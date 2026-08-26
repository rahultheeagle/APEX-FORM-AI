/**
 * @fileoverview Layer 1: App Glue.
 * Binds UI control panel events, Layer 5 CameraManager, Layer 4 PoseEngine, 
 * Layer 3 MathEngine, and Layer 2 StateMachine + SoundEngine together.
 */

import { CameraManager } from './core/cameraManager.js';
import { PoseEngine } from './core/poseEngine.js';
import { EXERCISE_RULES } from './config/exerciseRules.js';
import { calculate3DAngle, calculateIncline, getConfidenceScore } from './core/mathEngine.js';
import { StateMachine } from './logic/stateMachine.js';
import { SoundEngine } from './logic/soundEngine.js';

document.addEventListener('DOMContentLoaded', () => {
  const webcam = /** @type {HTMLVideoElement|null} */ (document.getElementById('webcam'));
  const startBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('start-btn'));
  const switchBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('switch-btn'));
  const stopBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('stop-btn'));
  const logContainer = /** @type {HTMLElement|null} */ (document.getElementById('log'));
  const exerciseSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('exercise-select'));

  if (!webcam || !startBtn || !switchBtn || !stopBtn || !logContainer) {
    console.error('ApexForm AI: Failed to initialize application glue due to missing DOM nodes.');
    return;
  }

  const cameraManager = new CameraManager();
  const stateMachine = new StateMachine();
  const soundEngine = new SoundEngine();

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

  // Trackers to detect transitions
  let lastRepCount = 0;
  let lastState = 'IDLE';

  if (exerciseSelect) {
    exerciseSelect.addEventListener('change', () => {
      activeExercise = exerciseSelect.value;
      writeLog(`Exercise rules switched to: ${activeExercise}`);
      
      // Reset state machine on switch
      stateMachine.reset();
      lastRepCount = 0;
      lastState = 'IDLE';
      poseEngine.resetSmoothing();
    });
  }

  /**
   * Appends messages to the console container.
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

  /**
   * Evaluates biomechanical angles and feeds them to the FSM.
   * @param {Array<any>} landmarks Smoothed keypoint landmarks.
   */
  const processTelemetry = (landmarks) => {
    if (activeExercise === 'SQUAT') {
      const joints = EXERCISE_RULES.SQUAT.joints;
      const thresholds = EXERCISE_RULES.SQUAT.thresholds;

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

      if (confidence < 0.55) {
        writeLog('Telemetry: Low tracking confidence. Please adjust your body position.');
        return;
      }

      const selectedHip = isLeft ? hipL : hipR;
      const selectedKnee = isLeft ? kneeL : kneeR;
      const selectedAnkle = isLeft ? ankleL : ankleR;
      const selectedShoulder = isLeft ? shoulderL : shoulderR;

      const kneeAngle = calculate3DAngle(selectedHip, selectedKnee, selectedAnkle);
      const torsoIncline = calculateIncline(selectedShoulder, selectedHip);

      // FSM state transition evaluation
      const fsm = stateMachine.update('SQUAT', kneeAngle, torsoIncline);

      // Audio feedback triggers
      if (fsm.repCount > lastRepCount) {
        soundEngine.playSuccessChime();
        lastRepCount = fsm.repCount;
      }
      if (fsm.currentState === 'FORM_FAULT' && lastState !== 'FORM_FAULT') {
        soundEngine.playFaultTone();
      }
      lastState = fsm.currentState;

      // Telemetry log output formatting
      const displayAngle = Math.round(kneeAngle);
      let logLine = `Reps: ${fsm.repCount} | State: ${fsm.currentState} | Angle: ${displayAngle}°`;
      if (fsm.hasFault) {
        logLine += ` [FAULT: ${fsm.faultMessage}]`;
      }
      writeLog(logLine);

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

      if (confidence < 0.55) {
        writeLog('Telemetry: Low tracking confidence. Make sure your arm is visible.');
        return;
      }

      const selectedShoulder = isLeft ? shoulderL : shoulderR;
      const selectedElbow = isLeft ? elbowL : elbowR;
      const selectedWrist = isLeft ? wristL : wristR;

      const elbowAngle = calculate3DAngle(selectedShoulder, selectedElbow, selectedWrist);

      // FSM state transition evaluation
      const fsm = stateMachine.update('BICEP_CURL', elbowAngle);

      // Audio feedback triggers
      if (fsm.repCount > lastRepCount) {
        soundEngine.playSuccessChime();
        lastRepCount = fsm.repCount;
      }
      if (fsm.currentState === 'FORM_FAULT' && lastState !== 'FORM_FAULT') {
        soundEngine.playFaultTone();
      }
      lastState = fsm.currentState;

      const displayAngle = Math.round(elbowAngle);
      let logLine = `Reps: ${fsm.repCount} | State: ${fsm.currentState} | Angle: ${displayAngle}°`;
      if (fsm.hasFault) {
        logLine += ` [FAULT: ${fsm.faultMessage}]`;
      }
      writeLog(logLine);
    }
  };

  // Initialize PoseEngine with a callback to calculate and feed FSM
  const poseEngine = new PoseEngine((results) => {
    const hasPose = !!(results && results.poseLandmarks && results.poseLandmarks.length > 0);
    const newState = hasPose ? 'detected' : 'searching';

    if (newState !== trackingState) {
      trackingState = newState;
      if (hasPose) {
        writeLog('Pose Tracking: Full Body Detected (33 Landmarks)');
      } else {
        writeLog('Searching for body...');
      }
    }

    if (hasPose) {
      const now = Date.now();
      if (now - lastTelemetryTime >= TELEMETRY_THROTTLE_MS) {
        lastTelemetryTime = now;
        processTelemetry(results.poseLandmarks);
      }
    }
  });

  /**
   * Continuous processing loop dispatching frames to PoseEngine.
   */
  const processFrameLoop = async () => {
    if (!isTrackingActive) {
      return;
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
   * Starts coordinates detection.
   */
  const startTracking = async () => {
    writeLog('Initializing Pose Landmark Engine...');
    await poseEngine.init();
    
    isTrackingActive = true;
    trackingState = null;
    poseEngine.resetSmoothing();
    
    // Reset state parameters
    stateMachine.reset();
    lastRepCount = 0;
    lastState = 'IDLE';

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
    
    // Clean states
    stateMachine.reset();
    lastRepCount = 0;
    lastState = 'IDLE';
    trackingState = null;
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
    
    writeLog('Requesting camera stream...');
    startBtn.disabled = true;

    try {
      const stream = await cameraManager.startStream(webcam);
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        writeLog(`Camera active: ${settings.width}x${settings.height} (${cameraManager.getFacingMode()})`);
      } else {
        writeLog('Camera active, but no video track found.', true);
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
    writeLog('Toggling facing mode...');
    switchBtn.disabled = true;

    try {
      poseEngine.resetSmoothing();
      const stream = await cameraManager.toggleCamera();
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        writeLog(`Switched camera: ${settings.width}x${settings.height} (${cameraManager.getFacingMode()})`);
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
    writeLog('Releasing video streams...');
    stopTracking();
    cameraManager.stopStream();
    writeLog('Stream terminated.');
    updateUIState(false);
  });
});
