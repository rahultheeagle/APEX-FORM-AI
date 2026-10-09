/**
 * @fileoverview Layer 1: 3D Holographic Biomechanical Canvas HUD Renderer.
 * High-performance 60 FPS AR spatial pipeline featuring:
 * - 3D floor perspective grid projecting beneath feet
 * - Dynamic velocity-color-graded bar path / joint trajectory ribbon
 * - Real-time bilateral symmetry balance HUD gauge
 * - Knee cave (Valgus) outward corrective warning vectors
 * - Multi-layered neon holographic skeleton with Z-depth perception
 */

/**
 * Skeletal segment connections by MediaPipe Pose landmark indices.
 * @type {Array<[number, number]>}
 */
const SKELETON_CONNECTIONS = [
  // Torso outer box
  [11, 12], [12, 24], [24, 23], [23, 11],
  // Left Arm: Shoulder -> Elbow -> Wrist
  [11, 13], [13, 15],
  // Right Arm: Shoulder -> Elbow -> Wrist
  [12, 14], [14, 16],
  // Left Leg: Hip -> Knee -> Ankle
  [23, 25], [25, 27],
  // Right Leg: Hip -> Knee -> Ankle
  [24, 26], [26, 28]
];

/**
 * Landmark indices for major articulated joints.
 * @type {number[]}
 */
const MAJOR_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

/**
 * Holographic Palette tokens.
 */
const HOLO_COLORS = {
  CYAN: '#00f2fe',
  CYAN_ALPHA: 'rgba(0, 242, 254, 0.45)',
  AMBER: '#f59e0b',
  AMBER_ALPHA: 'rgba(245, 158, 11, 0.45)',
  MINT: '#00ff87',
  MINT_ALPHA: 'rgba(0, 255, 135, 0.5)',
  CRIMSON: '#ff0055',
  CRIMSON_ALPHA: 'rgba(255, 0, 85, 0.55)',
  MAGENTA: '#ff00ea',
  MAGENTA_ALPHA: 'rgba(255, 0, 234, 0.5)',
  WHITE: '#ffffff',
};

