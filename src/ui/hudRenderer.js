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
    valgusResult = null
  }) {
    this.clear();

    if (!landmarks || landmarks.length === 0) {
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

    // 1. AR 3D Floor Perspective Grid (below feet)
    this._renderFloorGrid(landmarks, width, height, now);

    // 2. Trailing Luminous Bar Path Ribbon (joint trajectory)
    if (barPath && barPath.length > 1) {
      this._renderBarPath(barPath, width, height);
    }

    // 3. 3D Depth-Modulated Multi-Layered Bones
    this._renderHolographicBones(landmarks, activeExercise, theme, hasFault, width, height);

    // 4. Articulated Concentric Joint Nodes
    this._renderArticulatedNodes(landmarks, activeExercise, theme, now, width, height);

    // 5. 3D Biomechanical Radial Angle Gauge
    this._renderRadialAngleGauge(landmarks, activeExercise, activeAngle, theme, now, width, height);

    // 6. Bilateral Symmetry Real-Time HUD Balance Bar
    if (symmetry) {
      this._renderSymmetryGauge(symmetry, width, height);
    }

    // 7. Knee Cave (Valgus) Outward Corrective Warning Vectors
    if (valgusResult && valgusResult.hasValgus && activeExercise === 'SQUAT') {
      this._renderValgusWarning(valgusResult, width, height, now);
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

    // 12. Laser Crimson Fault Warning Banner
    if (hasFault && faultMessage) {
      this._renderFaultBanner(faultMessage, width, height, now);
    }

    this.ctx.restore();
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
      const isTargetJoint = isSquatJoint || isCurlJoint;
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
    } else if (exerciseKey === 'BICEP_CURL') {
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
    if (exerciseKey === 'BICEP_CURL') {
      const curlJoints = [11, 12, 13, 14, 15, 16];
      return curlJoints.includes(p1) && curlJoints.includes(p2);
    }
    return false;
  }
}
