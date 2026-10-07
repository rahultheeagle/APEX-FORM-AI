/**
 * @fileoverview Layer 4: Dynamic Momentum & Pelvic Sway Cheat Detector.
 * Tracks 3D horizontal pelvic sway relative to an anchored baseline prism to detect
 * momentum-assisted repetitions, kipping, and form breakdown during strict lifts.
 */

/**
 * @typedef {Object} JointPoint
 * @property {number} x Normalized X coordinate [0.0, 1.0].
 * @property {number} y Normalized Y coordinate [0.0, 1.0].
 * @property {number} [z] Normalized Z depth coordinate.
 * @property {number} [visibility] Confidence score [0.0, 1.0].
 */

/**
 * @typedef {Object} CheatDetectionResult
 * @property {boolean} isCheated True if excessive horizontal sway occurred during concentric ascent.
 * @property {number} swayMagnitude Instantaneous horizontal displacement delta_r in normalized units.
 * @property {number} strictnessScore Percentage strictness score [0 - 100]%.
 * @property {string} displayLabel Formatted HUD status string.
 * @property {number} tolerance Maximum allowable horizontal sway boundary.
 * @property {boolean} isAnchored True if baseline prism is calibrated.
 */

export class CheatDetector {
  /**
   * @param {Object} [options]
   * @param {number} [options.swayMultiplier=0.12] Sway threshold multiplier relative to torso length.
   * @param {number} [options.defaultTorsoLength=0.35] Fallback torso length if shoulders absent.
   */
  constructor(options = {}) {
    this.swayMultiplier = options.swayMultiplier !== undefined ? options.swayMultiplier : 0.12;
    this.defaultTorsoLength = options.defaultTorsoLength !== undefined ? options.defaultTorsoLength : 0.35;

    /** @type {boolean} Baseline anchor state */
    this.isAnchored = false;

    /** @type {number} Resting spatial anchor X coordinate */
    this.baselineX = 0;
    /** @type {number} Resting spatial anchor Y coordinate */
    this.baselineY = 0;
    /** @type {number} Resting spatial anchor Z coordinate */
    this.baselineZ = 0;

    /** @type {number} Measured or default torso length */
    this.torsoLength = this.defaultTorsoLength;

    /** @type {boolean} Repetition compromised flag */
    this.currentRepCheated = false;

    /** @type {number} Peak sway recorded during active rep */
    this.peakSway = 0;

    /** @type {number} Strictness score accumulator */
    this.lowestStrictness = 100;

    /** @type {CheatDetectionResult} Cached last evaluation */
    this.lastResult = {
      isCheated: false,
      swayMagnitude: 0,
      strictnessScore: 100,
      displayLabel: 'STRICTNESS: 100% [CLEAN FORM]',
      tolerance: 0.12 * this.defaultTorsoLength,
      isAnchored: false
    };
  }

  /**
   * Records resting spatial position of mid-hips [x0, y0, z0] and torso length at set/rep initiation.
   * 
   * @param {Array<JointPoint>|JointPoint} pelvicLandmarks Full landmark array or mid-hip point.
   */
  anchorBaselinePrism(pelvicLandmarks) {
    if (!pelvicLandmarks) return;

    let hipX = 0;
    let hipY = 0;
    let hipZ = 0;

    if (Array.isArray(pelvicLandmarks)) {
      const leftHip = pelvicLandmarks[23];
      const rightHip = pelvicLandmarks[24];

      if (leftHip && rightHip) {
        hipX = (leftHip.x + rightHip.x) * 0.5;
        hipY = (leftHip.y + rightHip.y) * 0.5;
        hipZ = ((leftHip.z || 0) + (rightHip.z || 0)) * 0.5;

        // Measure torso length if shoulders are present
        const leftSh = pelvicLandmarks[11];
        const rightSh = pelvicLandmarks[12];
        if (leftSh && rightSh) {
          const shX = (leftSh.x + rightSh.x) * 0.5;
          const shY = (leftSh.y + rightSh.y) * 0.5;
          const shZ = ((leftSh.z || 0) + (rightSh.z || 0)) * 0.5;
          const tLen = Math.hypot(hipX - shX, hipY - shY, hipZ - shZ);
          this.torsoLength = Math.max(0.18, tLen);
        }
      } else if (pelvicLandmarks[0]) {
        hipX = pelvicLandmarks[0].x;
        hipY = pelvicLandmarks[0].y;
        hipZ = pelvicLandmarks[0].z || 0;
      }
    } else if (typeof pelvicLandmarks.x === 'number') {
      hipX = pelvicLandmarks.x;
      hipY = pelvicLandmarks.y;
      hipZ = pelvicLandmarks.z || 0;
    }

    this.baselineX = hipX;
    this.baselineY = hipY;
    this.baselineZ = hipZ;
    this.isAnchored = true;
    this.currentRepCheated = false;
    this.peakSway = 0;
    this.lowestStrictness = 100;
  }

