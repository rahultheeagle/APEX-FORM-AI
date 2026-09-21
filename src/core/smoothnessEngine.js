/**
 * @fileoverview Layer 1: Movement Smoothness & Dimensionless Jerk Engine.
 * Computes real-time movement jerk (third derivative of displacement) and
 * calculates normalized dimensionless jerk over movement phases using the
 * Flash-Hogan biological motor control formulation:
 * 
 * Smoothness = -ln( (T^5 / v_peak^2) * \int (d^2v / dt^2)^2 dt )
 * 
 * Mapped to a normalized 0-100 Smoothness Score with jitter detection.
 */

export class SmoothnessEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxBufferSize=90] Maximum rolling history frames.
   * @param {number} [options.jitterThreshold=70] Score below which movement is flagged as jittery.
   * @param {number} [options.lnDjMin=6.0] Lower logarithmic bound (minimum-jerk ideal, score 100).
   * @param {number} [options.lnDjMax=18.0] Upper logarithmic bound (severe tremor/jerk, score 0).
   */
  constructor(options = {}) {
    /** @type {number} */
    this.maxBufferSize = options.maxBufferSize || 90;
    /** @type {number} */
    this.jitterThreshold = options.jitterThreshold || 70;
    /** @type {number} Theoretical minimum jerk -ln(DJ) bound */
    this.lnDjMin = options.lnDjMin || 6.0;
    /** @type {number} Severe jerk -ln(DJ) bound */
    this.lnDjMax = options.lnDjMax || 18.0;

    /** @type {Array<{ y: number, timestamp: number }>} Rolling buffer */
    this.trajectoryBuffer = [];

    /** @type {Array<{ y: number, timestamp: number }>} Active concentric phase buffer */
    this.concentricBuffer = [];

    /** @type {number} Filtered display smoothness score [0 - 100] */
    this.filteredSmoothness = 100;

    /** @type {boolean} Instantaneous jitter status */
    this.isJittery = false;

    /** @type {number} Latest raw dimensionless jerk */
    this.lastDimensionlessJerk = 0;
  }

  /**
   * Computes the third derivative of joint trajectories and calculates normalized
   * dimensionless jerk over the movement trajectory.
   * 
   * Formula:
   * Smoothness = -ln( ((t2 - t1)^5 / v_peak^2) * \int_{t1}^{t2} (d^2v / dt^2)^2 dt )
   * 
   * @param {number[]|Array<{ y: number, timestamp?: number }>} positionHistory Trajectory coordinates.
   * @param {number[]|number|null} [timeDeltas=null] Time intervals in seconds, timestamps, or fixed delta.
   * @returns {{ smoothnessScore: number, isJittery: boolean, dimensionlessJerk: number, rawSmoothness: number }}
   */
  calculateJerk(positionHistory, timeDeltas = null) {
    if (!positionHistory || positionHistory.length < 4) {
      return {
        smoothnessScore: 100,
        isJittery: false,
        dimensionlessJerk: 0,
        rawSmoothness: -this.lnDjMin
      };
    }

    // 1. Extract clean positions and time deltas (seconds)
    const positions = [];
    const dts = [];

    const isObjectFormat = typeof positionHistory[0] === 'object' && positionHistory[0] !== null;

    for (let i = 0; i < positionHistory.length; i++) {
      const item = positionHistory[i];
      const yVal = isObjectFormat ? item.y : Number(item);
      positions.push(yVal);
    }

    // Resolve time deltas (seconds)
    const N = positions.length;
    if (Array.isArray(timeDeltas) && timeDeltas.length >= N - 1) {
      // Check if timeDeltas are timestamps or deltas
      const isTimestampArray = timeDeltas.length > 1 && timeDeltas[1] > 100 && timeDeltas[1] > timeDeltas[0];
      for (let i = 0; i < N - 1; i++) {
        if (isTimestampArray) {
          const dtSec = Math.max(0.001, (timeDeltas[i + 1] - timeDeltas[i]) / (timeDeltas[i + 1] > 1e9 ? 1e9 : (timeDeltas[i + 1] > 1e6 ? 1e3 : 1e3)));
          dts.push(dtSec);
        } else {
          dts.push(Math.max(0.001, Number(timeDeltas[i])));
        }
      }
    } else if (typeof timeDeltas === 'number' && timeDeltas > 0) {
      const fixedDt = timeDeltas > 10 ? timeDeltas / 1000 : timeDeltas;
      for (let i = 0; i < N - 1; i++) {
        dts.push(fixedDt);
      }
    } else if (isObjectFormat && positionHistory[0].timestamp !== undefined && positionHistory[1].timestamp !== undefined) {
      for (let i = 0; i < N - 1; i++) {
        const t1 = positionHistory[i].timestamp;
        const t2 = positionHistory[i + 1].timestamp;
        const dtSec = Math.max(0.001, (t2 - t1) / 1000);
        dts.push(dtSec);
      }
    } else {
      // Fallback: standard 60 FPS delta (0.01667 seconds)
      const defaultDt = 1 / 60;
      for (let i = 0; i < N - 1; i++) {
        dts.push(defaultDt);
      }
    }

    // 2. Compute 1st derivative: Velocity v = dy / dt
    const velocities = [];
    let peakVelocity = 1e-4;

    for (let i = 0; i < N - 1; i++) {
      const v = (positions[i + 1] - positions[i]) / dts[i];
      velocities.push(v);
      const absV = Math.abs(v);
      if (absV > peakVelocity) {
        peakVelocity = absV;
      }
    }

    // 3. Compute 2nd derivative: Acceleration a = dv / dt
    const accelerations = [];
    const accelDts = [];

    for (let i = 0; i < velocities.length - 1; i++) {
      const avgDt = (dts[i] + dts[i + 1]) / 2;
      accelDts.push(avgDt);
      const a = (velocities[i + 1] - velocities[i]) / avgDt;
      accelerations.push(a);
    }

    if (accelerations.length < 2) {
      return {
        smoothnessScore: 100,
        isJittery: false,
        dimensionlessJerk: 0,
        rawSmoothness: -this.lnDjMin
      };
    }

    // 4. Compute 3rd derivative: Jerk j = da / dt = d^2v / dt^2 = d^3y / dt^3
    const jerks = [];
    const jerkDts = [];

    for (let i = 0; i < accelerations.length - 1; i++) {
      const avgDt = (accelDts[i] + accelDts[i + 1]) / 2;
      jerkDts.push(avgDt);
      const j = (accelerations[i + 1] - accelerations[i]) / avgDt;
      jerks.push(j);
    }

    // 5. Numerical Integration of squared jerk: \int_{t1}^{t2} j(t)^2 dt
    let jerkIntegral = 0;
    for (let i = 0; i < jerks.length; i++) {
      jerkIntegral += (jerks[i] * jerks[i]) * jerkDts[i];
    }

    // Total movement duration T = \sum dts
    let totalDuration = 0;
    for (let i = 0; i < dts.length; i++) {
      totalDuration += dts[i];
    }
    totalDuration = Math.max(0.05, totalDuration);

    // 6. Calculate Dimensionless Jerk: DJ = (T^5 / v_peak^2) * \int j^2 dt
    const durationFifth = Math.pow(totalDuration, 5);
    const peakVelSquared = peakVelocity * peakVelocity;
    const dimensionlessJerk = (durationFifth / peakVelSquared) * jerkIntegral;

    // 7. Calculate Logarithmic Smoothness: Smoothness = -ln(DJ)
    // Avoid ln(0) or negative/invalid values
    const safeDj = Math.max(10, dimensionlessJerk);
    const rawSmoothness = -Math.log(safeDj);

    // 8. Map to normalized 0 - 100 Smoothness Score
    // Minimum jerk ideal: -ln(DJ) >= -lnDjMin (approx -6.0) -> Score 100
    // Severe tremor/jerk: -ln(DJ) <= -lnDjMax (approx -18.0) -> Score 0
    const normalizedScore = ((rawSmoothness - (-this.lnDjMax)) / ((-this.lnDjMin) - (-this.lnDjMax))) * 100;
    const clampedScore = Math.max(0, Math.min(100, normalizedScore));

    const finalScore = Math.round(clampedScore);
    const isJittery = finalScore < this.jitterThreshold;

    return {
      smoothnessScore: finalScore,
      isJittery,
      dimensionlessJerk,
      rawSmoothness
    };
  }

  /**
   * Appends a coordinate sample to the rolling trajectory buffer.
   * @param {number} y Normalized or pixel coordinate.
   * @param {number} [timestamp] Timestamp in ms.
   */
  addTrajectorySample(y, timestamp = performance.now()) {
    if (typeof y !== 'number' || isNaN(y)) return;
    this.trajectoryBuffer.push({ y, timestamp });
    if (this.trajectoryBuffer.length > this.maxBufferSize) {
      this.trajectoryBuffer.shift();
    }
  }

  /**
   * Appends a coordinate sample specifically for active concentric phase tracking.
   * @param {number} y Normalized or pixel coordinate.
   * @param {number} [timestamp] Timestamp in ms.
   */
  addConcentricSample(y, timestamp = performance.now()) {
    if (typeof y !== 'number' || isNaN(y)) return;
    this.concentricBuffer.push({ y, timestamp });
    if (this.concentricBuffer.length > this.maxBufferSize) {
      this.concentricBuffer.shift();
    }
  }

  /**
   * Clears the concentric phase sample buffer on new rep phase start.
   */
  resetConcentric() {
    this.concentricBuffer = [];
  }

  /**
   * Real-time update evaluating trajectory smoothness.
   * Smooths the result using exponential moving average to prevent HUD jitter.
   * 
   * @param {number} y Active joint position.
   * @param {number} [timestamp] Timestamp in ms.
   * @param {boolean} [isConcentric=false] Whether currently in concentric ascent.
   * @returns {{ smoothnessScore: number, isJittery: boolean, dimensionlessJerk: number }}
   */
  update(y, timestamp = performance.now(), isConcentric = false) {
    this.addTrajectorySample(y, timestamp);

    if (isConcentric) {
      this.addConcentricSample(y, timestamp);
    }

    // Evaluate over concentric buffer if sufficient samples exist, otherwise rolling buffer
    const activeBuffer = (isConcentric && this.concentricBuffer.length >= 6)
      ? this.concentricBuffer
      : this.trajectoryBuffer;

    if (activeBuffer.length >= 6) {
      const result = this.calculateJerk(activeBuffer);
      // EMA smoothing (alpha = 0.25)
      this.filteredSmoothness = Math.round((0.25 * result.smoothnessScore) + (0.75 * this.filteredSmoothness));
      this.isJittery = this.filteredSmoothness < this.jitterThreshold;
      this.lastDimensionlessJerk = result.dimensionlessJerk;
    } else {
      this.isJittery = false;
    }

    return {
      smoothnessScore: this.filteredSmoothness,
      isJittery: this.isJittery,
      dimensionlessJerk: this.lastDimensionlessJerk
    };
  }

  /**
   * Returns instantaneous smoothness metrics.
   * @returns {{ smoothnessScore: number, isJittery: boolean }}
   */
  getSmoothness() {
    return {
      smoothnessScore: this.filteredSmoothness,
      isJittery: this.isJittery
    };
  }

  /**
   * Resets all trajectory buffers and resets score to 100.
   */
  reset() {
    this.trajectoryBuffer = [];
    this.concentricBuffer = [];
    this.filteredSmoothness = 100;
    this.isJittery = false;
    this.lastDimensionlessJerk = 0;
  }
}
