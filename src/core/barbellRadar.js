/**
 * @fileoverview Layer 4: Real-time Sub-Pixel Barbell Vector Radar & Trajectory Tracker.
 * Calculates collinear barbell tilt, midpoint coordinates, vertical descent plane drift,
 * and maintains a 90-frame ring buffer of bar path history with zero garbage collection overhead.
 */

/**
 * @typedef {Object} WristPoint
 * @property {number} x Normalized X coordinate [0.0, 1.0].
 * @property {number} y Normalized Y coordinate [0.0, 1.0].
 * @property {number} [z] Depth coordinate.
 * @property {number} [visibility] Confidence score [0.0, 1.0].
 */

/**
 * @typedef {Object} BarbellRadarResult
 * @property {{ x: number, y: number }} barMidpoint Calculated center coordinate between wrists.
 * @property {number} tiltDeg Angular tilt relative to horizontal in degrees.
 * @property {boolean} isLevel True if |tiltDeg| <= tiltThreshold (default 2.0°).
 * @property {number} driftRatio Ratio of horizontal drift relative to bar span.
 * @property {Array<{ x: number, y: number, timestamp: number }>} pathHistory 90-frame ring buffer of path coordinates.
 * @property {WristPoint|null} leftWrist
 * @property {WristPoint|null} rightWrist
 * @property {number} barLength Normalized Euclidean distance between wrists.
 * @property {boolean} isVisible True if both wrists meet visibility requirements.
 */

export class BarbellRadar {
  /**
   * @param {Object} [options]
   * @param {number} [options.tiltThreshold=2.0] Maximum tilt tolerance to be considered level (degrees).
   * @param {number} [options.bufferSize=90] Size of the trajectory ring buffer.
   * @param {number} [options.minVisibility=0.35] Minimum confidence for wrist detection.
   * @param {number} [options.smoothingAlpha=0.30] EMA smoothing factor for angle stabilization.
   */
  constructor(options = {}) {
    this.tiltThreshold = options.tiltThreshold !== undefined ? options.tiltThreshold : 2.0;
    this.bufferSize = options.bufferSize !== undefined ? options.bufferSize : 90;
    this.minVisibility = options.minVisibility !== undefined ? options.minVisibility : 0.35;
    this.smoothingAlpha = options.smoothingAlpha !== undefined ? options.smoothingAlpha : 0.30;

    /** @type {number} Temporally smoothed tilt angle in degrees */
    this.smoothedTilt = 0;
    /** @type {boolean} True if first valid frame has been processed */
    this.hasReading = false;

    // Pre-allocated flat Float32Arrays for 90-frame ring buffer (zero GC overhead)
    this.ringBufferX = new Float32Array(this.bufferSize);
    this.ringBufferY = new Float32Array(this.bufferSize);
    this.ringBufferTime = new Float64Array(this.bufferSize);
    this.bufferHead = 0;
    this.bufferCount = 0;

    // Anchor X position of initial vertical descent plane
    this.descentAnchorX = null;
    this.maxDriftX = 0;

    // Pre-allocated reusable object pool for pathHistory output to prevent frame-by-frame GC allocations
    this._reusableHistory = new Array(this.bufferSize);
    for (let i = 0; i < this.bufferSize; i++) {
      this._reusableHistory[i] = { x: 0, y: 0, timestamp: 0 };
    }
  }

