/**
 * @fileoverview Layer 4: Tendon Stretch-Shortening Cycle (SSC) Amortization Engine.
 * Measures time spent in the bottom turnaround inflection zone (|v_y| < 0.05 m/s),
 * evaluates muscular elasticity vs. dissipating grind, and rates explosive elastic recoil.
 */

/**
 * Elasticity classification categories.
 * @readonly
 * @enum {string}
 */
export const ElasticityRating = {
  HIGH_ELASTICITY: 'HIGH_ELASTICITY', // < 160 ms (Explosive recoil)
  MODERATE: 'MODERATE',               // 160 - 320 ms
  DISSIPATED: 'DISSIPATED',           // > 320 ms (Pure muscular grind)
  STANDBY: 'STANDBY'
};

/**
 * @typedef {Object} SscResult
 * @property {number} amortizationMs Amortization duration in milliseconds.
 * @property {string} elasticityRating Classification ('HIGH_ELASTICITY' | 'MODERATE' | 'DISSIPATED' | 'STANDBY').
 * @property {number} recoilScore Elastic recoil score [0 - 100].
 * @property {boolean} isAmortizing True while currently inside the inflection window.
 * @property {boolean} justCompleted True on the single frame where turnaround completed.
 * @property {string} displayLabel Formatted HUD label string.
 */

export class SscEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.velocityThreshold=0.05] Velocity boundary defining inflection zone (m/s).
   * @param {number} [options.highElasticityCutoffMs=160] Max ms for high elasticity.
   * @param {number} [options.moderateCutoffMs=320] Max ms for moderate elasticity.
   */
  constructor(options = {}) {
    this.velocityThreshold = options.velocityThreshold !== undefined ? options.velocityThreshold : 0.05;
    this.highElasticityCutoffMs = options.highElasticityCutoffMs !== undefined ? options.highElasticityCutoffMs : 160;
    this.moderateCutoffMs = options.moderateCutoffMs !== undefined ? options.moderateCutoffMs : 320;

    /** @type {'IDLE'|'DESCENT'|'AMORTIZATION'|'ASCENT'} Internal motion state */
    this.motionPhase = 'IDLE';

    /** @type {number|null} Timestamp when inflection window was entered */
    this.amortizationStartTime = null;

    /** @type {number} Previous vertical velocity (m/s) */
    this.prevVelocity = 0;

    /** @type {number} Previous timestamp in milliseconds */
    this.prevTimestamp = 0;

    /** @type {SscResult} Last evaluated turnaround metrics */
    this.lastResult = {
      amortizationMs: 0,
      elasticityRating: ElasticityRating.STANDBY,
      recoilScore: 100,
      isAmortizing: false,
      justCompleted: false,
      displayLabel: 'AMORTIZATION: STANDBY'
    };

    /** @type {number} Count of completed turnarounds in current set */
    this.turnaroundCount = 0;
  }

  /**
   * Tracks turnaround inflection and calculates amortization duration when velocity flips.
   * 
   * @param {number} verticalVelocity Signed vertical velocity in m/s (negative = descent, positive = ascent).
   * @param {number} [timestamp=performance.now()] High-resolution timestamp.
   * @returns {SscResult}
   */
  trackTurnaround(verticalVelocity, timestamp = performance.now()) {
    if (typeof verticalVelocity !== 'number' || isNaN(verticalVelocity)) {
      return this.lastResult;
    }

    const absV = Math.abs(verticalVelocity);
    const inInflectionZone = absV < this.velocityThreshold;
    let justCompleted = false;

    // Phase 1: Moving downward (descent)
    if (verticalVelocity <= -this.velocityThreshold) {
      this.motionPhase = 'DESCENT';
      this.amortizationStartTime = null;
    }
    // Phase 2: In inflection zone (|v_y| < 0.05 m/s) following or during descent
    else if (inInflectionZone) {
      if (this.motionPhase === 'DESCENT' || this.motionPhase === 'IDLE') {
        this.motionPhase = 'AMORTIZATION';
        this.amortizationStartTime = timestamp;
      }
    }
    // Phase 3: Driven upward (ascent, v_y > 0.05 m/s)
    else if (verticalVelocity >= this.velocityThreshold) {
      if (this.motionPhase === 'AMORTIZATION' || this.motionPhase === 'DESCENT') {
        // Turnaround completed!
        const startTime = this.amortizationStartTime || (this.prevTimestamp ? this.prevTimestamp : timestamp - 50);
        const rawDuration = Math.max(16, timestamp - startTime);
        const amortizationMs = Math.round(rawDuration);

        const { rating, score } = this._classify(amortizationMs);

        this.turnaroundCount++;
        justCompleted = true;

        this.lastResult = {
          amortizationMs,
          elasticityRating: rating,
          recoilScore: score,
          isAmortizing: false,
          justCompleted: true,
          displayLabel: this._formatLabel(amortizationMs, rating)
        };

        this.motionPhase = 'ASCENT';
        this.amortizationStartTime = null;
      } else {
        this.motionPhase = 'ASCENT';
      }
    }

    this.prevVelocity = verticalVelocity;
    this.prevTimestamp = timestamp;

    return {
      ...this.lastResult,
      isAmortizing: this.motionPhase === 'AMORTIZATION',
      justCompleted
    };
  }

  /**
   * Classifies amortization time into elasticity rating and score.
   * 
   * @param {number} ms Duration in milliseconds.
   * @returns {{ rating: string, score: number }}
   * @private
   */
  _classify(ms) {
    if (ms < this.highElasticityCutoffMs) {
      // High elasticity: score 85 - 100
      const score = Math.min(100, Math.round(85 + 15 * (1 - (ms / this.highElasticityCutoffMs))));
      return { rating: ElasticityRating.HIGH_ELASTICITY, score };
    }
    if (ms <= this.moderateCutoffMs) {
      // Moderate: score 50 - 84
      const range = this.moderateCutoffMs - this.highElasticityCutoffMs;
      const progress = (ms - this.highElasticityCutoffMs) / (range || 1);
      const score = Math.round(84 - 34 * progress);
      return { rating: ElasticityRating.MODERATE, score };
    }
    // Dissipated grind: score 10 - 49
    const over = ms - this.moderateCutoffMs;
    const score = Math.max(10, Math.round(49 - 39 * Math.min(1.0, over / 400)));
    return { rating: ElasticityRating.DISSIPATED, score };
  }

  /**
   * Formats the user-facing display label.
   * @param {number} ms
   * @param {string} rating
   * @returns {string}
   * @private
   */
  _formatLabel(ms, rating) {
    let tag = 'EXPLOSIVE RECOIL';
    if (rating === ElasticityRating.MODERATE) {
      tag = 'MODERATE';
    } else if (rating === ElasticityRating.DISSIPATED) {
      tag = 'DISSIPATED GRIND';
    }
    return `AMORTIZATION: ${ms}ms [${tag}]`;
  }

  /**
   * Returns current or cached turnaround result.
   * @returns {SscResult}
   */
  getLastResult() {
    return this.lastResult;
  }

  /**
   * Resets internal timers and status between exercises or reps.
   */
  reset() {
    this.motionPhase = 'IDLE';
    this.amortizationStartTime = null;
    this.prevVelocity = 0;
    this.prevTimestamp = 0;
    this.turnaroundCount = 0;
    this.lastResult = {
      amortizationMs: 0,
      elasticityRating: ElasticityRating.STANDBY,
      recoilScore: 100,
      isAmortizing: false,
      justCompleted: false,
      displayLabel: 'AMORTIZATION: STANDBY'
    };
  }
}
