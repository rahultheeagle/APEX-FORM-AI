/**
 * @fileoverview Layer 4: Kinetic Telemetry & Concentric Velocity Decay Engine.
 * Tracks instantaneous vertical velocity (v_y = dy / dt) during concentric lifting phases,
 * computes Mean Concentric Velocity (MCV), percentage velocity loss relative to Rep 1,
 * estimates Reps in Reserve (RIR), and calculates instantaneous mechanical power (Watts).
 */

/**
 * @typedef {Object} KineticTelemetryResult
 * @property {number} mcv Mean Concentric Velocity in meters per second (m/s).
 * @property {number} velocityDecay Percentage velocity loss relative to Rep 1 [0 - 100]%.
 * @property {string} rir Estimated Reps in Reserve ("3+", "1-2", or "0 (Failure Imminent)").
 * @property {number} instantWatts Instantaneous mechanical power output in Watts.
 * @property {number} currentVelocity Instantaneous smoothed upward velocity in m/s.
 * @property {number} rep1MCV Baseline MCV established on Rep 1.
 * @property {boolean} isConcentric Active concentric phase flag.
 */

export class KineticTelemetry {
  /**
   * @param {Object} [options]
   * @param {number} [options.lifterMassKg=75] Nominal lifter + bar load mass (kg).
   * @param {number} [options.heightScaleMeters=1.70] Metric conversion factor for normalized canvas height.
   * @param {number} [options.smoothingAlpha=0.35] EMA factor for velocity smoothing.
   */
  constructor(options = {}) {
    this.lifterMassKg = options.lifterMassKg !== undefined ? options.lifterMassKg : 75;
    this.heightScaleMeters = options.heightScaleMeters !== undefined ? options.heightScaleMeters : 1.70;
    this.smoothingAlpha = options.smoothingAlpha !== undefined ? options.smoothingAlpha : 0.35;

    /** @type {number|null} Baseline Mean Concentric Velocity from Rep 1 (m/s) */
    this.rep1MCV = null;

    /** @type {number} Instantaneous smoothed upward vertical velocity (m/s) */
    this.instantVelocity = 0;

    /** @type {number} Current running or finalized Mean Concentric Velocity (m/s) */
    this.currentMCV = 0.68;

    /** @type {number} Velocity loss percentage relative to Rep 1 */
    this.velocityDecay = 0;

    /** @type {string} Estimated Reps in Reserve */
    this.rir = '3+';

    /** @type {number} Instantaneous mechanical power (Watts) */
    this.instantWatts = 0;

    /** @type {number|null} Previous vertical coordinate (normalized [0, 1]) */
    this.prevY = null;

    /** @type {number|null} Previous timestamp in milliseconds */
    this.prevTimestamp = null;

    /** @type {number} Concentric velocity accumulator */
    this.concentricVelocitySum = 0;
    /** @type {number} Number of samples in active concentric phase */
    this.concentricSamplesCount = 0;

    /** @type {boolean} True if actively in concentric ascent */
    this.isConcentricActive = false;

    /** @type {Array<number>} History of finalized MCVs per rep */
    this.repHistory = [];
  }

