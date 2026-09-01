/**
 * @fileoverview Layer 1: App Glue.
 * Connects WebRTC CameraManager, MediaPipe PoseEngine, Biomechanical MathEngine,
 * StateMachine, Web Audio SoundEngine, Web Speech VoiceCoach,
 * and 3D Holographic HUDRenderer + SummaryModal.
 */

import { CameraManager } from './core/cameraManager.js';
import { PoseEngine } from './core/poseEngine.js';
import { EXERCISE_RULES } from './config/exerciseRules.js';
import { calculate3DAngle, calculateIncline, getConfidenceScore } from './core/mathEngine.js';
import { StateMachine } from './logic/stateMachine.js';
import { SoundEngine } from './logic/soundEngine.js';
import { VoiceCoach } from './logic/voiceCoach.js';
import { HUDRenderer } from './ui/hudRenderer.js';
import { SummaryModal } from './ui/summaryModal.js';

document.addEventListener('DOMContentLoaded', () => {
  const webcam = /** @type {HTMLVideoElement|null} */ (document.getElementById('webcam'));
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('output-canvas'));
  const startBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('start-btn'));
  const switchBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('switch-btn'));
  const stopBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('stop-btn'));
  const logContainer = /** @type {HTMLElement|null} */ (document.getElementById('log'));
  const exerciseSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('exercise-select'));
  const toggleTelemetryBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('toggle-telemetry-btn'));
  const telemetryDrawerEl = /** @type {HTMLElement|null} */ (document.getElementById('telemetry-drawer'));

  // Spatial Floating HUD DOM elements
  const sessionTimerEl = document.getElementById('session-timer');
  const exerciseBadgeEl = document.getElementById('exercise-badge');
  const hudStatusBadgeEl = document.getElementById('hud-status-badge');
  const hudRepCountEl = document.getElementById('hud-rep-count');
  const hudStateDisplayEl = document.getElementById('hud-state-display');

  // Summary Modal DOM nodes
  const modalEl = document.getElementById('summary-modal');
  const repsEl = document.getElementById('stat-reps');
  const accuracyEl = document.getElementById('stat-accuracy');
  const angleEl = document.getElementById('stat-angle');
  const closeBtnEl = document.getElementById('modal-close-btn');

  if (!webcam || !canvas || !startBtn || !switchBtn || !stopBtn || !logContainer ||
      !modalEl || !repsEl || !accuracyEl || !angleEl || !closeBtnEl) {
    console.error('ApexForm AI: Failed to initialize application glue due to missing DOM nodes.');
    return;
  }

  const cameraManager = new CameraManager();
  const stateMachine = new StateMachine();
  const soundEngine = new SoundEngine();
  const voiceCoach = new VoiceCoach();
  const hudRenderer = new HUDRenderer(canvas);
  
  const summaryModal = new SummaryModal(
    /** @type {HTMLElement} */ (modalEl),
    /** @type {HTMLElement} */ (repsEl),
    /** @type {HTMLElement} */ (accuracyEl),
    /** @type {HTMLElement} */ (angleEl),
    /** @type {HTMLButtonElement} */ (closeBtnEl)
  );

  /** @type {number|null} */
  let frameRequestIdx = null;
  /** @type {boolean} */
  let isTrackingActive = false;
  /** @type {string|null} */
  let trackingState = null;

  /** @type {string} */
  let activeExercise = exerciseSelect ? exerciseSelect.value : 'SQUAT';
  /** @type {number} */
  let lastTelemetryTime = 0;
  /** @type {number} */
  const TELEMETRY_THROTTLE_MS = 500;

  // Session Stopwatch Timer
  /** @type {number} */
  let sessionStartTime = 0;
  /** @type {any} */
  let sessionTimerInterval = null;

  // FSM state trackers
  let lastRepCount = 0;
  let lastState = 'IDLE';

  // Biomechanical set analytics tracking variables
  /** @type {Array<{repNum: number, hadFault: boolean, peakAngle: number}>} */
  let completedReps = [];
  let currentRepHasFault = false;
  let currentRepMinAngle = 180;
  let initiatedRep = false;

  // Toggle Telemetry Drawer
  if (toggleTelemetryBtn && telemetryDrawerEl) {
    toggleTelemetryBtn.addEventListener('click', () => {
      telemetryDrawerEl.classList.toggle('telemetry-drawer--minimized');
      telemetryDrawerEl.classList.toggle('telemetry-drawer--expanded');
    });
  }

  /**
   * Starts active workout timer.
   */
  const startSessionTimer = () => {
    sessionStartTime = Date.now();
    if (sessionTimerInterval) clearInterval(sessionTimerInterval);
    
    sessionTimerInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - sessionStartTime) / 1000);
      const minutes = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const seconds = String(elapsedSec % 60).padStart(2, '0');
      if (sessionTimerEl) {
        sessionTimerEl.textContent = `${minutes}:${seconds}`;
      }
    }, 1000);
  };

  /**
   * Halts workout timer.
   */
  const stopSessionTimer = () => {
    if (sessionTimerInterval) {
      clearInterval(sessionTimerInterval);
      sessionTimerInterval = null;
    }
  };

  /**
   * Updates on-screen spatial floating glass badges.
   * 
   * @param {number} repCount
   * @param {string} currentState
   * @param {boolean} hasFault
   */
  const updateFloatingHUD = (repCount, currentState, hasFault) => {
    if (hudRepCountEl) {
      hudRepCountEl.textContent = String(repCount);
    }
    if (hudStateDisplayEl) {
      hudStateDisplayEl.textContent = currentState;
    }
    if (hudStatusBadgeEl) {
      hudStatusBadgeEl.className = 'hud-status-pill';
      if (hasFault) {
        hudStatusBadgeEl.classList.add('hud-status-pill--fault');
        hudStatusBadgeEl.textContent = 'FAULT';
      } else if (currentState === 'VALIDATED_SUCCESS') {
        hudStatusBadgeEl.classList.add('hud-status-pill--validated');
        hudStatusBadgeEl.textContent = 'SUCCESS';
      } else if (currentState === 'IN_PROGRESS') {
        hudStatusBadgeEl.classList.add('hud-status-pill--in-progress');
        hudStatusBadgeEl.textContent = 'ACTIVE';
      } else if (currentState === 'SETUP') {
        hudStatusBadgeEl.classList.add('hud-status-pill--active');
        hudStatusBadgeEl.textContent = 'ALIGNED';
      } else {
        hudStatusBadgeEl.classList.add('hud-status-pill--standby');
        hudStatusBadgeEl.textContent = 'STANDBY';
      }
    }
  };

  if (exerciseSelect) {
    exerciseSelect.addEventListener('change', () => {
      activeExercise = exerciseSelect.value;
      if (exerciseBadgeEl) {
        exerciseBadgeEl.textContent = activeExercise === 'SQUAT' ? 'SQUAT' : 'BICEP CURL';
      }
      writeLog(`Biomechanics target switched to: ${activeExercise}`);
      
      // Reset state machine parameters
      stateMachine.reset();
      lastRepCount = 0;
      lastState = 'IDLE';
      poseEngine.resetSmoothing();
      
      // Clean analytics accumulators
      completedReps = [];
      currentRepHasFault = false;
      currentRepMinAngle = 180;
      initiatedRep = false;

      // Reset spatial HUD badges
      updateFloatingHUD(0, 'STANDBY', false);

      // Clear visual frame overlay
      hudRenderer.clear();
    });
  }

  /**
   * Appends messages to the telemetry log container.
   * @param {string} msg Message to write.
   * @param {boolean} [isError=false] Mark as error visually.
   */
  const writeLog = (msg, isError = false) => {
    const time = new Date().toLocaleTimeString();
    const formatted = `[${time}] ${msg}`;
    
    const line = document.createElement('div');
    line.textContent = formatted;
    if (isError) {
      line.classList.add('log-panel__console-line--error');
      console.error(formatted);
    } else {
      console.log(formatted);
    }
    
    logContainer.appendChild(line);
    logContainer.scrollTop = logContainer.scrollHeight;
  };

  // Initialize PoseEngine with callback to process 3D landmarks at 60 FPS
  const poseEngine = new PoseEngine((results) => {
    const landmarks = results.poseLandmarks;
    const hasPose = !!(landmarks && landmarks.length > 0);
    const newState = hasPose ? 'detected' : 'searching';

    if (newState !== trackingState) {
      trackingState = newState;
      if (hasPose) {
        writeLog('3D Spatial Pose: Body Tracking Active (33 Landmarks)');
      } else {
        writeLog('Scanning field for human silhouette...');
      }
    }

    let currentAngle = 0;
    let torsoIncline = 0;
    let fsm = { currentState: 'IDLE', repCount: 0, hasFault: false, faultMessage: '' };

    if (hasPose) {
      // 1. Calculate Biomechanical Joint Angles
      if (activeExercise === 'SQUAT') {
        const joints = EXERCISE_RULES.SQUAT.joints;

        const hipL = landmarks[joints.hipLeft];
        const kneeL = landmarks[joints.kneeLeft];
        const ankleL = landmarks[joints.ankleLeft];
        const shoulderL = landmarks[joints.shoulderLeft];

        const hipR = landmarks[joints.hipRight];
        const kneeR = landmarks[joints.kneeRight];
        const ankleR = landmarks[joints.ankleRight];
        const shoulderR = landmarks[joints.shoulderRight];

        const confidenceL = getConfidenceScore(hipL, kneeL, ankleL, shoulderL);
        const confidenceR = getConfidenceScore(hipR, kneeR, ankleR, shoulderR);

        const isLeft = confidenceL >= confidenceR;
        const confidence = isLeft ? confidenceL : confidenceR;

        if (confidence >= 0.55) {
          const selectedHip = isLeft ? hipL : hipR;
          const selectedKnee = isLeft ? kneeL : kneeR;
          const selectedAnkle = isLeft ? ankleL : ankleR;
          const selectedShoulder = isLeft ? shoulderL : shoulderR;

          currentAngle = calculate3DAngle(selectedHip, selectedKnee, selectedAnkle);
          torsoIncline = calculateIncline(selectedShoulder, selectedHip);
        }
      } else if (activeExercise === 'BICEP_CURL') {
        const joints = EXERCISE_RULES.BICEP_CURL.joints;

        const shoulderL = landmarks[joints.shoulderLeft];
        const elbowL = landmarks[joints.elbowLeft];
        const wristL = landmarks[joints.wristLeft];

        const shoulderR = landmarks[joints.shoulderRight];
        const elbowR = landmarks[joints.elbowRight];
        const wristR = landmarks[joints.wristRight];

        const confidenceL = getConfidenceScore(shoulderL, elbowL, wristL);
        const confidenceR = getConfidenceScore(shoulderR, elbowR, wristR);

        const isLeft = confidenceL >= confidenceR;
        const confidence = isLeft ? confidenceL : confidenceR;

        if (confidence >= 0.55) {
          const selectedShoulder = isLeft ? shoulderL : shoulderR;
          const selectedElbow = isLeft ? elbowL : elbowR;
          const selectedWrist = isLeft ? wristL : wristR;

          currentAngle = calculate3DAngle(selectedShoulder, selectedElbow, selectedWrist);
        }
      }

      // 2. FSM state transition updates at 60 FPS
      fsm = stateMachine.update(activeExercise, currentAngle, torsoIncline);

      // Track peak angles and fault flags during active repetition phases
      if (fsm.currentState === 'IN_PROGRESS') {
        currentRepMinAngle = Math.min(currentRepMinAngle, currentAngle);
        
        // Track partial descents for voice coaching
        if (activeExercise === 'SQUAT' && currentAngle < 130) {
          initiatedRep = true;
        } else if (activeExercise === 'BICEP_CURL' && currentAngle < 110) {
          initiatedRep = true;
        }
      }

      if (fsm.hasFault) {
        currentRepHasFault = true;
      }

      // Voice coaching triggers for partial / incomplete range of motion
      if (initiatedRep) {
        if (activeExercise === 'SQUAT' && currentAngle > 150) {
          if (fsm.repCount === lastRepCount && !fsm.hasFault) {
            voiceCoach.speak('Go lower');
          }
          initiatedRep = false;
        } else if (activeExercise === 'BICEP_CURL' && currentAngle > 145) {
          if (fsm.repCount === lastRepCount && !fsm.hasFault) {
            voiceCoach.speak('Go higher');
          }
          initiatedRep = false;
        }
      }

      // 3. Audio & Vocal feedback on rep / fault events
      if (fsm.repCount > lastRepCount) {
        soundEngine.playSuccessChime();
        voiceCoach.speak('Good rep');

        // Archive completed rep metrics
        completedReps.push({
          repNum: fsm.repCount,
          hadFault: currentRepHasFault,
          peakAngle: currentRepMinAngle
        });

        // Reset trackers for next rep
        lastRepCount = fsm.repCount;
        currentRepHasFault = false;
        currentRepMinAngle = 180;
        initiatedRep = false;
      }

      if (fsm.currentState === 'FORM_FAULT' && lastState !== 'FORM_FAULT') {
        soundEngine.playFaultTone();
        if (activeExercise === 'SQUAT') {
          voiceCoach.speak('Chest up');
        }
      }
      lastState = fsm.currentState;

      // 4. Log text updates throttled to avoid layout thrashing
      const now = Date.now();
      if (now - lastTelemetryTime >= TELEMETRY_THROTTLE_MS) {
        lastTelemetryTime = now;
        const displayAngle = Math.round(currentAngle);
        let logLine = `Reps: ${fsm.repCount} | State: ${fsm.currentState} | Angle: ${displayAngle}°`;
        if (fsm.hasFault) {
          logLine += ` [FAULT: ${fsm.faultMessage}]`;
        }
        writeLog(logLine);
      }
    } else {
      fsm = {
        currentState: stateMachine.currentState,
        repCount: stateMachine.repCount,
        hasFault: stateMachine.hasFault,
        faultMessage: stateMachine.faultMessage
      };
    }

    // 5. Update Spatial HTML Floating Badges
    updateFloatingHUD(fsm.repCount, fsm.currentState, fsm.hasFault);

    // 6. Render 3D Holographic Skeletal Canvas at 60 FPS
    hudRenderer.render({
      landmarks: hasPose ? landmarks : [],
      activeAngle: currentAngle,
      activeExercise,
      currentState: fsm.currentState,
      repCount: fsm.repCount,
      hasFault: fsm.hasFault,
      faultMessage: fsm.faultMessage
    });
  });

  /**
   * Continuous animation loop with Retina HiDPI buffer synchronization.
   */
  const processFrameLoop = async () => {
    if (!isTrackingActive) {
      return;
    }

    // Sync canvas buffer with Retina devicePixelRatio
    if (webcam.videoWidth > 0 && webcam.videoHeight > 0) {
      hudRenderer.syncDimensions(webcam.videoWidth, webcam.videoHeight);
    }

    if (webcam.readyState >= webcam.HAVE_CURRENT_DATA && !webcam.paused && !webcam.ended) {
      try {
        await poseEngine.sendFrame(webcam);
      } catch (error) {
        console.error('PoseEngine: Frame processing failed in animation loop:', error);
      }
    }

    frameRequestIdx = requestAnimationFrame(processFrameLoop);
  };

  /**
   * Starts tracking pipeline.
   */
  const startTracking = async () => {
    writeLog('Initializing 3D Pose Extraction Engine...');
    await poseEngine.init();
    
    isTrackingActive = true;
    trackingState = null;
    poseEngine.resetSmoothing();
    
    // Reset state parameters
    stateMachine.reset();
    lastRepCount = 0;
    lastState = 'IDLE';

    // Reset analytics trackers
    completedReps = [];
    currentRepHasFault = false;
    currentRepMinAngle = 180;
    initiatedRep = false;

    // Start session timer and update HUD
    startSessionTimer();
    updateFloatingHUD(0, 'SETUP', false);

    if (frameRequestIdx) {
      cancelAnimationFrame(frameRequestIdx);
    }
    frameRequestIdx = requestAnimationFrame(processFrameLoop);
  };

  /**
   * Halts detection pipeline.
   */
  const stopTracking = () => {
    isTrackingActive = false;
    if (frameRequestIdx) {
      cancelAnimationFrame(frameRequestIdx);
      frameRequestIdx = null;
    }
    poseEngine.resetSmoothing();
    
    // Halt session timer
    stopSessionTimer();

    // Clear canvas visual state
    hudRenderer.clear();

    // Clean states
    stateMachine.reset();
    lastRepCount = 0;
    lastState = 'IDLE';
    trackingState = null;

    updateFloatingHUD(0, 'STANDBY', false);
  };

  /**
   * Updates state of control buttons.
   * @param {boolean} isStreaming True if stream is active.
   */
  const updateUIState = (isStreaming) => {
    startBtn.disabled = isStreaming;
    switchBtn.disabled = !isStreaming;
    stopBtn.disabled = !isStreaming;
  };

  startBtn.addEventListener('click', async () => {
    // Unlock AudioContext defensively inside user gesture block
    soundEngine.unlockContext();
    voiceCoach.speak('Workout started');
    
    writeLog('Acquiring camera optical feed...');
    startBtn.disabled = true;

    try {
      const stream = await cameraManager.startStream(webcam);
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        writeLog(`Optics active: ${settings.width}x${settings.height} (${cameraManager.getFacingMode()})`);
      } else {
        writeLog('Optics active, but no video track found.', true);
      }
      
      await startTracking();
      updateUIState(true);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorCat = error && typeof error === 'object' && 'category' in error ? error.category : 'ERROR';
      writeLog(`Stream failed: [${errorCat}] ${errorMsg}`, true);
      updateUIState(false);
    }
  });

  switchBtn.addEventListener('click', async () => {
    writeLog('Toggling optical lens...');
    switchBtn.disabled = true;

    try {
      poseEngine.resetSmoothing();
      const stream = await cameraManager.toggleCamera();
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        writeLog(`Optics switched: ${settings.width}x${settings.height} (${cameraManager.getFacingMode()})`);
      }
      switchBtn.disabled = false;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorCat = error && typeof error === 'object' && 'category' in error ? error.category : 'ERROR';
      writeLog(`Toggle failed: [${errorCat}] ${errorMsg}`, true);
      switchBtn.disabled = false;
    }
  });

  stopBtn.addEventListener('click', () => {
    writeLog('Terminating optical stream...');
    voiceCoach.speak('Workout paused');
    
    // Evaluate set analytics
    const totalRepsCount = completedReps.length;
    let accuracyRate = 100;
    let avgDepthAngle = 0;

    if (totalRepsCount > 0) {
      const flawlessRepsCount = completedReps.filter(r => !r.hadFault).length;
      accuracyRate = (flawlessRepsCount / totalRepsCount) * 100;
      
      const angleAccumulator = completedReps.reduce((sum, r) => sum + r.peakAngle, 0);
      avgDepthAngle = angleAccumulator / totalRepsCount;
    }

    // Stop all WebRTC tracks and frame loops
    stopTracking();
    cameraManager.stopStream();
    writeLog('Session completed and archived.');
    updateUIState(false);

    // Launch analytics card
    summaryModal.open({
      totalReps: totalRepsCount,
      accuracyRate,
      avgDepthAngle,
      exerciseKey: activeExercise
    });
  });
});
