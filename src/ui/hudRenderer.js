/**
 * @fileoverview Layer 1: Canvas HUD Renderer.
 * Renders the neon skeleton, dynamic color-shifting joint angle arcs,
 * setup alignment reticles, rep counters, and warnings.
 */

/**
 * Standard skeletal segment connections by MediaPipe Pose landmark indices.
 * @type {Array<Array<number>>}
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
 * Color definitions for neon overlays.
 * @type {Object<string, string>}
 */
const COLORS = {
  BONE_DEFAULT: '#00F2FE', // Neon Cyan
  BONE_ACTIVE_CYAN: '#00F2FE', // Cyan (> 140)
  BONE_ACTIVE_AMBER: '#FF9900', // Amber (91 - 140)
  BONE_ACTIVE_VALID: '#00FF87', // Neon Green (<= 90)
  BONE_ACTIVE_FAULT: '#FF0055', // Neon Red/Orange
  WHITE: '#FFFFFF',
  CARD_BG: 'rgba(18, 18, 18, 0.85)',
  GLOW_SHADOW_COLOR: 'rgba(0, 242, 254, 0.4)',
  GLOW_SHADOW_COLOR_FAULT: 'rgba(255, 0, 85, 0.5)'
};

/**
 * High-performance 2D Canvas overlay drawer.
 */
export class HUDRenderer {
  /**
   * @param {HTMLCanvasElement} canvas Target drawing canvas.
   */
  constructor(canvas) {
    if (!canvas) {
      throw new Error('HUDRenderer: A valid HTMLCanvasElement is required.');
    }
    
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;

    /** @type {CanvasRenderingContext2D} */
    this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  }

  /**
   * Clears the canvas buffer.
   */
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Returns active joint color based on form validity and degree thresholds.
   * 
   * @param {number} angle Joint angle in degrees.
   * @param {boolean} hasFault Active posture violation.
   * @returns {string} Hex color code.
   * @private
   */
  _getJointColor(angle, hasFault) {
    if (hasFault) {
      return COLORS.BONE_ACTIVE_FAULT;
    }
    // Dynamic color shifting by thresholds
    if (angle > 140) {
      return COLORS.BONE_ACTIVE_CYAN;
    }
    if (angle > 90) {
      return COLORS.BONE_ACTIVE_AMBER;
    }
    return COLORS.BONE_ACTIVE_VALID;
  }

  /**
   * Redraws the HUD screen overlay with skeleton segments, badges, and warnings.
   * 
   * @param {Object} renderPayload
   * @param {Array<any>} [renderPayload.landmarks] MediaPipe pose keypoint landmarks.
   * @param {number} renderPayload.activeAngle Calculated exercise joint angle.
   * @param {string} renderPayload.activeExercise Active movement ('SQUAT' | 'BICEP_CURL').
   * @param {string} renderPayload.currentState Current state machine state.
   * @param {number} renderPayload.repCount Complete repetition count.
   * @param {boolean} renderPayload.hasFault True if a posture fault is active.
   * @param {string} renderPayload.faultMessage Fault description string.
   */
  render({ landmarks, activeAngle, activeExercise, currentState, repCount, hasFault, faultMessage }) {
    this.clear();

    const width = this.canvas.width;
    const height = this.canvas.height;

    // 1. Draw pulsing reticle in SETUP state to guide user alignment
    if (currentState === 'SETUP') {
      this._drawTargetReticle(width, height);
    }

    // 2. Draw HUD analytics card (Top-Left of user view / Top-Right of canvas coords due to CSS mirroring)
    this._drawHUDCard(width, repCount, currentState, hasFault, faultMessage);

    // Guard against missing landmarks
    if (!landmarks || landmarks.length === 0) {
      return;
    }

    // Resolve color of the active exercise joint based on angle threshold dynamics
    const activeColor = this._getJointColor(activeAngle, hasFault);

    // 3. Draw Bones (Skeletal connections)
    this.ctx.save();
    for (let i = 0; i < SKELETON_CONNECTIONS.length; i++) {
      const [p1Index, p2Index] = SKELETON_CONNECTIONS[i];
      const p1 = landmarks[p1Index];
      const p2 = landmarks[p2Index];

      // Draw connection line if both landmarks are detected
      if (p1 && p2 && p1.visibility > 0.5 && p2.visibility > 0.5) {
        const isActive = this._isActiveConnection(p1Index, p2Index, activeExercise);
        
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x * width, p1.y * height);
        this.ctx.lineTo(p2.x * width, p2.y * height);

        // Neon Glow Styling
        this.ctx.strokeStyle = isActive ? activeColor : COLORS.BONE_DEFAULT;
        this.ctx.lineWidth = isActive ? 5 : 3;
        this.ctx.lineCap = 'round';
        this.ctx.shadowBlur = 6;
        this.ctx.shadowColor = isActive ? activeColor : COLORS.BONE_DEFAULT;
        
        this.ctx.stroke();
      }
    }
    this.ctx.restore();

