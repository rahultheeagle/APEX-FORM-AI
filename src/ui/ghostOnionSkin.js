/**
 * @fileoverview Layer 3: Multi-Rep Ghost Onion-Skinning Engine.
 * Caches normalized keyframe landmark vectors from the baseline form of Rep 1,
 * and interpolates a translucent ghost skeleton matching subsequent repetitions' phase progress.
 */

/**
 * @typedef {Object} LandmarkPoint
 * @property {number} x
 * @property {number} y
 * @property {number} [z]
 * @property {number} [visibility]
 */

/**
 * @typedef {Object} BaselineKeyframe
 * @property {number} progress Repetition progress ratio [0.0 - 1.0].
 * @property {Float32Array} data Packed array of 33 landmarks [x0, y0, z0, vis0, ...].
 */

export class GhostOnionSkin {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxKeyframes=64] Maximum keyframes sampled during baseline rep.
   */
  constructor(options = {}) {
    this.maxKeyframes = options.maxKeyframes || 64;

    /** @type {Array<BaselineKeyframe>} Cached baseline keyframes from Rep 1 */
    this.baselineKeyframes = [];

    /** @type {boolean} True if baseline Rep 1 is finalized and ready for onion-skinning */
    this.baselineReady = false;

    // Pre-allocated object pool of 33 landmarks to prevent per-frame GC allocations at 60 FPS
    this._ghostPool = new Array(33);
    for (let i = 0; i < 33; i++) {
      this._ghostPool[i] = { x: 0, y: 0, z: 0, visibility: 0.8 };
    }
  }

  /**
   * Ingests a frame during the baseline repetition (Rep 1) sampled at the given phase progress.
   * 
   * @param {number} repIndex Current repetition count (must be 1 for baseline).
   * @param {Array<LandmarkPoint>} landmarks 33 MediaPipe pose landmarks.
   * @param {number} [phaseProgress=0] Repetition phase progress [0.0 - 1.0].
   */
  recordBaselineSample(repIndex, landmarks, phaseProgress = 0) {
    if (repIndex !== 1 || this.baselineReady || !landmarks || landmarks.length < 25) {
      return;
    }

    if (this.baselineKeyframes.length >= this.maxKeyframes) {
      return;
    }

    const data = new Float32Array(33 * 4);
    for (let i = 0; i < Math.min(33, landmarks.length); i++) {
      const lm = landmarks[i];
      const offset = i * 4;
      data[offset] = lm.x;
      data[offset + 1] = lm.y;
      data[offset + 2] = lm.z || 0;
      data[offset + 3] = lm.visibility !== undefined ? lm.visibility : 0.9;
    }

    const progClamped = Math.max(0.0, Math.min(1.0, phaseProgress));
    this.baselineKeyframes.push({ progress: progClamped, data });
  }

  /**
   * Finalizes the captured keyframe set after Rep 1 completes.
   * Sorts keyframes by progress and activates the onion-skin overlay.
   */
  finalizeBaseline() {
    if (this.baselineKeyframes.length < 2) {
      return;
    }

    // Sort chronologically by progress
    this.baselineKeyframes.sort((a, b) => a.progress - b.progress);
    this.baselineReady = true;
  }

  /**
   * Captures baseline from a pre-recorded array of frames upon Rep 1 completion.
   * 
   * @param {number} repIndex Must be 1.
   * @param {Array<{ progress: number, landmarks: Array<LandmarkPoint> }>} landmarkFrames
   */
  captureBaselineRep(repIndex, landmarkFrames) {
    if (repIndex !== 1 || !Array.isArray(landmarkFrames) || landmarkFrames.length === 0) {
      return;
    }

    this.baselineKeyframes = [];
    for (let i = 0; i < landmarkFrames.length; i++) {
      const frame = landmarkFrames[i];
      if (frame && frame.landmarks) {
        this.recordBaselineSample(1, frame.landmarks, frame.progress !== undefined ? frame.progress : (i / (landmarkFrames.length - 1)));
      }
    }
    this.finalizeBaseline();
  }

  /**
   * Interpolates cached baseline vectors to match current repetition phase percentage.
   * 
   * @param {number} phaseProgress Current repetition progress [0.0 - 1.0].
   * @returns {Array<LandmarkPoint>|null} Normalized ghost skeleton coordinates.
   */
  getGhostFrame(phaseProgress) {
    if (!this.baselineReady || this.baselineKeyframes.length === 0) {
      return null;
    }

    const p = Math.max(0.0, Math.min(1.0, phaseProgress));
    const kfs = this.baselineKeyframes;
    const count = kfs.length;

    // Edge cases
    if (p <= kfs[0].progress) {
      return this._fillPoolFromData(kfs[0].data);
    }
    if (p >= kfs[count - 1].progress) {
      return this._fillPoolFromData(kfs[count - 1].data);
    }

    // Binary search for surrounding keyframes
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (kfs[mid].progress <= p) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const idxA = Math.max(0, high);
    const idxB = Math.min(count - 1, low);

    const kfA = kfs[idxA];
    const kfB = kfs[idxB];

    if (idxA === idxB || kfA.progress === kfB.progress) {
      return this._fillPoolFromData(kfA.data);
    }

    const t = Math.max(0.0, Math.min(1.0, (p - kfA.progress) / (kfB.progress - kfA.progress)));
    const dataA = kfA.data;
    const dataB = kfB.data;

    for (let i = 0; i < 33; i++) {
      const offset = i * 4;
      const pt = this._ghostPool[i];
      pt.x = dataA[offset] + t * (dataB[offset] - dataA[offset]);
      pt.y = dataA[offset + 1] + t * (dataB[offset + 1] - dataA[offset + 1]);
      pt.z = dataA[offset + 2] + t * (dataB[offset + 2] - dataA[offset + 2]);
      pt.visibility = dataA[offset + 3] + t * (dataB[offset + 3] - dataA[offset + 3]);
    }

    return this._ghostPool;
  }

  /**
   * Fills reusable pool from packed Float32Array.
   * @private
   */
  _fillPoolFromData(data) {
    for (let i = 0; i < 33; i++) {
      const offset = i * 4;
      const pt = this._ghostPool[i];
      pt.x = data[offset];
      pt.y = data[offset + 1];
      pt.z = data[offset + 2];
      pt.visibility = data[offset + 3];
    }
    return this._ghostPool;
  }

  /**
   * Returns true if Rep 1 baseline is cached and ready.
   * @returns {boolean}
   */
  hasBaseline() {
    return this.baselineReady;
  }

  /**
   * Resets all cached keyframes and baseline state.
   */
  reset() {
    this.baselineKeyframes = [];
    this.baselineReady = false;
  }
}
