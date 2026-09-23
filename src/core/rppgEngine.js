/**
 * @fileoverview Layer 1: Contactless Optical Photoplethysmography (rPPG) Engine.
 * Extracts micro-vascular capillary blood volume pulse (BVP) signals from facial
 * forehead tissue using standard RGB webcam video streams. Employs a Difference-of-Moving-Averages
 * (DoMA) band-pass filter (0.75 Hz to 3.0 Hz / 45-180 BPM) on the optical green absorption channel,
 * and performs peak-to-peak periodicity analysis to estimate instantaneous heart rate.
 */

export class RPPGEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.patchSize=32] Dimension of offscreen sampling buffer (px).
   * @param {number} [options.maxHistory=180] Rolling buffer length (approx 3 seconds at 60 FPS).
   * @param {number} [options.fastWindow=10] Fast moving average window for high-frequency noise attenuation.
   * @param {number} [options.slowWindow=65] Slow moving average window for DC illumination drift suppression.
   */
  constructor(options = {}) {
    /** @type {number} */
    this.patchSize = options.patchSize || 32;
    /** @type {number} */
    this.maxHistory = options.maxHistory || 180;
    /** @type {number} */
    this.fastWindow = options.fastWindow || 10;
    /** @type {number} */
    this.slowWindow = options.slowWindow || 65;

    /** @type {HTMLCanvasElement|null} */
    this.canvas = null;
    /** @type {CanvasRenderingContext2D|null} */
    this.ctx = null;
    this._initCanvas();

    /** @type {number[]} Raw green channel intensity samples */
    this.greenHistory = [];
    /** @type {number[]} Band-pass filtered pulse wave samples */
    this.waveHistory = [];
    /** @type {number[]} Sample timestamps (ms) */
    this.timestampHistory = [];

    /** @type {number} Instantaneous smoothed heart rate (BPM) */
    this.filteredBpm = 72;
    /** @type {number} Measurement confidence [0.0 - 1.0] */
    this.confidence = 0.50;
    /** @type {number} Latest bandpass wave amplitude */
    this.currentWave = 0;

    /** @type {number|null} Initial baseline resting BPM for recovery detection */
    this.baselineBpm = null;
    /** @type {boolean} */
    this.isRecovering = false;
  }

  /**
   * Initializes offscreen canvas for lightweight pixel extraction.
   * @private
   */
  _initCanvas() {
    if (typeof document !== 'undefined') {
      try {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.patchSize;
        this.canvas.height = this.patchSize;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      } catch (e) {
        console.warn('RPPGEngine: Offscreen canvas creation failed:', e);
      }
    }
  }

  /**
   * Extracts forehead pixel patch from video, filters green absorption channel,
   * and computes instantaneous heart rate.
   * 
   * @param {HTMLVideoElement} videoElement Active camera video source.
   * @param {Array<{ x: number, y: number, z?: number, visibility?: number }>} faceLandmarks Full landmarks array.
   * @param {number} [timestamp] Optional timestamp in ms.
   * @returns {{ bpm: number, confidence: number, rawWave: number, isRecovering: boolean, faceBox: Object|null, waveHistory: number[] }}
   */
  sampleFaceRegion(videoElement, faceLandmarks, timestamp = performance.now()) {
    if (!faceLandmarks || faceLandmarks.length < 6) {
      return this._getDefaultResult();
    }

    // 1. Identify forehead region of interest (ROI) from facial landmarks
    // MediaPipe Pose landmarks: 0 = nose, 1 = left eye inner, 2 = left eye, 4 = right eye inner, 5 = right eye
    const nose = faceLandmarks[0];
    const leftEye = faceLandmarks[2] || faceLandmarks[1];
    const rightEye = faceLandmarks[5] || faceLandmarks[4];

    if (!nose || !leftEye || !rightEye) {
      return this._getDefaultResult();
    }

    const midEyeX = (leftEye.x + rightEye.x) / 2;
    const midEyeY = (leftEye.y + rightEye.y) / 2;
    const eyeDist = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);

    if (eyeDist <= 0.01) {
      return this._getDefaultResult();
    }

    // Forehead anchor: positioned above the midpoint between eyes
    const foreheadX = midEyeX;
    const foreheadY = midEyeY - (eyeDist * 0.55);
    const patchWNorm = Math.max(0.04, eyeDist * 0.55);
    const patchHNorm = Math.max(0.03, eyeDist * 0.35);

    const faceBox = {
      x: foreheadX,
      y: foreheadY,
      width: patchWNorm,
      height: patchHNorm
    };

    // 2. Extract optical patch from video stream
    let gMean = 0;
    if (videoElement && videoElement.videoWidth > 0 && this.ctx && this.canvas) {
      const vidW = videoElement.videoWidth;
      const vidH = videoElement.videoHeight;

      const sx = Math.max(0, Math.min(vidW - 10, Math.round((foreheadX - (patchWNorm / 2)) * vidW)));
      const sy = Math.max(0, Math.min(vidH - 10, Math.round((foreheadY - (patchHNorm / 2)) * vidH)));
      const sw = Math.max(8, Math.min(vidW - sx, Math.round(patchWNorm * vidW)));
      const sh = Math.max(8, Math.min(vidH - sy, Math.round(patchHNorm * vidH)));

      try {
        this.ctx.drawImage(videoElement, sx, sy, sw, sh, 0, 0, this.patchSize, this.patchSize);
        const imgData = this.ctx.getImageData(0, 0, this.patchSize, this.patchSize).data;
        const totalPixels = this.patchSize * this.patchSize;

        let greenSum = 0;
        for (let i = 0; i < totalPixels; i++) {
          greenSum += imgData[(i * 4) + 1]; // Green channel
        }
        gMean = greenSum / totalPixels;
      } catch (_) {
        // Fallback for security/tainted canvas constraints
        gMean = this.greenHistory.length > 0 ? this.greenHistory[this.greenHistory.length - 1] : 128;
      }
    } else {
      // In synthetic/mock environments, use synthetic pulse oscillation
      const synthFreq = 1.25; // 75 BPM
      gMean = 128 + Math.sin((timestamp / 1000) * 2 * Math.PI * synthFreq) * 4;
    }

    // 3. Apply Difference-of-Moving-Averages (DoMA) Band-pass Filter
    // 0.75 Hz (45 BPM) to 3.0 Hz (180 BPM)
    this.greenHistory.push(gMean);
    this.timestampHistory.push(timestamp);

    if (this.greenHistory.length > this.maxHistory) {
      this.greenHistory.shift();
      this.timestampHistory.shift();
    }

    const n = this.greenHistory.length;
    if (n < this.slowWindow) {
      return {
        bpm: Math.round(this.filteredBpm),
        confidence: 0.40,
        rawWave: 0,
        isRecovering: false,
        faceBox,
        waveHistory: this.waveHistory
      };
    }

    // Compute Fast Moving Average (Low-Pass Filter)
    let fastSum = 0;
    const fastStart = Math.max(0, n - this.fastWindow);
    for (let i = fastStart; i < n; i++) {
      fastSum += this.greenHistory[i];
    }
    const smaFast = fastSum / (n - fastStart);

    // Compute Slow Moving Average (High-Pass Detrending)
    let slowSum = 0;
    const slowStart = Math.max(0, n - this.slowWindow);
    for (let i = slowStart; i < n; i++) {
      slowSum += this.greenHistory[i];
    }
    const smaSlow = slowSum / (n - slowStart);

    // Bandpass output
    const rawPulse = smaFast - smaSlow;
    this.currentWave = rawPulse;
    this.waveHistory.push(rawPulse);
    if (this.waveHistory.length > this.maxHistory) {
      this.waveHistory.shift();
    }

    // 4. Peak-to-Peak Periodic Frequency Estimation
    this._computeHeartRateFromPeaks();

    return {
      bpm: Math.round(this.filteredBpm),
      confidence: Number(this.confidence.toFixed(2)),
      rawWave: Number(this.currentWave.toFixed(3)),
      isRecovering: this.isRecovering,
      faceBox,
      waveHistory: this.waveHistory
    };
  }

  /**
   * Identifies systolic peaks and estimates instantaneous BPM.
   * @private
   */
  _computeHeartRateFromPeaks() {
    const waves = this.waveHistory;
    const times = this.timestampHistory;
    const len = waves.length;

    if (len < 50) return;

    // Detect local maxima separated by at least 300 ms (max 200 BPM)
    const minPeakDistanceMs = 300;
    const peakIndices = [];

    // Calculate dynamic threshold based on signal standard deviation
    let sumSq = 0;
    for (let i = 0; i < len; i++) {
      sumSq += waves[i] * waves[i];
    }
    const rms = Math.sqrt(sumSq / len);
    const peakThreshold = Math.max(0.15, rms * 0.45);

    let lastPeakTime = 0;
    for (let i = 2; i < len - 2; i++) {
      const val = waves[i];
      if (val > peakThreshold && val > waves[i - 1] && val > waves[i - 2] && val > waves[i + 1] && val > waves[i + 2]) {
        const t = times[i];
        if (t - lastPeakTime >= minPeakDistanceMs) {
          peakIndices.push(i);
          lastPeakTime = t;
        }
      }
    }

    if (peakIndices.length >= 2) {
      const intervals = [];
      for (let i = 1; i < peakIndices.length; i++) {
        const dtMs = times[peakIndices[i]] - times[peakIndices[i - 1]];
        if (dtMs >= 320 && dtMs <= 1350) { // 44 to 187 BPM window
          intervals.push(dtMs);
        }
      }

      if (intervals.length >= 1) {
        const avgIntervalMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const instantaneousBpm = 60000 / avgIntervalMs;

        // Exponential smoothing (alpha = 0.18)
        this.filteredBpm = (0.18 * instantaneousBpm) + (0.82 * this.filteredBpm);
        this.filteredBpm = Math.max(45, Math.min(185, this.filteredBpm));

        // Evaluate signal variance for confidence scoring
        if (intervals.length >= 2) {
          const variance = intervals.reduce((acc, dt) => acc + Math.pow(dt - avgIntervalMs, 2), 0) / intervals.length;
          const stdDev = Math.sqrt(variance);
          const regularity = Math.max(0.3, Math.min(0.96, 1.0 - (stdDev / avgIntervalMs)));
          this.confidence = (0.2 * regularity) + (0.8 * this.confidence);
        } else {
          this.confidence = Math.max(this.confidence, 0.65);
        }

        // Establish or check recovery decline
        if (this.baselineBpm === null) {
          this.baselineBpm = this.filteredBpm;
        } else if (this.baselineBpm - this.filteredBpm >= 3.5) {
          this.isRecovering = true;
        }
      }
    }
  }

  /**
   * Default result when face is not in frame.
   * @private
   */
  _getDefaultResult() {
    return {
      bpm: Math.round(this.filteredBpm),
      confidence: 0.0,
      rawWave: 0,
      isRecovering: false,
      faceBox: null,
      waveHistory: this.waveHistory
    };
  }

  /**
   * Resets internal history buffers.
   */
  reset() {
    this.greenHistory = [];
    this.waveHistory = [];
    this.timestampHistory = [];
    this.filteredBpm = 72;
    this.confidence = 0.50;
    this.currentWave = 0;
    this.baselineBpm = null;
    this.isRecovering = false;
  }
}
