/**
 * @fileoverview Layer 1: 3D Holographic Biomechanical Canvas HUD Renderer.
 * High-performance 60 FPS 2D canvas pipeline featuring multi-layered holographic bones,
 * Z-depth modulation, articulated concentric joint nodes, dynamic radial gauge arcs,
 * and laser crimson fault states.
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
  WHITE: '#ffffff'
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
   * Calculates a normalized depth factor [0.35, 1.0] from a MediaPipe landmark Z coordinate.
   * Negative Z indicates closer to camera; positive indicates farther away.
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
   */
  render({ landmarks, activeAngle, activeExercise, currentState, repCount, hasFault, faultMessage }) {
    this.clear();

    // Guard against empty landmarks
    if (!landmarks || landmarks.length === 0) {
      return;
    }

    const dpr = this.dpr || 1;
    const width = this.logicalWidth;
    const height = this.logicalHeight;
    const now = performance.now();

    this.ctx.save();
    // Scale context by device pixel ratio for crystal-clear Retina rendering
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const theme = this._getTheme(activeAngle, hasFault);

    // 1. Draw 3D Depth-Modulated Multi-Layered Bones
    this._renderHolographicBones(landmarks, activeExercise, theme, hasFault, width, height);

    // 2. Draw Articulated 3D Concentric Joint Nodes with White Anchor
    this._renderArticulatedNodes(landmarks, activeExercise, theme, now, width, height);

    // 3. Draw 3D Biomechanical Radial Angle Gauge on Active Vertex
    this._renderRadialAngleGauge(landmarks, activeExercise, activeAngle, theme, now, width, height);

    // 4. Fault Warning Laser HUD Banner (if posture breaks)
    if (hasFault && faultMessage) {
      this._renderFaultBanner(faultMessage, width, height, now);
    }

    this.ctx.restore();
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

      // Calculate depth from average Z
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
