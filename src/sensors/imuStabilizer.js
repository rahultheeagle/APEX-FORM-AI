/**
 * @fileoverview Layer 0: Hardware IMU Accelerometer & Gyroscope Camera Stabilization Engine.
 * Implements a real-time complementary filter (accelerometer + gyro fusion) and high-pass
 * shock dampener to isolate camera-shake vibration and tilt artifacts from visual pose landmarks.
 */

export class ImuStabilizer {
  /**
   * @param {Object} [options]
   * @param {number} [options.filterAlpha=0.96] Complementary filter gyro weight.
   * @param {number} [options.hpAlpha=0.85] High-pass filter weight for linear vibration shocks.
   * @param {number} [options.pitchSensitivity=0.0035] Normalized screen Y displacement per degree tilt.
   * @param {number} [options.rollSensitivity=0.0035] Normalized screen X displacement per degree tilt.
   */
  constructor(options = {}) {
    this.filterAlpha = options.filterAlpha !== undefined ? options.filterAlpha : 0.96;
    this.hpAlpha = options.hpAlpha !== undefined ? options.hpAlpha : 0.85;
    this.pitchSensitivity = options.pitchSensitivity || 0.0035;
    this.rollSensitivity = options.rollSensitivity || 0.0035;

    /** @type {boolean} True if receiving real hardware IMU updates */
    this.isImuActive = false;
    this.isSupported = false;
    this.isListening = false;

    // Filter states (degrees)
    this.pitch = 0;
    this.roll = 0;
    this.basePitch = null;
    this.baseRoll = null;

    // High-pass vibration acceleration states (m/s^2)
    this.prevAccelX = 0;
    this.prevAccelY = 0;
    this.vibShockX = 0;
    this.vibShockY = 0;

    // Displacement offsets applied to visual landmarks
    this.offsetCorrectionX = 0;
    this.offsetCorrectionY = 0;

    this.lastTimestamp = 0;
    this.lastMotionTimestamp = 0;

    // Pre-allocate 33-slot landmark pool to guarantee zero GC pressure at 60 FPS
    this._correctedPool = Array.from({ length: 33 }, () => ({
      x: 0,
      y: 0,
      z: 0,
      visibility: 0
    }));

    this._onDeviceMotion = this._onDeviceMotion.bind(this);
    this._onDeviceOrientation = this._onDeviceOrientation.bind(this);
  }

