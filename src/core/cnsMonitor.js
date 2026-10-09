/**
 * @fileoverview Central Nervous System (CNS) Neuromuscular Tremor Monitor.
 * Maintains a 128-sample sliding ring buffer of wrist midpoint displacement deltas
 * and periodically offloads spectral FFT computations to a dedicated Web Worker via zero-copy ArrayBuffer transfer.
 */

export class CnsMonitor {
  /**
   * @param {Object} [options]
   * @param {number} [options.windowSize=128] FFT sample window length (Radix-2, power of 2).
   * @param {number} [options.dispatchInterval=15] Frame interval between worker spectral evaluations.
   */
  constructor(options = {}) {
    this.windowSize = options.windowSize || 128;
    this.dispatchInterval = options.dispatchInterval || 15;

    // 128-frame ring buffer of wrist midpoint displacement deltas
    this.ringBuffer = new Float32Array(this.windowSize);
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.frameCounter = 0;

    this.lastWristY = null;
    this.lastWristX = null;

    /** @type {number} Current physiological tremor ratio (8-12 Hz power vs baseline) */
    this.tremorRatio = 1.0;

    /** @type {boolean} Neuromuscular fatigue indication */
    this.isFatigued = false;

    /** @type {string} Status string: STABLE, ELEVATED, NEURAL_BREAKDOWN */
    this.status = 'STABLE';

    /** @type {boolean} Worker operational status */
    this.isWorkerActive = false;

    /** @type {Worker|null} */
    this.worker = null;

    // Buffer pool for zero-GC transferable message exchanges
    this.bufferPool = [
      new Float32Array(this.windowSize),
      new Float32Array(this.windowSize)
    ];

    this._initWorker();
  }

  /**
   * Initializes off-thread tremor analysis Web Worker.
   * @private
   */
  _initWorker() {
    try {
      if (typeof Worker !== 'undefined') {
        // Attempt ESM module worker first, fallback to standard worker path
        try {
          this.worker = new Worker(new URL('../workers/tremorWorker.js', import.meta.url), { type: 'module' });
        } catch (_) {
          this.worker = new Worker('./src/workers/tremorWorker.js');
        }

        this.worker.onmessage = (e) => {
          if (!e.data) return;
          const { tremorRatio, isFatigued, buffer } = e.data;

          if (typeof tremorRatio === 'number') {
            this.tremorRatio = tremorRatio;
            this.isFatigued = Boolean(isFatigued);
            this.status = this.tremorRatio > 3.5
              ? 'NEURAL_BREAKDOWN'
              : (this.tremorRatio >= 2.0 ? 'ELEVATED' : 'STABLE');
          }

          // Return transferable buffer to pool to ensure zero garbage collection
          if (buffer && buffer instanceof Float32Array) {
            this.bufferPool.push(buffer);
          }
        };

        this.worker.onerror = (err) => {
          console.warn('CnsMonitor: Worker error encountered, falling back to local computation:', err);
          this.isWorkerActive = false;
        };

        this.isWorkerActive = true;
      }
    } catch (e) {
      console.warn('CnsMonitor: Web Worker instantiation unavailable:', e);
      this.isWorkerActive = false;
    }
  }

  /**
   * Ingests latest wrist midpoint coordinate, updates the 128-sample ring buffer,
   * and triggers worker dispatch every 15 frames.
   *
   * @param {{ x: number, y: number }|null} wristMidpoint Normalized midpoint coordinate.
   * @param {number} [now=performance.now()] Timestamp.
   * @returns {{ tremorRatio: number, isFatigued: boolean, status: string }}
   */
  update(wristMidpoint, now = performance.now()) {
    if (!wristMidpoint || typeof wristMidpoint.y !== 'number') {
      return this.getNeurologicalStatus();
    }

    const currentY = wristMidpoint.y;
    let deltaY = 0.0;

    if (this.lastWristY !== null) {
      deltaY = currentY - this.lastWristY;
    }
    this.lastWristY = currentY;

    // Push into ring buffer
    this.ringBuffer[this.writeIndex] = deltaY;
    this.writeIndex = (this.writeIndex + 1) & (this.windowSize - 1);
    this.sampleCount++;
    this.frameCounter++;

    // Periodically dispatch buffer to worker every 15 frames
    if (this.frameCounter >= this.dispatchInterval && this.sampleCount >= 64) {
      this.frameCounter = 0;
      this._dispatchToWorker();
    }

    return this.getNeurologicalStatus();
  }

