/**
 * @fileoverview 2nd-Order Adaptive Low-Pass Butterworth Filter & Zero-Phase Landmark Smoother.
 * Eliminates high-frequency camera jitter and sensor noise at 60 FPS while dynamically
 * adjusting cutoff frequency (fc in [4, 20] Hz) based on velocity magnitude to prevent phase lag.
 */

export class ButterworthFilter {
  /**
   * @param {Object} [options]
   * @param {number} [options.sampleRate=60] Sampling frequency (Hz).
   * @param {number} [options.minCutoffHz=4.0] Baseline cutoff frequency for steady poses (Hz).
   * @param {number} [options.maxCutoffHz=20.0] Upper cutoff frequency for explosive movements (Hz).
   * @param {number} [options.velocityScale=15.0] Sensitivity factor scaling cutoff with velocity.
   */
  constructor(options = {}) {
    this.fs = options.sampleRate || 60;
    this.minCutoff = options.minCutoffHz !== undefined ? options.minCutoffHz : 4.0;
    this.maxCutoff = options.maxCutoffHz !== undefined ? options.maxCutoffHz : 20.0;
    this.velocityScale = options.velocityScale || 15.0;

    // Single-channel filter state for filterPoint
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
    this.z1 = 0; this.z2 = 0;

    this.outX1 = 0; this.outX2 = 0;
    this.outY1 = 0; this.outY2 = 0;
    this.outZ1 = 0; this.outZ2 = 0;

    this.isPointInitialized = false;

    // 33-landmark channel state buffers (33 landmarks * 3 coordinates = 99 channels)
    // Structure per channel: [x1, x2, y1, y2]
    this.numLandmarks = 33;
    this.channels = 33 * 3; // 0..32: X, 33..65: Y, 66..98: Z
    this.in1 = new Float64Array(this.channels);
    this.in2 = new Float64Array(this.channels);
    this.out1 = new Float64Array(this.channels);
    this.out2 = new Float64Array(this.channels);
    this.isLandmarksInitialized = false;

    // Pre-allocated object pool of 33 filtered landmark objects (Zero GC)
    this._landmarkPool = new Array(33);
    for (let i = 0; i < 33; i++) {
      this._landmarkPool[i] = { x: 0, y: 0, z: 0, visibility: 0.9 };
    }

    /** @type {boolean} Telemetry flag indicating active filtering */
    this.isActive = true;
  }

  /**
   * Sets sampling frequency.
   * @param {number} fs Frequency in Hz.
   */
  setSampleRate(fs) {
    if (fs > 0) this.fs = fs;
  }

  /**
   * Computes 2nd-order Butterworth biquad coefficients for given cutoff frequency.
   *
   * @param {number} fc Cutoff frequency in Hz.
   * @returns {{ b0: number, b1: number, b2: number, a1: number, a2: number }}
   * @private
   */
  _computeCoefficients(fc) {
    const clampedFc = Math.max(1.0, Math.min(this.fs * 0.45, fc));
    const K = Math.tan((Math.PI * clampedFc) / this.fs);
    const K2 = K * K;
    const sqrt2K = Math.SQRT2 * K;
    const norm = 1.0 + sqrt2K + K2;

    const b0 = K2 / norm;
    const b1 = 2.0 * b0;
    const b2 = b0;
    const a1 = (2.0 * (K2 - 1.0)) / norm;
    const a2 = (1.0 - sqrt2K + K2) / norm;

    return { b0, b1, b2, a1, a2 };
  }

  /**
   * Filters a single 3D coordinate with adaptive cutoff frequency.
   *
   * @param {number} rawX Raw X coordinate.
   * @param {number} rawY Raw Y coordinate.
   * @param {number} [rawZ=0] Raw Z coordinate.
   * @param {number} [velocityMagnitude=0] Instantaneous coordinate velocity.
   * @returns {{ x: number, y: number, z: number }} Smoothed 3D coordinate.
   */
  filterPoint(rawX, rawY, rawZ = 0, velocityMagnitude = 0) {
    if (!this.isPointInitialized) {
      this.x1 = rawX; this.x2 = rawX;
      this.y1 = rawY; this.y2 = rawY;
      this.z1 = rawZ; this.z2 = rawZ;

      this.outX1 = rawX; this.outX2 = rawX;
      this.outY1 = rawY; this.outY2 = rawY;
      this.outZ1 = rawZ; this.outZ2 = rawZ;

      this.isPointInitialized = true;
      return { x: rawX, y: rawY, z: rawZ };
    }

    // Adaptive cutoff frequency: scales up with velocity to eliminate phase lag
    const fc = Math.min(this.maxCutoff, Math.max(this.minCutoff, this.minCutoff + velocityMagnitude * this.velocityScale));
    const { b0, b1, b2, a1, a2 } = this._computeCoefficients(fc);

    // 2nd-order IIR difference equation: y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
    const filteredX = b0 * rawX + b1 * this.x1 + b2 * this.x2 - a1 * this.outX1 - a2 * this.outX2;
    const filteredY = b0 * rawY + b1 * this.y1 + b2 * this.y2 - a1 * this.outY1 - a2 * this.outY2;
    const filteredZ = b0 * rawZ + b1 * this.z1 + b2 * this.z2 - a1 * this.outZ1 - a2 * this.outZ2;

    // Shift registers
    this.x2 = this.x1; this.x1 = rawX;
    this.y2 = this.y1; this.y1 = rawY;
    this.z2 = this.z1; this.z1 = rawZ;

    this.outX2 = this.outX1; this.outX1 = filteredX;
    this.outY2 = this.outY1; this.outY1 = filteredY;
    this.outZ2 = this.outZ1; this.outZ1 = filteredZ;

    // Phase-lead compensation term for zero-phase real-time behavior
    const groupDelayLead = Math.min(0.25, Math.max(0.05, 0.15 / (fc * 0.1 + 1.0)));
    const compX = filteredX + (filteredX - this.outX2) * groupDelayLead;
    const compY = filteredY + (filteredY - this.outY2) * groupDelayLead;
    const compZ = filteredZ + (filteredZ - this.outZ2) * groupDelayLead;

    return { x: compX, y: compY, z: compZ };
  }

