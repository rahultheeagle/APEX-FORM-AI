/**
 * @fileoverview Layer 4: Transverse-Plane Pelvic & Thoracic Yaw Kinematics Engine.
 * Evaluates 3D rotational asymmetry in the transverse plane:
 * - Pelvic Yaw (left vs. right hip Z-depth disparity)
 * - Thoracic Yaw (left vs. right shoulder Z-depth disparity)
 * - Relative Spinal Twist Angle: |theta_thorax - theta_pelvis|
 * - Flags unlevel pelvic torque when twist exceeds 3.0 degrees.
 */

export class TransverseAnalyzer {
  /**
   * @param {Object} [options]
   * @param {number} [options.asymmetryThresholdDeg=3.0] Rotation threshold in degrees.
   * @param {number} [options.smoothingAlpha=0.35] EMA filter weight.
   */
  constructor(options = {}) {
    this.asymmetryThresholdDeg = options.asymmetryThresholdDeg !== undefined ? options.asymmetryThresholdDeg : 3.0;
    this.smoothingAlpha = options.smoothingAlpha !== undefined ? options.smoothingAlpha : 0.35;

    // Filtered angle states (degrees)
    this.smoothPelvicYaw = 0;
    this.smoothThoracicYaw = 0;
    this.smoothTwistDelta = 0;
    this.isInitialized = false;
  }

  /**
   * Evaluates 3D transverse-plane rotation of the pelvis and thorax.
   * 
   * @param {Array<Object>} landmarks 3D MediaPipe pose landmarks (with x, y, z, visibility).
   * @returns {{
   *   pelvicYawDeg: number,
   *   thoracicYawDeg: number,
   *   twistDeltaDeg: number,
   *   isAsymmetric: boolean,
   *   twistDirection: string,
   *   twistLabel: string,
   *   isVisible: boolean,
   *   rawPelvicYaw: number,
   *   leftHip: Object|null,
   *   rightHip: Object|null
   * }}
   */
  evaluateTransverseAsymmetry(landmarks) {
    const defaultResult = {
      pelvicYawDeg: 0,
      thoracicYawDeg: 0,
      twistDeltaDeg: 0,
      isAsymmetric: false,
      twistDirection: 'NEUTRAL',
      twistLabel: 'PELVIS ALIGNED [0.0°]',
      isVisible: false,
      rawPelvicYaw: 0,
      leftHip: null,
      rightHip: null
    };

    if (!landmarks || landmarks.length < 25) {
      return defaultResult;
    }

    const sL = landmarks[11]; // Left Shoulder
    const sR = landmarks[12]; // Right Shoulder
    const hL = landmarks[23]; // Left Hip
    const hR = landmarks[24]; // Right Hip

    if (!sL || !sR || !hL || !hR) {
      return defaultResult;
    }

    const minVis = 0.40;
    const isVisible = (sL.visibility > minVis && sR.visibility > minVis &&
                       hL.visibility > minVis && hR.visibility > minVis);

    if (!isVisible) {
      return defaultResult;
    }

    // 1. Pelvic Yaw Angle: theta = arctan2(Z_R - Z_L, X_R - X_L) * (180 / PI)
    // MediaPipe coordinate system:
    // X: rightward [0, 1]
    // Z: depth into screen (smaller Z = closer to camera, larger Z = farther back)
    const dxPelvis = (hR.x - hL.x);
    const dzPelvis = (hR.z - hL.z);
    const rawPelvicYaw = Math.atan2(dzPelvis, dxPelvis) * (180 / Math.PI);

    // 2. Thoracic Yaw Angle: theta = arctan2(Z_R - Z_L, X_R - X_L) * (180 / PI)
    const dxThorax = (sR.x - sL.x);
    const dzThorax = (sR.z - sL.z);
    const rawThoracicYaw = Math.atan2(dzThorax, dxThorax) * (180 / Math.PI);

    // 3. Relative Spinal Twist: Delta theta = |theta_thorax - theta_pelvis|
    let rawTwistDelta = Math.abs(rawThoracicYaw - rawPelvicYaw);
    // Normalize angular difference [-180, 180]
    while (rawTwistDelta > 180) rawTwistDelta -= 360;
    rawTwistDelta = Math.abs(rawTwistDelta);

    // 4. Apply Exponential Moving Average (EMA) smoothing
    if (!this.isInitialized) {
      this.smoothPelvicYaw = rawPelvicYaw;
      this.smoothThoracicYaw = rawThoracicYaw;
      this.smoothTwistDelta = rawTwistDelta;
      this.isInitialized = true;
    } else {
      const alpha = this.smoothingAlpha;
      this.smoothPelvicYaw = (alpha * rawPelvicYaw) + ((1.0 - alpha) * this.smoothPelvicYaw);
      this.smoothThoracicYaw = (alpha * rawThoracicYaw) + ((1.0 - alpha) * this.smoothThoracicYaw);
      this.smoothTwistDelta = (alpha * rawTwistDelta) + ((1.0 - alpha) * this.smoothTwistDelta);
    }

    const pelvicYawDeg = Math.round(this.smoothPelvicYaw * 10) / 10;
    const thoracicYawDeg = Math.round(this.smoothThoracicYaw * 10) / 10;
    const twistDeltaDeg = Math.round(this.smoothTwistDelta * 10) / 10;

    // Asymmetry is flagged if pelvic rotation or spinal twist exceeds threshold (3.0 deg)
    const isAsymmetric = Math.abs(pelvicYawDeg) > this.asymmetryThresholdDeg || twistDeltaDeg > this.asymmetryThresholdDeg;

    // Determine anatomical rotation direction
    // If Z_R > Z_L (pelvicYawDeg > 0), right hip is farther from camera -> RIGHT HIP BACK
    // If Z_L > Z_R (pelvicYawDeg < 0), left hip is farther from camera -> LEFT HIP BACK
    let twistDirection = 'NEUTRAL';
    let twistLabel = `ALIGNED: ${Math.abs(pelvicYawDeg).toFixed(1)}°`;

    if (isAsymmetric) {
      if (pelvicYawDeg > 0) {
        twistDirection = 'RIGHT_HIP_BACK';
        twistLabel = `TWIST: +${pelvicYawDeg.toFixed(1)}° RIGHT HIP BACK`;
      } else {
        twistDirection = 'LEFT_HIP_BACK';
        twistLabel = `TWIST: ${pelvicYawDeg.toFixed(1)}° LEFT HIP BACK`;
      }
    }

    return {
      pelvicYawDeg,
      thoracicYawDeg,
      twistDeltaDeg,
      isAsymmetric,
      twistDirection,
      twistLabel,
      isVisible: true,
      rawPelvicYaw,
      leftHip: hL,
      rightHip: hR
    };
  }

  /**
   * Resets internal smoothed filter states.
   */
  reset() {
    this.smoothPelvicYaw = 0;
    this.smoothThoracicYaw = 0;
    this.smoothTwistDelta = 0;
    this.isInitialized = false;
  }
}