  /**
   * Helper that extracts wrist midpoint from 33 MediaPipe landmarks and updates CNS monitor.
   *
   * @param {Array<{ x: number, y: number }>} landmarks MediaPipe pose landmarks.
   * @param {number} [now=performance.now()]
   * @returns {{ tremorRatio: number, isFatigued: boolean, status: string }}
   */
  updateFromLandmarks(landmarks, now = performance.now()) {
    if (!landmarks || landmarks.length < 17) {
      return this.getNeurologicalStatus();
    }

    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];

    if (leftWrist && rightWrist) {
      const midpoint = {
        x: (leftWrist.x + rightWrist.x) * 0.5,
        y: (leftWrist.y + rightWrist.y) * 0.5
      };
      return this.update(midpoint, now);
    } else if (leftWrist) {
      return this.update(leftWrist, now);
    } else if (rightWrist) {
      return this.update(rightWrist, now);
    }

    return this.getNeurologicalStatus();
  }

  /**
   * Unrolls 128-sample ring buffer and dispatches to worker via zero-copy ArrayBuffer transfer.
   * @private
   */
  _dispatchToWorker() {
    // Acquire a buffer from pool or allocate if pool is temporarily depleted
    const transferBuffer = this.bufferPool.length > 0
      ? this.bufferPool.pop()
      : new Float32Array(this.windowSize);

    // Unroll ring buffer in chronological order
    const startIdx = (this.writeIndex - this.windowSize) & (this.windowSize - 1);
    for (let i = 0; i < this.windowSize; i++) {
      transferBuffer[i] = this.ringBuffer[(startIdx + i) & (this.windowSize - 1)];
    }

    if (this.isWorkerActive && this.worker) {
      try {
        // Zero-copy transfer: transfer ArrayBuffer ownership directly to worker
        this.worker.postMessage({ buffer: transferBuffer }, [transferBuffer.buffer]);
      } catch (postErr) {
        // Fallback: put back into pool and run in-line
        this.bufferPool.push(transferBuffer);
        this._runFallbackAnalysis(transferBuffer);
      }
    } else {
      // In-line fallback calculation if worker is disabled
      this._runFallbackAnalysis(transferBuffer);
      this.bufferPool.push(transferBuffer);
    }
  }

  /**
   * In-line fallback spectral analysis if Web Worker is restricted.
   * @private
   */
  _runFallbackAnalysis(input) {
    let sum = 0.0;
    for (let i = 0; i < this.windowSize; i++) {
      sum += Math.abs(input[i]);
    }
    const meanMag = sum / this.windowSize;

    // Approximate ratio from high-frequency energy ratio
    let diffSum = 0.0;
    for (let i = 1; i < this.windowSize; i++) {
      diffSum += Math.abs(input[i] - input[i - 1]);
    }
    const hfRatio = (diffSum / (meanMag * this.windowSize + 1e-6));
    const normalizedRatio = Math.max(0.8, Math.min(6.0, hfRatio * 0.75));

    this.tremorRatio = Number(normalizedRatio.toFixed(2));
    this.isFatigued = this.tremorRatio > 3.5;
    this.status = this.tremorRatio > 3.5
      ? 'NEURAL_BREAKDOWN'
      : (this.tremorRatio >= 2.0 ? 'ELEVATED' : 'STABLE');
  }

  /**
   * Returns current neurological status and tremor index.
   *
   * @returns {{
   *   tremorRatio: number,
   *   isFatigued: boolean,
   *   status: string,
   *   tremorIndex: number,
   *   displayLabel: string
   * }}
   */
  getNeurologicalStatus() {
    let displayLabel = `CNS: ${this.tremorRatio.toFixed(1)}x [STABLE]`;
    if (this.status === 'NEURAL_BREAKDOWN') {
      displayLabel = `⚠️ CNS: ${this.tremorRatio.toFixed(1)}x [NEURAL BREAKDOWN]`;
    } else if (this.status === 'ELEVATED') {
      displayLabel = `⚡ CNS: ${this.tremorRatio.toFixed(1)}x [ELEVATED]`;
    }

    return {
      tremorRatio: this.tremorRatio,
      isFatigued: this.isFatigued,
      status: this.status,
      tremorIndex: this.tremorRatio,
      displayLabel
    };
  }

  /**
   * Resets temporal buffers for set initiation or exercise changes.
   */
  reset() {
    this.ringBuffer.fill(0);
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.frameCounter = 0;
    this.lastWristY = null;
    this.lastWristX = null;
    this.tremorRatio = 1.0;
    this.isFatigued = false;
    this.status = 'STABLE';
  }

  /**
   * Terminates background worker thread.
   */
  destroy() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isWorkerActive = false;
  }
}