  /**
   * Evaluates horizontal pelvic sway against the anchored baseline prism.
   * Detects momentum cheating if delta_r > 0.12 * torsoLength while vertical drive is positive.
   * 
   * @param {JointPoint|{x: number, y: number, z?: number}} currentHips Current mid-hip spatial coordinate.
   * @param {number} [verticalVelocity=0] Vertical upward velocity in m/s (positive = ascent).
   * @param {number} [torsoLength] Optional override for torso length.
   * @returns {CheatDetectionResult}
   */
  evaluateMomentum(currentHips, verticalVelocity = 0, torsoLength = this.torsoLength) {
    if (!currentHips) {
      return this.lastResult;
    }

    if (!this.isAnchored) {
      this.anchorBaselinePrism(currentHips);
    }

    const hX = currentHips.x;
    const hZ = currentHips.z || 0;

    // Calculate horizontal 3D displacement: delta_r = sqrt((x - x0)^2 + (z - z0)^2)
    const dx = hX - this.baselineX;
    const dz = hZ - this.baselineZ;
    const swayMagnitude = Math.hypot(dx, dz);

    this.peakSway = Math.max(this.peakSway, swayMagnitude);

    const effTorso = torsoLength || this.torsoLength || this.defaultTorsoLength;
    const tolerance = this.swayMultiplier * effTorso;

    // Cheating condition: delta_r > 0.12 * torsoLength during positive vertical drive (concentric ascent)
    const isDrivingUp = verticalVelocity > 0.05;
    if (swayMagnitude > tolerance && isDrivingUp) {
      this.currentRepCheated = true;
    }

    // Strictness Score [0 - 100]%
    let strictnessScore = 100;
    if (tolerance > 0.001) {
      const swayRatio = swayMagnitude / tolerance;
      if (swayRatio <= 1.0) {
        // Within clean strictness zone: 90% - 100%
        strictnessScore = Math.max(90, Math.min(100, Math.round(100 - (swayRatio * 10))));
      } else {
        // Outside allowable boundary: decays down to 10%
        const excess = swayRatio - 1.0;
        strictnessScore = Math.max(10, Math.round(90 - Math.min(80, excess * 45)));
      }
    }

    this.lowestStrictness = Math.min(this.lowestStrictness, strictnessScore);

    const displayLabel = this.currentRepCheated
      ? '⚠️ MOMENTUM DETECTED // ELIMINATE SWAY'
      : `STRICTNESS: ${strictnessScore}% [CLEAN FORM]`;

    this.lastResult = {
      isCheated: this.currentRepCheated,
      swayMagnitude: Math.round(swayMagnitude * 1000) / 1000,
      strictnessScore,
      displayLabel,
      tolerance: Math.round(tolerance * 1000) / 1000,
      isAnchored: this.isAnchored
    };

    return this.lastResult;
  }

  /**
   * Helper extracting hips and evaluating momentum directly from 33 MediaPipe pose landmarks.
   * 
   * @param {Array<JointPoint>} landmarks 33 MediaPipe pose landmarks.
   * @param {number} [verticalVelocity=0] Instantaneous vertical velocity in m/s.
   * @returns {CheatDetectionResult}
   */
  evaluateFromLandmarks(landmarks, verticalVelocity = 0) {
    if (!landmarks || landmarks.length < 25) {
      return this.lastResult;
    }

    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    if (!leftHip || !rightHip) {
      return this.lastResult;
    }

    const midHip = {
      x: (leftHip.x + rightHip.x) * 0.5,
      y: (leftHip.y + rightHip.y) * 0.5,
      z: ((leftHip.z || 0) + (rightHip.z || 0)) * 0.5
    };

    return this.evaluateMomentum(midHip, verticalVelocity);
  }

  /**
   * Finalizes the current repetition status and resets intra-rep cheat flags.
   * 
   * @returns {{ wasCheated: boolean, lowestStrictness: number, peakSway: number }}
   */
  onRepComplete() {
    const summary = {
      wasCheated: this.currentRepCheated,
      lowestStrictness: this.lowestStrictness,
      peakSway: Math.round(this.peakSway * 1000) / 1000
    };

    this.currentRepCheated = false;
    this.peakSway = 0;
    this.lowestStrictness = 100;
    return summary;
  }

  /**
   * Resets baseline anchors and historical metrics.
   */
  reset() {
    this.isAnchored = false;
    this.baselineX = 0;
    this.baselineY = 0;
    this.baselineZ = 0;
    this.torsoLength = this.defaultTorsoLength;
    this.currentRepCheated = false;
    this.peakSway = 0;
    this.lowestStrictness = 100;
    this.lastResult = {
      isCheated: false,
      swayMagnitude: 0,
      strictnessScore: 100,
      displayLabel: 'STRICTNESS: 100% [CLEAN FORM]',
      tolerance: 0.12 * this.defaultTorsoLength,
      isAnchored: false
    };
  }
}
