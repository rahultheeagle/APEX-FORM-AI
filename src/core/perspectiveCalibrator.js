/**
 * @fileoverview Layer 1: Ground Perspective Auto-Calibration & Camera Tilt Rectification.
 * Automatically estimates the 3D pitch angle of a mobile/webcam device using
 * ground contact anchors and vertical spine vectors. Applies a 3D coordinate rotation
 * around the X-axis to ensure joint angles and biomechanical metrics are invariant to camera tilt.
 * 
 * Formula:
 * y' = y_c + (y - y_c) * cos(theta) - (z - z_c) * sin(theta)
 * z' = z_c + (y - y_c) * sin(theta) + (z - z_c) * cos(theta)
 */

export class PerspectiveCalibrator {
  /**
   * @param {Object} [options]
   * @param {number} [options.smoothingFactor=0.08] Exponential moving average alpha for tilt stability.
   * @param {number} [options.optimalThresholdDeg=3.0] Maximum tilt deviation considered level/optimal.
   */
  constructor(options = {}) {
    /** @type {number} */
    this.smoothingFactor = options.smoothingFactor || 0.08;
    /** @type {number} */
    this.optimalThresholdDeg = options.optimalThresholdDeg || 3.0;

    /** @type {number} Instantaneous pitch angle in radians (positive = looking up) */
    this.pitchAngle = 0;
    /** @type {number} Filtered pitch angle in radians */
    this.filteredPitchAngle = 0;

    /** @type {number[]} Ground plane normal vector in camera coordinates [nx, ny, nz] */
    this.groundNormal = [0, -1, 0];

    /** @type {boolean} */
    this.hasSufficientConfidence = false;

    /**
     * Pre-allocated buffer of 33 rectified landmarks to guarantee ZERO garbage collection at 60 FPS.
     * @type {Array<{ x: number, y: number, z: number, visibility: number }>}
     */
    this.rectifiedBuffer = [];
    for (let i = 0; i < 33; i++) {
      this.rectifiedBuffer.push({ x: 0, y: 0, z: 0, visibility: 1.0 });
    }
  }

  /**
   * Estimates camera pitch angle theta_pitch from ankle contact points and vertical spine alignment.
   * 
   * @param {Array<{ x: number, y: number, z: number, visibility?: number }>} landmarks
   * @returns {number} Estimated pitch angle in radians.
   */
  estimateCameraPitch(landmarks) {
    if (!landmarks || landmarks.length < 29) {
      return this.filteredPitchAngle;
    }

    const sL = landmarks[11];
    const sR = landmarks[12];
    const aL = landmarks[27];
    const aR = landmarks[28];

    // Check visibility confidence of reference anchors
    const shouldersVisible = sL && sR && (sL.visibility || 1) > 0.35 && (sR.visibility || 1) > 0.35;
    const anklesVisible = aL && aR && (aL.visibility || 1) > 0.35 && (aR.visibility || 1) > 0.35;

    if (!shouldersVisible || !anklesVisible) {
      this.hasSufficientConfidence = false;
      return this.filteredPitchAngle;
    }

    this.hasSufficientConfidence = true;

    // 1. Mid-Shoulder Anchor
    const midShoulder = {
      y: (sL.y + sR.y) / 2,
      z: ((sL.z || 0) + (sR.z || 0)) / 2
    };

    // 2. Mid-Ankle Contact Anchor
    const midAnkle = {
      y: (aL.y + aR.y) / 2,
      z: ((aL.z || 0) + (aR.z || 0)) / 2
    };

    // 3. Compute vertical spine vector in Y-Z camera plane
    // In normalized image space, Y points downward (ankles have larger Y than shoulders)
    const dy = midAnkle.y - midShoulder.y;
    const dz = midAnkle.z - midShoulder.z;

    if (dy <= 0.1) {
      return this.filteredPitchAngle;
    }

    // When the phone is tilted up (looking up at user), ankles are closer (more negative z) than shoulders,
    // so dz = (ankleZ - shoulderZ) < 0. Pitch angle looking up is positive.
    const rawPitch = -Math.atan2(dz, dy);

    // Clamp pitch angle to physical range [-45°, +45°]
    const maxPitchRad = 45 * (Math.PI / 180);
    const clampedPitch = Math.max(-maxPitchRad, Math.min(maxPitchRad, rawPitch));

    // Low-pass exponential smoothing to prevent frame jitter
    this.filteredPitchAngle = (this.smoothingFactor * clampedPitch) + ((1 - this.smoothingFactor) * this.filteredPitchAngle);
    this.pitchAngle = this.filteredPitchAngle;

    // Compute ground normal vector rotated by pitch angle around X-axis
    // Base normal [0, -1, 0] (upwards) rotated by theta:
    const cosTheta = Math.cos(this.pitchAngle);
    const sinTheta = Math.sin(this.pitchAngle);
    this.groundNormal = [0, -cosTheta, -sinTheta];

    return this.pitchAngle;
  }

  /**
   * Applies 3D rotation matrix around the X-axis:
   * y' = y * cos(theta) - z * sin(theta)
   * z' = y * sin(theta) + z * cos(theta)
   * 
   * Centered at frame midpoint (y_c = 0.5, z_c = 0) to ensure landmarks stay inside viewport.
   * 
   * @param {Array<{ x: number, y: number, z: number, visibility?: number }>} landmarks
   * @returns {Array<{ x: number, y: number, z: number, visibility: number }>}
   */
  rectifyLandmarks(landmarks) {
    if (!landmarks || landmarks.length === 0) {
      return landmarks;
    }

    const theta = this.filteredPitchAngle;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);

    const yCenter = 0.5;
    const zCenter = 0.0;

    const count = Math.min(landmarks.length, this.rectifiedBuffer.length);
    for (let i = 0; i < count; i++) {
      const src = landmarks[i];
      const dest = this.rectifiedBuffer[i];

      const dy = src.y - yCenter;
      const dz = (src.z || 0) - zCenter;

      // X remains invariant under X-axis pitch rotation
      dest.x = src.x;
      // Rotation around X-axis
      dest.y = yCenter + (dy * cosTheta - dz * sinTheta);
      dest.z = zCenter + (dy * sinTheta + dz * cosTheta);
      dest.visibility = src.visibility !== undefined ? src.visibility : 1.0;
    }

    return this.rectifiedBuffer;
  }

  /**
   * Returns current pitch in degrees.
   * @returns {number}
   */
  getPitchDegrees() {
    return Number((this.filteredPitchAngle * (180 / Math.PI)).toFixed(1));
  }

  /**
   * Evaluates if device tilt is within optimal level tolerance (<= 3 degrees).
   * @returns {boolean}
   */
  isOptimal() {
    return Math.abs(this.getPitchDegrees()) <= this.optimalThresholdDeg;
  }

  /**
   * Resets calibrated pitch state.
   */
  reset() {
    this.pitchAngle = 0;
    this.filteredPitchAngle = 0;
    this.groundNormal = [0, -1, 0];
    this.hasSufficientConfidence = false;
  }
}