export class HUDRenderer {
  /**
   * @param {HTMLCanvasElement} canvas Target drawing canvas.
   */
  constructor(canvas) {
    if (!canvas) {
      throw new Error('HUDRenderer: Valid HTMLCanvasElement required.');
    }
    
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;

    /** @type {CanvasRenderingContext2D} */
    this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { alpha: true }));

    /** @type {number} */
    this.dpr = window.devicePixelRatio || 1;
    /** @type {number} */
    this.logicalWidth = 640;
    /** @type {number} */
    this.logicalHeight = 480;

    /** @type {Array<{ x: number, y: number, timestamp?: number }>} Rolling 60-frame wrist midpoint trajectory */
    this.wristHistory = [];

    /** @type {Array<Object>} Kinetic chain golden particles streaming along the skeleton */
    this.kineticParticles = [];
  }

  /**
   * Appends a wrist midpoint coordinate to the 60-frame rolling trajectory.
   * @param {{ x: number, y: number }} point
   */
  addWristPoint(point) {
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return;
    this.wristHistory.push({ x: point.x, y: point.y, timestamp: performance.now() });
    if (this.wristHistory.length > 60) {
      this.wristHistory.shift();
    }
  }

  /**
   * Clears active wrist trajectory trail.
   */
  clearWristHistory() {
    this.wristHistory = [];
  }

  /**
   * Synchronizes buffer size with HiDPI display pixel ratios.
   * 
   * @param {number} width Logical video width.
   * @param {number} height Logical video height.
   */
  syncDimensions(width, height) {
    if (width <= 0 || height <= 0) return;
    
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.logicalWidth = width;
    this.logicalHeight = height;

    const scaledWidth = Math.round(width * dpr);
    const scaledHeight = Math.round(height * dpr);

    if (this.canvas.width !== scaledWidth || this.canvas.height !== scaledHeight) {
      this.canvas.width = scaledWidth;
      this.canvas.height = scaledHeight;
    }
  }

  /**
   * Clears the canvas buffer.
   */
  clear() {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  /**
   * Calculates a normalized depth factor [0.35, 1.0] from a landmark Z coordinate.
   * 
   * @param {number} [z=0]
   * @returns {number}
   * @private
   */
  _getDepthFactor(z = 0) {
    const clampedZ = Math.max(-0.6, Math.min(0.6, z));
    const normalized = (0.6 - clampedZ) / 1.2;
    return 0.35 + (0.65 * normalized);
  }

  /**
   * Resolves the holographic color theme based on exercise angle and fault state.
   * 
   * @param {number} angle
   * @param {boolean} hasFault
   * @returns {{ solid: string, alpha: string, label: string }}
   * @private
   */
  _getTheme(angle, hasFault) {
    if (hasFault) {
      return { solid: HOLO_COLORS.CRIMSON, alpha: HOLO_COLORS.CRIMSON_ALPHA, label: 'FORM FAULT' };
    }
    if (angle > 140) {
      return { solid: HOLO_COLORS.CYAN, alpha: HOLO_COLORS.CYAN_ALPHA, label: 'SETUP / STANDING' };
    }
    if (angle > 90) {
      return { solid: HOLO_COLORS.AMBER, alpha: HOLO_COLORS.AMBER_ALPHA, label: 'DESCENT PHASE' };
    }
    return { solid: HOLO_COLORS.MINT, alpha: HOLO_COLORS.MINT_ALPHA, label: 'TARGET DEPTH' };
  }

  /**
   * Main 60 FPS holographic render call.
   * 
   * @param {Object} payload
   * @param {Array<any>} [payload.landmarks]
   * @param {number} payload.activeAngle
   * @param {string} payload.activeExercise
   * @param {string} payload.currentState
   * @param {number} payload.repCount
   * @param {boolean} payload.hasFault
   * @param {string} payload.faultMessage
   * @param {Array<any>} [payload.barPath]
   * @param {Object} [payload.symmetry]
   * @param {Object} [payload.valgusResult]
   */
  render({
    landmarks,
    activeAngle,
    activeExercise,
    currentState,
    repCount,
    hasFault,
    faultMessage,
    barPath = [],
    symmetry = null,
    valgusResult = null,
    gesture = null,
    cadence = null,
    calibration = null,
    laserDepth = null,
    rirData = null,
    rhythmGame = null,
    centerOfMass = null,
    powerTelemetry = null,
    exerciseBanner = null,
    strainData = null,
    isTwinActive = false,
    hrData = null,
    peerData = null,
    wristMidpoint = null,
    wristHistory = null,
    smoothnessData = null,
    perspectiveData = null,
    workData = null,
    laserConstraints = null,
    rppgData = null,
    virtualGimbal = null,
    safetySpotterData = null,
    spineData = null,
    personTrackerData = null,
    phaseSpaceData = null,
    barbellData = null,
    valsalvaData = null,
    mobilityData = null,
    kineticChainData = null,
    voiceStatus = null,
    dvrReplay = null,
    transverseData = null,
    imuStatus = null,
    sscData = null,
    efficiencyData = null,
    romRadarData = null,
    rpeData = null,
    ghostSkeleton = null,
    cheatData = null,
    cnsData = null,
    shaderStatus = null,
    crepitusData = null,
    inertiaData = null
  }) {
    this.clear();

    if (!landmarks || landmarks.length === 0) {
      if (voiceStatus || dvrReplay || imuStatus || sscData || efficiencyData || romRadarData || rpeData || cheatData || cnsData || shaderStatus || inertiaData) {
        this.ctx.save();
        this.ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
        if (voiceStatus) {
          this.drawVoiceIndicator(this.ctx, voiceStatus, this.logicalWidth, this.logicalHeight, performance.now());
        }
        if (efficiencyData) {
          this.drawBarEfficiencyBadge(this.ctx, efficiencyData, this.logicalWidth, this.logicalHeight, performance.now());
        }
        if (cheatData) {
          this.drawCheatGauge(this.ctx, cheatData, this.logicalWidth, this.logicalHeight, performance.now());
        }
        if (cnsData) {
          this.drawCnsTremorRadar(this.ctx, cnsData, this.logicalWidth, this.logicalHeight, performance.now());
        }
        if (shaderStatus) {
          this.drawShaderStatus(this.ctx, shaderStatus, this.logicalWidth, this.logicalHeight, performance.now());
        }
        if (rpeData) {
          this.drawRpeBadge(this.ctx, rpeData, this.logicalWidth, this.logicalHeight, performance.now());
        }
        if (inertiaData) {
          this.drawInertiaGauge(this.ctx, inertiaData, this.logicalWidth, this.logicalHeight, performance.now());
        }
        if (dvrReplay) {
          this.drawDvrWindow(this.ctx, dvrReplay, this.logicalWidth, this.logicalHeight, performance.now());
        }
        if (imuStatus) {
          this.drawImuStatus(this.ctx, imuStatus, this.logicalWidth, this.logicalHeight, performance.now());
        }
        if (sscData) {
          this.drawSscAmortizationMeter(this.ctx, sscData, this.logicalWidth, this.logicalHeight, performance.now());
        }
        if (romRadarData) {
          this.drawPolarMobilityRadar(this.ctx, romRadarData, this.logicalWidth, this.logicalHeight, performance.now());
        }
        this.ctx.restore();
      }
      return;
    }

    const dpr = this.dpr || 1;
    const width = this.logicalWidth;
    const height = this.logicalHeight;
    const now = performance.now();

    this.ctx.save();
    // Scale context for Retina/HiDPI displays
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const theme = this._getTheme(activeAngle, hasFault);

    // Update Virtual Gimbal auto-zoom and pan viewport
    if (virtualGimbal && landmarks && landmarks.length > 0) {
      virtualGimbal.calculateViewport(landmarks, width, height);
    }

    // Apply Virtual Gimbal transformation for athlete-centered spatial elements
    if (virtualGimbal) {
      virtualGimbal.applyTransform(this.ctx);
    }

    // 1. AR 3D Floor Perspective Grid (below feet)
    this._renderFloorGrid(landmarks, width, height, now);

    // 1b. Primary Athlete Isolation Glow (Ground Perimeter Holographic Boundary Cage)
    if (personTrackerData) {
      this._renderPrimaryAthleteIsolation(personTrackerData, landmarks, width, height, now);
    }

    // Record wrist midpoint if provided
    if (wristMidpoint) {
      this.addWristPoint(wristMidpoint);
    }

    // 2. Trailing Luminous Bar Path Ribbon (60-frame interactive barbell tracer)
    const activeWristHistory = wristHistory || this.wristHistory;
    if (activeWristHistory && activeWristHistory.length > 1) {
      this.renderBarPath(activeWristHistory, width, height);
    } else if (barPath && barPath.length > 1) {
      this._renderBarPath(barPath, width, height);
    }

    // 3. 3D Depth-Modulated Multi-Layered Bones
    this._renderHolographicBones(landmarks, activeExercise, theme, hasFault, width, height);

    // 3b. Multi-Rep Ghost Skeleton Onion-Skin (translucent baseline Rep 1 comparison)
    if (ghostSkeleton) {
      this._renderGhostOnionSkin(ghostSkeleton, landmarks, width, height);
    }

    // 4. Articulated Concentric Joint Nodes
    this._renderArticulatedNodes(landmarks, activeExercise, theme, now, width, height);

    // 5. 3D Biomechanical Radial Angle Gauge
    this._renderRadialAngleGauge(landmarks, activeExercise, activeAngle, theme, now, width, height);

    // 7. Knee Cave (Valgus) Outward Corrective Warning Vectors
    if (valgusResult && valgusResult.hasValgus && activeExercise === 'SQUAT') {
      this._renderValgusWarning(valgusResult, width, height, now);
    }

    // 15. Center-of-Mass AR Plumb Line & Floor Balance Ring
    if (centerOfMass && landmarks && landmarks.length >= 25) {
      this._renderCenterOfMassPlumbLine(centerOfMass, landmarks, width, height);
    }

    // 25. AR Spatial Laser Constraints & Movement Corridor Boundaries
    if (laserConstraints) {
      this._renderLaserConstraints(laserConstraints, width, height, now);
    }

    // 28. Articulated Glowing Segmented Spine Ladder Overlay
    if (spineData) {
      this._renderSpineLadder(spineData, width, height, now);
    }

    // 30. Barbell Collinear Level Gauge & Aircraft Roll Indicator
    if (barbellData && barbellData.isVisible) {
      this._renderBarbellLevelGauge(barbellData, width, height, now);
    }

    // 31. Core Bracing (Valsalva Maneuver) HUD Midsection Shield
    if (valsalvaData) {
      this._renderValsalvaShield(valsalvaData, landmarks, width, height, now);
    }

    // 32. Ankle Dorsiflexion Arc & Premature Heel-Rise Detection
    if (mobilityData && mobilityData.isVisible) {
      this._renderAnkleDorsiflexion(mobilityData, landmarks, width, height, now);
    }

    // 33. Kinetic Chain Golden Skeletal Particle Stream (Triple Extension)
    if (kineticChainData) {
      this._renderKineticParticleStream(kineticChainData, landmarks, width, height, now);
    }

    // Reset Virtual Gimbal transformation back to screen-space for HUD chrome
    if (virtualGimbal) {
      virtualGimbal.resetTransform(this.ctx);
    }

    // 6. Bilateral Symmetry Real-Time HUD Balance Bar
    if (symmetry) {
      this._renderSymmetryGauge(symmetry, width, height);
    }

    // 8. Hands-Free Gesture Hold Confirmation Ring
    if (gesture && gesture.holdProgress > 0) {
      this._renderGestureHoldRing(gesture, width, height);
    }

    // 9. 3-1-1 Cadence Tempo Pace Ring
    if (cadence) {
      this._renderCadenceRing(cadence, width, height);
    }

    // 10. Autonomous Calibration Reticle & Top Guidance Pill
    if (calibration && !calibration.isSteadyCalibrated) {
      this._renderCalibrationReticle(calibration, width, height, now);
    }

    // 11. Viewport Orientation Badge (Profile vs Frontal)
    if (calibration) {
      this._renderViewportBadge(calibration, width, height);
    }

    // 12. AR Laser Depth Plane & Shockwave Particles
    if (laserDepth && laserDepth.targetY > 0) {
      this.drawLaserPlane(laserDepth.targetY, laserDepth.isTriggered, width, height, now);
    }

    // 13. Real-Time RIR (Reps in Reserve) & Fatigue Decay Gauge
    if (rirData) {
      this._renderRIRBadge(rirData, width, height);
    }

    // 14. AR Kinetic Rhythm Target Orbs & Particles
    if (rhythmGame && rhythmGame.isEnabled) {
      rhythmGame.render(this.ctx, width, height, now);
      if (rhythmGame.comboStreak > 0) {
        this._renderComboBadge(rhythmGame.comboStreak, rhythmGame.getMultiplier(), rhythmGame.getComboTierLabel(), width, height, now);
      }
    }

    // 16. Concentric Mechanical Power Meter (Watts)
    if (powerTelemetry && powerTelemetry.watts > 0) {
      this._renderPowerMeter(powerTelemetry, width, height);
    }

    // 17. Dynamic Exercise Mode Switch Banner
    if (exerciseBanner && now - exerciseBanner.timestamp < 2500) {
      this._renderExerciseBanner(exerciseBanner, width, height, now);
    }

    // 18. Laser Crimson Fault Warning Banner
    if (hasFault && faultMessage) {
      this._renderFaultBanner(faultMessage, width, height, now);
    }

    // 19. 3D Spatial Digital Twin & Kinetic Muscle Strain Telemetry Card
    if (strainData && isTwinActive) {
      this._renderMuscleStrainCard(strainData, width, height, now);
    }

    // 20. Web Bluetooth Biometric Heart Rate Telemetry & EKG Waveform
    if (hrData && (hrData.connected || hrData.bpm > 0)) {
      this._renderHeartRateTelemetry(hrData, width, height, now);
    }

    // 21. Low-Bandwidth Co-Op Peer Telemetry & Ghost Athlete Skeleton
    if (peerData && peerData.isConnected && peerData.landmarks) {
      this._renderPeerGhostOverlay(peerData.landmarks, peerData.metadata, width, height, now);
    }

    // 22. Motor Smoothness Index & Dimensionless Jerk Waveform
    if (smoothnessData) {
      this._renderSmoothnessGauge(smoothnessData, width, height, now);
    }

    // 23. Perspective Horizon Reticle (Camera Tilt Level)
    if (perspectiveData) {
      this._renderHorizonReticle(perspectiveData, width, height, now);
    }

    // 24. Cyber Kinetic Energy Battery Cell (Top-Left HUD)
    if (workData) {
      this._renderEnergyBattery(workData, width, height, now);
    }

    // 26. Rest-Mode Facial Optical Pulse (rPPG) Telemetry Card & Forehead Reticle
    if (rppgData && (rppgData.bpm > 0 || rppgData.faceBox)) {
      this._renderRPPGCard(rppgData, width, height, now);
    }

    // 27. Biomechanical Sticking-Point Safety Spotter HUD Overlay
    if (safetySpotterData) {
      this._renderSafetySpotter(safetySpotterData, width, height, now);
    }

    // 29. Phase-Plane HUD Radar (Position vs. Velocity Trajectory & Sticking Horizon)
    if (phaseSpaceData) {
      this._renderPhasePlaneRadar(phaseSpaceData, width, height, now);
    }

    // 34. Kinetic Chain Sequencing Telemetry Card & Waterfall Graph
    if (kineticChainData) {
      this._renderKineticChainCard(kineticChainData, width, height, now);
    }

    // 35. Voice Command Mic Status Indicator (Top-Left HUD)
    if (voiceStatus) {
      this.drawVoiceIndicator(this.ctx, voiceStatus, width, height, now);
    }

    // 36. Slow-Motion Fault Replay DVR Window (Lower-Left PiP)
    if (dvrReplay) {
      this.drawDvrWindow(this.ctx, dvrReplay, width, height, now);
    }

    // 37. Transverse Gyro HUD Compass (Upper-Left Radar Disc)
    if (transverseData) {
      this.drawTransverseCompass(this.ctx, transverseData, width, height, now);
    }

    // 38. IMU Hardware Sensor Stabilization Status (Bottom-Left Pill Badge)
    if (imuStatus) {
      this.drawImuStatus(this.ctx, imuStatus, width, height, now);
    }

    // 39. Tendon Stretch-Shortening Cycle (SSC) Amortization Meter (Bottom-Center Cyber Dial)
    if (sscData) {
      this.drawSscAmortizationMeter(this.ctx, sscData, width, height, now);
    }

    // 40. Bar Path Mechanical Efficiency Ratio (MER) Badge (Upper-Left Pill Card)
    if (efficiencyData) {
      this.drawBarEfficiencyBadge(this.ctx, efficiencyData, width, height, now);
    }

    // 41. 3D Joint Polar Mobility Radar (Lower-Right Overhead Radar Sweep)
    if (romRadarData) {
      this.drawPolarMobilityRadar(this.ctx, romRadarData, width, height, now);
    }

    // 42. Velocity-Loss Objective RPE HUD Badge (Top-Right Cyber Badge with Mini-Graph)
    if (rpeData) {
      this.drawRpeBadge(this.ctx, rpeData, width, height, now);
    }

    // 43. Momentum Pelvic Sway & Strictness HUD Gauge (Top-Left Pill)
    if (cheatData) {
      this.drawCheatGauge(this.ctx, cheatData, width, height, now);
    }

    // 44. Central Nervous System (CNS) Tremor Radar & Neuromuscular Pulse (Top-Left Pill)
    if (cnsData) {
      this.drawCnsTremorRadar(this.ctx, cnsData, width, height, now);
    }

    // 45. WebGL Low-Light Contrast Normalization Shader Status (Top-Left Ambient Pill)
    if (shaderStatus) {
      this.drawShaderStatus(this.ctx, shaderStatus, width, height, now);
    }

    // 46. Rotational Moment of Inertia & Angular Momentum Gauge (Top-Right HUD)
    if (inertiaData) {
      this.drawInertiaGauge(this.ctx, inertiaData, width, height, now);
    }

    // 47. Joint Crepitus Acoustic Profiler & Mini Spectrogram Wave
    if (crepitusData && landmarks && landmarks.length >= 27) {
      this._renderCrepitusPill(this.ctx, crepitusData, landmarks, activeExercise, width, height, now);
    }

    this.ctx.restore();
  }

  /**
   * Renders the top-center Motor Smoothness circular gauge and real-time waveform.
   * Flattens from a harmonic wave into an erratic jagged line when jerk exceeds thresholds.
   * 
   * @param {{ smoothnessScore: number, isJittery: boolean, dimensionlessJerk?: number }} smoothnessData
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderSmoothnessGauge(smoothnessData, width, height, now) {
    if (!smoothnessData) return;

    const ctx = this.ctx;
    const score = typeof smoothnessData.smoothnessScore === 'number'
      ? Math.max(0, Math.min(100, Math.round(smoothnessData.smoothnessScore)))
      : 100;
    const isJittery = Boolean(smoothnessData.isJittery);

    const cardW = 230;
    const cardH = 36;
    const x = (width - cardW) / 2;
    const y = 14;

    const themeColor = isJittery
      ? HOLO_COLORS.CRIMSON
      : (score >= 85 ? HOLO_COLORS.MINT : HOLO_COLORS.CYAN);

    ctx.save();

    // 1. Glassmorphic pill container
    ctx.fillStyle = 'rgba(10, 15, 29, 0.85)';
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = isJittery ? 2.0 : 1.2;
    ctx.shadowBlur = isJittery ? 14 : 8;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, cardW, cardH, 8);
    ctx.fill();
    ctx.stroke();

    // 2. Circular Mini-Gauge on Left
    const gaugeCenterX = x + 22;
    const gaugeCenterY = y + (cardH / 2);
    const gaugeRadius = 11;

    // Track circle
    ctx.beginPath();
    ctx.arc(gaugeCenterX, gaugeCenterY, gaugeRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Active progress arc
    const startAngle = -0.5 * Math.PI;
    const endAngle = startAngle + ((score / 100) * 2 * Math.PI);
    ctx.beginPath();
    ctx.arc(gaugeCenterX, gaugeCenterY, gaugeRadius, startAngle, endAngle);
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.shadowBlur = isJittery ? 12 : 6;
    ctx.shadowColor = themeColor;
    ctx.stroke();

    // Center pulse dot
    const pulseDotScale = isJittery ? (Math.sin(now / 80) * 0.5 + 1.5) : 1.0;
    ctx.beginPath();
    ctx.arc(gaugeCenterX, gaugeCenterY, 3 * pulseDotScale, 0, Math.PI * 2);
    ctx.fillStyle = themeColor;
    ctx.fill();

    // 3. Smoothness Text & Metrics (Unmirrored for left-to-right reading)
    const textCenterX = x + 88;
    this._drawUnmirroredText(
      'MOTOR SMOOTHNESS',
      textCenterX,
      y + 11,
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      '#94a3b8',
      'center'
    );

    const statusLabel = isJittery ? 'JITTER DETECTED' : `${score}/100`;
    this._drawUnmirroredText(
      `SMOOTHNESS: ${statusLabel}`,
      textCenterX,
      y + 24,
      'bold 9px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'center'
    );

    // 4. Kinetic Waveform / Oscilloscope on Right
    const waveBoxX = x + 152;
    const waveBoxY = y + 6;
    const waveBoxW = 68;
    const waveBoxH = cardH - 12;

    ctx.save();
    ctx.beginPath();
    ctx.rect(waveBoxX, waveBoxY, waveBoxW, waveBoxH);
    ctx.clip();

    ctx.beginPath();
    const waveCenterY = waveBoxY + (waveBoxH / 2);

    if (isJittery) {
      // Erratic, jagged line with high-frequency spikes when jerk exceeds threshold
      for (let i = 0; i <= waveBoxW; i += 3) {
        const px = waveBoxX + i;
        const spike = Math.sin((i * 1.7) + (now / 35)) * 6.5
          + Math.cos((i * 3.1) - (now / 20)) * 3.5;
        const py = waveCenterY + Math.max(-11, Math.min(11, spike));
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.strokeStyle = HOLO_COLORS.CRIMSON;
      ctx.lineWidth = 1.8;
      ctx.shadowBlur = 10;
      ctx.shadowColor = HOLO_COLORS.CRIMSON;
    } else {
      // Subtle, harmonic sine wave pulse
      for (let i = 0; i <= waveBoxW; i += 2) {
        const px = waveBoxX + i;
        const py = waveCenterY + Math.sin((i / 8) + (now / 180)) * 4.5;
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.strokeStyle = themeColor;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 6;
      ctx.shadowColor = themeColor;
    }
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  /**
   * Draws an ambient cybernetic horizon reticle indicating mobile device pitch tilt.
   * 
   * @param {{ pitchAngleDeg: number, isOptimal: boolean }} perspectiveData
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderHorizonReticle(perspectiveData, width, height, now) {
    if (!perspectiveData) return;

    const ctx = this.ctx;
    const pitchDeg = typeof perspectiveData.pitchAngleDeg === 'number'
      ? perspectiveData.pitchAngleDeg
      : (typeof perspectiveData === 'number' ? perspectiveData : 0);
    const isOptimal = perspectiveData.isOptimal !== undefined
      ? perspectiveData.isOptimal
      : Math.abs(pitchDeg) <= 3.0;

    const themeColor = isOptimal ? HOLO_COLORS.MINT : (Math.abs(pitchDeg) > 10 ? HOLO_COLORS.AMBER : HOLO_COLORS.CYAN);

    const centerX = width / 2;
    const centerY = height * 0.46;
    const pitchOffset = Math.max(-40, Math.min(40, pitchDeg * 2.2));

    ctx.save();

    // 1. Subtle central reticle circle & crosshairs
    ctx.beginPath();
    ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(centerX, centerY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = themeColor;
    ctx.fill();

    // 2. Horizon Pitch Wings (shifted by camera tilt)
    const horizonY = centerY + pitchOffset;
    const wingLength = 48;
    const wingGap = 16;

    // Left wing
    ctx.beginPath();
    ctx.moveTo(centerX - wingGap - wingLength, horizonY);
    ctx.lineTo(centerX - wingGap, horizonY);
    ctx.lineTo(centerX - wingGap, horizonY + (pitchDeg >= 0 ? 5 : -5));
    // Right wing
    ctx.moveTo(centerX + wingGap + wingLength, horizonY);
    ctx.lineTo(centerX + wingGap, horizonY);
    ctx.lineTo(centerX + wingGap, horizonY + (pitchDeg >= 0 ? 5 : -5));

    ctx.strokeStyle = themeColor;
    ctx.lineWidth = isOptimal ? 1.8 : 1.2;
    ctx.shadowBlur = isOptimal ? 10 : 4;
    ctx.shadowColor = themeColor;
    ctx.stroke();

    // 3. Subtle pitch ladder markings (+10°, -10°)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = 0;
    // +10 ladder
    ctx.beginPath();
    ctx.moveTo(centerX - 18, centerY - 22);
    ctx.lineTo(centerX - 6, centerY - 22);
    ctx.moveTo(centerX + 6, centerY - 22);
    ctx.lineTo(centerX + 18, centerY - 22);
    // -10 ladder
    ctx.moveTo(centerX - 18, centerY + 22);
    ctx.lineTo(centerX - 6, centerY + 22);
    ctx.moveTo(centerX + 6, centerY + 22);
    ctx.lineTo(centerX + 18, centerY + 22);
    ctx.stroke();

    // 4. Digital Pitch Readout Pill (unmirrored)
    const pillW = 130;
    const pillH = 16;
    const pillX = centerX - (pillW / 2);
    const pillY = centerY + 30;

    ctx.fillStyle = 'rgba(10, 15, 29, 0.70)';
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = 6;
    ctx.shadowColor = themeColor;
    this._drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 4);
    ctx.fill();
    ctx.stroke();

    const sign = pitchDeg > 0 ? '+' : '';
    const label = isOptimal ? 'HORIZON: 0° OPTIMAL' : `TILT: ${sign}${pitchDeg.toFixed(1)}°`;
    this._drawUnmirroredText(
      label,
      centerX,
      pillY + (pillH / 2),
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders the Cyber Kinetic Energy Battery Cell in the top-left HUD.
   * Displays cumulative kJ and peak Watts, and emits an intense emerald pulse on rep completion.
   * 
   * @param {{ instantWatts: number, cumulativeKilojoules: number, peakWatts: number, repPulse: boolean }} workData
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderEnergyBattery(workData, width, height, now) {
    if (!workData) return;

    const ctx = this.ctx;
    const kj = typeof workData.cumulativeKilojoules === 'number' ? workData.cumulativeKilojoules : 0;
    const peakWatts = typeof workData.peakWatts === 'number' ? workData.peakWatts : 0;
    const instantWatts = typeof workData.instantWatts === 'number' ? workData.instantWatts : 0;
    const repPulse = Boolean(workData.repPulse);

    const cardW = 210;
    const cardH = 46;
    // Positioned at (width - cardW - 20) on canvas so it displays on visual TOP-LEFT of mirrored screen
    const x = width - cardW - 20;
    const y = 20;

    ctx.save();

    const pulseGlow = repPulse ? (Math.sin(now / 80) * 0.3 + 0.7) : 0;
    const borderColor = repPulse ? `rgba(0, 255, 135, ${pulseGlow})` : 'rgba(0, 242, 254, 0.4)';
    const shadowColor = repPulse ? HOLO_COLORS.MINT : HOLO_COLORS.CYAN;

    // 1. Glassmorphic Card Backing
    ctx.fillStyle = repPulse
      ? `rgba(0, 255, 135, ${0.12 * pulseGlow})`
      : 'rgba(10, 15, 29, 0.85)';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = repPulse ? 2.0 : 1.2;
    ctx.shadowBlur = repPulse ? 18 : 8;
    ctx.shadowColor = shadowColor;

    this._drawRoundedRect(ctx, x, y, cardW, cardH, 8);
    ctx.fill();
    ctx.stroke();

    // 2. Header Text: ENERGY: 14.2 kJ | 380W PEAK (unmirrored)
    const textCenterX = x + (cardW / 2);
    this._drawUnmirroredText(
      `ENERGY: ${kj.toFixed(1)} kJ | ${peakWatts}W PEAK`,
      textCenterX,
      y + 12,
      'bold 8px "Orbitron", -apple-system, sans-serif',
      repPulse ? HOLO_COLORS.MINT : HOLO_COLORS.WHITE,
      'center'
    );

    // 3. Segmented Kinetic Energy Battery Cells
    const batteryX = x + 12;
    const batteryY = y + 23;
    const batteryW = cardW - 32;
    const batteryH = 14;

    // Outer battery frame
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 0;
    this._drawRoundedRect(ctx, batteryX, batteryY, batteryW, batteryH, 3);
    ctx.stroke();

    // Positive terminal nipple
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    this._drawRoundedRect(ctx, batteryX + batteryW + 1, batteryY + 3.5, 3, 7, 1);
    ctx.fill();

    // 10 Segments
    const numSegments = 10;
    const segmentGap = 2;
    const segmentW = (batteryW - 4 - ((numSegments - 1) * segmentGap)) / numSegments;
    const fillRatio = Math.max(0.08, Math.min(1.0, kj > 0 ? (kj / 20) : (instantWatts > 0 ? 0.2 : 0.05)));
    const activeSegments = Math.ceil(fillRatio * numSegments);

    for (let i = 0; i < numSegments; i++) {
      const segX = batteryX + 2 + (i * (segmentW + segmentGap));
      const segY = batteryY + 2;
      const segH = batteryH - 4;

      if (i < activeSegments) {
        ctx.fillStyle = repPulse
          ? HOLO_COLORS.MINT
          : (i >= 8 ? HOLO_COLORS.MAGENTA : (i >= 5 ? HOLO_COLORS.CYAN : HOLO_COLORS.MINT));
        ctx.shadowBlur = repPulse ? 10 : (i === activeSegments - 1 ? 6 : 0);
        ctx.shadowColor = ctx.fillStyle;
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.shadowBlur = 0;
      }

      this._drawRoundedRect(ctx, segX, segY, segmentW, segH, 1.5);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Renders glowing translucent AR laser boundary constraint planes and breach alerts.
   * 
   * @param {{ walls?: Array<Object>, isBreached?: boolean, penance?: string, getWalls?: Function }} constraintData
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderLaserConstraints(constraintData, width, height, now) {
    if (!constraintData) return;

    const walls = constraintData.walls || (constraintData.getWalls ? constraintData.getWalls() : []);
    if (!walls || walls.length === 0) return;

    const ctx = this.ctx;
    ctx.save();

    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      const isBreached = Boolean(wall.isBreached);
      const color = isBreached ? HOLO_COLORS.CRIMSON : HOLO_COLORS.CYAN;
      const alphaPulse = isBreached ? (Math.sin(now / 70) * 0.15 + 0.35) : 0.15;

      if (wall.axis === 'x') {
        const wallX = wall.limitValue * width;
        const dirSign = wall.direction === 'greater' ? 1 : -1;
        const planeDepth = 40;

        // 1. Translucent AR Laser Plane
        const grad = ctx.createLinearGradient(wallX, 0, wallX + (dirSign * planeDepth), 0);
        grad.addColorStop(0, isBreached ? `rgba(255, 0, 85, ${alphaPulse})` : 'rgba(0, 242, 254, 0.20)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = grad;
        const rectLeft = dirSign > 0 ? wallX : wallX - planeDepth;
        ctx.fillRect(rectLeft, 0, planeDepth, height);

        // 2. Luminous Core Laser Wall
        ctx.beginPath();
        ctx.moveTo(wallX, 0);
        ctx.lineTo(wallX, height);
        ctx.strokeStyle = color;
        ctx.lineWidth = isBreached ? 3.0 : 1.5;
        ctx.shadowBlur = isBreached ? 18 : 8;
        ctx.shadowColor = color;
        ctx.stroke();

        // 3. Cyber Hazard Cross-Ticks along the wall
        ctx.lineWidth = 1.0;
        ctx.shadowBlur = 0;
        ctx.strokeStyle = isBreached ? 'rgba(255, 0, 85, 0.7)' : 'rgba(0, 242, 254, 0.4)';
        for (let ty = 30; ty < height; ty += 45) {
          ctx.beginPath();
          ctx.moveTo(wallX - 4, ty);
          ctx.lineTo(wallX + 4, ty);
          ctx.stroke();
        }

        // 4. Boundary Label Tag (unmirrored)
        this._drawUnmirroredText(
          wall.label,
          wallX + (dirSign * 8),
          height * 0.22 + (i * 14),
          'bold 7.5px "Orbitron", -apple-system, sans-serif',
          color,
          dirSign > 0 ? 'left' : 'right'
        );
      } else if (wall.axis === 'y') {
        const wallY = wall.limitValue * height;
        const dirSign = wall.direction === 'greater' ? 1 : -1;
        const planeDepth = 32;

        const grad = ctx.createLinearGradient(0, wallY, 0, wallY + (dirSign * planeDepth));
        grad.addColorStop(0, isBreached ? `rgba(255, 0, 85, ${alphaPulse})` : 'rgba(0, 242, 254, 0.20)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = grad;
        const rectTop = dirSign > 0 ? wallY : wallY - planeDepth;
        ctx.fillRect(0, rectTop, width, planeDepth);

        ctx.beginPath();
        ctx.moveTo(0, wallY);
        ctx.lineTo(width, wallY);
        ctx.strokeStyle = color;
        ctx.lineWidth = isBreached ? 3.0 : 1.5;
        ctx.shadowBlur = isBreached ? 16 : 8;
        ctx.shadowColor = color;
        ctx.stroke();

        this._drawUnmirroredText(
          wall.label,
          width * 0.5,
          wallY - 8,
          'bold 7.5px "Orbitron", -apple-system, sans-serif',
          color,
          'center'
        );
      }
    }

    // 5. Breached Penance Banner
    if (constraintData.isBreached && constraintData.penance) {
      const bannerW = Math.min(380, width * 0.88);
      const bannerH = 28;
      const bx = (width - bannerW) / 2;
      const by = height - 96;

      const alertPulse = Math.sin(now / 100) * 0.15 + 0.85;

      ctx.fillStyle = `rgba(255, 0, 85, ${0.88 * alertPulse})`;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.shadowBlur = 14;
      ctx.shadowColor = HOLO_COLORS.CRIMSON;

      this._drawRoundedRect(ctx, bx, by, bannerW, bannerH, 6);
      ctx.fill();
      ctx.stroke();

      this._drawUnmirroredText(
        `⚠️ ${constraintData.penance.toUpperCase()}`,
        bx + (bannerW / 2),
        by + (bannerH / 2),
        'bold 8.5px "Orbitron", -apple-system, sans-serif',
        HOLO_COLORS.WHITE,
        'center'
      );
    }

    ctx.restore();
  }

  /**
   * Renders the ambient Rest-Mode facial optical pulse (rPPG) telemetry card and forehead tracking reticle.
   * 
   * @param {{ bpm: number, confidence: number, rawWave: number, isRecovering: boolean, faceBox: Object|null, waveHistory: number[] }} rppgData
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderRPPGCard(rppgData, width, height, now) {
    if (!rppgData) return;

    const ctx = this.ctx;
    ctx.save();

    // 1. Forehead Scan Reticle Brackets on video stream
    if (rppgData.faceBox) {
      const fb = rppgData.faceBox;
      const bw = fb.width * width;
      const bh = fb.height * height;
      const bx = (fb.x * width) - (bw / 2);
      const by = (fb.y * height) - (bh / 2);
      const cornerLen = 7;

      ctx.strokeStyle = HOLO_COLORS.CYAN;
      ctx.lineWidth = 1.6;
      ctx.shadowBlur = 8;
      ctx.shadowColor = HOLO_COLORS.CYAN;

      // Top-left
      ctx.beginPath();
      ctx.moveTo(bx, by + cornerLen);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + cornerLen, by);
      ctx.stroke();

      // Top-right
      ctx.beginPath();
      ctx.moveTo(bx + bw - cornerLen, by);
      ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw, by + cornerLen);
      ctx.stroke();

      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(bx, by + bh - cornerLen);
      ctx.lineTo(bx, by + bh);
      ctx.lineTo(bx + cornerLen, by + bh);
      ctx.stroke();

      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(bx + bw - cornerLen, by + bh);
      ctx.lineTo(bx + bw, by + bh);
      ctx.lineTo(bx + bw, by + bh - cornerLen);
      ctx.stroke();

      this._drawUnmirroredText(
        '[ SCANNING rPPG ]',
        bx + (bw / 2),
        by - 8,
        'bold 6.5px "Orbitron", -apple-system, sans-serif',
        HOLO_COLORS.CYAN,
        'center'
      );
    }

    // 2. Ambient Rest-Mode Telemetry Card
    const cardW = 210;
    const cardH = 68;
    const x = 20;
    const y = 62;

    const isRecovering = Boolean(rppgData.isRecovering);
    const themeColor = isRecovering ? HOLO_COLORS.MINT : HOLO_COLORS.CYAN;
    const statusText = isRecovering
      ? 'RECOVERY DETECTED'
      : (rppgData.confidence > 0.4 ? 'STABILIZING' : 'SCANNING PULSE...');

    ctx.fillStyle = 'rgba(10, 15, 29, 0.88)';
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = isRecovering ? 1.8 : 1.2;
    ctx.shadowBlur = isRecovering ? 12 : 8;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, cardW, cardH, 8);
    ctx.fill();
    ctx.stroke();

    // 3. Card Header Tag (unmirrored)
    this._drawUnmirroredText(
      '❤️ OPTICAL PULSE (rPPG)',
      x + 12,
      y + 11,
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      '#94a3b8',
      'left'
    );

    // 4. BPM & Recovery Status Readout
    const bpmDisplay = (rppgData.bpm && rppgData.bpm > 0) ? rppgData.bpm : '--';
    this._drawUnmirroredText(
      `HR: ${bpmDisplay} BPM [${statusText}]`,
      x + 12,
      y + 24,
      'bold 8.5px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'left'
    );

    // 5. Real-Time Oscilloscope Pulse Waveform
    const waveBoxX = x + 10;
    const waveBoxY = y + 36;
    const waveBoxW = cardW - 20;
    const waveBoxH = 24;

    ctx.save();
    ctx.beginPath();
    ctx.rect(waveBoxX, waveBoxY, waveBoxW, waveBoxH);
    ctx.clip();

    // Background waveform grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(waveBoxX, waveBoxY + (waveBoxH / 2));
    ctx.lineTo(waveBoxX + waveBoxW, waveBoxY + (waveBoxH / 2));
    ctx.stroke();

    const history = rppgData.waveHistory || [];
    if (history.length > 2) {
      const step = waveBoxW / Math.max(1, history.length - 1);
      const waveMidY = waveBoxY + (waveBoxH / 2);

      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const px = waveBoxX + (i * step);
        const amp = Math.max(-10, Math.min(10, history[i] * 3.2));
        const py = waveMidY - amp;

        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }

      ctx.strokeStyle = themeColor;
      ctx.lineWidth = 1.6;
      ctx.shadowBlur = 8;
      ctx.shadowColor = themeColor;
      ctx.stroke();
    }

    ctx.restore();
    ctx.restore();
  }

  /**
   * Renders real-time Web Bluetooth Heart Rate Telemetry HUD module with procedural EKG wave.
   * 
   * @param {{ bpm: number, hrZone: any, connected: boolean, isSimulated: boolean, deviceName: string }} hrData
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderHeartRateTelemetry(hrData, width, height, now) {
    const ctx = this.ctx;
    ctx.save();

    const bpm = hrData.bpm || 0;
    const zone = hrData.hrZone || { id: 0, label: 'REST', color: '#94a3b8' };
    const zoneColor = zone.color || '#38bdf8';

    // Positioned in top-left canvas space -> renders on top-right of user's mirrored screen
    const x = 20;
    const y = 62;
    const cardW = 180;
    const cardH = 48;

    // Heartbeat lub-dub pulse scale
    const beatPeriod = (60 / Math.max(45, bpm)) * 1000;
    const phase = (now % beatPeriod) / beatPeriod;
    let heartScale = 1.0;
    if (phase < 0.16) {
      heartScale = 1.0 + Math.sin((phase / 0.16) * Math.PI) * 0.35;
    } else if (phase >= 0.22 && phase < 0.38) {
      heartScale = 1.0 + Math.sin(((phase - 0.22) / 0.16) * Math.PI) * 0.20;
    }

    // Card background & glowing border
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = zoneColor;
    ctx.lineWidth = 1.3;
    ctx.shadowBlur = 10;
    ctx.shadowColor = zoneColor;

    this._drawRoundedRect(ctx, x, y, cardW, cardH, 6);
    ctx.fill();
    ctx.stroke();

    // Pulsing Heart Icon
    ctx.save();
    const hx = x + 18;
    const hy = y + 17;
    ctx.translate(hx, hy);
    ctx.scale(heartScale, heartScale);
    this._drawUnmirroredText('❤️', 0, 0, '12px "Inter", sans-serif', zoneColor, 'center');
    ctx.restore();

    // BPM Value Readout
    this._drawUnmirroredText(
      `${bpm > 0 ? bpm : '--'}`,
      x + 36,
      y + 16,
      'bold 13px "Orbitron", -apple-system, sans-serif',
      HOLO_COLORS.WHITE,
      'left'
    );

    this._drawUnmirroredText(
      'BPM',
      x + (bpm >= 100 ? 76 : 64),
      y + 17,
      'bold 7.5px "Orbitron", sans-serif',
      '#94a3b8',
      'left'
    );

    // Zone Badge
    const zoneLabel = `Z${zone.id || 1} [${zone.label || 'AEROBIC'}]`;
    this._drawUnmirroredText(
      zoneLabel,
      x + cardW - 10,
      y + 16,
      'bold 7.5px "Orbitron", sans-serif',
      zoneColor,
      'right'
    );

    // Procedural Ambient EKG Sine/Cardiac Waveform Line
    const ekgX = x + 10;
    const ekgY = y + 35;
    const ekgW = cardW - 20;
    const ekgH = 12;

    ctx.beginPath();
    const samples = 48;
    const cycles = 1.8;
    const scroll = (now / beatPeriod) * cycles;

    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      const px = ekgX + (u * ekgW);

      // Parametric cardiac P-Q-R-S-T wave function
      const phi = ((u * cycles) + scroll) % 1.0;
      let wave = 0;

      if (phi >= 0.12 && phi < 0.22) {
        // P wave
        wave = Math.sin(((phi - 0.12) / 0.10) * Math.PI) * 0.24;
      } else if (phi >= 0.32 && phi < 0.36) {
        // Q dip
        wave = -Math.sin(((phi - 0.32) / 0.04) * Math.PI) * 0.20;
      } else if (phi >= 0.36 && phi < 0.44) {
        // R spike (tall)
        wave = Math.sin(((phi - 0.36) / 0.08) * Math.PI) * 0.95;
      } else if (phi >= 0.44 && phi < 0.50) {
        // S dip
        wave = -Math.sin(((phi - 0.44) / 0.06) * Math.PI) * 0.38;
      } else if (phi >= 0.58 && phi < 0.74) {
        // T wave
        wave = Math.sin(((phi - 0.58) / 0.16) * Math.PI) * 0.32;
      }

      const py = ekgY - (wave * (ekgH / 2));
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }

    ctx.strokeStyle = zoneColor;
    ctx.lineWidth = 1.4;
    ctx.shadowBlur = 6;
    ctx.shadowColor = zoneColor;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Renders translucent holographic ghost wireframe skeleton for Co-Op peer athlete.
   * 
   * @param {Array<{ x: number, y: number, z?: number, visibility?: number }>} peerLandmarks
   * @param {{ repCount?: number, bpm?: number, peerName?: string }} [peerMeta]
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderPeerGhostOverlay(peerLandmarks, peerMeta, width, height, now) {
    if (!peerLandmarks || peerLandmarks.length < 17) return;

    const ctx = this.ctx;
    ctx.save();

    const ghostColor = '#c084fc'; // Cyber Lavender / Magenta
    ctx.strokeStyle = ghostColor;
    ctx.fillStyle = ghostColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.shadowBlur = 8;
    ctx.shadowColor = ghostColor;

    // Draw Ghost Skeletal Connections
    for (let i = 0; i < SKELETON_CONNECTIONS.length; i++) {
      const [idxA, idxB] = SKELETON_CONNECTIONS[i];
      const pA = peerLandmarks[idxA];
      const pB = peerLandmarks[idxB];

      if (pA && pB && (pA.visibility || 1) > 0.4 && (pB.visibility || 1) > 0.4) {
        ctx.beginPath();
        ctx.moveTo(pA.x * width, pA.y * height);
        ctx.lineTo(pB.x * width, pB.y * height);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Draw Joint Nodes
    for (let i = 0; i < MAJOR_JOINTS.length; i++) {
      const idx = MAJOR_JOINTS[i];
      const lm = peerLandmarks[idx];
      if (lm && (lm.visibility || 1) > 0.4) {
        ctx.beginPath();
        ctx.arc(lm.x * width, lm.y * height, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(lm.x * width, lm.y * height, 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = ghostColor;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // Ghost Head Floating Badge
    const nose = peerLandmarks[0];
    if (nose && (nose.visibility || 1) > 0.4) {
      const tagX = nose.x * width;
      const tagY = (nose.y * height) - 22;
      const peerReps = peerMeta ? peerMeta.repCount || 0 : 0;
      const peerBpm = peerMeta ? peerMeta.bpm || 0 : 0;
      const ghostTag = `👥 CO-OP: ${peerReps} REPS ${peerBpm > 0 ? `| ${peerBpm} BPM` : ''}`;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = ghostColor;
      ctx.lineWidth = 1.0;
      this._drawRoundedRect(ctx, tagX - 65, tagY - 10, 130, 18, 4);
      ctx.fill();
      ctx.stroke();

      this._drawUnmirroredText(
        ghostTag,
        tagX,
        tagY,
        'bold 7px "Orbitron", sans-serif',
        ghostColor,
        'center'
      );
    }

    ctx.restore();
  }

  /**
   * Renders real-time 3D Digital Twin & Kinetic Muscle Strain Telemetry Card on HUD.
   * 
   * @param {Object} strainData
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderMuscleStrainCard(strainData, width, height, now) {
    const ctx = this.ctx;
    ctx.save();

    const cardW = 210;
    const cardH = 78;
    const x = 20;
    const y = 172;

    const isOverload = strainData.status === 'OVERLOAD';
    let borderColor = HOLO_COLORS.CYAN;
    if (isOverload) {
      const pulse = Math.sin(now / 120) * 0.2 + 0.8;
      borderColor = `rgba(255, 0, 85, ${pulse})`;
    } else if (strainData.status === 'MODERATE') {
      borderColor = HOLO_COLORS.AMBER;
    }

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.3;
    ctx.shadowBlur = isOverload ? 14 : 8;
    ctx.shadowColor = borderColor;

    this._drawRoundedRect(ctx, x, y, cardW, cardH, 6);
    ctx.fill();
    ctx.stroke();

    // Card Header: Title & Status
    const statusColor = isOverload ? HOLO_COLORS.CRIMSON : (strainData.status === 'MODERATE' ? HOLO_COLORS.AMBER : HOLO_COLORS.MINT);
    this._drawUnmirroredText(
      '🧬 3D TWIN: MUSCLE LOAD',
      x + 10,
      y + 12,
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      HOLO_COLORS.CYAN,
      'left'
    );

    this._drawUnmirroredText(
      `[${strainData.status}]`,
      x + cardW - 10,
      y + 12,
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      statusColor,
      'right'
    );

    // Mini Muscle Strain Progress Bars
    const rows = [
      { label: 'QUADS', pct: strainData.quadsPct, color: '#00f2fe' },
      { label: 'LUMBAR', pct: strainData.lowerBackPct, color: strainData.lowerBackPct > 70 ? '#ff0055' : '#f59e0b' },
      { label: 'GLUTES', pct: strainData.glutePct, color: '#00ff87' }
    ];

    const trackX = x + 62;
    const trackW = 95;
    const trackH = 5;

    rows.forEach((row, idx) => {
      const rowY = y + 27 + (idx * 16);

      // Label
      this._drawUnmirroredText(
        row.label,
        x + 10,
        rowY + 4,
        'bold 6.5px "Orbitron", sans-serif',
        '#94a3b8',
        'left'
      );

      // Track Background
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      this._drawRoundedRect(ctx, trackX, rowY, trackW, trackH, 2.5);
      ctx.fill();

      // Track Fill
      const fillW = Math.max(2, (Math.min(100, row.pct) / 100) * trackW);
      ctx.fillStyle = row.color;
      ctx.shadowBlur = 4;
      ctx.shadowColor = row.color;
      this._drawRoundedRect(ctx, trackX, rowY, fillW, trackH, 2.5);
      ctx.fill();

      // Percentage Text
      this._drawUnmirroredText(
        `${row.pct}%`,
        x + cardW - 10,
        rowY + 4,
        'bold 7px "Orbitron", sans-serif',
        '#e2e8f0',
        'right'
      );
    });

    ctx.restore();
  }

  /**
   * Draws a vertical laser plumb line from CoM down to the floor plane with dynamic balance ring.
   * 
   * @param {{ x: number, y: number, z: number }} com
   * @param {Array<any>} landmarks
   * @param {number} width
   * @param {number} height
   * @private
   */
  _renderCenterOfMassPlumbLine(com, landmarks, width, height) {
    const ctx = this.ctx;
    ctx.save();

    const cx = com.x * width;
    const cy = com.y * height;

    const ankleL = landmarks[27];
    const ankleR = landmarks[28];
    const floorY = Math.max(ankleL ? ankleL.y : 0.88, ankleR ? ankleR.y : 0.88) * height + 10;

    // Check base of support between feet
    const aLx = ankleL ? ankleL.x * width : cx - 30;
    const aRx = ankleR ? ankleR.x * width : cx + 30;
    const minFootX = Math.min(aLx, aRx) - 25;
    const maxFootX = Math.max(aLx, aRx) + 25;

    const isBalanced = cx >= minFootX && cx <= maxFootX;
    const color = isBalanced ? HOLO_COLORS.MINT : HOLO_COLORS.CRIMSON;

    // Plumb line (dashed laser)
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, floorY);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
    ctx.stroke();
    ctx.setLineDash([]);

    // CoM Center Node
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.shadowColor = color;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Floor Balance Projection Ring
    ctx.beginPath();
    ctx.ellipse(cx, floorY, 32, 10, 0, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.0;
    ctx.shadowBlur = 12;
    ctx.shadowColor = color;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, floorY, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    this._drawUnmirroredText(
      isBalanced ? 'COM: STABLE' : 'COM: OFF-BALANCE',
      cx,
      floorY + 16,
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      color,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders mechanical power output telemetry in Watts on the HUD.
   * 
   * @param {{ watts: number, rating: string }} powerTelemetry
   * @param {number} width
   * @param {number} height
   * @private
   */
  _renderPowerMeter(powerTelemetry, width, height) {
    const ctx = this.ctx;
    ctx.save();

    const { watts, rating } = powerTelemetry;
    let color = HOLO_COLORS.CYAN;
    if (rating === 'EXPLOSIVE') color = HOLO_COLORS.MAGENTA;
    else if (rating === 'POWERFUL') color = HOLO_COLORS.MINT;
    else if (rating === 'FATIGUED') color = HOLO_COLORS.AMBER;

    const badgeW = 210;
    const badgeH = 22;
    const x = 20;
    const y = 142;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;

    this._drawRoundedRect(ctx, x, y, badgeW, badgeH, 6);
    ctx.fill();
    ctx.stroke();

    this._drawUnmirroredText(
      `OUTPUT: ${watts}W [${rating}]`,
      x + (badgeW / 2),
      y + (badgeH / 2),
      'bold 8px "Orbitron", -apple-system, sans-serif',
      color,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders an animated cyber banner when an exercise auto-switch is triggered.
   * 
   * @param {{ exerciseKey: string, timestamp: number }} banner
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderExerciseBanner(banner, width, height, now) {
    const ctx = this.ctx;
    const elapsed = now - banner.timestamp;
    const alpha = Math.max(0, Math.min(1, 1 - (elapsed - 1500) / 1000));

    ctx.save();
    ctx.globalAlpha = alpha;

    const isPR = banner.exerciseKey.includes('🏆') || banner.exerciseKey.includes('RECORD');
    const bannerW = isPR ? 310 : 260;
    const bannerH = 34;
    const x = (width - bannerW) / 2;
    const y = 70;
    const strokeCol = isPR ? HOLO_COLORS.AMBER : HOLO_COLORS.CYAN;
    const textCol = isPR ? HOLO_COLORS.AMBER : HOLO_COLORS.MINT;
    const bannerText = isPR ? banner.exerciseKey : `⚡ AUTO-DETECT: ${banner.exerciseKey}`;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 1.8;
    ctx.shadowBlur = 18;
    ctx.shadowColor = strokeCol;

    this._drawRoundedRect(ctx, x, y, bannerW, bannerH, 8);
    ctx.fill();
    ctx.stroke();

    this._drawUnmirroredText(
      bannerText,
      x + (bannerW / 2),
      y + (bannerH / 2),
      'bold 9px "Orbitron", -apple-system, sans-serif',
      textCol,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders high-energy streak & multiplier badge on the upper canvas.
   * 
   * @param {number} comboStreak
   * @param {number} multiplier
   * @param {string} tierLabel
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderComboBadge(comboStreak, multiplier, tierLabel, width, height, now) {
    const ctx = this.ctx;
    ctx.save();

    const text = `STREAK: ${comboStreak}x [${tierLabel}]`;
    const isOverdrive = comboStreak >= 10;
    const badgeColor = comboStreak >= 20 ? HOLO_COLORS.MAGENTA : isOverdrive ? HOLO_COLORS.MINT : HOLO_COLORS.CYAN;

    const badgeW = 230;
    const badgeH = 24;
    // Positioned in top-left canvas space -> appears top-right on mirrored screen
    const x = 20;
    const y = 114;

    const pulse = Math.sin(now / 120) * 0.15 + 0.85;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = badgeColor;
    ctx.lineWidth = 1.6;
    ctx.shadowBlur = 12 * pulse;
    ctx.shadowColor = badgeColor;

    this._drawRoundedRect(ctx, x, y, badgeW, badgeH, 6);
    ctx.fill();
    ctx.stroke();

    this._drawUnmirroredText(
      text,
      x + (badgeW / 2),
      y + (badgeH / 2),
      'bold 8px "Orbitron", -apple-system, sans-serif',
      badgeColor,
      'center'
    );

    ctx.restore();
  }

  /**
   * Draws a glowing AR laser depth tripwire across the frame with particle shockwaves upon breach.
   * 
   * @param {number} targetY Y-coordinate of the target depth line.
   * @param {boolean} isTriggered True if athlete has hit/breached depth.
   * @param {number} width
   * @param {number} height
   * @param {number} now
   */
  drawLaserPlane(targetY, isTriggered, width, height, now) {
    if (targetY <= 0 || targetY >= height) return;

    const ctx = this.ctx;
    ctx.save();

    const beamColor = isTriggered ? HOLO_COLORS.MINT : HOLO_COLORS.CYAN;

    // 1. Vertical Ambient Glow
    const glowGrad = ctx.createLinearGradient(0, targetY - 18, 0, targetY + 18);
    glowGrad.addColorStop(0, 'rgba(0, 242, 254, 0.0)');
    glowGrad.addColorStop(0.5, isTriggered ? 'rgba(0, 255, 135, 0.35)' : 'rgba(0, 242, 254, 0.15)');
    glowGrad.addColorStop(1, 'rgba(0, 242, 254, 0.0)');

    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, targetY - 18, width, 36);

    // 2. Core Laser Beam
    ctx.beginPath();
    ctx.moveTo(0, targetY);
    ctx.lineTo(width, targetY);
    ctx.strokeStyle = beamColor;
    ctx.lineWidth = isTriggered ? 3.0 : 1.8;
    ctx.shadowBlur = isTriggered ? 16 : 8;
    ctx.shadowColor = beamColor;
    ctx.stroke();

    // 3. Shockwave Particle Bursts on Breach
    if (isTriggered) {
      const numNodes = 5;
      const phase = (now % 600) / 600;
      const radius = 4 + (phase * 18);
      const ringAlpha = 1.0 - phase;

      for (let i = 1; i <= numNodes; i++) {
        const nodeX = (width / (numNodes + 1)) * i;

        ctx.beginPath();
        ctx.arc(nodeX, targetY, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(0, 255, 135, ${ringAlpha * 0.8})`;
        ctx.lineWidth = 2.0;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(nodeX, targetY, 3, 0, 2 * Math.PI);
        ctx.fillStyle = HOLO_COLORS.WHITE;
        ctx.fill();
      }
    }

    // 4. Floating Holographic Laser Tag (unmirrored)
    const tagText = isTriggered ? '🎯 DEPTH PLANE HIT' : '⚡ TARGET DEPTH TRIPWIRE';
    this._drawUnmirroredText(
      tagText,
      25,
      targetY - 10,
      'bold 8px "Orbitron", -apple-system, sans-serif',
      beamColor,
      'left'
    );

    ctx.restore();
  }

  /**
   * Renders real-time RIR (Reps in Reserve) and velocity fatigue decay gauge badge.
   * 
   * @param {Object} rirData
   * @param {number} width
   * @param {number} height
   * @private
   */
  _renderRIRBadge(rirData, width, height) {
    if (!rirData) return;

    const ctx = this.ctx;
    const rirText = rirData.rirEstimate || '3+ (FRESH)';
    const lossPct = Math.round(rirData.velocityLossPercent || 0);

    let color = HOLO_COLORS.MINT;
    if (rirText.startsWith('2')) {
      color = HOLO_COLORS.CYAN;
    } else if (rirText.startsWith('1')) {
      color = HOLO_COLORS.AMBER;
    } else if (rirText.startsWith('0')) {
      color = HOLO_COLORS.CRIMSON;
    }

    const badgeW = 160;
    const badgeH = 22;
    // Positioned in top-left of canvas -> appears top-right on mirrored screen
    const x = 20;
    const y = 88;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.80)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;

    this._drawRoundedRect(ctx, x, y, badgeW, badgeH, 6);
    ctx.fill();
    ctx.stroke();

    this._drawUnmirroredText(
      `RIR: ${rirText} | -${lossPct}%`,
      x + (badgeW / 2),
      y + (badgeH / 2),
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      color,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders subtle corner alignment brackets and top guidance status pill during calibration.
   * 
   * @param {Object} calibration
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderCalibrationReticle(calibration, width, height, now) {
    if (!calibration || calibration.isSteadyCalibrated) return;

    const ctx = this.ctx;
    ctx.save();

    // 1. Draw Corner Alignment Brackets
    const b = calibration.bounds || { minX: 0.2, minY: 0.1, maxX: 0.8, maxY: 0.9 };
    const pad = 24;
    const x1 = Math.max(10, (b.minX * width) - pad);
    const y1 = Math.max(10, (b.minY * height) - pad);
    const x2 = Math.min(width - 10, (b.maxX * width) + pad);
    const y2 = Math.min(height - 10, (b.maxY * height) + pad);

    const bracketLen = Math.min(30, (x2 - x1) * 0.2);
    const color = calibration.isCalibrated ? HOLO_COLORS.MINT : HOLO_COLORS.AMBER;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(x1 + bracketLen, y1);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, y1 + bracketLen);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(x2 - bracketLen, y1);
    ctx.lineTo(x2, y1);
    ctx.lineTo(x2, y1 + bracketLen);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(x1 + bracketLen, y2);
    ctx.lineTo(x1, y2);
    ctx.lineTo(x1, y2 - bracketLen);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(x2 - bracketLen, y2);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2, y2 - bracketLen);
    ctx.stroke();

    // 2. Pulsing Top Guidance Status Pill
    const pillW = Math.min(280, width * 0.7);
    const pillH = 34;
    const px = (width - pillW) / 2;
    const py = 25;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 12;
    ctx.shadowColor = color;

    this._drawRoundedRect(ctx, px, py, pillW, pillH, 8);
    ctx.fill();
    ctx.stroke();

    // If holding steady, draw fill bar
    if (calibration.holdProgress > 0 && !calibration.isSteadyCalibrated) {
      const fillW = (pillW - 8) * calibration.holdProgress;
      ctx.fillStyle = HOLO_COLORS.MINT;
      ctx.fillRect(px + 4, py + pillH - 4, fillW, 2);
    }

    this._drawUnmirroredText(
      calibration.calibrationMessage,
      px + (pillW / 2),
      py + (pillH / 2) - 1,
      'bold 10px "Orbitron", -apple-system, sans-serif',
      color,
      'center'
    );

    ctx.restore();
  }

  /**
   * Displays upper viewport orientation badge (Profile Depth vs Frontal Symmetry).
   * 
   * @param {Object} calibration
   * @param {number} width
   * @param {number} height
   * @private
   */
  _renderViewportBadge(calibration, width, height) {
    if (!calibration) return;

    const ctx = this.ctx;
    const isSagittal = calibration.viewAngle === 'SAGITTAL_VIEW';
    const text = isSagittal ? 'VIEW: PROFILE (DEPTH TRACKING)' : 'VIEW: FRONTAL (SYMMETRY TRACKING)';
    const color = isSagittal ? HOLO_COLORS.MAGENTA : HOLO_COLORS.CYAN;

    const badgeW = 220;
    const badgeH = 22;
    // Positioned in top-left of canvas -> appears top-right on mirrored display below symmetry bar
    const x = 20;
    const y = 62;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.80)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;

    this._drawRoundedRect(ctx, x, y, badgeW, badgeH, 6);
    ctx.fill();
    ctx.stroke();

    this._drawUnmirroredText(
      text,
      x + (badgeW / 2),
      y + (badgeH / 2),
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      color,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders circular confirmation hold timer around active gesture joint.
   * 
   * @param {Object} gesture
   * @param {number} width
   * @param {number} height
   * @private
   */
  _renderGestureHoldRing(gesture, width, height) {
    if (!gesture || !gesture.anchorPoint || gesture.holdProgress <= 0) return;

    const ctx = this.ctx;
    const x = gesture.anchorPoint.x * width;
    const y = gesture.anchorPoint.y * height;
    const radius = 28;
    const progress = Math.min(1.0, gesture.holdProgress);

    ctx.save();

    // Background track
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Filling arc
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (progress * 2 * Math.PI);

    let ringColor = HOLO_COLORS.CYAN;
    if (gesture.activeGesture === 'STOP') {
      ringColor = HOLO_COLORS.CRIMSON;
    } else if (gesture.activeGesture === 'PAUSE') {
      ringColor = HOLO_COLORS.AMBER;
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, startAngle, endAngle);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 12;
    ctx.shadowColor = ringColor;
    ctx.stroke();

    // Label badge above ring (unmirrored)
    const pct = Math.round(progress * 100);
    this._drawUnmirroredText(
      `${gesture.activeGesture} ${pct}%`,
      x,
      y - radius - 14,
      'bold 11px "Orbitron", -apple-system, sans-serif',
      ringColor,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders the 3-1-1 cadence tempo ring gauge at the top-center of the canvas.
   * 
   * @param {Object} cadence
   * @param {number} width
   * @param {number} height
   * @private
   */
  _renderCadenceRing(cadence, width, height) {
    if (!cadence || cadence.phase === 'REST') return;

    const ctx = this.ctx;
    const x = width / 2;
    const y = 80;
    const radius = 24;
    const progress = Math.min(1.0, cadence.phaseProgress || 0);

    ctx.save();

    // Background circle
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.beginPath();
    ctx.arc(x, y, radius + 4, 0, 2 * Math.PI);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Active color by phase
    let color = HOLO_COLORS.CYAN;
    let phaseLabel = 'DOWN (3s)';

    if (cadence.phase === 'ISOMETRIC') {
      color = HOLO_COLORS.AMBER;
      phaseLabel = 'HOLD (1s)';
    } else if (cadence.phase === 'CONCENTRIC') {
      color = HOLO_COLORS.MINT;
      phaseLabel = 'UP (1s)';
    }

    if (cadence.isRushed) {
      color = HOLO_COLORS.CRIMSON;
      phaseLabel = 'RUSHED!';
    }

    // Sweeping progress arc
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (progress * 2 * Math.PI);

    ctx.beginPath();
    ctx.arc(x, y, radius, startAngle, endAngle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 10;
    ctx.shadowColor = color;
    ctx.stroke();

    // Time Under Tension text (unmirrored)
    this._drawUnmirroredText(
      `${cadence.repTUT}s`,
      x,
      y,
      'bold 10px "Orbitron", -apple-system, sans-serif',
      HOLO_COLORS.WHITE,
      'center'
    );

    // Label below ring
    this._drawUnmirroredText(
      phaseLabel,
      x,
      y + radius + 12,
      'bold 8px "Orbitron", -apple-system, sans-serif',
      color,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders an animated, fading neon 3D floor perspective grid beneath the athlete's feet.
   * 
   * @param {Array<any>} landmarks
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderFloorGrid(landmarks, width, height, now) {
    const leftAnkle = landmarks[27];
    const rightAnkle = landmarks[28];

    let anchorX = width / 2;
    let feetY = height * 0.90;

    if (leftAnkle && rightAnkle && leftAnkle.visibility > 0.4 && rightAnkle.visibility > 0.4) {
      anchorX = ((leftAnkle.x + rightAnkle.x) / 2) * width;
      feetY = Math.max(leftAnkle.y, rightAnkle.y) * height + 10;
    }

    const horizonY = feetY - (height * 0.10);
    const bottomY = Math.min(height, feetY + (height * 0.22));

    if (bottomY <= horizonY) return;

    const ctx = this.ctx;
    ctx.save();

    const gridLines = 9;
    const baseSpread = width * 0.85;
    const shift = (Math.sin(now / 400) * 8);

    // Perspective radial rays
    for (let i = 0; i < gridLines; i++) {
      const t = (i / (gridLines - 1)) - 0.5; // -0.5 to 0.5
      const startX = anchorX + (t * (baseSpread * 0.35)) + shift;
      const endX = anchorX + (t * baseSpread * 1.5) + shift;

      const grad = ctx.createLinearGradient(startX, horizonY, endX, bottomY);
      grad.addColorStop(0, 'rgba(0, 242, 254, 0.0)');
      grad.addColorStop(0.35, 'rgba(0, 242, 254, 0.35)');
      grad.addColorStop(1, 'rgba(0, 242, 254, 0.05)');

      ctx.beginPath();
      ctx.moveTo(startX, horizonY);
      ctx.lineTo(endX, bottomY);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Horizontal depth rungs with progressive perspective spacing
    const numRungs = 5;
    for (let j = 1; j <= numRungs; j++) {
      const p = Math.pow(j / numRungs, 1.8);
      const rungY = horizonY + (p * (bottomY - horizonY));
      const spread = (baseSpread * 0.35) + (p * baseSpread * 1.15);

      const gradRung = ctx.createLinearGradient(anchorX - spread / 2, rungY, anchorX + spread / 2, rungY);
      gradRung.addColorStop(0, 'rgba(0, 242, 254, 0.0)');
      gradRung.addColorStop(0.5, `rgba(0, 242, 254, ${0.4 * (1 - p * 0.6)})`);
      gradRung.addColorStop(1, 'rgba(0, 242, 254, 0.0)');

      ctx.beginPath();
      ctx.moveTo(anchorX - spread / 2 + shift, rungY);
      ctx.lineTo(anchorX + spread / 2 + shift, rungY);
      ctx.strokeStyle = gradRung;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Renders dynamic velocity-graded bar path trailing ribbon over the last 30 frames.
   * 
   * @param {Array<{ x: number, y: number, category: string, velocity: number }>} barPath
   * @param {number} width
   * @param {number} height
   * @private
   */
  _renderBarPath(barPath, width, height) {
    const ctx = this.ctx;
    ctx.save();

    for (let i = 1; i < barPath.length; i++) {
      const pPrev = barPath[i - 1];
      const pCurr = barPath[i];

      const x1 = pPrev.x * width;
      const y1 = pPrev.y * height;
      const x2 = pCurr.x * width;
      const y2 = pCurr.y * height;

      const progress = i / barPath.length; // 0 (oldest) to 1 (newest)
      const lineWidth = 1.5 + (progress * 5.0);

      let strokeColor = HOLO_COLORS.CYAN;
      if (pCurr.category === 'EXPLOSIVE') {
        strokeColor = HOLO_COLORS.MAGENTA;
      } else if (pCurr.category === 'FATIGUE') {
        strokeColor = HOLO_COLORS.AMBER;
      }

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.strokeStyle = strokeColor;
      ctx.shadowBlur = 10 * progress;
      ctx.shadowColor = strokeColor;
      ctx.stroke();
    }

    // Lead tracking point
    const lead = barPath[barPath.length - 1];
    if (lead) {
      ctx.beginPath();
      ctx.arc(lead.x * width, lead.y * height, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = HOLO_COLORS.WHITE;
      ctx.shadowBlur = 12;
      ctx.shadowColor = HOLO_COLORS.CYAN;
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Renders 3D luminous neon barbell path ribbon connecting the past 60 frames of wrist midpoints.
   * Color coding:
   * - Cyan during vertical descent
   * - Emerald on vertical ascent
   * - Crimson if horizontal drift > 8% of frame width
   * 
   * @param {Array<{ x: number, y: number }>} [wristHistory]
   * @param {number} [width]
   * @param {number} [height]
   */
  renderBarPath(wristHistory = this.wristHistory, width = this.logicalWidth, height = this.logicalHeight) {
    if (!wristHistory || wristHistory.length < 2) {
      return;
    }

    const ctx = this.ctx;
    ctx.save();

    // Compute baseline mean X to detect horizontal barbell drift (> 8% of frame width)
    let sumX = 0;
    for (let i = 0; i < wristHistory.length; i++) {
      sumX += wristHistory[i].x;
    }
    const meanX = sumX / wristHistory.length;

    let lastColor = HOLO_COLORS.CYAN;

    for (let i = 1; i < wristHistory.length; i++) {
      const pPrev = wristHistory[i - 1];
      const pCurr = wristHistory[i];

      const x1 = pPrev.x * width;
      const y1 = pPrev.y * height;
      const x2 = pCurr.x * width;
      const y2 = pCurr.y * height;

      const progress = i / wristHistory.length; // 0 (oldest) to 1 (newest)
      const lineWidth = 1.5 + (progress * 4.5);

      const dy = pCurr.y - pPrev.y; // Positive = downward (descent), Negative = upward (ascent)
      const driftX = Math.abs(pCurr.x - meanX);

      let strokeColor;
      if (driftX > 0.08) {
        // Horizontal drift > 8% frame width -> Warning Crimson
        strokeColor = HOLO_COLORS.CRIMSON;
      } else if (dy > 0.001) {
        // Vertical descent -> Cyan
        strokeColor = HOLO_COLORS.CYAN;
      } else if (dy < -0.001) {
        // Vertical ascent -> Emerald
        strokeColor = HOLO_COLORS.MINT;
      } else {
        strokeColor = lastColor;
      }
      lastColor = strokeColor;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.strokeStyle = strokeColor;
      ctx.shadowBlur = 10 * progress;
      ctx.shadowColor = strokeColor;
      ctx.stroke();
    }

    // Lead tracking point at current barbell wrist position
    const lead = wristHistory[wristHistory.length - 1];
    if (lead) {
      const lx = lead.x * width;
      const ly = lead.y * height;

      ctx.beginPath();
      ctx.arc(lx, ly, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = HOLO_COLORS.WHITE;
      ctx.shadowBlur = 12;
      ctx.shadowColor = lastColor;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(lx, ly, 7.5, 0, 2 * Math.PI);
      ctx.strokeStyle = lastColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Renders real-time bilateral symmetry balance HUD gauge.
   * 
   * @param {{ leftPct: number, rightPct: number, symmetryScore: number }} symmetry
   * @param {number} width
   * @param {number} height
   * @private
   */
  _renderSymmetryGauge(symmetry, width, height) {
    const ctx = this.ctx;
    const gaugeWidth = 140;
    const gaugeHeight = 18;
    // Positioned in top-left of mirrored canvas -> displays top-right of screen
    const x = 20;
    const y = 20;

    ctx.save();

    // Background card
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.3)';
    ctx.lineWidth = 1.2;
    this._drawRoundedRect(ctx, x, y, gaugeWidth, gaugeHeight + 18, 6);
    ctx.fill();
    ctx.stroke();

    // Title text (unmirrored)
    this._drawUnmirroredText(
      `SYMMETRY: ${symmetry.symmetryScore}%`,
      x + gaugeWidth / 2,
      y + 8,
      'bold 8px "Orbitron", -apple-system, sans-serif',
      HOLO_COLORS.WHITE,
      'center'
    );

    // Balance Bar
    const barY = y + 17;
    const barInnerW = gaugeWidth - 16;
    const barX = x + 8;
    const leftWidth = (symmetry.leftPct / 100) * barInnerW;

    // Left fill
    ctx.fillStyle = HOLO_COLORS.CYAN;
    ctx.fillRect(barX, barY, leftWidth, 8);

    // Right fill
    ctx.fillStyle = HOLO_COLORS.MINT;
    ctx.fillRect(barX + leftWidth, barY, barInnerW - leftWidth, 8);

    // Center divider notch
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(barX + (barInnerW / 2) - 1, barY - 1, 2, 10);

    // Text L/R labels (unmirrored)
    this._drawUnmirroredText(
      `L ${symmetry.leftPct}%`,
      barX + 2,
      barY + 12,
      'bold 7px "Orbitron", -apple-system, sans-serif',
      HOLO_COLORS.CYAN,
      'left'
    );
    this._drawUnmirroredText(
      `${symmetry.rightPct}% R`,
      barX + barInnerW - 2,
      barY + 12,
      'bold 7px "Orbitron", -apple-system, sans-serif',
      HOLO_COLORS.MINT,
      'right'
    );

    ctx.restore();
  }

  /**
   * Renders glowing outward corrective warning vectors on knee valgus.
   * 
   * @param {{ correctiveVector: { startX: number, startY: number, targetX: number, targetY: number } }} valgus
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderValgusWarning(valgus, width, height, now) {
    const ctx = this.ctx;
    const cv = valgus.correctiveVector;
    const startX = cv.startX * width;
    const startY = cv.startY * height;
    const targetX = cv.targetX * width;
    const targetY = cv.targetY * height;

    const pulse = Math.sin(now / 120) * 3;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(targetX + pulse, targetY);
    ctx.strokeStyle = HOLO_COLORS.AMBER;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 14;
    ctx.shadowColor = HOLO_COLORS.AMBER;
    ctx.stroke();

    // Outward Arrowhead
    const angle = Math.atan2(targetY - startY, (targetX + pulse) - startX);
    const arrowSize = 10;
    ctx.beginPath();
    ctx.moveTo(targetX + pulse, targetY);
    ctx.lineTo(
      targetX + pulse - arrowSize * Math.cos(angle - Math.PI / 6),
      targetY - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      targetX + pulse - arrowSize * Math.cos(angle + Math.PI / 6),
      targetY - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fillStyle = HOLO_COLORS.AMBER;
    ctx.fill();

    // Warning Badge Label near knee
    this._drawUnmirroredText(
      'PUSH KNEES OUT ⚠️',
      startX,
      startY - 22,
      'bold 11px "Orbitron", -apple-system, sans-serif',
      HOLO_COLORS.AMBER,
      'center'
    );

    ctx.restore();
  }

  /**
   * Multi-pass holographic bone rendering with depth perception.
   * 
   * @param {Array<any>} landmarks
   * @param {string} exerciseKey
   * @param {{ solid: string, alpha: string }} theme
   * @param {boolean} hasFault
   * @param {number} width
   * @param {number} height
   * @private
   */
  _renderHolographicBones(landmarks, exerciseKey, theme, hasFault, width, height) {
    const ctx = this.ctx;

    for (let i = 0; i < SKELETON_CONNECTIONS.length; i++) {
      const [idx1, idx2] = SKELETON_CONNECTIONS[i];
      const p1 = landmarks[idx1];
      const p2 = landmarks[idx2];

      if (!p1 || !p2 || p1.visibility < 0.5 || p2.visibility < 0.5) {
        continue;
      }

      const avgZ = ((p1.z || 0) + (p2.z || 0)) / 2;
      const depth = this._getDepthFactor(avgZ);
      const isActive = this._isActiveConnection(idx1, idx2, exerciseKey);
      const isTorso = (idx1 === 11 && idx2 === 12) || (idx1 === 12 && idx2 === 24) || 
                      (idx1 === 24 && idx2 === 23) || (idx1 === 23 && idx2 === 11);
      
      const isFaultedSegment = hasFault && (isTorso || isActive);

      const x1 = p1.x * width;
      const y1 = p1.y * height;
      const x2 = p2.x * width;
      const y2 = p2.y * height;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);

      let strokeColor = HOLO_COLORS.CYAN;
      let alphaStroke = `rgba(0, 242, 254, ${0.45 * depth})`;

      if (isFaultedSegment) {
        strokeColor = HOLO_COLORS.CRIMSON;
        alphaStroke = HOLO_COLORS.CRIMSON_ALPHA;
      } else if (isActive) {
        strokeColor = theme.solid;
        alphaStroke = theme.alpha;
      }

      // PASS 1: Outer Glow Pass
      ctx.lineWidth = 5 * depth;
      ctx.lineCap = 'round';
      ctx.strokeStyle = alphaStroke;
      ctx.shadowBlur = 14 * depth;
      ctx.shadowColor = strokeColor;
      ctx.stroke();

      // PASS 2: Inner Energy Core Pass
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = 2 * depth;
      ctx.strokeStyle = HOLO_COLORS.WHITE;
      ctx.shadowBlur = 3 * depth;
      ctx.shadowColor = HOLO_COLORS.WHITE;
      ctx.stroke();

      ctx.restore();
    }
  }

  /**
   * Renders glowing concentric rings on major joints with white core anchors.
   * 
   * @param {Array<any>} landmarks
   * @param {string} exerciseKey
   * @param {{ solid: string, alpha: string }} theme
   * @param {number} now
   * @param {number} width
   * @param {number} height
   * @private
   */
  _renderArticulatedNodes(landmarks, exerciseKey, theme, now, width, height) {
    const ctx = this.ctx;

    for (let i = 0; i < MAJOR_JOINTS.length; i++) {
      const idx = MAJOR_JOINTS[i];
      const lm = landmarks[idx];

      if (!lm || lm.visibility < 0.5) {
        continue;
      }

      const depth = this._getDepthFactor(lm.z || 0);
      const x = lm.x * width;
      const y = lm.y * height;

      const isSquatJoint = exerciseKey === 'SQUAT' && [23, 24, 25, 26, 27, 28].includes(idx);
      const isCurlJoint = exerciseKey === 'BICEP_CURL' && [11, 12, 13, 14, 15, 16].includes(idx);
      const isPushupJoint = exerciseKey === 'PUSHUP' && [11, 12, 13, 14, 15, 16].includes(idx);
      const isTargetJoint = isSquatJoint || isCurlJoint || isPushupJoint;
      const nodeColor = isTargetJoint ? theme.solid : HOLO_COLORS.CYAN;

      ctx.save();

      // Outer Halo Ring
      const pulse = Math.sin((now / 220) + idx) * 2;
      const outerRadius = Math.max(3, (7 + pulse) * depth);

      ctx.beginPath();
      ctx.arc(x, y, outerRadius, 0, 2 * Math.PI);
      ctx.strokeStyle = nodeColor;
      ctx.lineWidth = 1.5 * depth;
      ctx.shadowBlur = 8 * depth;
      ctx.shadowColor = nodeColor;
      ctx.stroke();

      // Middle Cyber Ring
      const coreRadius = Math.max(2, 4 * depth);
      ctx.beginPath();
      ctx.arc(x, y, coreRadius, 0, 2 * Math.PI);
      ctx.fillStyle = nodeColor;
      ctx.fill();

      // White Center Anchor Dot
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, 1.8 * depth), 0, 2 * Math.PI);
      ctx.fillStyle = HOLO_COLORS.WHITE;
      ctx.shadowBlur = 0;
      ctx.fill();

      ctx.restore();
    }
  }

  /**
   * Draws dynamic concentric depth arcs and glowing floating angle badge.
   * 
   * @param {Array<any>} landmarks
   * @param {string} exerciseKey
   * @param {number} angle
   * @param {{ solid: string, alpha: string, label: string }} theme
   * @param {number} now
   * @param {number} width
   * @param {number} height
   * @private
   */
  _renderRadialAngleGauge(landmarks, exerciseKey, angle, theme, now, width, height) {
    let pA = null, pB = null, pC = null;

    if (exerciseKey === 'SQUAT') {
      const leftConf = landmarks[25] ? landmarks[25].visibility : 0;
      const rightConf = landmarks[26] ? landmarks[26].visibility : 0;
      const isLeft = leftConf >= rightConf;
      pA = landmarks[isLeft ? 23 : 24]; // Hip
      pB = landmarks[isLeft ? 25 : 26]; // Knee (Vertex)
      pC = landmarks[isLeft ? 27 : 28]; // Ankle
    } else if (exerciseKey === 'BICEP_CURL' || exerciseKey === 'PUSHUP') {
      const leftConf = landmarks[13] ? landmarks[13].visibility : 0;
      const rightConf = landmarks[14] ? landmarks[14].visibility : 0;
      const isLeft = leftConf >= rightConf;
      pA = landmarks[isLeft ? 11 : 12]; // Shoulder
      pB = landmarks[isLeft ? 13 : 14]; // Elbow (Vertex)
      pC = landmarks[isLeft ? 15 : 16]; // Wrist
    }

    if (!pA || !pB || !pC || pA.visibility < 0.5 || pB.visibility < 0.5 || pC.visibility < 0.5) {
      return;
    }

    const ctx = this.ctx;
    const xB = pB.x * width;
    const yB = pB.y * height;
    const xA = pA.x * width;
    const yA = pA.y * height;
    const xC = pC.x * width;
    const yC = pC.y * height;

    const angleA = Math.atan2(yA - yB, xA - xB);
    const angleC = Math.atan2(yC - yB, xC - xB);

    ctx.save();

    // Expanding ripple pulse when target depth achieved (<= 90 deg)
    if (angle <= 90 && theme.solid === HOLO_COLORS.MINT) {
      const ripplePhase = (now % 800) / 800;
      const rippleRadius = 40 + (ripplePhase * 36);
      const rippleAlpha = 1 - ripplePhase;

      ctx.beginPath();
      ctx.arc(xB, yB, rippleRadius, 0, 2 * Math.PI);
      ctx.strokeStyle = `rgba(0, 255, 135, ${rippleAlpha * 0.8})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Dynamic Concentric Gauge Arc
    const gaugeRadius = 44;
    ctx.beginPath();
    ctx.arc(xB, yB, gaugeRadius, angleA, angleC);
    ctx.strokeStyle = theme.solid;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 14;
    ctx.shadowColor = theme.solid;
    ctx.stroke();

    // Floating Holographic Angle Badge
    const badgeWidth = 110;
    const badgeHeight = 38;
    const badgeX = xB - (badgeWidth / 2);
    const badgeY = yB - 65;

    ctx.save();
    ctx.fillStyle = 'rgba(10, 15, 29, 0.9)';
    ctx.strokeStyle = theme.solid;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 10;
    ctx.shadowColor = theme.solid;

    this._drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 8);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Badge Angle Display (Unmirrored for left-to-right legibility)
    this._drawUnmirroredText(
      `${Math.round(angle)}°`,
      badgeX + (badgeWidth / 2),
      badgeY + 14,
      'bold 15px "Orbitron", -apple-system, sans-serif',
      HOLO_COLORS.WHITE,
      'center'
    );

    // Subtitle label (e.g. TARGET DEPTH)
    this._drawUnmirroredText(
      theme.label,
      badgeX + (badgeWidth / 2),
      badgeY + 27,
      'bold 8px "Orbitron", -apple-system, sans-serif',
      theme.solid,
      'center'
    );

    ctx.restore();
  }

  /**
   * Displays laser crimson warning banner on posture fault.
   * 
   * @param {string} faultMessage
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderFaultBanner(faultMessage, width, height, now) {
    const ctx = this.ctx;
    const bannerWidth = Math.min(320, width * 0.85);
    const bannerHeight = 38;
    const x = (width - bannerWidth) / 2;
    const y = height - 60;

    const pulse = Math.sin(now / 150) * 0.15 + 0.85;

    ctx.save();
    ctx.fillStyle = `rgba(255, 0, 85, ${0.9 * pulse})`;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 16;
    ctx.shadowColor = HOLO_COLORS.CRIMSON;

    this._drawRoundedRect(ctx, x, y, bannerWidth, bannerHeight, 8);
    ctx.fill();
    ctx.stroke();

    this._drawUnmirroredText(
      `⚠️ ${faultMessage.toUpperCase()}`,
      x + (bannerWidth / 2),
      y + (bannerHeight / 2),
      'bold 12px "Orbitron", -apple-system, sans-serif',
      HOLO_COLORS.WHITE,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders text with horizontal inverse matrix to cancel CSS mirrored transform.
   * 
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {string} font
   * @param {string} color
   * @param {CanvasTextAlign} [align='left']
   * @private
   */
  _drawUnmirroredText(text, x, y, font, color, align = 'left') {
    this.ctx.save();
    this.ctx.font = font;
    this.ctx.fillStyle = color;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = 'middle';
    
    // Invert X axis around anchor
    this.ctx.translate(x, y);
    this.ctx.scale(-1, 1);
    
    this.ctx.fillText(text, 0, 0);
    this.ctx.restore();
  }

  /**
   * Draws a rounded rectangle path.
   * 
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {number} radius
   * @private
   */
  _drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x + radius, y);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * Evaluates if a connection belongs to active movement targets.
   * 
   * @param {number} p1
   * @param {number} p2
   * @param {string} exerciseKey
   * @returns {boolean}
   * @private
   */
  _isActiveConnection(p1, p2, exerciseKey) {
    if (exerciseKey === 'SQUAT') {
      const squatJoints = [23, 24, 25, 26, 27, 28];
      return squatJoints.includes(p1) && squatJoints.includes(p2);
    }
    if (exerciseKey === 'BICEP_CURL' || exerciseKey === 'PUSHUP') {
      const armJoints = [11, 12, 13, 14, 15, 16];
      return armJoints.includes(p1) && armJoints.includes(p2);
    }
    return false;
  }

  /**
   * Renders the Biomechanical Sticking-Point Safety Spotter HUD overlay.
   * - Normal: Ambient cyber-cyan HUD status chip.
   * - Warning (Velocity Loss > 40%): Amber pulsing border pill (STICKING POINT DETECTED).
   * - Critical (Stall > 1.2s): Pulsing strobe crimson screen border with high-contrast emergency badge.
   * 
   * @param {{
   *   isStalled: boolean,
   *   severity: 'NORMAL'|'WARNING'|'CRITICAL',
   *   cue: string,
   *   velocityLossPercent?: number,
   *   inStickingZone?: boolean
   * }} safetyData
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderSafetySpotter(safetyData, width, height, now) {
    if (!safetyData) return;

    const ctx = this.ctx;
    const severity = safetyData.severity || 'NORMAL';

    ctx.save();

    if (severity === 'CRITICAL') {
      // 1. Critical Emergency Stall: Strobe crimson screen border & high-contrast badge
      const strobeRate = Math.sin(now / 75); // fast ~6.5 Hz strobe
      const strobeAlpha = 0.65 + (0.35 * Math.abs(strobeRate));
      const borderThickness = 10;

      // Screen-wide crimson alert border
      ctx.strokeStyle = `rgba(255, 0, 85, ${strobeAlpha.toFixed(3)})`;
      ctx.lineWidth = borderThickness;
      ctx.shadowColor = '#ff0055';
      ctx.shadowBlur = 24;
      ctx.strokeRect(borderThickness / 2, borderThickness / 2, width - borderThickness, height - borderThickness);

      // Semi-transparent emergency red wash
      ctx.fillStyle = `rgba(255, 0, 85, ${(0.10 * Math.abs(strobeRate)).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);

      // High-Contrast Emergency Badge (Center-Top)
      const badgeW = Math.min(width - 40, 520);
      const badgeH = 76;
      const badgeX = (width - badgeW) / 2;
      const badgeY = 88;

      // Dark card with neon crimson border
      ctx.shadowBlur = 28;
      ctx.shadowColor = '#ff0055';
      ctx.fillStyle = 'rgba(15, 3, 8, 0.95)';
      ctx.strokeStyle = '#ff0055';
      ctx.lineWidth = 2.5;

      this._drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 10);
      ctx.fill();
      ctx.stroke();

      // Hazard diagonal hash accents on left and right edges
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(255, 0, 85, 0.25)';
      ctx.lineWidth = 3;
      for (let x = badgeX - 20; x < badgeX + badgeW + 40; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, badgeY);
        ctx.lineTo(x + 12, badgeY + badgeH);
        ctx.stroke();
      }
      ctx.restore();

      // Top title text
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#ff0055';
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 15px "Orbitron", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚠️ EMERGENCY: STALL DETECTED - DUMP SAFELY', width / 2, badgeY + 26);

      // Subtitle directive
      ctx.fillStyle = '#ff0055';
      ctx.font = '600 12px "Inter", sans-serif';
      ctx.fillText('CRITICAL STICKING STALL > 1.2s | RELEASE WEIGHT / SECURE POSITION', width / 2, badgeY + 52);

    } else if (severity === 'WARNING') {
      // 2. Warning: Amber pulsing border pill (STICKING POINT DETECTED)
      const pulse = 0.55 + (0.45 * Math.sin(now / 160)); // ~3 Hz pulse
      const pillW = 310;
      const pillH = 34;
      const pillX = (width - pillW) / 2;
      const pillY = 82;

      // Glowing amber pill
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(24, 18, 5, 0.88)';
      ctx.strokeStyle = `rgba(245, 158, 11, ${pulse.toFixed(3)})`;
      ctx.lineWidth = 2;

      this._drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 16);
      ctx.fill();
      ctx.stroke();

      // Amber indicator dot
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(pillX + 20, pillY + (pillH / 2), 5, 0, Math.PI * 2);
      ctx.fill();

      // Text label
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#fef3c7';
      ctx.font = '700 11px "Orbitron", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lossLabel = safetyData.velocityLossPercent ? ` [${safetyData.velocityLossPercent}% LOSS]` : '';
      ctx.fillText(`⚡ STICKING POINT DETECTED${lossLabel}`, (width / 2) + 6, pillY + (pillH / 2));

      // Subtle amber corner hazard brackets
      ctx.strokeStyle = `rgba(245, 158, 11, ${(0.4 * pulse).toFixed(3)})`;
      ctx.lineWidth = 3;
      const bSize = 24;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(12, 12 + bSize);
      ctx.lineTo(12, 12);
      ctx.lineTo(12 + bSize, 12);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(width - 12 - bSize, 12);
      ctx.lineTo(width - 12, 12);
      ctx.lineTo(width - 12, 12 + bSize);
      ctx.stroke();

    } else {
      // 3. Normal: Ambient cyber-cyan HUD
      // Discreet cyber status tag in the upper-right telemetry rail
      const tagW = 148;
      const tagH = 22;
      const tagX = width - tagW - 20;
      const tagY = 56;

      ctx.fillStyle = 'rgba(5, 20, 28, 0.65)';
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
      ctx.lineWidth = 1;

      this._drawRoundedRect(ctx, tagX, tagY, tagW, tagH, 6);
      ctx.fill();
      ctx.stroke();

      // Cyan pulse dot
      ctx.fillStyle = '#00f2fe';
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(tagX + 12, tagY + (tagH / 2), 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#a5f3fc';
      ctx.font = '600 9px "Orbitron", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('SPOTTER: ACTIVE', tagX + 22, tagY + (tagH / 2));
    }

    ctx.restore();
  }

  /**
   * Renders the articulated glowing segmented spine ladder column.
   * If status === 'CRITICAL_FLEXION', flashes the lumbar segments in intense Hazard Red (#FF0055)
   * with an anchored warning tag: ⚠️ LUMBAR SHEAR EXCEEDED.
   * 
   * @param {Object} spineData
   * @param {Array<any>} spineData.spineSegments
   * @param {string} spineData.status
   * @param {number} spineData.lumbarFlexionDeg
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderSpineLadder(spineData, width, height, now) {
    if (!spineData || !spineData.spineSegments || spineData.spineSegments.length === 0) return;

    const ctx = this.ctx;
    const segments = spineData.spineSegments;
    const isCritical = spineData.status === 'CRITICAL_FLEXION';
    const isModerate = spineData.status === 'MODERATE_SHEAR';

    ctx.save();

    // Map segments to canvas coordinates
    const pixelSegs = segments.map(seg => ({
      x: seg.x * width,
      y: seg.y * height,
      z: seg.z || 0,
      id: seg.id,
      label: seg.label,
      isLumbar: seg.isLumbar
    }));

    // 1. Draw central vertebral column chord line
    ctx.beginPath();
    ctx.moveTo(pixelSegs[0].x, pixelSegs[0].y);
    for (let i = 1; i < pixelSegs.length; i++) {
      ctx.lineTo(pixelSegs[i].x, pixelSegs[i].y);
    }

    if (isCritical) {
      const strobe = Math.abs(Math.sin(now / 90));
      ctx.strokeStyle = `rgba(255, 0, 85, ${(0.7 + (0.3 * strobe)).toFixed(2)})`;
      ctx.shadowColor = '#ff0055';
      ctx.shadowBlur = 18;
      ctx.lineWidth = 4;
    } else if (isModerate) {
      ctx.strokeStyle = '#f59e0b';
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 3;
    } else {
      ctx.strokeStyle = '#00f2fe';
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2.5;
    }
    ctx.stroke();

    // 2. Draw articulated transverse vertebral rungs (ladder discs)
    let lumbarAnchor = null;

    for (let i = 0; i < pixelSegs.length; i++) {
      const curr = pixelSegs[i];
      const prev = pixelSegs[Math.max(0, i - 1)];
      const next = pixelSegs[Math.min(pixelSegs.length - 1, i + 1)];

      // Direction vector
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const angle = Math.atan2(dy, dx);
      // Perpendicular angle
      const perpAngle = angle + (Math.PI / 2);

      const rungHalfW = curr.isLumbar ? 16 : 13;
      const rx1 = curr.x + (Math.cos(perpAngle) * rungHalfW);
      const ry1 = curr.y + (Math.sin(perpAngle) * rungHalfW);
      const rx2 = curr.x - (Math.cos(perpAngle) * rungHalfW);
      const ry2 = curr.y - (Math.sin(perpAngle) * rungHalfW);

      // Determine disc color
      let discColor = '#00f2fe';
      let discGlow = '#00f2fe';
      let rungThickness = 3;

      if (curr.isLumbar && isCritical) {
        discColor = '#ff0055';
        discGlow = '#ff0055';
        rungThickness = 5;
        if (!lumbarAnchor) lumbarAnchor = curr;
      } else if (curr.isLumbar && isModerate) {
        discColor = '#f59e0b';
        discGlow = '#f59e0b';
        rungThickness = 4;
      } else if (!curr.isLumbar && isCritical) {
        discColor = '#f59e0b';
        discGlow = '#f59e0b';
      } else {
        discColor = '#00ff87';
        discGlow = '#00ff87';
      }

      // Draw vertebral rung
      ctx.shadowColor = discGlow;
      ctx.shadowBlur = curr.isLumbar && isCritical ? 16 : 8;
      ctx.strokeStyle = discColor;
      ctx.lineWidth = rungThickness;
      ctx.beginPath();
      ctx.moveTo(rx1, ry1);
      ctx.lineTo(rx2, ry2);
      ctx.stroke();

      // Center disc nucleus
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(curr.x, curr.y, curr.isLumbar ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Anchored Warning Tag if CRITICAL_FLEXION
    if (isCritical && lumbarAnchor) {
      const tagX = lumbarAnchor.x + 36;
      const tagY = lumbarAnchor.y - 14;
      const tagW = 240;
      const tagH = 30;

      ctx.shadowColor = '#ff0055';
      ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(20, 2, 8, 0.94)';
      ctx.strokeStyle = '#ff0055';
      ctx.lineWidth = 2;

      this._drawRoundedRect(ctx, tagX, tagY, tagW, tagH, 6);
      ctx.fill();
      ctx.stroke();

      // Indicator pulse dot
      ctx.fillStyle = '#ff0055';
      ctx.beginPath();
      ctx.arc(tagX + 14, tagY + (tagH / 2), 4, 0, Math.PI * 2);
      ctx.fill();

      // Warning text
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 11px "Orbitron", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const flexLabel = spineData.lumbarFlexionDeg ? ` (+${Math.round(spineData.lumbarFlexionDeg)}°)` : '';
      ctx.fillText(`⚠️ LUMBAR SHEAR EXCEEDED${flexLabel}`, tagX + 24, tagY + (tagH / 2));
    }

    ctx.restore();
  }

  /**
   * Renders the mini top-left Phase-Plane HUD Radar showing position vs. velocity (y vs yDot).
   * Traces a glowing cyan cyclical trajectory curve that loops per repetition.
   * If isSticking === true, pulses the trajectory curve in vibrant plasma purple
   * with the alert label: STICKING HORIZON // DRIVE UP and required escape force.
   * 
   * @param {Object} phaseSpaceData
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderPhasePlaneRadar(phaseSpaceData, width, height, now) {
    if (!phaseSpaceData) return;

    const ctx = this.ctx;
    const isSticking = Boolean(phaseSpaceData.isSticking);
    const velocity = typeof phaseSpaceData.velocity === 'number' ? phaseSpaceData.velocity : 0;
    const escapeForce = phaseSpaceData.escapeForceRequired || 0;
    const trajectory = phaseSpaceData.trajectory || (phaseSpaceData.getTrajectory ? phaseSpaceData.getTrajectory() : []);

    const cardW = 168;
    const cardH = 158;
    // Mirrored display: (width - cardW - 20) places it on visual TOP-LEFT of screen
    const x = width - cardW - 20;
    const y = 72;

    ctx.save();

    // 1. Cyber Radar Card Background
    const themeColor = isSticking ? '#d946ef' : '#00f2fe';
    const borderPulse = isSticking ? (0.65 + 0.35 * Math.sin(now / 90)) : 0.40;

    ctx.fillStyle = 'rgba(7, 13, 26, 0.88)';
    ctx.strokeStyle = isSticking ? `rgba(217, 70, 239, ${borderPulse.toFixed(2)})` : 'rgba(0, 242, 254, 0.35)';
    ctx.lineWidth = isSticking ? 2.0 : 1.2;
    ctx.shadowBlur = isSticking ? 16 : 8;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, cardW, cardH, 8);
    ctx.fill();
    ctx.stroke();

    // 2. Header Text (Unmirrored for left-to-right reading)
    const textCenterX = x + (cardW / 2);
    this._drawUnmirroredText(
      isSticking ? '⚠️ STICKING DETECTED' : 'PHASE-PLANE RADAR',
      textCenterX,
      y + 11,
      'bold 8px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'center'
    );

    // 3. Circular Radar Screen
    const radarCX = x + (cardW / 2);
    const radarCY = y + 74;
    const radius = 42;

    // Dark circular radar backing
    ctx.beginPath();
    ctx.arc(radarCX, radarCY, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(3, 8, 18, 0.75)';
    ctx.fill();

    // Outer radar rim
    ctx.strokeStyle = isSticking ? 'rgba(217, 70, 239, 0.7)' : 'rgba(0, 242, 254, 0.4)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Concentric range rings
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.shadowBlur = 0;
    
    ctx.beginPath();
    ctx.arc(radarCX, radarCY, radius * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(radarCX, radarCY, radius * 0.75, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(radarCX - radius + 2, radarCY);
    ctx.lineTo(radarCX + radius - 2, radarCY);
    ctx.moveTo(radarCX, radarCY - radius + 2);
    ctx.lineTo(radarCX, radarCY + radius - 2);
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.22)';
    ctx.stroke();

    // Rotating radar sweep ray
    const sweepAngle = (now / 1400) % (Math.PI * 2);
    const sweepGrad = ctx.createLinearGradient(
      radarCX, radarCY,
      radarCX + Math.cos(sweepAngle) * radius,
      radarCY + Math.sin(sweepAngle) * radius
    );
    sweepGrad.addColorStop(0, 'rgba(0, 242, 254, 0.0)');
    sweepGrad.addColorStop(1, isSticking ? 'rgba(217, 70, 239, 0.35)' : 'rgba(0, 242, 254, 0.25)');

    ctx.beginPath();
    ctx.moveTo(radarCX, radarCY);
    ctx.arc(radarCX, radarCY, radius, sweepAngle - 0.3, sweepAngle);
    ctx.closePath();
    ctx.fillStyle = sweepGrad;
    ctx.fill();

    // Axis micro-labels (unmirrored)
    this._drawUnmirroredText('+V', radarCX, radarCY - radius + 6, '6px "Orbitron", monospace', '#94a3b8', 'center');
    this._drawUnmirroredText('-V', radarCX, radarCY + radius - 6, '6px "Orbitron", monospace', '#94a3b8', 'center');

    // 4. Trace the Glowing Cyclical Phase-Space Trajectory Curve
    if (trajectory && trajectory.length > 1) {
      ctx.beginPath();
      let first = true;

      for (let i = 0; i < trajectory.length; i++) {
        const pt = trajectory[i];
        if (!pt || typeof pt.y !== 'number' || typeof pt.yDot !== 'number') continue;

        // Map y [0, 1] to [-radius * 0.78, +radius * 0.78]
        // Map yDot [-1.2, 1.2] m/s to [+radius * 0.78, -radius * 0.78] (positive velocity is upward)
        const mappedX = radarCX + ((pt.y - 0.5) * 2 * (radius * 0.78));
        const mappedY = radarCY - ((pt.yDot / 1.2) * (radius * 0.78));

        // Clamp to radar interior circle
        const distFromCenter = Math.hypot(mappedX - radarCX, mappedY - radarCY);
        const clampRatio = distFromCenter > (radius - 2) ? ((radius - 2) / distFromCenter) : 1.0;
        const px = radarCX + (mappedX - radarCX) * clampRatio;
        const py = radarCY + (mappedY - radarCY) * clampRatio;

        if (first) {
          ctx.moveTo(px, py);
          first = false;
        } else {
          ctx.lineTo(px, py);
        }
      }

      ctx.strokeStyle = isSticking ? '#d946ef' : '#00f2fe';
      ctx.lineWidth = isSticking ? 2.6 : 1.8;
      ctx.shadowBlur = isSticking ? 14 : 7;
      ctx.shadowColor = isSticking ? '#d946ef' : '#00f2fe';
      ctx.stroke();

      // Draw current lead orb at last phase point
      const lastPt = trajectory[trajectory.length - 1];
      if (lastPt) {
        const leadX = radarCX + ((lastPt.y - 0.5) * 2 * (radius * 0.78));
        const leadY = radarCY - ((lastPt.yDot / 1.2) * (radius * 0.78));
        const leadDist = Math.hypot(leadX - radarCX, leadY - radarCY);
        const leadRatio = leadDist > (radius - 2) ? ((radius - 2) / leadDist) : 1.0;
        const lx = radarCX + (leadX - radarCX) * leadRatio;
        const ly = radarCY + (leadY - radarCY) * leadRatio;

        // Glowing center dot
        ctx.beginPath();
        ctx.arc(lx, ly, isSticking ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 12;
        ctx.shadowColor = isSticking ? '#d946ef' : '#00f2fe';
        ctx.fill();

        // Orbit pulse ring
        ctx.beginPath();
        ctx.arc(lx, ly, 6.5, 0, Math.PI * 2);
        ctx.strokeStyle = isSticking ? '#d946ef' : '#00f2fe';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // 5. Lower Alert Label / Telemetry Pill
    const alertY = y + cardH - 24;
    const pillW = cardW - 16;
    const pillH = 18;
    const pillX = x + 8;

    if (isSticking) {
      // Pulse background in plasma purple
      ctx.fillStyle = 'rgba(217, 70, 239, 0.25)';
      ctx.strokeStyle = '#d946ef';
      ctx.lineWidth = 1.2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#d946ef';

      this._drawRoundedRect(ctx, pillX, alertY, pillW, pillH, 4);
      ctx.fill();
      ctx.stroke();

      this._drawUnmirroredText(
        `STICKING HORIZON // DRIVE UP`,
        textCenterX,
        alertY + (pillH / 2),
        'bold 7.5px "Orbitron", -apple-system, sans-serif',
        '#ffffff',
        'center'
      );
    } else {
      ctx.fillStyle = 'rgba(10, 18, 32, 0.65)';
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.25)';
      ctx.lineWidth = 1.0;
      ctx.shadowBlur = 0;

      this._drawRoundedRect(ctx, pillX, alertY, pillW, pillH, 4);
      ctx.fill();
      ctx.stroke();

      const vSign = velocity >= 0 ? '+' : '';
      this._drawUnmirroredText(
        `v: ${vSign}${velocity.toFixed(2)} m/s | ORBIT OK`,
        textCenterX,
        alertY + (pillH / 2),
        'bold 7px "Orbitron", -apple-system, sans-serif',
        '#00f2fe',
        'center'
      );
    }

    ctx.restore();
  }

  /**
   * Renders a subtle holographic boundary cage around the primary athlete's ground perimeter,
   * visually separating them from bystanders and background noise.
   * 
   * @param {Object} trackerData PersonTracker instance or isolation data
   * @param {Array<any>} landmarks
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderPrimaryAthleteIsolation(trackerData, landmarks, width, height, now) {
    if (!trackerData) return;

    const perimeter = trackerData.perimeter || trackerData.lastPerimeter || 
      (trackerData.getGroundPerimeter ? trackerData.getGroundPerimeter(landmarks) : null);
    if (!perimeter || !perimeter.center) return;

    const ctx = this.ctx;
    ctx.save();

    const cx = perimeter.center.x * width;
    const cy = perimeter.center.y * height;
    const rx = Math.max(25, perimeter.radiusX * width);
    const ry = Math.max(10, perimeter.radiusY * height);

    // 1. Dual Concentric Ground Ellipse Rings
    const pulseAlpha = 0.35 + 0.15 * Math.sin(now / 280);
    
    // Outer perimeter ring
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 242, 254, ${pulseAlpha.toFixed(2)})`;
    ctx.lineWidth = 1.8;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00f2fe';
    ctx.stroke();

    // Inner dashed ring
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.85, ry * 0.85, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 255, 135, 0.40)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -(now / 50) % 12;
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Holographic Ground Corner Brackets (Framing Athlete Stance)
    const bracketSize = 14;
    ctx.strokeStyle = '#00ff87';
    ctx.lineWidth = 2.0;
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#00ff87';

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy - ry + bracketSize);
    ctx.lineTo(cx - rx, cy - ry);
    ctx.lineTo(cx - rx + bracketSize, cy - ry);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(cx + rx - bracketSize, cy - ry);
    ctx.lineTo(cx + rx, cy - ry);
    ctx.lineTo(cx + rx, cy - ry + bracketSize);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy + ry - bracketSize);
    ctx.lineTo(cx - rx, cy + ry);
    ctx.lineTo(cx - rx + bracketSize, cy + ry);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(cx + rx - bracketSize, cy + ry);
    ctx.lineTo(cx + rx, cy + ry);
    ctx.lineTo(cx + rx, cy + ry - bracketSize);
    ctx.stroke();

    // 3. Vertical Laser Light Boundary Cage Beams (rising upwards from perimeter)
    const cageHeight = 50;
    const numBeams = 8;
    for (let i = 0; i < numBeams; i++) {
      const angle = (i / numBeams) * Math.PI * 2;
      const bx = cx + Math.cos(angle) * rx;
      const by = cy + Math.sin(angle) * ry;

      const beamGrad = ctx.createLinearGradient(bx, by, bx, by - cageHeight);
      beamGrad.addColorStop(0, 'rgba(0, 242, 254, 0.45)');
      beamGrad.addColorStop(0.4, 'rgba(0, 255, 135, 0.20)');
      beamGrad.addColorStop(1, 'rgba(0, 242, 254, 0.0)');

      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, by - cageHeight);
      ctx.strokeStyle = beamGrad;
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#00f2fe';
      ctx.stroke();

      // Top glowing beam tip
      ctx.beginPath();
      ctx.arc(bx, by - cageHeight, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 242, 254, 0.6)';
      ctx.fill();
    }

    // 4. Subtle Isolation Anchor Tag below the athlete
    const tagW = 135;
    const tagH = 15;
    const tagX = cx - (tagW / 2);
    const tagY = cy + ry + 6;

    ctx.fillStyle = 'rgba(5, 15, 24, 0.70)';
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = 4;
    ctx.shadowColor = '#00f2fe';

    this._drawRoundedRect(ctx, tagX, tagY, tagW, tagH, 3);
    ctx.fill();
    ctx.stroke();

    this._drawUnmirroredText(
      'PRIMARY ANCHOR [ISOLATED]',
      cx,
      tagY + (tagH / 2),
      'bold 6.5px "Orbitron", -apple-system, sans-serif',
      '#a5f3fc',
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders the illuminated neon barbell reference line and aircraft-style roll indicator.
   * - Shows level horizontal line connecting wrists.
   * - Green when |tiltDegrees| <= 2.0°.
   * - Pulsing Amber/Crimson when > 2.0° showing degrees off-axis.
   * 
   * @param {Object} barbellData
   * @param {number} barbellData.tiltDegrees
   * @param {boolean} barbellData.isLevel
   * @param {number} barbellData.yawDisparityZ
   * @param {Object} barbellData.leftWrist
   * @param {Object} barbellData.rightWrist
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderBarbellLevelGauge(barbellData, width, height, now) {
    if (!barbellData || !barbellData.leftWrist || !barbellData.rightWrist) return;

    const ctx = this.ctx;
    const lw = barbellData.leftWrist;
    const rw = barbellData.rightWrist;

    const x1 = lw.x * width;
    const y1 = lw.y * height;
    const x2 = rw.x * width;
    const y2 = rw.y * height;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;

    const tiltDeg = typeof barbellData.tiltDegrees === 'number' ? barbellData.tiltDegrees : 0;
    const isLevel = Boolean(barbellData.isLevel);
    const yawZ = barbellData.yawDisparityZ || 0;

    // Determine color theme
    let color = '#00ff87'; // Emerald
    let glowColor = '#00ff87';
    if (!isLevel) {
      if (Math.abs(tiltDeg) > 5.0) {
        color = '#ff0055'; // Crimson
        glowColor = '#ff0055';
      } else {
        color = '#f59e0b'; // Amber
        glowColor = '#f59e0b';
      }
    }

    ctx.save();

    // 1. Subtle horizontal ground-plane reference datum through bar midpoint
    const datumHalfW = 60;
    ctx.beginPath();
    ctx.moveTo(mx - datumHalfW, my);
    ctx.lineTo(mx + datumHalfW, my);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Illuminated Neon Barbell Bridging Line (connecting bilateral wrists)
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = isLevel ? 2.5 : 3.5;
    ctx.shadowBlur = isLevel ? 10 : 16;
    ctx.shadowColor = glowColor;
    ctx.stroke();

    // Crisp white core overlay line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Collar endcap nodes at wrists
    [ { x: x1, y: y1 }, { x: x2, y: y2 } ].forEach((collar) => {
      ctx.beginPath();
      ctx.arc(collar.x, collar.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 16, 30, 0.85)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.shadowBlur = 8;
      ctx.shadowColor = glowColor;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(collar.x, collar.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    });

    // 3. Mini Aircraft-Style Roll Indicator (above bar midpoint)
    const gaugeCY = my - 34;
    const gaugeR = 20;

    // Dark instrument bezel backing
    ctx.beginPath();
    ctx.arc(mx, gaugeCY, gaugeR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 14, 28, 0.90)';
    ctx.strokeStyle = color;
    ctx.lineWidth = isLevel ? 1.4 : 2.0;
    ctx.shadowBlur = isLevel ? 6 : 14;
    ctx.shadowColor = glowColor;
    ctx.fill();
    ctx.stroke();

    // Fixed aircraft reference symbol (center dot with mini wings)
    ctx.beginPath();
    ctx.arc(mx, gaugeCY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(mx - 8, gaugeCY);
    ctx.lineTo(mx - 3, gaugeCY);
    ctx.moveTo(mx + 3, gaugeCY);
    ctx.lineTo(mx + 8, gaugeCY);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Rotating Artificial Horizon Bar (tilted by -tiltDeg radians in screen space)
    ctx.save();
    ctx.translate(mx, gaugeCY);
    ctx.rotate((tiltDeg * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(-gaugeR + 3, 0);
    ctx.lineTo(gaugeR - 3, 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.0;
    ctx.shadowBlur = 8;
    ctx.shadowColor = glowColor;
    ctx.stroke();
    ctx.restore();

    // 4. Digital Readout Pill
    const pillW = 100;
    const pillH = 16;
    const pillX = mx - (pillW / 2);
    const pillY = gaugeCY - gaugeR - pillH - 4;

    ctx.fillStyle = 'rgba(7, 13, 24, 0.88)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = isLevel ? 4 : 10;
    ctx.shadowColor = glowColor;

    this._drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 4);
    ctx.fill();
    ctx.stroke();

    const sign = tiltDeg > 0 ? '+' : '';
    const label = isLevel ? `LEVEL: ${Math.abs(tiltDeg).toFixed(1)}°` : `TILT: ${sign}${tiltDeg.toFixed(1)}°`;
    this._drawUnmirroredText(
      label,
      mx,
      pillY + (pillH / 2),
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      color,
      'center'
    );

    // 5. Yaw Disparity Tag if asymmetric extension detected
    if (Math.abs(yawZ) > 0.05) {
      const yawW = 90;
      const yawH = 14;
      const yawY = my + 14;
      const yawX = mx - (yawW / 2);

      ctx.fillStyle = 'rgba(25, 15, 5, 0.85)';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.0;
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#f59e0b';

      this._drawRoundedRect(ctx, yawX, yawY, yawW, yawH, 3);
      ctx.fill();
      ctx.stroke();

      const yawSide = yawZ > 0 ? 'R FWD' : 'L FWD';
      this._drawUnmirroredText(
        `YAW: ${yawSide}`,
        mx,
        yawY + (yawH / 2),
        'bold 6.5px "Orbitron", -apple-system, sans-serif',
        '#f59e0b',
        'center'
      );
    }

    ctx.restore();
  }

  /**
   * Renders the Core Bracing (Valsalva Maneuver) HUD Shield near the athlete's midsection.
   * - Cyan Shield: BRACE LOCKED [VALSALVA ACTIVE]
   * - Broken Amber/Crimson Shield: ⚠️ CORE LEAK: RE-ENGAGE DIAPHRAGM
   * 
   * @param {Object} valsalvaData
   * @param {boolean} valsalvaData.isBraced
   * @param {boolean} valsalvaData.valsalvaIntact
   * @param {string|null} valsalvaData.error
   * @param {number} valsalvaData.dbLevel
   * @param {string} valsalvaData.breathPhase
   * @param {Array<any>} landmarks
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderValsalvaShield(valsalvaData, landmarks, width, height, now) {
    if (!valsalvaData) return;

    const ctx = this.ctx;
    const isLeak = valsalvaData.valsalvaIntact === false || valsalvaData.error === 'PREMATURE_EXHALATION';
    const isBraced = Boolean(valsalvaData.isBraced) && !isLeak;
    const dbLevel = typeof valsalvaData.dbLevel === 'number' ? valsalvaData.dbLevel : -50;

    // Anchor midsection coordinates
    let mx = width * 0.5;
    let my = height * 0.52;

    if (landmarks && landmarks.length >= 25) {
      const lShoulder = landmarks[11];
      const rShoulder = landmarks[12];
      const lHip = landmarks[23];
      const rHip = landmarks[24];

      if (lShoulder && rShoulder && lHip && rHip) {
        const sx = ((lShoulder.x + rShoulder.x) / 2) * width;
        const sy = ((lShoulder.y + rShoulder.y) / 2) * height;
        const hx = ((lHip.x + rHip.x) / 2) * width;
        const hy = ((lHip.y + rHip.y) / 2) * height;

        // Position slightly offset to lateral midsection (+48px) so it doesn't collide with spine ladder
        mx = ((sx + hx) / 2) + 48;
        my = (0.45 * sy) + (0.55 * hy);
      }
    }

    ctx.save();

    // Shield dimensions
    const sw = 15; // half-width
    const sh = 34; // full height
    const themeColor = isLeak ? '#ff0055' : (isBraced ? '#00f2fe' : '#f59e0b');
    const strobeAlpha = isLeak ? (0.65 + 0.35 * Math.sin(now / 70)) : 0.85;

    // 1. Draw Cybernetic Shield Geometry
    ctx.shadowBlur = isLeak ? 18 : 10;
    ctx.shadowColor = themeColor;
    ctx.lineWidth = isLeak ? 2.5 : 1.8;
    ctx.strokeStyle = isLeak ? `rgba(255, 0, 85, ${strobeAlpha.toFixed(2)})` : themeColor;
    ctx.fillStyle = isLeak ? 'rgba(30, 5, 10, 0.85)' : 'rgba(5, 18, 28, 0.85)';

    if (!isLeak) {
      // Sleek intact shield path
      ctx.beginPath();
      ctx.moveTo(mx, my - (sh / 2));
      ctx.lineTo(mx + sw, my - (sh / 2) + 6);
      ctx.lineTo(mx + sw, my + 4);
      ctx.quadraticCurveTo(mx + sw, my + (sh / 2), mx, my + (sh / 2) + 4);
      ctx.quadraticCurveTo(mx - sw, my + (sh / 2), mx - sw, my + 4);
      ctx.lineTo(mx - sw, my - (sh / 2) + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Inner core energy diamond
      ctx.beginPath();
      ctx.moveTo(mx, my - 6);
      ctx.lineTo(mx + 6, my);
      ctx.lineTo(mx, my + 6);
      ctx.lineTo(mx - 6, my);
      ctx.closePath();
      ctx.fillStyle = themeColor;
      ctx.shadowBlur = 6;
      ctx.fill();
    } else {
      // Broken / Cracked Shield with central jagged rupture
      ctx.beginPath();
      // Left broken half
      ctx.moveTo(mx, my - (sh / 2));
      ctx.lineTo(mx - sw, my - (sh / 2) + 6);
      ctx.lineTo(mx - sw, my + 4);
      ctx.quadraticCurveTo(mx - sw, my + (sh / 2), mx - 2, my + (sh / 2) + 4);
      // Jagged rupture line
      ctx.lineTo(mx + 3, my + 6);
      ctx.lineTo(mx - 4, my);
      ctx.lineTo(mx + 2, my - 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Right broken half
      ctx.beginPath();
      ctx.moveTo(mx + 2, my - (sh / 2) + 2);
      ctx.lineTo(mx + sw + 2, my - (sh / 2) + 8);
      ctx.lineTo(mx + sw + 2, my + 6);
      ctx.quadraticCurveTo(mx + sw + 2, my + (sh / 2) + 2, mx + 4, my + (sh / 2) + 6);
      ctx.lineTo(mx + 7, my + 6);
      ctx.lineTo(mx + 1, my);
      ctx.lineTo(mx + 5, my - 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 2. Floating Telemetry Badge
    const badgeW = isLeak ? 195 : 155;
    const badgeH = 22;
    const badgeX = mx - (badgeW / 2);
    const badgeY = my + (sh / 2) + 10;

    ctx.fillStyle = isLeak ? 'rgba(25, 3, 8, 0.94)' : 'rgba(5, 14, 24, 0.88)';
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = isLeak ? 14 : 6;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
    ctx.fill();
    ctx.stroke();

    if (isLeak) {
      this._drawUnmirroredText(
        '⚠️ CORE LEAK: RE-ENGAGE DIAPHRAGM',
        mx,
        badgeY + (badgeH / 2),
        'bold 7.5px "Orbitron", -apple-system, sans-serif',
        '#ff0055',
        'center'
      );
    } else {
      this._drawUnmirroredText(
        'BRACE LOCKED [VALSALVA ACTIVE]',
        mx,
        badgeY + (badgeH / 2),
        'bold 7.5px "Orbitron", -apple-system, sans-serif',
        '#00f2fe',
        'center'
      );
    }

    ctx.restore();
  }

  /**
   * Renders the Ankle Dorsiflexion Arc around the ankle joint and premature heel-rise warning ripples.
   * - Animated cyan angle arc showing degrees of acute dorsiflexion.
   * - If heelLifting === true, highlights the heel contact point with expanding hazard-amber ripples:
   *   '⚠️ HEEL RISING // DRIVE FLAT'.
   * 
   * @param {Object} mobilityData
   * @param {Array<Object>} landmarks
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderAnkleDorsiflexion(mobilityData, landmarks, width, height, now) {
    if (!mobilityData || !mobilityData.isVisible || !mobilityData.anklePoint || !mobilityData.kneePoint || !mobilityData.heelContactPoint || !mobilityData.toePoint) {
      return;
    }

    const ctx = this.ctx;
    const ax = mobilityData.anklePoint.x * width;
    const ay = mobilityData.anklePoint.y * height;
    const kx = mobilityData.kneePoint.x * width;
    const ky = mobilityData.kneePoint.y * height;
    const hx = mobilityData.heelContactPoint.x * width;
    const hy = mobilityData.heelContactPoint.y * height;
    const tx = mobilityData.toePoint.x * width;
    const ty = mobilityData.toePoint.y * height;

    const angleTibia = Math.atan2(ky - ay, kx - ax);
    const angleFoot = Math.atan2(ty - hy, tx - hx);
    const deg = Math.round(mobilityData.dorsiAngleDeg || 0);
    const isRestricted = mobilityData.mobilityScore === 'RESTRICTED';
    const isLifting = Boolean(mobilityData.heelLifting);

    const arcColor = isLifting ? '#ff0055' : (isRestricted ? '#f59e0b' : '#00f2fe');
    const glowColor = isLifting ? '#ff0055' : (isRestricted ? '#f59e0b' : '#00f2fe');

    ctx.save();

    // 1. Animated Ankle Dorsiflexion Arc
    const arcR = 26;
    let diff = angleFoot - angleTibia;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    const anticlockwise = diff < 0;

    // Glowing arc line
    ctx.beginPath();
    ctx.arc(ax, ay, arcR, angleTibia, angleFoot, anticlockwise);
    ctx.strokeStyle = arcColor;
    ctx.lineWidth = isLifting ? 2.8 : 2.0;
    ctx.shadowBlur = isLifting ? 16 : 8;
    ctx.shadowColor = glowColor;
    ctx.stroke();

    // Soft sector fill
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.arc(ax, ay, arcR, angleTibia, angleFoot, anticlockwise);
    ctx.closePath();
    ctx.fillStyle = isLifting ? 'rgba(255, 0, 85, 0.22)' : (isRestricted ? 'rgba(245, 158, 11, 0.20)' : 'rgba(0, 242, 254, 0.16)');
    ctx.fill();

    // Radial guide rays
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + Math.cos(angleTibia) * (arcR + 5), ay + Math.sin(angleTibia) * (arcR + 5));
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + Math.cos(angleFoot) * (arcR + 5), ay + Math.sin(angleFoot) * (arcR + 5));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // Ankle pivot node
    ctx.beginPath();
    ctx.arc(ax, ay, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = arcColor;
    ctx.shadowBlur = 6;
    ctx.fill();

    // Digital Dorsiflexion Badge Pill
    const pillW = 76;
    const pillH = 16;
    const pillX = ax + (ax > width * 0.5 ? -pillW - 10 : 10);
    const pillY = ay - (pillH / 2);

    ctx.fillStyle = 'rgba(6, 12, 24, 0.88)';
    ctx.strokeStyle = arcColor;
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = 6;
    ctx.shadowColor = glowColor;

    this._drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 4);
    ctx.fill();
    ctx.stroke();

    this._drawUnmirroredText(
      `${deg}° DORSI`,
      pillX + (pillW / 2),
      pillY + (pillH / 2),
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      arcColor,
      'center'
    );

    // 2. Premature Heel Elevation Warning Ripple
    if (isLifting) {
      // 3 expanding hazard ripples
      for (let r = 0; r < 3; r++) {
        const phase = ((now / 650) + (r * 0.33)) % 1;
        const radius = 6 + (phase * 30);
        const alpha = (1.0 - phase) * 0.90;

        ctx.beginPath();
        ctx.arc(hx, hy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(245, 158, 11, ${alpha.toFixed(2)})`;
        ctx.lineWidth = 2.2;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#f59e0b';
        ctx.stroke();
      }

      // Heel contact node
      ctx.beginPath();
      ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff0055';
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#ff0055';
      ctx.fill();

      // Floating hazard warning badge: ⚠️ HEEL RISING // DRIVE FLAT
      const badgeW = 176;
      const badgeH = 20;
      const badgeX = hx - (badgeW / 2);
      const badgeY = hy + 18;
      const strobe = 0.65 + 0.35 * Math.sin(now / 75);

      ctx.fillStyle = 'rgba(25, 5, 10, 0.92)';
      ctx.strokeStyle = `rgba(255, 0, 85, ${strobe.toFixed(2)})`;
      ctx.lineWidth = 1.6;
      ctx.shadowBlur = 14;
      ctx.shadowColor = '#ff0055';

      this._drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
      ctx.fill();
      ctx.stroke();

      this._drawUnmirroredText(
        '⚠️ HEEL RISING // DRIVE FLAT',
        hx,
        badgeY + (badgeH / 2),
        'bold 7.5px "Orbitron", -apple-system, sans-serif',
        '#ff0055',
        'center'
      );
    }

    ctx.restore();
  }

  /**
   * Emits a golden particle stream propagating up the skeleton (Ankle -> Knee -> Hip -> Torso)
   * when triple-extension concentric timing is optimal.
   * 
   * @param {Object} kineticChainData
   * @param {Array<Object>} landmarks
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderKineticParticleStream(kineticChainData, landmarks, width, height, now) {
    if (!kineticChainData || !landmarks || landmarks.length < 29) return;

    const ctx = this.ctx;
    const isOptimal = kineticChainData.sequenceStatus === 'OPTIMAL_CHAIN';
    const isDriving = Boolean(kineticChainData.isTripleExtensionActive) || (now - (kineticChainData.tPeakAnkle || 0) < 1400);

    // Identify skeletal path nodes (prioritize more visible side)
    const scoreL = (landmarks[27]?.visibility || 0) + (landmarks[25]?.visibility || 0) + (landmarks[23]?.visibility || 0);
    const scoreR = (landmarks[28]?.visibility || 0) + (landmarks[26]?.visibility || 0) + (landmarks[24]?.visibility || 0);
    const useLeft = scoreL >= scoreR;

    const ankle = landmarks[useLeft ? 27 : 28];
    const knee = landmarks[useLeft ? 25 : 26];
    const hip = landmarks[useLeft ? 23 : 24];
    const shoulderL = landmarks[11];
    const shoulderR = landmarks[12];

    if (!ankle || !knee || !hip || !shoulderL || !shoulderR) return;

    const midTorso = {
      x: ((shoulderL.x + shoulderR.x) / 2) * width,
      y: ((shoulderL.y + shoulderR.y) / 2) * height
    };

    const chainPoints = [
      { x: ankle.x * width, y: ankle.y * height },
      { x: knee.x * width, y: knee.y * height },
      { x: hip.x * width, y: hip.y * height },
      midTorso
    ];

    // Spawn golden particles when optimal concentric triple extension is executing
    if (isOptimal && isDriving && this.kineticParticles.length < 36) {
      const spawnCount = 2;
      for (let s = 0; s < spawnCount; s++) {
        this.kineticParticles.push({
          u: 0,
          speed: 0.022 + (Math.random() * 0.012),
          size: 2.2 + (Math.random() * 2.2),
          jitterX: (Math.random() - 0.5) * 6,
          jitterY: (Math.random() - 0.5) * 6
        });
      }
    }

    if (this.kineticParticles.length === 0) return;

    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ffd700';

    const activeParticles = [];
    for (let i = 0; i < this.kineticParticles.length; i++) {
      const p = this.kineticParticles[i];
      p.u += p.speed;

      if (p.u >= 1.0) continue; // particle reached top of kinetic chain

      // Piecewise linear interpolation along the 3 segments: Ankle -> Knee -> Hip -> Torso
      let segmentIdx = 0;
      let segU = p.u * 3; // 0 to 3
      if (segU < 1) {
        segmentIdx = 0;
      } else if (segU < 2) {
        segmentIdx = 1;
        segU -= 1;
      } else {
        segmentIdx = 2;
        segU -= 2;
      }

      const pStart = chainPoints[segmentIdx];
      const pEnd = chainPoints[segmentIdx + 1];

      const px = pStart.x + (pEnd.x - pStart.x) * segU + p.jitterX;
      const py = pStart.y + (pEnd.y - pStart.y) * segU + p.jitterY;
      const alpha = Math.max(0.1, 1.0 - (p.u * 0.85));

      ctx.beginPath();
      ctx.arc(px, py, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 215, 0, ${alpha.toFixed(2)})`;
      ctx.fill();

      activeParticles.push(p);
    }

    this.kineticParticles = activeParticles;
    ctx.restore();
  }

  /**
   * Renders the mini top-right Kinetic Chain Sequencing Telemetry Card & Waterfall Graph.
   * Displays: 'KINETIC SEQUENCE: [HIP -> KNEE -> ANKLE] 98% MATCH'
   * 
   * @param {Object} kineticChainData
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderKineticChainCard(kineticChainData, width, height, now) {
    if (!kineticChainData) return;

    const ctx = this.ctx;
    const isOptimal = kineticChainData.sequenceStatus === 'OPTIMAL_CHAIN';
    const percent = Math.round(kineticChainData.sequenceEfficiencyPercent || 98);
    const themeColor = isOptimal ? '#ffd700' : '#ff0055';
    const glowColor = isOptimal ? '#fbbf24' : '#ff0055';

    // Top-right positioned in user space (x = 20 in mirrored canvas space)
    const cardW = 208;
    const cardH = 76;
    const x = 20;
    const y = 118; // Sits neatly below Bluetooth HR or top telemetry

    ctx.save();

    // 1. Cyber Card Background
    const borderAlpha = isOptimal ? 0.50 : (0.60 + 0.40 * Math.sin(now / 90));
    ctx.fillStyle = 'rgba(7, 13, 26, 0.90)';
    ctx.strokeStyle = isOptimal ? `rgba(255, 215, 0, ${borderAlpha.toFixed(2)})` : `rgba(255, 0, 85, ${borderAlpha.toFixed(2)})`;
    ctx.lineWidth = isOptimal ? 1.4 : 1.8;
    ctx.shadowBlur = isOptimal ? 10 : 16;
    ctx.shadowColor = glowColor;

    this._drawRoundedRect(ctx, x, y, cardW, cardH, 6);
    ctx.fill();
    ctx.stroke();

    // 2. Header Text: KINETIC SEQUENCE: [HIP -> KNEE -> ANKLE] XX% MATCH
    this._drawUnmirroredText(
      `KINETIC SEQUENCE: [HIP -> KNEE -> ANKLE] ${percent}% MATCH`,
      x + (cardW / 2),
      y + 11,
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'center'
    );

    // 3. Mini Waterfall Progress Bars (HIP, KNEE, ANKLE)
    const waterfall = kineticChainData.waterfallData || [
      { joint: 'HIP', progress: 0.95 },
      { joint: 'KNEE', progress: 0.88 },
      { joint: 'ANKLE', progress: 0.75 }
    ];

    const barStartX = x + 44;
    const barW = cardW - 88;
    const barH = 5;
    const rowStartY = y + 21;
    const rowSpacing = 11;

    waterfall.forEach((item, idx) => {
      const rowY = rowStartY + (idx * rowSpacing);

      // Joint Label
      this._drawUnmirroredText(
        item.joint,
        x + 10,
        rowY + 4,
        'bold 6.5px "Orbitron", -apple-system, sans-serif',
        '#94a3b8',
        'left'
      );

      // Trough
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      this._drawRoundedRect(ctx, barStartX, rowY, barW, barH, 2);
      ctx.fill();

      // Active Waterfall Fill
      const fillW = Math.max(4, barW * (item.progress || 0.1));
      const grad = ctx.createLinearGradient(barStartX, 0, barStartX + fillW, 0);
      if (isOptimal) {
        grad.addColorStop(0, '#00f2fe');
        grad.addColorStop(1, '#ffd700');
      } else {
        grad.addColorStop(0, '#f59e0b');
        grad.addColorStop(1, '#ff0055');
      }

      ctx.fillStyle = grad;
      ctx.shadowBlur = 4;
      ctx.shadowColor = themeColor;
      this._drawRoundedRect(ctx, barStartX, rowY, fillW, barH, 2);
      ctx.fill();

      // Peak Indicator Node
      ctx.beginPath();
      ctx.arc(barStartX + fillW, rowY + (barH / 2), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 4;
      ctx.fill();

      // Joint velocity readout
      const vVal = kineticChainData.currentVelocities?.[item.joint.toLowerCase()] || 0;
      this._drawUnmirroredText(
        `${vVal}°/s`,
        x + cardW - 8,
        rowY + 4,
        '6.5px "Orbitron", monospace',
        '#cbd5e1',
        'right'
      );
    });

    // 4. Status Indicator Footer
    const statusText = isOptimal ? '✓ OPTIMAL TRIPLE EXTENSION' : `⚠️ LEAK: ${kineticChainData.faultReason ? 'KNEE DOMINANT' : 'SEQUENCE MISMATCH'}`;
    const statusColor = isOptimal ? '#00ff87' : '#ff0055';
    this._drawUnmirroredText(
      statusText,
      x + (cardW / 2),
      y + cardH - 8,
      'bold 7px "Orbitron", -apple-system, sans-serif',
      statusColor,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders the top-left Voice Command Mic status badge:
   * 'VOICE: ACTIVE [LISTENING]'
   * 
   * @param {CanvasRenderingContext2D} [ctx=this.ctx]
   * @param {string|Object} [voiceStatus='ACTIVE [LISTENING]']
   * @param {number} [canvasWidth=this.logicalWidth]
   * @param {number} [canvasHeight=this.logicalHeight]
   * @param {number} [now=performance.now()]
   */
  drawVoiceIndicator(ctx = this.ctx, voiceStatus = 'ACTIVE [LISTENING]', canvasWidth = this.logicalWidth, canvasHeight = this.logicalHeight, now = performance.now()) {
    if (!ctx) return;

    const statusText = typeof voiceStatus === 'object' && voiceStatus ? (voiceStatus.status || 'ACTIVE [LISTENING]') : String(voiceStatus || 'ACTIVE [LISTENING]');
    const isListening = statusText.includes('ACTIVE') || statusText.includes('LISTENING');
    const isError = statusText.includes('ERROR') || statusText.includes('UNSUPPORTED');

    const badgeW = 168;
    const badgeH = 22;
    // Mirrored display: (canvasWidth - badgeW - 20) places it on visual TOP-LEFT of screen
    const x = canvasWidth - badgeW - 20;
    const y = 14;

    ctx.save();

    const themeColor = isError ? '#ff0055' : (isListening ? '#00ff87' : '#94a3b8');
    const pulse = isListening ? (0.7 + 0.3 * Math.sin(now / 140)) : 0.4;

    // 1. Badge Pill Background
    ctx.fillStyle = 'rgba(7, 13, 26, 0.88)';
    ctx.strokeStyle = isListening ? `rgba(0, 255, 135, ${pulse.toFixed(2)})` : 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = isListening ? 1.5 : 1.0;
    ctx.shadowBlur = isListening ? 8 : 0;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, badgeW, badgeH, 11);
    ctx.fill();
    ctx.stroke();

    // 2. Microphone indicator node / pulsing audio wave dot
    const micX = x + 12;
    const micY = y + (badgeH / 2);
    ctx.beginPath();
    ctx.arc(micX, micY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = themeColor;
    ctx.shadowBlur = isListening ? 6 : 0;
    ctx.fill();

    if (isListening) {
      ctx.beginPath();
      ctx.arc(micX, micY, 3.5 + 4 * (1 - pulse), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 255, 135, ${(0.8 * pulse).toFixed(2)})`;
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }

    // 3. Status text: 'VOICE: ACTIVE [LISTENING]'
    const displayText = statusText.startsWith('VOICE:') ? statusText : `VOICE: ${statusText}`;
    this._drawUnmirroredText(
      displayText,
      x + 24,
      y + (badgeH / 2),
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'left'
    );

    ctx.restore();
  }

  /**
   * Renders a floating glassmorphic Picture-in-Picture window in the lower-left:
   * - Header: 'SLOW-MO FAULT REPLAY [0.25x]'
   * - Border: Pulsing Amber/Crimson outline
   * - Draws captured replay frame with frozen fault vectors
   * 
   * @param {CanvasRenderingContext2D} [ctx=this.ctx] Target drawing context.
   * @param {Object|ImageBitmap} replayFrame Captured replay snapshot or frame object.
   * @param {number} [canvasWidth=this.logicalWidth] Logical canvas width.
   * @param {number} [canvasHeight=this.logicalHeight] Logical canvas height.
   * @param {number} [now=performance.now()] High-resolution timestamp.
   */
  drawDvrWindow(ctx = this.ctx, replayFrame, canvasWidth = this.logicalWidth, canvasHeight = this.logicalHeight, now = performance.now()) {
    if (!ctx || !replayFrame) return;

    const w = canvasWidth || this.logicalWidth || 640;
    const h = canvasHeight || this.logicalHeight || 480;

    const bitmap = (replayFrame && replayFrame.bitmap !== undefined) ? replayFrame.bitmap : (replayFrame instanceof ImageBitmap ? replayFrame : null);
    const telemetry = (replayFrame && replayFrame.telemetry) ? replayFrame.telemetry : null;
    const progress = (replayFrame && typeof replayFrame.progress === 'number') ? replayFrame.progress : 0.5;
    const frameIndex = (replayFrame && replayFrame.frameIndex) || 1;
    const totalFrames = (replayFrame && replayFrame.totalFrames) || 90;

    // PiP Dimensions (floating in visual lower-left)
    const pipW = 184;
    const pipH = 142;
    // Mirrored display: (w - pipW - 18) places it on visual LOWER-LEFT of screen
    const x = w - pipW - 18;
    const y = h - pipH - 24;

    ctx.save();

    // 1. Pulsing Amber / Crimson outline
    const pulsePhase = (now / 120);
    const pulse = 0.65 + 0.35 * Math.sin(pulsePhase);
    const themeColor = Math.sin(pulsePhase) > 0 ? '#ff0055' : '#f59e0b';
    const borderColor = `rgba(255, 0, 85, ${pulse.toFixed(2)})`;

    // 2. Glassmorphic Card Container
    ctx.fillStyle = 'rgba(8, 12, 22, 0.92)';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.8;
    ctx.shadowBlur = 14;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, pipW, pipH, 8);
    ctx.fill();
    ctx.stroke();

    // 3. Header: SLOW-MO FAULT REPLAY [0.25x]
    const headerY = y + 12;
    const textCenterX = x + (pipW / 2);

    ctx.beginPath();
    ctx.arc(x + 12, headerY, 3, 0, Math.PI * 2);
    ctx.fillStyle = themeColor;
    ctx.shadowBlur = 6;
    ctx.fill();

    this._drawUnmirroredText(
      'SLOW-MO FAULT REPLAY [0.25x]',
      textCenterX + 4,
      headerY,
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'center'
    );

    // 4. Inner Replay Viewport
    const viewMargin = 8;
    const viewX = x + viewMargin;
    const viewY = y + 24;
    const viewW = pipW - (viewMargin * 2);
    const viewH = pipH - 44;

    ctx.save();
    this._drawRoundedRect(ctx, viewX, viewY, viewW, viewH, 4);
    ctx.clip();

    ctx.fillStyle = '#020611';
    ctx.fillRect(viewX, viewY, viewW, viewH);

    if (bitmap && typeof bitmap.width === 'number' && bitmap.width > 0) {
      try {
        ctx.drawImage(bitmap, viewX, viewY, viewW, viewH);
      } catch (e) {}
    } else {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(viewX, viewY, viewW, viewH);
      this._drawUnmirroredText(
        'BUFFERING DVR FRAME...',
        viewX + (viewW / 2),
        viewY + (viewH / 2),
        '6.5px "Orbitron", monospace',
        '#64748b',
        'center'
      );
    }

    // Scanlines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    for (let sl = viewY; sl < viewY + viewH; sl += 3) {
      ctx.fillRect(viewX, sl, viewW, 1);
    }

    // 5. Draw Frozen Fault Vectors & Kinematic Telemetry Overlay
    if (telemetry) {
      const faultMsg = telemetry.faultMessage || telemetry.error || 'BIOMECHANICAL FAULT';
      const angle = telemetry.activeAngle ? `${Math.round(telemetry.activeAngle)}°` : '';

      ctx.fillStyle = 'rgba(255, 0, 85, 0.28)';
      ctx.fillRect(viewX, viewY, viewW, 14);

      this._drawUnmirroredText(
        `⚠️ ${faultMsg} ${angle}`,
        viewX + (viewW / 2),
        viewY + 7,
        'bold 6.5px "Orbitron", monospace',
        '#ffffff',
        'center'
      );

      if (telemetry.landmarks && telemetry.landmarks.length > 0) {
        ctx.save();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ff0055';
        ctx.shadowColor = '#ff0055';
        ctx.shadowBlur = 4;

        const lm = telemetry.landmarks;
        const drawPipeLine = (i1, i2) => {
          if (lm[i1] && lm[i2] && lm[i1].visibility > 0.4 && lm[i2].visibility > 0.4) {
            ctx.beginPath();
            ctx.moveTo(viewX + (lm[i1].x * viewW), viewY + (lm[i1].y * viewH));
            ctx.lineTo(viewX + (lm[i2].x * viewW), viewY + (lm[i2].y * viewH));
            ctx.stroke();
          }
        };

        drawPipeLine(11, 23);
        drawPipeLine(12, 24);
        drawPipeLine(23, 25);
        drawPipeLine(25, 27);
        drawPipeLine(24, 26);
        drawPipeLine(26, 28);
        ctx.restore();
      }
    }

    ctx.restore();

    // 6. Scrubbing Timeline Progress Bar
    const progTrackY = y + pipH - 12;
    const progTrackW = pipW - 16;
    const progTrackX = x + 8;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    this._drawRoundedRect(ctx, progTrackX, progTrackY, progTrackW, 3, 1.5);
    ctx.fill();

    const filledW = Math.max(3, progTrackW * Math.min(1.0, progress));
    ctx.fillStyle = themeColor;
    ctx.shadowBlur = 4;
    ctx.shadowColor = themeColor;
    this._drawRoundedRect(ctx, progTrackX, progTrackY, filledW, 3, 1.5);
    ctx.fill();

    this._drawUnmirroredText(
      `${frameIndex}/${totalFrames}`,
      x + pipW - 10,
      progTrackY - 4,
      '6px "Orbitron", monospace',
      '#94a3b8',
      'right'
    );

    ctx.restore();
  }

  /**
   * Renders the aerial top-down Transverse Gyro HUD Compass in the upper-left corner.
   * Shows the lifter's pelvic orientation relative to the camera plane.
   * - Normal (|theta| <= 3 deg): Glowing cyan alignment marker.
   * - Asymmetric (|theta| > 3 deg): Pulsing amber chevron showing rotation direction
   *   ('TWIST: +5.4° RIGHT HIP BACK').
   * 
   * @param {CanvasRenderingContext2D} [ctx=this.ctx] Target drawing context.
   * @param {Object} transverseData Output from TransverseAnalyzer.
   * @param {number} [canvasWidth=this.logicalWidth]
   * @param {number} [canvasHeight=this.logicalHeight]
   * @param {number} [now=performance.now()]
   */
  drawTransverseCompass(ctx = this.ctx, transverseData, canvasWidth = this.logicalWidth, canvasHeight = this.logicalHeight, now = performance.now()) {
    if (!ctx || !transverseData || !transverseData.isVisible) return;

    const w = canvasWidth || this.logicalWidth || 640;
    const cardW = 168;
    const cardH = 92;
    // Mirrored display: (w - cardW - 20) places it on visual TOP-LEFT of screen
    const x = w - cardW - 20;
    const y = 158; // Stacked cleanly below top status badges

    const pelvicYaw = typeof transverseData.pelvicYawDeg === 'number' ? transverseData.pelvicYawDeg : 0;
    const isAsymmetric = Boolean(transverseData.isAsymmetric);
    const twistLabel = transverseData.twistLabel || (isAsymmetric ? `TWIST: ${pelvicYaw.toFixed(1)}°` : `ALIGNED: ${Math.abs(pelvicYaw).toFixed(1)}°`);

    ctx.save();

    const themeColor = isAsymmetric ? '#f59e0b' : '#00f2fe';
    const glowColor = isAsymmetric ? '#f59e0b' : '#00ff87';
    const borderPulse = isAsymmetric ? (0.65 + 0.35 * Math.sin(now / 90)) : 0.35;

    // 1. Glassmorphic Card Container
    ctx.fillStyle = 'rgba(7, 13, 26, 0.90)';
    ctx.strokeStyle = isAsymmetric ? `rgba(245, 158, 11, ${borderPulse.toFixed(2)})` : 'rgba(0, 242, 254, 0.40)';
    ctx.lineWidth = isAsymmetric ? 1.8 : 1.2;
    ctx.shadowBlur = isAsymmetric ? 12 : 6;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, cardW, cardH, 8);
    ctx.fill();
    ctx.stroke();

    // 2. Header (Unmirrored for left-to-right reading)
    const textCenterX = x + (cardW / 2);
    this._drawUnmirroredText(
      isAsymmetric ? '⚠️ TRANSVERSE ASYMMETRY' : 'TRANSVERSE GYRO COMPASS',
      textCenterX,
      y + 11,
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'center'
    );

    // 3. Aerial Top-Down Radar Disc
    const radarCX = x + (cardW / 2);
    const radarCY = y + 42;
    const radarR = 21;

    // Disc background
    ctx.beginPath();
    ctx.arc(radarCX, radarCY, radarR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(3, 8, 18, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = 0;
    ctx.fill();
    ctx.stroke();

    // Concentric guideline & camera plane crosshair
    ctx.beginPath();
    ctx.arc(radarCX, radarCY, radarR * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.18)';
    ctx.stroke();

    // Camera axis (horizontal baseline)
    ctx.beginPath();
    ctx.moveTo(radarCX - radarR + 2, radarCY);
    ctx.lineTo(radarCX + radarR - 2, radarCY);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. Rotating Pelvic Axis Bar & Endcaps
    ctx.save();
    ctx.translate(radarCX, radarCY);
    // Rotate by -pelvicYaw radians (mapping Z disparity into top-down rotation)
    const yawRad = (pelvicYaw * Math.PI) / 180;
    ctx.rotate(-yawRad);

    const barHalfLen = radarR - 4;
    ctx.beginPath();
    ctx.moveTo(-barHalfLen, 0);
    ctx.lineTo(barHalfLen, 0);
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = isAsymmetric ? 2.5 : 2.0;
    ctx.shadowBlur = isAsymmetric ? 10 : 6;
    ctx.shadowColor = glowColor;
    ctx.stroke();

    // Dual Hip Nodes (Left & Right hip markers)
    ctx.beginPath();
    ctx.arc(-barHalfLen, 0, 2.5, 0, Math.PI * 2);
    ctx.arc(barHalfLen, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = isAsymmetric ? '#f59e0b' : '#00ff87';
    ctx.shadowBlur = 6;
    ctx.shadowColor = glowColor;
    ctx.fill();

    // 5. Directional Amber Chevron if Asymmetric (> 3 deg)
    if (isAsymmetric) {
      const dirSign = pelvicYaw > 0 ? 1 : -1;
      const chX = dirSign * (barHalfLen + 2);
      ctx.beginPath();
      ctx.moveTo(chX - (dirSign * 4), -4);
      ctx.lineTo(chX, 0);
      ctx.lineTo(chX - (dirSign * 4), 4);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    ctx.restore(); // Exit radar transform

    // 6. Readout Pill Footer: TWIST: +5.4° RIGHT HIP BACK
    const pillW = cardW - 14;
    const pillH = 17;
    const pillX = x + 7;
    const pillY = y + cardH - 22;

    ctx.fillStyle = isAsymmetric ? 'rgba(30, 18, 5, 0.88)' : 'rgba(5, 14, 24, 0.75)';
    ctx.strokeStyle = isAsymmetric ? '#f59e0b' : 'rgba(0, 242, 254, 0.35)';
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = isAsymmetric ? 6 : 0;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 4);
    ctx.fill();
    ctx.stroke();

    this._drawUnmirroredText(
      twistLabel,
      textCenterX,
      pillY + (pillH / 2),
      'bold 6.8px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders the bottom-left IMU status pill badge:
   * 'STABILIZATION: HARDWARE IMU ACTIVE' or 'STABILIZATION: BYPASS'
   * 
   * @param {CanvasRenderingContext2D} [ctx=this.ctx] Target drawing context.
   * @param {string} [imuStatus='STABILIZATION: HARDWARE IMU ACTIVE'] Status string.
   * @param {number} [canvasWidth=this.logicalWidth]
   * @param {number} [canvasHeight=this.logicalHeight]
   * @param {number} [now=performance.now()]
   */
  drawImuStatus(ctx = this.ctx, imuStatus = 'STABILIZATION: HARDWARE IMU ACTIVE', canvasWidth = this.logicalWidth, canvasHeight = this.logicalHeight, now = performance.now()) {
    if (!ctx) return;

    const w = canvasWidth || this.logicalWidth || 640;
    const h = canvasHeight || this.logicalHeight || 480;

    const statusText = String(imuStatus || 'STABILIZATION: HARDWARE IMU ACTIVE');
    const isActive = statusText.includes('ACTIVE');

    const badgeW = 196;
    const badgeH = 20;
    // Mirrored display: (w - badgeW - 20) places it on visual LOWER-LEFT of screen
    const x = w - badgeW - 20;
    const y = h - 28; // Bottom-left corner

    ctx.save();

    const themeColor = isActive ? '#00ff87' : '#94a3b8';
    const pulse = isActive ? (0.70 + 0.30 * Math.sin(now / 150)) : 0.40;

    // 1. Badge Pill Background
    ctx.fillStyle = 'rgba(7, 13, 26, 0.88)';
    ctx.strokeStyle = isActive ? `rgba(0, 255, 135, ${pulse.toFixed(2)})` : 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = isActive ? 1.4 : 1.0;
    ctx.shadowBlur = isActive ? 8 : 0;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, badgeW, badgeH, 10);
    ctx.fill();
    ctx.stroke();

    // 2. Hardware Gyro / Sensor Pulse Indicator Node
    const nodeX = x + 12;
    const nodeY = y + (badgeH / 2);

    ctx.beginPath();
    ctx.arc(nodeX, nodeY, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = themeColor;
    ctx.shadowBlur = isActive ? 6 : 0;
    ctx.shadowColor = themeColor;
    ctx.fill();

    if (isActive) {
      ctx.beginPath();
      ctx.arc(nodeX, nodeY, 3.2 + 3.5 * (1 - pulse), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 255, 135, ${(0.75 * pulse).toFixed(2)})`;
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }

    // 3. Status text
    this._drawUnmirroredText(
      statusText,
      x + 22,
      y + (badgeH / 2),
      'bold 6.8px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'left'
    );

    ctx.restore();
  }

  /**
   * Renders the bottom-center Stretch-Shortening Cycle (SSC) Amortization Cyber Dial:
   * 'AMORTIZATION: 142ms [EXPLOSIVE RECOIL]'
   * 
   * @param {CanvasRenderingContext2D} [ctx=this.ctx]
   * @param {Object} [sscData]
   * @param {number} [canvasWidth=this.logicalWidth]
   * @param {number} [canvasHeight=this.logicalHeight]
   * @param {number} [now=performance.now()]
   */
  drawSscAmortizationMeter(ctx = this.ctx, sscData, canvasWidth = this.logicalWidth, canvasHeight = this.logicalHeight, now = performance.now()) {
    if (!ctx || !sscData) return;

    const w = canvasWidth || this.logicalWidth || 640;
    const h = canvasHeight || this.logicalHeight || 480;

    const ms = typeof sscData.amortizationMs === 'number' ? sscData.amortizationMs : 0;
    const rating = sscData.elasticityRating || 'STANDBY';
    const isAmortizing = Boolean(sscData.isAmortizing);
    const score = typeof sscData.recoilScore === 'number' ? sscData.recoilScore : 100;
    const label = sscData.displayLabel || (ms > 0 ? `AMORTIZATION: ${ms}ms [${rating.replace('_', ' ')}]` : 'AMORTIZATION: STANDBY');

    const cardW = 246;
    const cardH = 34;
    const x = (w - cardW) / 2;
    const y = h - cardH - 12;

    ctx.save();

    let themeColor = '#00f2fe';
    if (rating === 'HIGH_ELASTICITY') {
      themeColor = '#00ff87';
    } else if (rating === 'MODERATE') {
      themeColor = '#f59e0b';
    } else if (rating === 'DISSIPATED') {
      themeColor = '#ff0055';
    }

    const pulse = isAmortizing ? (0.70 + 0.30 * Math.sin(now / 90)) : 0.40;

    // 1. Cyber Dial Card Background
    ctx.fillStyle = 'rgba(7, 13, 26, 0.90)';
    ctx.strokeStyle = isAmortizing ? `rgba(0, 255, 135, ${pulse.toFixed(2)})` : `rgba(${rating === 'HIGH_ELASTICITY' ? '0, 255, 135' : (rating === 'DISSIPATED' ? '255, 0, 85' : '0, 242, 254')}, 0.40)`;
    ctx.lineWidth = isAmortizing ? 1.8 : 1.2;
    ctx.shadowBlur = isAmortizing ? 12 : 6;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, cardW, cardH, 8);
    ctx.fill();
    ctx.stroke();

    // 2. Mini Cyber Radial Arc Dial
    const dialCX = x + 20;
    const dialCY = y + (cardH / 2);
    const dialR = 10;

    // Background track arc
    ctx.beginPath();
    ctx.arc(dialCX, dialCY, dialR, -Math.PI * 0.75, Math.PI * 0.75);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Active speed/recoil arc (higher recoil score = fuller arc)
    const arcRatio = Math.max(0.08, Math.min(1.0, score / 100));
    const arcEnd = -Math.PI * 0.75 + (arcRatio * (1.5 * Math.PI));
    ctx.beginPath();
    ctx.arc(dialCX, dialCY, dialR, -Math.PI * 0.75, arcEnd);
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 6;
    ctx.shadowColor = themeColor;
    ctx.stroke();

    // Center pulse dot
    ctx.beginPath();
    ctx.arc(dialCX, dialCY, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = themeColor;
    ctx.fill();

    // 3. Unmirrored Readout Text
    const textCenterX = x + (cardW / 2) + 10;
    this._drawUnmirroredText(
      label,
      textCenterX,
      y + (cardH / 2),
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders the upper-left Bar Efficiency Badge:
   * 'BAR EFFICIENCY: 94.2% [VERTICAL GROOVE]'
   * 
   * @param {CanvasRenderingContext2D} [ctx=this.ctx]
   * @param {Object} [efficiencyData]
   * @param {number} [canvasWidth=this.logicalWidth]
   * @param {number} [canvasHeight=this.logicalHeight]
   * @param {number} [now=performance.now()]
   */
  drawBarEfficiencyBadge(ctx = this.ctx, efficiencyData, canvasWidth = this.logicalWidth, canvasHeight = this.logicalHeight, now = performance.now()) {
    if (!ctx || !efficiencyData) return;

    const w = canvasWidth || this.logicalWidth || 640;
    const mer = typeof efficiencyData.merPercent === 'number' ? efficiencyData.merPercent : 100.0;
    const rating = efficiencyData.rating || (mer >= 90 ? 'VERTICAL GROOVE' : (mer >= 80 ? 'MODERATE SWAY' : 'EXCESSIVE DRIFT'));
    const label = efficiencyData.displayLabel || `BAR EFFICIENCY: ${mer.toFixed(1)}% [${rating}]`;

    const badgeW = 196;
    const badgeH = 24;
    // Mirrored display: (w - badgeW - 20) places it on visual UPPER-LEFT of screen
    // Placed at y = 46 (stacked between Voice Indicator at y=14 and Transverse Compass at y=84)
    const x = w - badgeW - 20;
    const y = 46;

    ctx.save();

    let themeColor = '#00ff87';
    if (mer < 80.0) {
      themeColor = '#ff0055';
    } else if (mer < 90.0) {
      themeColor = '#f59e0b';
    }

    const pulse = mer < 80.0 ? (0.65 + 0.35 * Math.sin(now / 100)) : 0.40;

    // 1. Glassmorphic Pill Container
    ctx.fillStyle = 'rgba(7, 13, 26, 0.88)';
    ctx.strokeStyle = mer < 80.0 ? `rgba(255, 0, 85, ${pulse.toFixed(2)})` : `rgba(${mer >= 90 ? '0, 255, 135' : '245, 158, 11'}, 0.45)`;
    ctx.lineWidth = mer < 80.0 ? 1.6 : 1.2;
    ctx.shadowBlur = mer < 80.0 ? 10 : 5;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, badgeW, badgeH, 12);
    ctx.fill();
    ctx.stroke();

    // 2. Vertical Line Groove Icon
    const iconX = x + 12;
    const iconY = y + (badgeH / 2);

    ctx.beginPath();
    ctx.moveTo(iconX, iconY - 6);
    ctx.lineTo(iconX, iconY + 6);
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Small arrow or crosshair marks
    ctx.beginPath();
    ctx.arc(iconX, iconY, 2.0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // 3. Unmirrored Readout Text
    this._drawUnmirroredText(
      label,
      x + 22,
      y + (badgeH / 2),
      'bold 6.8px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'left'
    );

    ctx.restore();
  }

  /**
   * Renders the 3D Joint Polar Mobility Radar in the lower-right corner:
   * - Overhead circular radar sweep (360° rotating beam)
   * - Left limb perimeter (Cyan) vs Right limb perimeter (Emerald)
   * - Restricted sectors flagged in red with deficiency warnings
   * - Bilateral symmetry score readout
   * 
   * @param {CanvasRenderingContext2D} [ctx=this.ctx]
   * @param {Object} [romRadarData]
   * @param {number} [canvasWidth=this.logicalWidth]
   * @param {number} [canvasHeight=this.logicalHeight]
   * @param {number} [now=performance.now()]
   */
  drawPolarMobilityRadar(ctx = this.ctx, romRadarData, canvasWidth = this.logicalWidth, canvasHeight = this.logicalHeight, now = performance.now()) {
    if (!ctx || !romRadarData) return;

    const w = canvasWidth || this.logicalWidth || 640;
    const h = canvasHeight || this.logicalHeight || 480;

    const cardW = 168;
    const cardH = 144;
    // Mirrored display: x = 20 places it on visual LOWER-RIGHT of screen
    const x = 20;
    const y = h - cardH - 24;

    const symmetryScore = typeof romRadarData.symmetryScore === 'number' ? romRadarData.symmetryScore : 100;
    const restrictedSectors = Array.isArray(romRadarData.restrictedSectors) ? romRadarData.restrictedSectors : [];
    const hasRestrictions = restrictedSectors.length > 0;
    const sweepAngleDeg = typeof romRadarData.sweepAngleDeg === 'number' ? romRadarData.sweepAngleDeg : 0;

    ctx.save();

    const themeColor = hasRestrictions ? '#ff0055' : '#00f2fe';
    const borderPulse = hasRestrictions ? (0.65 + 0.35 * Math.sin(now / 100)) : 0.40;

    // 1. Glassmorphic Card Container
    ctx.fillStyle = 'rgba(7, 13, 26, 0.90)';
    ctx.strokeStyle = hasRestrictions ? `rgba(255, 0, 85, ${borderPulse.toFixed(2)})` : 'rgba(0, 242, 254, 0.40)';
    ctx.lineWidth = hasRestrictions ? 1.8 : 1.2;
    ctx.shadowBlur = hasRestrictions ? 12 : 6;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, cardW, cardH, 8);
    ctx.fill();
    ctx.stroke();

    // 2. Header
    const textCenterX = x + (cardW / 2);
    this._drawUnmirroredText(
      hasRestrictions ? '⚠️ MOBILITY DEFICIT RADAR' : 'POLAR MOBILITY RADAR [3D ROM]',
      textCenterX,
      y + 11,
      'bold 7.2px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'center'
    );

    // 3. Circular Radar Sweep Disc
    const radarCX = x + (cardW / 2);
    const radarCY = y + 68;
    const radarR = 38;

    // Disc background
    ctx.beginPath();
    ctx.arc(radarCX, radarCY, radarR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(3, 8, 18, 0.88)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.0;
    ctx.fill();
    ctx.stroke();

    // Concentric range rings (33%, 66%, 100%)
    [0.33, 0.66, 1.0].forEach(ratio => {
      ctx.beginPath();
      ctx.arc(radarCX, radarCY, radarR * ratio, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(radarCX - radarR, radarCY);
    ctx.lineTo(radarCX + radarR, radarCY);
    ctx.moveTo(radarCX, radarCY - radarR);
    ctx.lineTo(radarCX, radarCY + radarR);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 4. Highlight Restricted Sectors (in Red)
    restrictedSectors.forEach(sec => {
      const startRad = (sec.azimuthMin * Math.PI) / 180;
      const endRad = (sec.azimuthMax * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(radarCX, radarCY);
      ctx.arc(radarCX, radarCY, radarR, startRad, endRad);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 0, 85, 0.28)';
      ctx.strokeStyle = 'rgba(255, 0, 85, 0.70)';
      ctx.lineWidth = 1.2;
      ctx.fill();
      ctx.stroke();
    });

    // 5. Rotating Radar Sweep Beam
    const sweepRad = (sweepAngleDeg * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(radarCX, radarCY);
    ctx.lineTo(radarCX + radarR * Math.cos(sweepRad), radarCY + radarR * Math.sin(sweepRad));
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.85)';
    ctx.lineWidth = 1.4;
    ctx.shadowBlur = 6;
    ctx.shadowColor = '#00f2fe';
    ctx.stroke();

    // Sweep trail fan
    ctx.beginPath();
    ctx.moveTo(radarCX, radarCY);
    ctx.arc(radarCX, radarCY, radarR, sweepRad - 0.35, sweepRad);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 242, 254, 0.12)';
    ctx.fill();

    // 6. Draw Left Perimeter (Cyan)
    const perimL = romRadarData.perimeterLeft || [];
    if (perimL.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < perimL.length; i++) {
        const pt = perimL[i];
        const rad = (pt.azimuthDeg * Math.PI) / 180;
        const dist = Math.min(radarR, pt.radiusNorm * radarR);
        const px = radarCX + dist * Math.cos(rad);
        const py = radarCY + dist * Math.sin(rad);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.75)';
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 4;
      ctx.shadowColor = '#00f2fe';
      ctx.stroke();
    }

    // 7. Draw Right Perimeter (Emerald)
    const perimR = romRadarData.perimeterRight || [];
    if (perimR.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < perimR.length; i++) {
        const pt = perimR[i];
        const rad = (pt.azimuthDeg * Math.PI) / 180;
        const dist = Math.min(radarR, pt.radiusNorm * radarR);
        const px = radarCX + dist * Math.cos(rad);
        const py = radarCY + dist * Math.sin(rad);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(0, 255, 135, 0.75)';
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 4;
      ctx.shadowColor = '#00ff87';
      ctx.stroke();
    }

    // 8. Active Joint Position Nodes
    if (romRadarData.left) {
      const radL = (romRadarData.left.azimuthDeg * Math.PI) / 180;
      const distL = Math.min(radarR, (romRadarData.left.radius / 0.45) * radarR);
      const lx = radarCX + distL * Math.cos(radL);
      const ly = radarCY + distL * Math.sin(radL);
      ctx.beginPath();
      ctx.arc(lx, ly, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#00f2fe';
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#00f2fe';
      ctx.fill();
    }

    if (romRadarData.right) {
      const radR = (romRadarData.right.azimuthDeg * Math.PI) / 180;
      const distR = Math.min(radarR, (romRadarData.right.radius / 0.45) * radarR);
      const rx = radarCX + distR * Math.cos(radR);
      const ry = radarCY + distR * Math.sin(radR);
      ctx.beginPath();
      ctx.arc(rx, ry, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#00ff87';
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#00ff87';
      ctx.fill();
    }

    // 9. Legend & Footer Metrics
    this._drawUnmirroredText('● LEFT (CYAN)', x + 16, y + cardH - 24, '6px "Orbitron", sans-serif', '#00f2fe', 'left');
    this._drawUnmirroredText('● RIGHT (EMERALD)', x + cardW - 16, y + cardH - 24, '6px "Orbitron", sans-serif', '#00ff87', 'right');

    const footerText = hasRestrictions ? `⚠️ ${restrictedSectors[0].label}` : `SYMMETRY: ${symmetryScore}% [OPTIMAL]`;
    const footerColor = hasRestrictions ? '#ff0055' : '#00ff87';
    this._drawUnmirroredText(
      footerText,
      textCenterX,
      y + cardH - 10,
      'bold 6.8px "Orbitron", -apple-system, sans-serif',
      footerColor,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders the Dynamic Objective RPE HUD Badge with mini velocity loss bar graph:
   * 'OBJECTIVE RPE: 8.5 [METABOLIC STRAIN: HIGH]'
   * 
   * @param {CanvasRenderingContext2D} [ctx=this.ctx]
   * @param {Object} [rpeData]
   * @param {number} [canvasWidth=this.logicalWidth]
   * @param {number} [canvasHeight=this.logicalHeight]
   * @param {number} [now=performance.now()]
   */
  drawRpeBadge(ctx = this.ctx, rpeData, canvasWidth = this.logicalWidth, canvasHeight = this.logicalHeight, now = performance.now()) {
    if (!ctx || !rpeData) return;

    const w = canvasWidth || this.logicalWidth || 640;
    const badgeW = 216;
    const badgeH = 46;
    // Mirrored display: x = 20 places it on visual TOP-RIGHT of screen
    const x = 20;
    const y = 14;

    const rpe = typeof rpeData.calculatedRPE === 'number' ? rpeData.calculatedRPE : 6.0;
    const strainLabel = rpeData.strainLabel || 'LOW';
    const lossHistory = Array.isArray(rpeData.lossHistory) ? rpeData.lossHistory : [];
    const label = rpeData.displayLabel || `OBJECTIVE RPE: ${rpe.toFixed(1)} [METABOLIC STRAIN: ${strainLabel}]`;

    ctx.save();

    let themeColor = '#00ff87';
    if (rpe >= 9.5) {
      themeColor = '#ff0055';
    } else if (rpe >= 7.5) {
      themeColor = '#f59e0b';
    }

    const pulse = rpe >= 9.5 ? (0.65 + 0.35 * Math.sin(now / 100)) : 0.40;

    // 1. Badge Container
    ctx.fillStyle = 'rgba(7, 13, 26, 0.90)';
    ctx.strokeStyle = rpe >= 9.5 ? `rgba(255, 0, 85, ${pulse.toFixed(2)})` : `rgba(${rpe >= 7.5 ? '245, 158, 11' : '0, 255, 135'}, 0.45)`;
    ctx.lineWidth = rpe >= 9.5 ? 1.8 : 1.2;
    ctx.shadowBlur = rpe >= 9.5 ? 10 : 5;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, badgeW, badgeH, 8);
    ctx.fill();
    ctx.stroke();

    // 2. Unmirrored Readout Text Header
    this._drawUnmirroredText(
      label,
      x + 12,
      y + 12,
      'bold 7.2px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'left'
    );

    // 3. Velocity-Loss Mini-Bar Graph (Dynamic per-rep fatigue progression)
    const graphX = x + 12;
    const graphY = y + 24;
    const graphW = badgeW - 24;
    const graphH = 14;

    // Track baseline
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    this._drawRoundedRect(ctx, graphX, graphY, graphW, graphH, 2);
    ctx.fill();

    const maxBars = 10;
    const barSlotW = (graphW - 4) / maxBars;
    const barW = Math.max(2, barSlotW - 2);

    if (lossHistory.length === 0) {
      this._drawUnmirroredText(
        'BASELINE VELOCITY ESTABLISHING...',
        graphX + (graphW / 2),
        graphY + (graphH / 2),
        '5.8px "Orbitron", monospace',
        '#64748b',
        'center'
      );
    } else {
      const recentLosses = lossHistory.slice(-maxBars);
      for (let i = 0; i < recentLosses.length; i++) {
        const loss = Math.max(0, Math.min(100, recentLosses[i]));
        const barH = Math.max(2, Math.min(graphH - 2, (loss / 50) * (graphH - 2)));
        const bx = graphX + 2 + (i * barSlotW);
        const by = graphY + graphH - barH - 1;

        let barColor = '#00ff87';
        if (loss >= 30) {
          barColor = '#ff0055';
        } else if (loss >= 15) {
          barColor = '#f59e0b';
        }

        ctx.fillStyle = barColor;
        this._drawRoundedRect(ctx, bx, by, barW, barH, 1);
        ctx.fill();
      }

      const latestLoss = lossHistory[lossHistory.length - 1];
      this._drawUnmirroredText(
        `LOSS: -${latestLoss.toFixed(1)}%`,
        graphX + graphW - 2,
        y + 12,
        '6.2px "Orbitron", monospace',
        '#cbd5e1',
        'right'
      );
    }

    ctx.restore();
  }

  /**
   * Renders the multi-rep ghost skeleton onion-skin comparing current reps
   * against the baseline form of Rep 1.
   * - Translucent cyan dashed bone segments (rgba(0, 242, 254, 0.25))
   * - Corrective offset lines linking live joints to baseline ghost nodes when drift occurs
   * 
   * @param {Array<any>} ghostSkeleton Interpolated 33-landmark baseline ghost array.
   * @param {Array<any>} landmarks Live athlete landmarks.
   * @param {number} width
   * @param {number} height
   * @private
   */
  _renderGhostOnionSkin(ghostSkeleton, landmarks, width, height) {
    if (!ghostSkeleton || ghostSkeleton.length < 25) return;

    const ctx = this.ctx;
    ctx.save();

    const ghostColor = 'rgba(0, 242, 254, 0.25)';
    const ghostJointColor = 'rgba(0, 242, 254, 0.40)';

    // 1. Draw Dashed Ghost Skeletal Connections
    ctx.strokeStyle = ghostColor;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 4]);

    for (let i = 0; i < SKELETON_CONNECTIONS.length; i++) {
      const [idxA, idxB] = SKELETON_CONNECTIONS[i];
      const pA = ghostSkeleton[idxA];
      const pB = ghostSkeleton[idxB];

      if (pA && pB && (pA.visibility || 1) > 0.35 && (pB.visibility || 1) > 0.35) {
        ctx.beginPath();
        ctx.moveTo(pA.x * width, pA.y * height);
        ctx.lineTo(pB.x * width, pB.y * height);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // 2. Draw Translucent Ghost Joint Nodes
    for (let i = 0; i < MAJOR_JOINTS.length; i++) {
      const idx = MAJOR_JOINTS[i];
      const lm = ghostSkeleton[idx];
      if (lm && (lm.visibility || 1) > 0.35) {
        ctx.beginPath();
        ctx.arc(lm.x * width, lm.y * height, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = ghostJointColor;
        ctx.fill();
      }
    }

    // 3. Draw Corrective Offset Lines Linking Live Joints to Ghost Nodes on Drift
    if (landmarks && landmarks.length >= 25) {
      ctx.setLineDash([2, 3]);
      for (let i = 0; i < MAJOR_JOINTS.length; i++) {
        const idx = MAJOR_JOINTS[i];
        const live = landmarks[idx];
        const ghost = ghostSkeleton[idx];

        if (live && ghost && (live.visibility || 1) > 0.4 && (ghost.visibility || 1) > 0.4) {
          const dx = (live.x - ghost.x) * width;
          const dy = (live.y - ghost.y) * height;
          const dist = Math.hypot(dx, dy);

          // Drift threshold: visual deviation from Rep 1 baseline groove (> 18 px)
          if (dist > 18) {
            ctx.beginPath();
            ctx.moveTo(live.x * width, live.y * height);
            ctx.lineTo(ghost.x * width, ghost.y * height);
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)'; // Glowing amber corrective offset vector
            ctx.lineWidth = 1.3;
            ctx.stroke();

            // Corrective beacon node at baseline position
            ctx.beginPath();
            ctx.arc(ghost.x * width, ghost.y * height, 2.2, 0, Math.PI * 2);
            ctx.fillStyle = '#f59e0b';
            ctx.fill();
          }
        }
      }
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  /**
   * Renders the Strictness / Momentum Cheat HUD Gauge:
   * 'STRICTNESS: 96% [CLEAN FORM]' or '⚠️ MOMENTUM DETECTED // ELIMINATE SWAY'
   * 
   * @param {CanvasRenderingContext2D} [ctx=this.ctx]
   * @param {Object} [cheatData]
   * @param {number} [canvasWidth=this.logicalWidth]
   * @param {number} [canvasHeight=this.logicalHeight]
   * @param {number} [now=performance.now()]
   */
  drawCheatGauge(ctx = this.ctx, cheatData, canvasWidth = this.logicalWidth, canvasHeight = this.logicalHeight, now = performance.now()) {
    if (!ctx || !cheatData) return;

    const w = canvasWidth || this.logicalWidth || 640;
    const badgeW = 196;
    const badgeH = 24;
    // Mirrored display: (w - badgeW - 20) places it on visual TOP-LEFT of screen
    // Placed at y = 74 (stacked below Bar Efficiency Badge at y=46)
    const x = w - badgeW - 20;
    const y = 74;

    const isCheated = Boolean(cheatData.isCheated);
    const score = typeof cheatData.strictnessScore === 'number' ? cheatData.strictnessScore : 100;
    const label = cheatData.displayLabel || (isCheated ? '⚠️ MOMENTUM DETECTED // ELIMINATE SWAY' : `STRICTNESS: ${score}% [CLEAN FORM]`);

    ctx.save();

    const themeColor = isCheated ? '#f59e0b' : '#00ff87';
    const pulse = isCheated ? (0.65 + 0.35 * Math.sin(now / 90)) : 0.40;

    // 1. Glassmorphic Pill Container
    ctx.fillStyle = 'rgba(7, 13, 26, 0.90)';
    ctx.strokeStyle = isCheated ? `rgba(245, 158, 11, ${pulse.toFixed(2)})` : 'rgba(0, 255, 135, 0.45)';
    ctx.lineWidth = isCheated ? 1.8 : 1.2;
    ctx.shadowBlur = isCheated ? 12 : 5;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, badgeW, badgeH, 12);
    ctx.fill();
    ctx.stroke();

    // 2. Icon Indicator Node
    const iconX = x + 12;
    const iconY = y + (badgeH / 2);

    ctx.beginPath();
    ctx.arc(iconX, iconY, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = themeColor;
    ctx.shadowBlur = isCheated ? 8 : 4;
    ctx.shadowColor = themeColor;
    ctx.fill();

    if (isCheated) {
      ctx.beginPath();
      ctx.arc(iconX, iconY, 3.2 + 3.5 * (1 - pulse), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(245, 158, 11, ${(0.8 * pulse).toFixed(2)})`;
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }

    // 3. Unmirrored Readout Text
    this._drawUnmirroredText(
      label,
      x + 22,
      y + (badgeH / 2),
      'bold 6.8px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'left'
    );

    ctx.restore();
  }

  /**
   * Renders the CNS Tremor Radar / Neuromuscular Status Badge:
   * Animated brain/pulse icon on top-left HUD.
   * Green (STABLE) when tremor ratio < 2.0; pulsing Crimson (NEURAL BREAKDOWN) when > 3.5.
   *
   * @param {CanvasRenderingContext2D} [ctx=this.ctx]
   * @param {Object} [cnsData]
   * @param {number} [canvasWidth=this.logicalWidth]
   * @param {number} [canvasHeight=this.logicalHeight]
   * @param {number} [now=performance.now()]
   */
  drawCnsTremorRadar(ctx = this.ctx, cnsData, canvasWidth = this.logicalWidth, canvasHeight = this.logicalHeight, now = performance.now()) {
    if (!ctx || !cnsData) return;

    const w = canvasWidth || this.logicalWidth || 640;
    const badgeW = 196;
    const badgeH = 24;
    // Mirrored display: (w - badgeW - 20) places it on visual TOP-LEFT of screen
    const x = w - badgeW - 20;
    const y = 104;

    const ratio = typeof cnsData.tremorRatio === 'number' ? cnsData.tremorRatio : 1.0;
    const isFatigued = Boolean(cnsData.isFatigued) || ratio > 3.5;
    const isElevated = !isFatigued && ratio >= 2.0;

    ctx.save();

    let themeColor = '#00ff87'; // Green (STABLE)
    let glowColor = '#00ff87';
    let statusText = `CNS: ${ratio.toFixed(1)}x [STABLE]`;

    if (isFatigued) {
      themeColor = '#ff0055'; // Pulsing Crimson (NEURAL BREAKDOWN)
      glowColor = '#ff0055';
      statusText = `CNS: ${ratio.toFixed(1)}x [NEURAL BREAKDOWN]`;
    } else if (isElevated) {
      themeColor = '#f59e0b'; // Amber (ELEVATED)
      glowColor = '#f59e0b';
      statusText = `CNS: ${ratio.toFixed(1)}x [ELEVATED]`;
    }

    const pulse = isFatigued ? (0.60 + 0.40 * Math.sin(now / 80)) : 0.35;

    // 1. Glassmorphic Pill Container
    ctx.fillStyle = 'rgba(7, 13, 26, 0.90)';
    ctx.strokeStyle = isFatigued
      ? `rgba(255, 0, 85, ${pulse.toFixed(2)})`
      : (isElevated ? 'rgba(245, 158, 11, 0.50)' : 'rgba(0, 255, 135, 0.45)');
    ctx.lineWidth = isFatigued ? 1.8 : 1.2;
    ctx.shadowBlur = isFatigued ? 12 : 5;
    ctx.shadowColor = glowColor;

    this._drawRoundedRect(ctx, x, y, badgeW, badgeH, 12);
    ctx.fill();
    ctx.stroke();

    // 2. Animated Brain / Neuromuscular Pulse Icon
    const iconX = x + 12;
    const iconY = y + (badgeH / 2);

    ctx.save();
    ctx.translate(iconX, iconY);

    // Stylized brain lobes / arcs
    ctx.beginPath();
    ctx.arc(-2.5, -1, 2.8, Math.PI * 0.7, Math.PI * 1.8);
    ctx.arc(2.5, -1, 2.8, Math.PI * 1.2, Math.PI * 0.3);
    ctx.lineTo(0, 3.5);
    ctx.closePath();
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 1.1;
    ctx.shadowBlur = isFatigued ? 10 : 4;
    ctx.shadowColor = glowColor;
    ctx.stroke();

    if (isFatigued) {
      // Expanding alert shockwave ring
      const ringRadius = 3.5 + 4.5 * ((now % 500) / 500);
      const ringAlpha = 1.0 - ((now % 500) / 500);
      ctx.beginPath();
      ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 0, 85, ${ringAlpha.toFixed(2)})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();

    // 3. Mini Animated Pulse Waveform (micro EEG tracer)
    const waveStartX = x + 23;
    const waveW = 20;
    const waveMidY = y + (badgeH / 2);
    const waveAmp = isFatigued ? 4.0 : (isElevated ? 2.5 : 1.4);

    ctx.beginPath();
    ctx.moveTo(waveStartX, waveMidY);
    for (let i = 0; i < 4; i++) {
      const segX = waveStartX + (i + 1) * (waveW / 4);
      const segY = waveMidY + (i % 2 === 0 ? -waveAmp : waveAmp) * Math.sin((now / 100) + i);
      ctx.lineTo(segX, segY);
    }
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // 4. Unmirrored Readout Text
    this._drawUnmirroredText(
      statusText,
      x + 48,
      y + (badgeH / 2),
      'bold 6.6px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'left'
    );

    ctx.restore();
  }

  /**
   * Renders the Shader Status Indicator:
   * Ambient pill indicator: 'SHADOW ENHANCEMENT: ON-GPU'
   *
   * @param {CanvasRenderingContext2D} [ctx=this.ctx]
   * @param {Object|boolean} [shaderStatus]
   * @param {number} [canvasWidth=this.logicalWidth]
   * @param {number} [canvasHeight=this.logicalHeight]
   * @param {number} [now=performance.now()]
   */
  drawShaderStatus(ctx = this.ctx, shaderStatus, canvasWidth = this.logicalWidth, canvasHeight = this.logicalHeight, now = performance.now()) {
    if (!ctx) return;

    const w = canvasWidth || this.logicalWidth || 640;
    const badgeW = 196;
    const badgeH = 20;
    // Mirrored display: (w - badgeW - 20) places it on visual TOP-LEFT of screen
    const x = w - badgeW - 20;
    const y = 132;

    const isGpu = typeof shaderStatus === 'object' && shaderStatus !== null
      ? (shaderStatus.isGpuActive !== undefined ? shaderStatus.isGpuActive : true)
      : Boolean(shaderStatus);

    const label = (typeof shaderStatus === 'object' && shaderStatus?.label)
      ? shaderStatus.label
      : (isGpu ? 'SHADOW ENHANCEMENT: ON-GPU' : 'SHADOW ENHANCEMENT: BYPASS');

    ctx.save();

    const themeColor = isGpu ? '#00f2fe' : '#9ca3af';

    // 1. Glassmorphic Ambient Pill
    ctx.fillStyle = 'rgba(7, 13, 26, 0.85)';
    ctx.strokeStyle = isGpu ? 'rgba(0, 242, 254, 0.35)' : 'rgba(156, 163, 175, 0.25)';
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = isGpu ? 5 : 0;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, badgeW, badgeH, 10);
    ctx.fill();
    ctx.stroke();

    // 2. Micro GPU Core Icon
    const iconX = x + 12;
    const iconY = y + (badgeH / 2);

    ctx.beginPath();
    ctx.rect(iconX - 3.5, iconY - 3.5, 7, 7);
    ctx.fillStyle = isGpu ? 'rgba(0, 242, 254, 0.25)' : 'rgba(156, 163, 175, 0.15)';
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 0.9;
    ctx.fill();
    ctx.stroke();

    // Central core dot
    ctx.beginPath();
    ctx.arc(iconX, iconY, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = themeColor;
    ctx.fill();

    // 3. Unmirrored Readout Text
    this._drawUnmirroredText(
      label,
      x + 22,
      y + (badgeH / 2),
      'bold 6.3px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'left'
    );

    ctx.restore();
  }

  /**
   * Renders the Rotational Moment of Inertia & Angular Momentum Gauge:
   * Top-right gauge displaying: 'INERTIA (I): 12.4 kg·m² | TURNOVER SPEED: FAST'
   *
   * @param {CanvasRenderingContext2D} [ctx=this.ctx]
   * @param {Object} [inertiaData]
   * @param {number} [canvasWidth=this.logicalWidth]
   * @param {number} [canvasHeight=this.logicalHeight]
   * @param {number} [now=performance.now()]
   */
  drawInertiaGauge(ctx = this.ctx, inertiaData, canvasWidth = this.logicalWidth, canvasHeight = this.logicalHeight, now = performance.now()) {
    if (!ctx || !inertiaData) return;

    const w = canvasWidth || this.logicalWidth || 640;
    const badgeW = 216;
    const badgeH = 26;
    // Mirrored display: x = 20 places it on visual TOP-RIGHT of screen
    const x = 20;
    // Stacked below RPE badge (which spans y=14..60)
    const y = 66;

    const inertia = typeof inertiaData.momentOfInertia === 'number' ? inertiaData.momentOfInertia : 12.0;
    const speed = inertiaData.turnoverSpeed || 'STEADY';
    const label = inertiaData.displayLabel || `INERTIA (I): ${inertia.toFixed(1)} kg·m² | TURNOVER SPEED: ${speed}`;

    ctx.save();

    let themeColor = '#00f2fe';
    if (speed === 'FAST') {
      themeColor = '#00f2fe'; // Explosive turnover
    } else if (speed === 'MODERATE') {
      themeColor = '#00ff87';
    } else {
      themeColor = '#38bdf8';
    }

    // 1. Glassmorphic Pill Container
    ctx.fillStyle = 'rgba(7, 13, 26, 0.90)';
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.40)';
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 6;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, x, y, badgeW, badgeH, 12);
    ctx.fill();
    ctx.stroke();

    // 2. Rotational Flywheel Icon (animated based on turnover speed)
    const iconX = x + 14;
    const iconY = y + (badgeH / 2);
    const rotAngle = (now / (speed === 'FAST' ? 120 : (speed === 'MODERATE' ? 240 : 450))) % (Math.PI * 2);

    ctx.save();
    ctx.translate(iconX, iconY);
    ctx.rotate(rotAngle);

    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 1.5);
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Arrowhead on arc tip
    ctx.beginPath();
    ctx.arc(0, -4.5, 1.4, 0, Math.PI * 2);
    ctx.fillStyle = themeColor;
    ctx.fill();

    ctx.restore();

    // 3. Unmirrored Readout Text
    this._drawUnmirroredText(
      label,
      x + 26,
      y + (badgeH / 2),
      'bold 6.4px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'left'
    );

    ctx.restore();
  }

  /**
   * Renders the Crepitus Audio Pill & Mini Spectrogram Wave:
   * Displays adjacent to active moving knee/shoulder joints.
   * Cyan if silent/smooth; pulsing amber wave when continuous acoustic friction is detected: '⚠️ JOINT FRICTION ELEVATED'.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} crepitusData
   * @param {Array<Object>} landmarks
   * @param {string} activeExercise
   * @param {number} width
   * @param {number} height
   * @param {number} now
   * @private
   */
  _renderCrepitusPill(ctx, crepitusData, landmarks, activeExercise, width, height, now) {
    if (!ctx || !crepitusData || !landmarks) return;

    // Pick active joint node based on exercise
    let targetJoint = null;
    if (activeExercise === 'SQUAT') {
      const kL = landmarks[25];
      const kR = landmarks[26];
      targetJoint = (kL && kR) ? ((kL.visibility || 0) >= (kR.visibility || 0) ? kL : kR) : (kL || kR);
    } else if (activeExercise === 'PUSHUP') {
      const sL = landmarks[11];
      const sR = landmarks[12];
      targetJoint = (sL && sR) ? ((sL.visibility || 0) >= (sR.visibility || 0) ? sL : sR) : (sL || sR);
    } else {
      const eL = landmarks[13];
      const eR = landmarks[14];
      targetJoint = (eL && eR) ? ((eL.visibility || 0) >= (eR.visibility || 0) ? eL : eR) : (eL || eR);
    }

    if (!targetJoint) return;

    const jx = targetJoint.x * width;
    const jy = targetJoint.y * height;

    const pillW = 152;
    const pillH = 24;
    // Offset pill to the right or left of joint
    const pillX = Math.min(width - pillW - 12, Math.max(12, jx + 18));
    const pillY = Math.min(height - pillH - 12, Math.max(12, jy - 12));

    const isFriction = Boolean(crepitusData.crepitusDetected);
    const hasCavitation = Boolean(crepitusData.hasCavitation);
    const wave = crepitusData.waveSamples || null;

    ctx.save();

    const themeColor = isFriction ? '#f59e0b' : (hasCavitation ? '#a855f7' : '#00f2fe');
    const pulse = isFriction ? (0.65 + 0.35 * Math.sin(now / 90)) : 0.40;

    // 1. Dashed Connector line linking joint node to pill
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(jx, jy);
    ctx.lineTo(pillX + 6, pillY + (pillH / 2));
    ctx.strokeStyle = isFriction ? 'rgba(245, 158, 11, 0.7)' : 'rgba(0, 242, 254, 0.35)';
    ctx.lineWidth = 1.0;
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Glassmorphic Pill Container
    ctx.fillStyle = 'rgba(7, 13, 26, 0.90)';
    ctx.strokeStyle = isFriction ? `rgba(245, 158, 11, ${pulse.toFixed(2)})` : 'rgba(0, 242, 254, 0.45)';
    ctx.lineWidth = isFriction ? 1.6 : 1.1;
    ctx.shadowBlur = isFriction ? 10 : 4;
    ctx.shadowColor = themeColor;

    this._drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 12);
    ctx.fill();
    ctx.stroke();

    // 3. Mini Spectrogram Wave (bars/waveform)
    const waveStartX = pillX + 8;
    const waveW = 28;
    const waveH = 12;
    const waveBaseY = pillY + (pillH / 2) + 6;

    if (wave && wave.length > 0) {
      const bars = Math.min(8, wave.length);
      const barW = 2.2;
      const barGap = 1.2;

      for (let b = 0; b < bars; b++) {
        const val = Math.max(0.15, wave[b * 2] || 0.2);
        const bh = Math.max(2, val * waveH * (isFriction ? (1.0 + 0.3 * Math.sin(now / 70 + b)) : 0.8));
        const bx = waveStartX + b * (barW + barGap);
        const by = waveBaseY - bh;

        ctx.fillStyle = isFriction ? `rgba(245, 158, 11, ${(0.6 + 0.4 * val).toFixed(2)})` : `rgba(0, 242, 254, ${(0.5 + 0.5 * val).toFixed(2)})`;
        ctx.fillRect(bx, by, barW, bh);
      }
    }

    // 4. Readout Text
    const label = isFriction
      ? '⚠️ JOINT FRICTION ELEVATED'
      : (hasCavitation ? '✨ CAVITATION (POP)' : 'ACOUSTIC: SMOOTH');

    this._drawUnmirroredText(
      label,
      pillX + 40,
      pillY + (pillH / 2),
      'bold 6.2px "Orbitron", -apple-system, sans-serif',
      themeColor,
      'left'
    );

    ctx.restore();
  }
}