    // 4. Draw Joint Points (Glowing points with white cores)
    this.ctx.save();
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (lm && lm.visibility > 0.5) {
        const xCoord = lm.x * width;
        const yCoord = lm.y * height;

        // Draw Outer neon glow circle
        this.ctx.beginPath();
        this.ctx.arc(xCoord, yCoord, 5, 0, 2 * Math.PI);
        this.ctx.fillStyle = COLORS.BONE_DEFAULT;
        this.ctx.shadowBlur = 4;
        this.ctx.shadowColor = COLORS.BONE_DEFAULT;
        this.ctx.fill();

        // Draw Inner white core circle
        this.ctx.beginPath();
        this.ctx.arc(xCoord, yCoord, 2, 0, 2 * Math.PI);
        this.ctx.fillStyle = COLORS.WHITE;
        this.ctx.shadowBlur = 0; // disable shadow for clean core
        this.ctx.fill();
      }
    }
    this.ctx.restore();

    // 5. Draw Active Joint Angle Badge and Dynamic Angle Arc outline
    this._drawJointAngleBadgeAndArc(landmarks, activeExercise, activeAngle, activeColor, width, height);
  }

  /**
   * Draws a pulsing setup reticle at the center of the canvas.
   * 
   * @param {number} width Canvas width.
   * @param {number} height Canvas height.
   * @private
   */
  _drawTargetReticle(width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    const pulseFactor = Math.sin(Date.now() / 200) * 4;
    const baseRadius = 40;
    const radius = baseRadius + pulseFactor;

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
    this.ctx.lineWidth = 2;
    this.ctx.shadowBlur = 6;
    this.ctx.shadowColor = 'rgba(0, 242, 254, 0.3)';

    // Outer pulsing circle
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    this.ctx.stroke();

    // Inner crosshairs
    const lineLength = 12;
    this.ctx.beginPath();
    
    // Left
    this.ctx.moveTo(centerX - radius - lineLength, centerY);
    this.ctx.lineTo(centerX - radius + 4, centerY);
    // Right
    this.ctx.moveTo(centerX + radius - 4, centerY);
    this.ctx.lineTo(centerX + radius + lineLength, centerY);
    // Top
    this.ctx.moveTo(centerX, centerY - radius - lineLength);
    this.ctx.lineTo(centerX, centerY - radius + 4);
    // Bottom
    this.ctx.moveTo(centerX, centerY + radius - 4);
    this.ctx.lineTo(centerX, centerY + radius + lineLength);

    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Draws the top panel card with rep stats, states, and active faults.
   * 
   * @param {number} canvasWidth Width of the drawing buffer.
   * @param {number} repCount Rep counter value.
   * @param {string} currentState FSM state name.
   * @param {boolean} hasFault True if fault is active.
   * @param {string} faultMessage Active warning text.
   * @private
   */
  _drawHUDCard(canvasWidth, repCount, currentState, hasFault, faultMessage) {
    const cardWidth = 200;
    const cardHeight = 85;
    
    // Top-right coordinate of flipped canvas maps to top-left of the screen
    const x = canvasWidth - cardWidth - 20;
    const y = 20;

    // Draw background panel
    this.ctx.save();
    this.ctx.fillStyle = COLORS.CARD_BG;
    this.ctx.strokeStyle = hasFault ? COLORS.CARD_BORDER_FAULT : COLORS.CARD_BORDER;
    this.ctx.lineWidth = 2;
    this.ctx.shadowBlur = 8;
    this.ctx.shadowColor = hasFault ? COLORS.GLOW_SHADOW_COLOR_FAULT : COLORS.GLOW_SHADOW_COLOR;
    
    this._drawRoundedRect(this.ctx, x, y, cardWidth, cardHeight, 8);
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.restore();

    // Draw Rep counter text (right aligned inside canvas context = left aligned on viewport)
    this._drawUnmirroredText(
      `REPS: ${repCount}`,
      x + cardWidth - 20,
      y + 25,
      'bold 22px "Courier New", Courier, monospace',
      COLORS.WHITE,
      'right'
    );

    // Draw State badge
    const stateColors = {
      IDLE: '#888888',
      SETUP: '#00F2FE',
      IN_PROGRESS: '#FFCC00',
      VALIDATED_SUCCESS: '#00FF87',
      FORM_FAULT: '#FF0055'
    };
    // @ts-ignore
    const stateColor = stateColors[currentState] || COLORS.WHITE;

    this._drawUnmirroredText(
      `STATE: ${currentState}`,
      x + cardWidth - 20,
      y + 55,
      'bold 13px Arial, Helvetica, sans-serif',
      stateColor,
      'right'
    );

    // Draw warning banner underneath card if a fault occurs
    if (hasFault && faultMessage) {
      const bannerY = y + cardHeight + 15;
      const bannerWidth = cardWidth + 40;
      const bannerX = x - 20;

      this.ctx.save();
      this.ctx.fillStyle = 'rgba(255, 0, 85, 0.9)';
      this._drawRoundedRect(this.ctx, bannerX, bannerY, bannerWidth, 32, 4);
      this.ctx.fill();
      this.ctx.restore();

      this._drawUnmirroredText(
        `⚠️ ${faultMessage.toUpperCase()}`,
        bannerX + (bannerWidth / 2),
        bannerY + 16,
        'bold 11px Arial, Helvetica, sans-serif',
        COLORS.WHITE,
        'center'
      );
    }
  }

  /**
   * Draws a glowing badge and an outline arc showing angle open size.
   * 
   * @param {Array<any>} landmarks
   * @param {string} exerciseKey
   * @param {number} angle
   * @param {string} activeColor Color code based on state.
   * @param {number} width Canvas width.
   * @param {number} height Canvas height.
   * @private
   */
  _drawJointAngleBadgeAndArc(landmarks, exerciseKey, angle, activeColor, width, height) {
    let pA = null, pB = null, pC = null;

    if (exerciseKey === 'SQUAT') {
      // Squat vertex: knee joint (Left Knee 25 or Right Knee 26 depending on detection confidence)
      const leftConf = landmarks[25] ? landmarks[25].visibility : 0;
      const rightConf = landmarks[26] ? landmarks[26].visibility : 0;
      
      const isLeft = leftConf >= rightConf;
      pA = landmarks[isLeft ? 23 : 24]; // Hip
      pB = landmarks[isLeft ? 25 : 26]; // Knee
      pC = landmarks[isLeft ? 27 : 28]; // Ankle
    } else if (exerciseKey === 'BICEP_CURL') {
      // Bicep Curl vertex: elbow joint (Left Elbow 13 or Right Elbow 14)
      const leftConf = landmarks[13] ? landmarks[13].visibility : 0;
      const rightConf = landmarks[14] ? landmarks[14].visibility : 0;

      const isLeft = leftConf >= rightConf;
      pA = landmarks[isLeft ? 11 : 12]; // Shoulder
      pB = landmarks[isLeft ? 13 : 14]; // Elbow
      pC = landmarks[isLeft ? 15 : 16]; // Wrist
    }

    if (!pA || !pB || !pC || pA.visibility < 0.5 || pB.visibility < 0.5 || pC.visibility < 0.5) {
      return;
    }

    const xA = pA.x * width;
    const yA = pA.y * height;
    const xB = pB.x * width;
    const yB = pB.y * height;
    const xC = pC.x * width;
    const yC = pC.y * height;

    // Draw dynamic concentric angle arc
    const angleStart = Math.atan2(yA - yB, xA - xB);
    const angleEnd = Math.atan2(yC - yB, xC - xB);
    const arcRadius = 38;

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(xB, yB, arcRadius, angleStart, angleEnd);
    this.ctx.strokeStyle = activeColor;
    this.ctx.lineWidth = 4;
    this.ctx.shadowBlur = 6;
    this.ctx.shadowColor = activeColor;
    this.ctx.stroke();
    this.ctx.restore();

    // Draw circular badge overlay
    const badgeRadius = 22;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(xB, yB, badgeRadius, 0, 2 * Math.PI);
    this.ctx.fillStyle = 'rgba(18, 18, 18, 0.85)';
    this.ctx.strokeStyle = activeColor;
    this.ctx.lineWidth = 2.5;
    this.ctx.shadowBlur = 6;
    this.ctx.shadowColor = activeColor;
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.restore();

    // Draw angle text inside
    this._drawUnmirroredText(
      `${Math.round(angle)}°`,
      xB,
      yB,
      'bold 12px Arial, Helvetica, sans-serif',
      COLORS.WHITE,
      'center'
    );
  }

  /**
   * Draws text that is flipped horizontally to cancel CSS mirror transform on canvas.
   * 
   * @param {string} text Text string.
   * @param {number} x Target X coordinate.
   * @param {number} y Target Y coordinate.
   * @param {string} font Font style definition.
   * @param {string} color Fill color.
   * @param {string} [align='left'] Alignment ('left'|'right'|'center').
   * @private
   */
  _drawUnmirroredText(text, x, y, font, color, align = 'left') {
    this.ctx.save();
    this.ctx.font = font;
    this.ctx.fillStyle = color;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = 'middle';
    
    // Move coordinate origin to text position, then flip coordinate matrix horizontally
    this.ctx.translate(x, y);
    this.ctx.scale(-1, 1);
    
    // Draw relative to new flipped origin
    this.ctx.fillText(text, 0, 0);
    this.ctx.restore();
  }

  /**
   * Draws a rounded rectangle path.
   * 
   * @param {CanvasRenderingContext2D} ctx Context.
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
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * Checks if connection belongs to the active biomechanical targets.
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
