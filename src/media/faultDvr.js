/**
 * @fileoverview Layer 3 (Media): In-Memory Slow-Motion Fault DVR.
 * Maintains a 90-frame circular FIFO ring buffer capturing visual ImageBitmaps
 * and kinematic telemetry. On form fault detection, triggers 0.25x (15 FPS) slow-mo replay
 * with guaranteed zero-leak GPU memory management via bitmap.close().
 */

export class FaultDvr {
  /**
   * @param {Object} [options]
   * @param {number} [options.capacity=90] Buffer frame capacity (1.5 seconds @ 60 FPS).
   * @param {number} [options.replayFps=15] Slow-motion playback frame rate (0.25x of 60 FPS).
   * @param {number} [options.snapshotWidth=320] PiP snapshot width for low GPU overhead.
   * @param {number} [options.snapshotHeight=240] PiP snapshot height for low GPU overhead.
   */
  constructor(options = {}) {
    this.capacity = options.capacity || 90;
    this.replayFps = options.replayFps || 15;
    this.frameDurationMs = 1000 / this.replayFps; // ~66.67ms per frame at 15 FPS
    this.snapshotWidth = options.snapshotWidth || 320;
    this.snapshotHeight = options.snapshotHeight || 240;

    /** @type {Array<{ bitmap: ImageBitmap|null, telemetry: any, timestamp: number }>} Ring buffer */
    this.buffer = [];

    /** @type {Array<{ bitmap: ImageBitmap|null, telemetry: any, timestamp: number }>} Frozen replay sequence */
    this.replayQueue = [];

    /** @type {boolean} True if currently replaying a fault */
    this.isReplaying = false;
    this.replayStartTime = 0;
    this.replayIndex = 0;
    this._isCapturing = false;

    // Offscreen canvas fallback if createImageBitmap options aren't fully supported
    this._offscreenCanvas = null;
    this._offscreenCtx = null;
    if (typeof document !== 'undefined') {
      this._offscreenCanvas = document.createElement('canvas');
      this._offscreenCanvas.width = this.snapshotWidth;
      this._offscreenCanvas.height = this.snapshotHeight;
      this._offscreenCtx = this._offscreenCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
    }
  }

  /**
   * Pushes a frame from the live canvas into the circular ring buffer.
   * Evicts and closes the oldest ImageBitmap when capacity exceeds 90 frames.
   * 
   * @param {HTMLCanvasElement|HTMLVideoElement} canvasSource Live source canvas.
   * @param {any} [telemetry=null] Associated kinematic fault vectors/landmarks.
   */
  pushFrame(canvasSource, telemetry = null) {
    if (!canvasSource) return;

    // Evict oldest frame if at or exceeding capacity
    if (this.buffer.length >= this.capacity) {
      const oldest = this.buffer.shift();
      if (oldest && oldest.bitmap && typeof oldest.bitmap.close === 'function') {
        try {
          oldest.bitmap.close();
        } catch (e) {}
      }
    }

    const frameEntry = {
      bitmap: null,
      telemetry: telemetry ? JSON.parse(JSON.stringify(telemetry)) : null,
      timestamp: performance.now()
    };
    this.buffer.push(frameEntry);

    // Asynchronously create low-overhead downscaled ImageBitmap to prevent main thread frame drops
    if (typeof createImageBitmap === 'function' && !this._isCapturing) {
      this._isCapturing = true;
      const opts = {
        resizeWidth: this.snapshotWidth,
        resizeHeight: this.snapshotHeight,
        resizeQuality: 'low'
      };

      createImageBitmap(canvasSource, opts)
        .then((bitmap) => {
          // If frame was evicted while bitmap was decoding, close it immediately
          if (!this.buffer.includes(frameEntry) && !this.replayQueue.includes(frameEntry)) {
            bitmap.close();
          } else {
            frameEntry.bitmap = bitmap;
          }
        })
        .catch(() => {
          // Fallback to quick offscreen canvas draw if createImageBitmap with options fails
          if (this._offscreenCtx && canvasSource.width && canvasSource.height) {
            try {
              this._offscreenCtx.drawImage(canvasSource, 0, 0, this.snapshotWidth, this.snapshotHeight);
              createImageBitmap(this._offscreenCanvas).then((bm) => {
                if (!this.buffer.includes(frameEntry)) {
                  bm.close();
                } else {
                  frameEntry.bitmap = bm;
                }
              }).catch(() => {});
            } catch (e) {}
          }
        })
        .finally(() => {
          this._isCapturing = false;
        });
    }
  }

  /**
   * Triggers slow-motion replay of the captured 90 frames at 0.25x speed (15 FPS).
   * 
   * @returns {Array<{ bitmap: ImageBitmap|null, telemetry: any, timestamp: number }>} Buffered frames.
   */
  triggerReplay() {
    if (this.buffer.length === 0) {
      return [];
    }

    // Clone references to the current buffer
    this.replayQueue = [...this.buffer];
    this.isReplaying = true;
    this.replayStartTime = performance.now();
    this.replayIndex = 0;

    return this.replayQueue;
  }

  /**
   * Samples the active replay frame corresponding to the current timestamp.
   * Advances through the 90 frames at 15 FPS (0.25x slow motion).
   * 
   * @param {number} [now=performance.now()] High-resolution timestamp.
   * @returns {{ bitmap: ImageBitmap|null, telemetry: any, frameIndex: number, totalFrames: number, progress: number, isComplete: boolean }|null}
   */
  getCurrentReplayFrame(now = performance.now()) {
    if (!this.isReplaying || this.replayQueue.length === 0) {
      return null;
    }

    const elapsedMs = now - this.replayStartTime;
    const frameIdx = Math.floor(elapsedMs / this.frameDurationMs);

    if (frameIdx >= this.replayQueue.length) {
      // Replay completed (looped or stopped)
      this.isReplaying = false;
      this.replayIndex = this.replayQueue.length - 1;
      return null;
    }

    this.replayIndex = frameIdx;
    const current = this.replayQueue[frameIdx];

    return {
      bitmap: current ? current.bitmap : null,
      telemetry: current ? current.telemetry : null,
      frameIndex: frameIdx + 1,
      totalFrames: this.replayQueue.length,
      progress: (frameIdx + 1) / this.replayQueue.length,
      isComplete: frameIdx >= this.replayQueue.length - 1
    };
  }

  /**
   * Stops active slow-motion replay.
   */
  stopReplay() {
    this.isReplaying = false;
    this.replayQueue = [];
  }

  /**
   * Clears ring buffer and explicitly closes all ImageBitmaps to free GPU memory.
   */
  clear() {
    this.stopReplay();
    for (let i = 0; i < this.buffer.length; i++) {
      const entry = this.buffer[i];
      if (entry && entry.bitmap && typeof entry.bitmap.close === 'function') {
        try {
          entry.bitmap.close();
        } catch (e) {}
      }
    }
    this.buffer = [];
  }

  /**
   * Destroys DVR resources.
   */
  destroy() {
    this.clear();
    this._offscreenCanvas = null;
    this._offscreenCtx = null;
  }
}
