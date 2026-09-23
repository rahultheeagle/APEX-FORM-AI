/**
 * @fileoverview Layer 1: Dynamic Virtual Gimbal (Auto-Zoom Cameraman).
 * Continuously tracks the athlete's spatial bounding box, dynamically calculates optimal
 * digital framing with 20% margin, and applies smooth Exponential Moving Average (EMA)
 * scale and pan transformations to keep the lifter centered and prominent on screen.
 */

export class VirtualGimbal {
  /**
   * @param {Object} [options]
   * @param {number} [options.alpha=0.08] EMA smoothing factor (0.05-0.12 prevents camera jitter).
   * @param {number} [options.padding=0.20] Relative margin around visible body bounding box (20%).
   * @param {number} [options.minScale=1.00] Minimum zoom scale (full wide-angle frame).
   * @param {number} [options.maxScale=2.50] Maximum zoom scale to prevent extreme pixelation/clipping.
   */
  constructor(options = {}) {
    /** @type {number} */
    this.alpha = options.alpha !== undefined ? options.alpha : 0.08;
    /** @type {number} */
    this.padding = options.padding !== undefined ? options.padding : 0.20;
    /** @type {number} */
    this.minScale = options.minScale || 1.0;
    /** @type {number} */
    this.maxScale = options.maxScale || 2.5;

    /** @type {number} Current smoothed zoom scale */
    this.currentScale = 1.0;
    /** @type {number|null} Current smoothed center X in canvas pixels */
    this.currentCenterX = null;
    /** @type {number|null} Current smoothed center Y in canvas pixels */
    this.currentCenterY = null;

    /** @type {number} Canvas horizontal translation */
    this.currentOffsetX = 0;
    /** @type {number} Canvas vertical translation */
    this.currentOffsetY = 0;

    /** @type {boolean} */
    this.hasInitialized = false;
  }

  /**
   * Calculates smoothed scale and offset parameters enclosing the visible athlete.
   * 
   * @param {Array<{ x: number, y: number, z?: number, visibility?: number }>} landmarks MediaPipe pose landmarks.
   * @param {number} canvasWidth Logical canvas width in pixels.
   * @param {number} canvasHeight Logical canvas height in pixels.
   * @returns {{ scale: number, offsetX: number, offsetY: number }} Transform parameters.
   */
  calculateViewport(landmarks, canvasWidth, canvasHeight) {
    if (!canvasWidth || !canvasHeight || canvasWidth <= 0 || canvasHeight <= 0) {
      return { scale: 1.0, offsetX: 0, offsetY: 0 };
    }

    const defaultCenterX = canvasWidth / 2;
    const defaultCenterY = canvasHeight / 2;

    // Graceful fallback to standard full-frame if no landmarks
    if (!landmarks || landmarks.length === 0) {
      return this._smoothTowards(1.0, defaultCenterX, defaultCenterY, canvasWidth, canvasHeight);
    }

    // Filter landmarks with adequate detection confidence
    let minX = 1.0;
    let maxX = 0.0;
    let minY = 1.0;
    let maxY = 0.0;
    let visibleCount = 0;

    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (!lm) continue;

      // MediaPipe landmarks: check visibility threshold
      const isVisible = lm.visibility === undefined || lm.visibility > 0.35;
      if (isVisible) {
        if (lm.x < minX) minX = lm.x;
        if (lm.x > maxX) maxX = lm.x;
        if (lm.y < minY) minY = lm.y;
        if (lm.y > maxY) maxY = lm.y;
        visibleCount++;
      }
    }

    // If fewer than 4 visible joints, decay smoothly to standard full-frame
    if (visibleCount < 4 || minX >= maxX || minY >= maxY) {
      return this._smoothTowards(1.0, defaultCenterX, defaultCenterY, canvasWidth, canvasHeight);
    }

    // Clamp normalized bounds
    minX = Math.max(0.0, Math.min(1.0, minX));
    maxX = Math.max(0.0, Math.min(1.0, maxX));
    minY = Math.max(0.0, Math.min(1.0, minY));
    maxY = Math.max(0.0, Math.min(1.0, maxY));

    // Convert to pixel dimensions
    const boxW = (maxX - minX) * canvasWidth;
    const boxH = (maxY - minY) * canvasHeight;
    const targetCenterX = ((minX + maxX) / 2) * canvasWidth;
    const targetCenterY = ((minY + maxY) / 2) * canvasHeight;

    // Apply 20% margin around the minimal bounding box
    const paddedW = Math.max(60, boxW * (1 + (2 * this.padding)));
    const paddedH = Math.max(60, boxH * (1 + (2 * this.padding)));

    // Determine target scale constrained by viewport dimensions
    const scaleX = canvasWidth / paddedW;
    const scaleY = canvasHeight / paddedH;
    let targetScale = Math.min(scaleX, scaleY);

    // Clamp zoom scale between minScale and maxScale
    targetScale = Math.max(this.minScale, Math.min(this.maxScale, targetScale));

    return this._smoothTowards(targetScale, targetCenterX, targetCenterY, canvasWidth, canvasHeight);
  }

  /**
   * Applies Exponential Moving Average (EMA) to prevent camera jitter.
   * 
   * @param {number} targetScale
   * @param {number} targetCenterX
   * @param {number} targetCenterY
   * @param {number} canvasWidth
   * @param {number} canvasHeight
   * @returns {{ scale: number, offsetX: number, offsetY: number }}
   * @private
   */
  _smoothTowards(targetScale, targetCenterX, targetCenterY, canvasWidth, canvasHeight) {
    if (!this.hasInitialized || this.currentCenterX === null || this.currentCenterY === null) {
      this.currentScale = targetScale;
      this.currentCenterX = targetCenterX;
      this.currentCenterY = targetCenterY;
      this.hasInitialized = true;
    } else {
      this.currentScale = (this.currentScale * (1 - this.alpha)) + (targetScale * this.alpha);
      this.currentCenterX = (this.currentCenterX * (1 - this.alpha)) + (targetCenterX * this.alpha);
      this.currentCenterY = (this.currentCenterY * (1 - this.alpha)) + (targetCenterY * this.alpha);
    }

    // Offset coordinates to place smoothed athlete center at the viewport center
    const centerScreenX = canvasWidth / 2;
    const centerScreenY = canvasHeight / 2;

    this.currentOffsetX = centerScreenX - (this.currentCenterX * this.currentScale);
    this.currentOffsetY = centerScreenY - (this.currentCenterY * this.currentScale);

    return {
      scale: this.currentScale,
      offsetX: this.currentOffsetX,
      offsetY: this.currentOffsetY
    };
  }

  /**
   * Applies canvas scale and translation so the lifter remains centered and magnified.
   * 
   * @param {CanvasRenderingContext2D} ctx Canvas rendering context.
   */
  applyTransform(ctx) {
    if (!ctx) return;
    ctx.save();
    ctx.translate(this.currentOffsetX, this.currentOffsetY);
    ctx.scale(this.currentScale, this.currentScale);
  }

  /**
   * Restores canvas transform matrix to pre-gimbal state.
   * 
   * @param {CanvasRenderingContext2D} ctx Canvas rendering context.
   */
  resetTransform(ctx) {
    if (!ctx) return;
    ctx.restore();
  }

  /**
   * Resets gimbal smoothing state and restores identity scale.
   */
  reset() {
    this.currentScale = 1.0;
    this.currentCenterX = null;
    this.currentCenterY = null;
    this.currentOffsetX = 0;
    this.currentOffsetY = 0;
    this.hasInitialized = false;
  }
}