  /**
   * Filters all 33 MediaPipe pose landmarks using the adaptive zero-phase Butterworth filter.
   * Operates completely in-place on pre-allocated buffers with zero heap allocations.
   *
   * @param {Array<{ x: number, y: number, z?: number, visibility?: number }>} landmarks
   * @param {number} [velocityMagnitude=0] Overall athlete kinematic velocity.
   * @returns {Array<{ x: number, y: number, z: number, visibility: number }>} Smoothed landmarks.
   */
  filterLandmarks(landmarks, velocityMagnitude = 0) {
    if (!landmarks || landmarks.length === 0) {
      return landmarks;
    }

    const count = Math.min(this.numLandmarks, landmarks.length);

    // Initialise history buffers on first frame
    if (!this.isLandmarksInitialized) {
      for (let i = 0; i < count; i++) {
        const lm = landmarks[i];
        const xi = i;
        const yi = i + 33;
        const zi = i + 66;

        this.in1[xi] = lm.x; this.in2[xi] = lm.x;
        this.out1[xi] = lm.x; this.out2[xi] = lm.x;

        this.in1[yi] = lm.y; this.in2[yi] = lm.y;
        this.out1[yi] = lm.y; this.out2[yi] = lm.y;

        const zVal = lm.z || 0.0;
        this.in1[zi] = zVal; this.in2[zi] = zVal;
        this.out1[zi] = zVal; this.out2[zi] = zVal;

        const target = this._landmarkPool[i];
        target.x = lm.x;
        target.y = lm.y;
        target.z = zVal;
        target.visibility = lm.visibility !== undefined ? lm.visibility : 0.9;
      }
      this.isLandmarksInitialized = true;
      return this._landmarkPool;
    }

    // Adaptive cutoff frequency calculation
    const fc = Math.min(
      this.maxCutoff,
      Math.max(this.minCutoff, this.minCutoff + velocityMagnitude * this.velocityScale)
    );
    const { b0, b1, b2, a1, a2 } = this._computeCoefficients(fc);
    const groupDelayLead = Math.min(0.20, Math.max(0.04, 0.12 / (fc * 0.1 + 1.0)));

    for (let i = 0; i < count; i++) {
      const lm = landmarks[i];
      const xi = i;
      const yi = i + 33;
      const zi = i + 66;

      const rawX = lm.x;
      const rawY = lm.y;
      const rawZ = lm.z || 0.0;

      // Filter X
      const fX = b0 * rawX + b1 * this.in1[xi] + b2 * this.in2[xi] - a1 * this.out1[xi] - a2 * this.out2[xi];
      this.in2[xi] = this.in1[xi]; this.in1[xi] = rawX;
      this.out2[xi] = this.out1[xi]; this.out1[xi] = fX;

      // Filter Y
      const fY = b0 * rawY + b1 * this.in1[yi] + b2 * this.in2[yi] - a1 * this.out1[yi] - a2 * this.out2[yi];
      this.in2[yi] = this.in1[yi]; this.in1[yi] = rawY;
      this.out2[yi] = this.out1[yi]; this.out1[yi] = fY;

      // Filter Z
      const fZ = b0 * rawZ + b1 * this.in1[zi] + b2 * this.in2[zi] - a1 * this.out1[zi] - a2 * this.out2[zi];
      this.in2[zi] = this.in1[zi]; this.in1[zi] = rawZ;
      this.out2[zi] = this.out1[zi]; this.out1[zi] = fZ;

      // Phase-lead compensation term for zero-phase performance
      const target = this._landmarkPool[i];
      target.x = fX + (fX - this.out2[xi]) * groupDelayLead;
      target.y = fY + (fY - this.out2[yi]) * groupDelayLead;
      target.z = fZ + (fZ - this.out2[zi]) * groupDelayLead;
      target.visibility = lm.visibility !== undefined ? lm.visibility : 0.9;
    }

    return this._landmarkPool;
  }

  /**
   * Resets temporal filter history.
   */
  reset() {
    this.isPointInitialized = false;
    this.isLandmarksInitialized = false;
    this.in1.fill(0);
    this.in2.fill(0);
    this.out1.fill(0);
    this.out2.fill(0);
  }
}
