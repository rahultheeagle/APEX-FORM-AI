/**
 * @fileoverview Layer 4: Computer Vision & Biomechanical Barbell Collinear Tilt Analyzer.
 * Computes 3D unit vector collinearity between bilateral wrists, horizontal tilt angle (arctan2),
 * and depth disparity (Z-axis delta) to detect bar yaw and asymmetric extension.
 */

/**
 * @typedef {Object} WristLandmark
 * @property {number} x Normalized X coordinate [0.0, 1.0].
 * @property {number} y Normalized Y coordinate [0.0, 1.0].
 * @property {number} [z] Normalized or metric depth coordinate.
 * @property {number} [visibility] Confidence score [0.0, 1.0].
 */

/**
 * @typedef {Object} BarAlignmentResult
 * @property {number} tiltDegrees Signed horizontal tilt angle in degrees.
 * @property {boolean} isLevel True if |tiltDegrees| <= threshold (default 2.0°).
 * @property {number} yawDisparityZ Delta Z between right and left wrist (positive = right forward).
 * @property {{ x: number, y: number, z: number }} unitVector 3D normalized unit direction vector.
 * @property {{ x: number, y: number, z: number }|null} barMidpoint Center coordinate between wrists.
 * @property {number} barLength Normalized Euclidean distance between wrists.
 * @property {boolean} isVisible True if both wrists meet visibility requirements.
 * @property {WristLandmark|null} leftWrist
 * @property {WristLandmark|null} rightWrist
 */

export class BarbellAnalyzer {
  /**
   * @param {Object} [options]
   * @param {number} [options.tiltThresholdDegrees=2.0] Maximum tilt tolerance to be considered level.
   * @param {number} [options.minVisibility=0.35] Minimum landmark confidence for evaluation.
   * @param {number} [options.smoothingAlpha=0.25] Exponential Moving Average factor for angle stability.
   */
  constructor(options = {}) {
    this.tiltThresholdDegrees = options.tiltThresholdDegrees !== undefined ? options.tiltThresholdDegrees : 2.0;
    this.minVisibility = options.minVisibility !== undefined ? options.minVisibility : 0.35;
    this.smoothingAlpha = options.smoothingAlpha !== undefined ? options.smoothingAlpha : 0.25;

    /** @type {number} Smoothed tilt angle in degrees */
    this.smoothedTilt = 0;

    /** @type {number} Smoothed Z disparity */
    this.smoothedYawZ = 0;

    /** @type {boolean} True if initialized with a valid reading */
    this.hasReading = false;
  }

  /**
   * Evaluates collinear barbell alignment and 3D orientation across bilateral wrist anchors.
   * 
   * @param {WristLandmark|null} leftWrist Landmark 15 (left wrist).
   * @param {WristLandmark|null} rightWrist Landmark 16 (right wrist).
   * @returns {BarAlignmentResult}
   */
  evaluateBarAlignment(leftWrist, rightWrist) {
    if (!leftWrist || !rightWrist) {
      return this._createFallbackResult(leftWrist, rightWrist);
    }

    const leftVis = leftWrist.visibility !== undefined ? leftWrist.visibility : 1.0;
    const rightVis = rightWrist.visibility !== undefined ? rightWrist.visibility : 1.0;

    if (leftVis < this.minVisibility || rightVis < this.minVisibility) {
      return this._createFallbackResult(leftWrist, rightWrist);
    }

    // Coordinate deltas from left wrist to right wrist
    const dx = rightWrist.x - leftWrist.x;
    const dy = rightWrist.y - leftWrist.y;
    const lz = leftWrist.z || 0;
    const rz = rightWrist.z || 0;
    const dz = rz - lz;

    // 3D Euclidean magnitude ||P_right - P_left||
    const length3D = Math.hypot(dx, dy, dz);
    if (length3D < 0.001) {
      return this._createFallbackResult(leftWrist, rightWrist);
    }

    // 3D Unit Vector connecting left to right wrist:
    // v_bar = (P_right - P_left) / ||P_right - P_left||
    const unitVector = {
      x: dx / length3D,
      y: dy / length3D,
      z: dz / length3D
    };

    // Horizontal Tilt Angle (degrees):
    // In screen coordinates: y increases downwards.
    // If wrists are level: dy = 0, angle = 0°.
    // If right wrist drops lower: dy > 0, angle > 0°.
    // If left wrist drops lower: dy < 0, angle < 0°.
    const rawTiltRad = Math.atan2(dy, dx);
    const rawTiltDeg = (rawTiltRad * 180) / Math.PI;

    // Apply Exponential Moving Average (EMA) smoothing to eliminate high-frequency tracking tremor
    const alpha = this.smoothingAlpha;
    if (!this.hasReading) {
      this.smoothedTilt = rawTiltDeg;
      this.smoothedYawZ = dz;
      this.hasReading = true;
    } else {
      this.smoothedTilt = (alpha * rawTiltDeg) + ((1.0 - alpha) * this.smoothedTilt);
      this.smoothedYawZ = (alpha * dz) + ((1.0 - alpha) * this.smoothedYawZ);
    }

    const tiltDegrees = Math.round(this.smoothedTilt * 10) / 10;
    const isLevel = Math.abs(this.smoothedTilt) <= this.tiltThresholdDegrees;
    const yawDisparityZ = Math.round(this.smoothedYawZ * 1000) / 1000;

    const barMidpoint = {
      x: (leftWrist.x + rightWrist.x) / 2,
      y: (leftWrist.y + rightWrist.y) / 2,
      z: (lz + rz) / 2
    };

    return {
      tiltDegrees,
      isLevel,
      yawDisparityZ,
      unitVector,
      barMidpoint,
      barLength: length3D,
      isVisible: true,
      leftWrist,
      rightWrist
    };
  }

  /**
   * Resets temporal smoothing state.
   */
  reset() {
    this.smoothedTilt = 0;
    this.smoothedYawZ = 0;
    this.hasReading = false;
  }

  /**
   * Creates a safe default result when wrists are obscured or unidentifiable.
   * @param {WristLandmark|null} leftWrist
   * @param {WristLandmark|null} rightWrist
   * @returns {BarAlignmentResult}
   * @private
   */
  _createFallbackResult(leftWrist, rightWrist) {
    return {
      tiltDegrees: 0,
      isLevel: true,
      yawDisparityZ: 0,
      unitVector: { x: 1, y: 0, z: 0 },
      barMidpoint: null,
      barLength: 0,
      isVisible: false,
      leftWrist: leftWrist || null,
      rightWrist: rightWrist || null
    };
  }
}