  /**
   * Requests device sensor permissions (iOS 13+ requirement) and attaches event listeners.
   * @returns {Promise<boolean>} True if IMU is active, false if bypassed.
   */
  async init() {
    if (typeof window === 'undefined') {
      this.isSupported = false;
      return false;
    }

    // Check availability of DeviceMotionEvent or DeviceOrientationEvent
    const hasMotion = 'DeviceMotionEvent' in window;
    const hasOrientation = 'DeviceOrientationEvent' in window;

    if (!hasMotion && !hasOrientation) {
      console.warn('ImuStabilizer: IMU hardware sensors not detected. Operating in BYPASS mode.');
      this.isSupported = false;
      this.isImuActive = false;
      return false;
    }

    this.isSupported = true;

    // Guard for iOS / WebKit permission prompt
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const motionPermission = await DeviceMotionEvent.requestPermission();
        if (motionPermission !== 'granted') {
          console.warn('ImuStabilizer: DeviceMotion permission denied.');
          this.isImuActive = false;
          return false;
        }
      }
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const orientationPermission = await DeviceOrientationEvent.requestPermission();
        if (orientationPermission !== 'granted') {
          console.warn('ImuStabilizer: DeviceOrientation permission denied.');
        }
      }
    } catch (err) {
      console.warn('ImuStabilizer: Permission request bypassed or rejected:', err);
    }

    this.startListening();
    return true;
  }

  /**
   * Attaches device motion and orientation listeners.
   */
  startListening() {
    if (this.isListening || typeof window === 'undefined') return;

    try {
      window.addEventListener('devicemotion', this._onDeviceMotion, { passive: true });
      window.addEventListener('deviceorientation', this._onDeviceOrientation, { passive: true });
      this.isListening = true;
    } catch (e) {
      console.warn('ImuStabilizer: Failed to bind window event listeners:', e);
    }
  }

  /**
   * Detaches hardware event listeners.
   */
  stopListening() {
    if (!this.isListening || typeof window === 'undefined') return;

    try {
      window.removeEventListener('devicemotion', this._onDeviceMotion);
      window.removeEventListener('deviceorientation', this._onDeviceOrientation);
    } catch (e) {}

    this.isListening = false;
    this.isImuActive = false;
  }

  /**
   * Handles high-rate accelerometer and angular velocity updates (devicemotion).
   * @param {DeviceMotionEvent} event
   * @private
   */
  _onDeviceMotion(event) {
    const now = performance.now();
    this.isImuActive = true;
    this.lastMotionTimestamp = now;

    const dt = this.lastTimestamp ? Math.max(0.005, Math.min(0.1, (now - this.lastTimestamp) / 1000)) : 0.016;
    this.lastTimestamp = now;

    // 1. Isolate Camera Vibration Shocks via High-Pass Filter on Linear Acceleration
    const acc = event.acceleration || event.accelerationIncludingGravity;
    if (acc) {
      const ax = acc.x || 0;
      const ay = acc.y || 0;

      // High-Pass: y[n] = alpha * (y[n-1] + x[n] - x[n-1])
      this.vibShockX = this.hpAlpha * (this.vibShockX + ax - this.prevAccelX);
      this.vibShockY = this.hpAlpha * (this.vibShockY + ay - this.prevAccelY);

      this.prevAccelX = ax;
      this.prevAccelY = ay;
    }

    // 2. Angular Velocity Gyroscope Integration
    const rot = event.rotationRate;
    if (rot) {
      const gyroPitch = rot.beta || 0; // deg/sec (pitch rate)
      const gyroRoll = rot.gamma || 0; // deg/sec (roll rate)

      this.pitch += gyroPitch * dt;
      this.roll += gyroRoll * dt;
    }
  }

  /**
   * Handles absolute / calibrated tilt angles (deviceorientation).
   * Fuses absolute orientation into complementary filter to eliminate gyro drift.
   * @param {DeviceOrientationEvent} event
   * @private
   */
  _onDeviceOrientation(event) {
    if (event.beta === null || event.gamma === null) return;
    this.isImuActive = true;

    const absPitch = event.beta;  // [-180, 180]
    const absRoll = event.gamma;   // [-90, 90]

    if (this.basePitch === null || this.baseRoll === null) {
      this.basePitch = absPitch;
      this.baseRoll = absRoll;
      this.pitch = absPitch;
      this.roll = absRoll;
      return;
    }

    // Complementary Filter Fusion: theta = alpha * gyro + (1 - alpha) * accel
    this.pitch = (this.filterAlpha * this.pitch) + ((1.0 - this.filterAlpha) * absPitch);
    this.roll = (this.filterAlpha * this.roll) + ((1.0 - this.filterAlpha) * absRoll);

    // Compute delta relative to resting baseline orientation
    const deltaPitch = this.pitch - this.basePitch;
    const deltaRoll = this.roll - this.baseRoll;

    // Convert tilt degrees and vibration to normalized visual coordinates
    // When device pitches forward (camera tilts down), visual scene moves upward in Y (+deltaPitch -> -offsetY)
    const tiltOffsetY = deltaPitch * this.pitchSensitivity;
    const tiltOffsetX = deltaRoll * this.rollSensitivity;

    // Shock vibration displacement scaling (0.0012 normalized per m/s^2)
    const vibOffsetY = this.vibShockY * 0.0012;
    const vibOffsetX = this.vibShockX * 0.0012;

    this.offsetCorrectionX = tiltOffsetX + vibOffsetX;
    this.offsetCorrectionY = tiltOffsetY + vibOffsetY;
  }

  /**
   * Corrects visual pose landmark coordinates by subtracting device tilt and shock vibrations.
   * Prevents false velocity spikes from camera wobble during heavy lifts.
   * 
   * @param {Array<Object>} landmarks Raw MediaPipe 3D normalized landmarks.
   * @returns {Array<Object>} Stabilized landmarks with compensated coordinates.
   */
  correctLandmarks(landmarks) {
    if (!landmarks || landmarks.length === 0) {
      return landmarks;
    }

    // Timeout guard: if no sensor updates in > 500ms, mark IMU inactive
    if (this.isImuActive && (performance.now() - this.lastMotionTimestamp > 500)) {
      this.isImuActive = false;
    }

    // If hardware IMU is unsupported or quiet, bypass stabilization without overhead
    if (!this.isImuActive) {
      return landmarks;
    }

    const ox = this.offsetCorrectionX;
    const oy = this.offsetCorrectionY;

    // Zero-allocation update using pre-allocated landmark pool
    const len = Math.min(landmarks.length, this._correctedPool.length);
    for (let i = 0; i < len; i++) {
      const src = landmarks[i];
      const dst = this._correctedPool[i];

      if (!src) continue;

      dst.x = src.x - ox;
      dst.y = src.y - oy;
      dst.z = src.z;
      dst.visibility = src.visibility;
    }

    return this._correctedPool;
  }

  /**
   * Returns current stabilization status string for HUD badges.
   * @returns {string} E.g., 'STABILIZATION: HARDWARE IMU ACTIVE' or 'STABILIZATION: BYPASS'
   */
  getStatusText() {
    return this.isImuActive
      ? 'STABILIZATION: HARDWARE IMU ACTIVE'
      : 'STABILIZATION: BYPASS';
  }

  /**
   * Resets baseline reference angles to the current phone orientation.
   */
  recalibrateBaseline() {
    this.basePitch = null;
    this.baseRoll = null;
    this.vibShockX = 0;
    this.vibShockY = 0;
    this.offsetCorrectionX = 0;
    this.offsetCorrectionY = 0;
  }

  /**
   * Destroys stabilizer and detaches event listeners.
   */
  destroy() {
    this.stopListening();
    this.recalibrateBaseline();
  }
}