  /**
   * Ingests instantaneous vertical position and updates velocity, MCV, decay, and RIR.
   * 
   * @param {number} currentY Normalized vertical coordinate of bar/lifter (0.0 at top, 1.0 at floor).
   * @param {number} timestampMs Current frame timestamp (performance.now()).
   * @param {boolean} [isConcentric=false] True during concentric ascent phase.
   * @param {number} [repNumber=1] Current repetition index.
   * @returns {KineticTelemetryResult}
   */
  update(currentY, timestampMs, isConcentric = false, repNumber = 1) {
    if (this.prevY === null || this.prevTimestamp === null) {
      this.prevY = currentY;
      this.prevTimestamp = timestampMs;
      return this._createResult(isConcentric);
    }

    const dt = Math.max(0.005, Math.min(0.2, (timestampMs - this.prevTimestamp) / 1000));
    this.prevTimestamp = timestampMs;

    // In canvas space: Y increases downwards.
    // Upward motion during concentric drive corresponds to prevY > currentY.
    const dyUpNormalized = this.prevY - currentY;
    this.prevY = currentY;

    // Convert normalized displacement to real-world velocity (m/s)
    const rawVelocity = (dyUpNormalized / dt) * this.heightScaleMeters;

    // Apply EMA smoothing
    const alpha = this.smoothingAlpha;
    this.instantVelocity = (alpha * rawVelocity) + ((1.0 - alpha) * this.instantVelocity);

    // Compute Instantaneous Power: P = m * g * v_y (Watts)
    const upwardSpeed = Math.max(0, this.instantVelocity);
    const g = 9.81;
    this.instantWatts = Math.round(this.lifterMassKg * g * upwardSpeed);

    // Handle Concentric Phase Accumulation
    if (isConcentric) {
      if (!this.isConcentricActive) {
        // Just entered concentric ascent
        this.isConcentricActive = true;
        this.concentricVelocitySum = 0;
        this.concentricSamplesCount = 0;
      }

      if (upwardSpeed > 0.05) {
        this.concentricVelocitySum += upwardSpeed;
        this.concentricSamplesCount++;
        this.currentMCV = this.concentricVelocitySum / this.concentricSamplesCount;
      }

      // If Rep 1 is finished, calculate decay relative to Rep 1 MCV
      if (this.rep1MCV !== null && this.rep1MCV > 0.05) {
        const decayRatio = (this.rep1MCV - this.currentMCV) / this.rep1MCV;
        this.velocityDecay = Math.max(0, Math.min(100, Math.round(decayRatio * 1000) / 10));
      } else {
        this.velocityDecay = 0;
      }

      // Estimate Reps in Reserve (RIR) based on velocity decay thresholds:
      // - Decay < 10%: RIR = "3+"
      // - Decay 10% - 25%: RIR = "1-2"
      // - Decay > 25%: RIR = "0 (Failure Imminent)"
      if (this.velocityDecay < 10) {
        this.rir = '3+';
      } else if (this.velocityDecay <= 25) {
        this.rir = '1-2';
      } else {
        this.rir = '0 (Failure Imminent)';
      }
    } else {
      if (this.isConcentricActive) {
        // Exited concentric ascent
        this.isConcentricActive = false;
      }
    }

    return this._createResult(isConcentric);
  }

  /**
   * Finalizes the current rep's concentric velocity metrics.
   * Sets baseline on Rep 1 and resets intra-rep accumulators.
   * 
   * @param {number} repNumber The completed rep number.
   * @returns {KineticTelemetryResult}
   */
  onRepComplete(repNumber) {
    const finalMCV = this.concentricSamplesCount > 0
      ? (this.concentricVelocitySum / this.concentricSamplesCount)
      : (this.currentMCV || 0.65);

    this.currentMCV = Math.round(finalMCV * 100) / 100;
    this.repHistory.push(this.currentMCV);

    // Establish Rep 1 baseline
    if (this.rep1MCV === null || repNumber === 1 || this.repHistory.length === 1) {
      this.rep1MCV = this.currentMCV;
      this.velocityDecay = 0;
      this.rir = '3+';
    } else {
      const decayRatio = (this.rep1MCV - this.currentMCV) / this.rep1MCV;
      this.velocityDecay = Math.max(0, Math.min(100, Math.round(decayRatio * 1000) / 10));

      if (this.velocityDecay < 10) {
        this.rir = '3+';
      } else if (this.velocityDecay <= 25) {
        this.rir = '1-2';
      } else {
        this.rir = '0 (Failure Imminent)';
      }
    }

    // Reset concentric accumulators for next rep
    this.concentricVelocitySum = 0;
    this.concentricSamplesCount = 0;
    this.isConcentricActive = false;

    return this._createResult(false);
  }

  /**
   * Resets all history and baseline values.
   */
  reset() {
    this.rep1MCV = null;
    this.instantVelocity = 0;
    this.currentMCV = 0.68;
    this.velocityDecay = 0;
    this.rir = '3+';
    this.instantWatts = 0;
    this.prevY = null;
    this.prevTimestamp = null;
    this.concentricVelocitySum = 0;
    this.concentricSamplesCount = 0;
    this.isConcentricActive = false;
    this.repHistory = [];
  }

  /**
   * Creates the structured telemetry output payload.
   * @private
   */
  _createResult(isConcentric) {
    return {
      mcv: Math.round(this.currentMCV * 100) / 100,
      velocityDecay: this.velocityDecay,
      rir: this.rir,
      instantWatts: this.instantWatts,
      currentVelocity: Math.round(Math.max(0, this.instantVelocity) * 100) / 100,
      rep1MCV: this.rep1MCV ? Math.round(this.rep1MCV * 100) / 100 : 0,
      isConcentric
    };
  }
}