  /**
   * Analyzes collinear barbell alignment, horizontal tilt angle, and trajectory drift.
   * 
   * @param {WristPoint|null} leftWrist Landmark 15.
   * @param {WristPoint|null} rightWrist Landmark 16.
   * @param {number} [frameTimestamp=0] Current frame timestamp (performance.now()).
   * @returns {BarbellRadarResult}
   */
  analyzeBar(leftWrist, rightWrist, frameTimestamp = performance.now()) {
    if (!leftWrist || !rightWrist) {
      return this._createFallbackResult(leftWrist, rightWrist);
    }

    const leftVis = leftWrist.visibility !== undefined ? leftWrist.visibility : 1.0;
    const rightVis = rightWrist.visibility !== undefined ? rightWrist.visibility : 1.0;

    if (leftVis < this.minVisibility || rightVis < this.minVisibility) {
      return this._createFallbackResult(leftWrist, rightWrist);
    }

    // 1. Midpoint calculation: X_m = (X_L + X_R) / 2, Y_m = (Y_L + Y_R) / 2
    const midX = (leftWrist.x + rightWrist.x) * 0.5;
    const midY = (leftWrist.y + rightWrist.y) * 0.5;

    // 2. Collinear delta vectors
    const dx = rightWrist.x - leftWrist.x;
    const dy = rightWrist.y - leftWrist.y;
    const barLength = Math.hypot(dx, dy);

    if (barLength < 0.001) {
      return this._createFallbackResult(leftWrist, rightWrist);
    }

    // 3. Angular tilt in degrees: theta = arctan2(Y_R - Y_L, X_R - X_L) * (180 / PI)
    // In screen coordinates: Y increases downwards.
    // If right wrist drops lower than left: dy > 0 => theta > 0 (Right Down / Tilted Right).
    // If left wrist drops lower than right: dy < 0 => theta < 0 (Left Down / Tilted Left).
    const rawTiltRad = Math.atan2(dy, dx);
    const rawTiltDeg = (rawTiltRad * 180) / Math.PI;

    // Apply Exponential Moving Average (EMA) smoothing for sub-pixel jitter reduction
    if (!this.hasReading) {
      this.smoothedTilt = rawTiltDeg;
      this.hasReading = true;
    } else {
      const alpha = this.smoothingAlpha;
      this.smoothedTilt = (alpha * rawTiltDeg) + ((1.0 - alpha) * this.smoothedTilt);
    }

    const tiltDeg = Math.round(this.smoothedTilt * 10) / 10;
    const isLevel = Math.abs(this.smoothedTilt) <= this.tiltThreshold;

    // 4. Update 90-frame ring buffer of midpoint coordinates
    const head = this.bufferHead;
    this.ringBufferX[head] = midX;
    this.ringBufferY[head] = midY;
    this.ringBufferTime[head] = frameTimestamp;

    this.bufferHead = (head + 1) % this.bufferSize;
    if (this.bufferCount < this.bufferSize) {
      this.bufferCount++;
    }

    // 5. Horizontal drift computation from vertical descent plane
    if (this.descentAnchorX === null) {
      this.descentAnchorX = midX;
    }

    const currentDeviation = Math.abs(midX - this.descentAnchorX);
    if (currentDeviation > this.maxDriftX) {
      this.maxDriftX = currentDeviation;
    }

    // Ratio of maximum drift relative to total bar span
    const driftRatio = barLength > 0 ? (this.maxDriftX / barLength) : 0;

    // 6. Build chronological pathHistory using pre-allocated reusable objects (zero GC)
    const history = [];
    const count = this.bufferCount;
    const startIdx = (this.bufferHead - count + this.bufferSize) % this.bufferSize;

    for (let i = 0; i < count; i++) {
      const idx = (startIdx + i) % this.bufferSize;
      const point = this._reusableHistory[i];
      point.x = this.ringBufferX[idx];
      point.y = this.ringBufferY[idx];
      point.timestamp = this.ringBufferTime[idx];
      history.push(point);
    }

    return {
      barMidpoint: { x: midX, y: midY },
      tiltDeg,
      isLevel,
      driftRatio: Math.round(driftRatio * 1000) / 1000,
      pathHistory: history,
      leftWrist,
      rightWrist,
      barLength,
      isVisible: true
    };
  }

  /**
   * Resets vertical descent anchor for a new repetition.
   * @param {number|null} [newAnchorX=null]
   */
  resetAnchor(newAnchorX = null) {
    this.descentAnchorX = newAnchorX;
    this.maxDriftX = 0;
  }

  /**
   * Clears ring buffer history and temporal smoothing state.
   */
  reset() {
    this.smoothedTilt = 0;
    this.hasReading = false;
    this.bufferHead = 0;
    this.bufferCount = 0;
    this.descentAnchorX = null;
    this.maxDriftX = 0;
  }

  /**
   * Fallback result when wrists are not visible.
   * @private
   */
  _createFallbackResult(leftWrist, rightWrist) {
    return {
      barMidpoint: { x: 0.5, y: 0.5 },
      tiltDeg: 0,
      isLevel: true,
      driftRatio: 0,
      pathHistory: [],
      leftWrist: leftWrist || null,
      rightWrist: rightWrist || null,
      barLength: 0,
      isVisible: false
    };
  }
}
