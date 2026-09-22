/**
 * @fileoverview Layer 1: Biomechanical Mechanical Work & Energy Accumulator.
 * Computes instantaneous vertical center-of-mass displacement, instantaneous mechanical power (Watts),
 * and accumulates total mechanical work (kJ) across workout repetitions using standard gravitational physics:
 * 
 * Delta W = m * g * |Delta h|
 * P = Delta W / Delta t
 */

export class WorkEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.gravity=9.80665] Acceleration due to gravity (m/s^2).
   * @param {number} [options.assumedHeightM=1.75] Average user height in meters for scale calibration.
   */
  constructor(options = {}) {
    /** @type {number} */
    this.gravity = options.gravity || 9.80665;
    /** @type {number} */
    this.assumedHeightM = options.assumedHeightM || 1.75;

    /** @type {number} Total cumulative mechanical work in Joules */
    this.cumulativeJoules = 0;

    /** @type {number} Peak instantaneous power output in Watts */
    this.peakWatts = 0;

    /** @type {number} Filtered instantaneous power output in Watts */
    this.instantWatts = 0;
    /** @type {number} */
    this.filteredWatts = 0;

    /** @type {number|null} Previous center of mass Y coordinate */
    this.prevCoMY = null;

    /** @type {number} Timestamp of the last rep completion pulse (ms) */
    this.lastPulseTimestamp = 0;
    /** @type {number} Duration of the energy battery dump flash animation (ms) */
    this.pulseDurationMs = 1200;
  }

  /**
   * Calculates the weighted vertical Center of Mass (CoM) coordinate from landmarks.
   * Hips: 40%, Shoulders: 40%, Head: 20%.
   * 
   * @param {Array<{ x: number, y: number, z: number }>} landmarks
   * @returns {number|null} Normalized vertical Y coordinate of CoM.
   * @private
   */
  _computeCoMY(landmarks) {
    if (!landmarks || landmarks.length < 25) return null;

    const sL = landmarks[11];
    const sR = landmarks[12];
    const hL = landmarks[23];
    const hR = landmarks[24];
    const nose = landmarks[0] || sL;

    if (!sL || !sR || !hL || !hR) return null;

    const midShoulderY = (sL.y + sR.y) / 2;
    const midHipY = (hL.y + hR.y) / 2;
    const headY = nose.y;

    return (midHipY * 0.40) + (midShoulderY * 0.40) + (headY * 0.20);
  }

  /**
   * Estimates metric scale (meters per normalized viewport unit) based on detected body proportions.
   * 
   * @param {Array<{ x: number, y: number, z: number }>} landmarks
   * @returns {number}
   * @private
   */
  _estimateMetricScale(landmarks) {
    if (!landmarks || landmarks.length < 29) return 2.50;

    const aL = landmarks[27];
    const aR = landmarks[28];
    const nose = landmarks[0];

    if (aL && aR && nose) {
      const ankleY = (aL.y + aR.y) / 2;
      const heightNorm = Math.abs(ankleY - nose.y);
      if (heightNorm > 0.35 && heightNorm < 0.95) {
        return this.assumedHeightM / heightNorm;
      }
    }
    return 2.50;
  }

  /**
   * Computes center of mass vertical displacement and accumulates mechanical work.
   * 
   * Formula:
   * Delta W = m * g * |Delta h|
   * 
   * @param {Array<{ x: number, y: number, z: number }>} landmarks Current landmarks.
   * @param {Array<{ x: number, y: number, z: number }>|null} [prevLandmarks=null] Previous frame landmarks.
   * @param {number} [deltaTime=0.01667] Time elapsed since last frame in seconds.
   * @param {number} [bodyWeightKg=75] Athlete body mass in kilograms.
   * @returns {{ instantWatts: number, cumulativeKilojoules: number, peakWatts: number, cumulativeJoules: number, repPulse: boolean }}
   */
  accumulateWork(landmarks, prevLandmarks = null, deltaTime = 0.01667, bodyWeightKg = 75) {
    if (!landmarks || landmarks.length < 25) {
      return this.getWork();
    }

    const currentCoMY = this._computeCoMY(landmarks);
    if (currentCoMY === null) {
      return this.getWork();
    }

    let priorCoMY = this.prevCoMY;
    if (prevLandmarks) {
      const calcPrior = this._computeCoMY(prevLandmarks);
      if (calcPrior !== null) {
        priorCoMY = calcPrior;
      }
    }

    // If first frame, seed previous CoM and exit with current totals
    if (priorCoMY === null) {
      this.prevCoMY = currentCoMY;
      return this.getWork();
    }

    // 1. Calculate vertical displacement in normalized units
    const deltaNormY = Math.abs(currentCoMY - priorCoMY);
    this.prevCoMY = currentCoMY;

    // Reject camera jitter noise (< 1.5mm)
    if (deltaNormY < 0.0006) {
      this.filteredWatts = 0.85 * this.filteredWatts;
      this.instantWatts = Math.round(this.filteredWatts);
      return this.getWork();
    }

    // 2. Convert to physical displacement (meters)
    const scale = this._estimateMetricScale(landmarks);
    const deltaH = deltaNormY * scale;

    // 3. Compute incremental mechanical work: Delta W = m * g * |Delta h|
    const deltaW = bodyWeightKg * this.gravity * deltaH;
    this.cumulativeJoules += deltaW;

    // 4. Compute instantaneous power output (Watts): P = Delta W / Delta t
    const safeDt = Math.max(0.005, Math.min(0.2, deltaTime));
    const rawWatts = deltaW / safeDt;

    // Filter power with EMA (alpha = 0.25)
    this.filteredWatts = (0.25 * rawWatts) + (0.75 * this.filteredWatts);
    this.instantWatts = Math.round(this.filteredWatts);
    this.peakWatts = Math.max(this.peakWatts, this.instantWatts);

    return this.getWork();
  }

  /**
   * Triggers an emerald kinetic energy pulse animation when a repetition successfully completes.
   */
  triggerRepPulse() {
    this.lastPulseTimestamp = performance.now();
  }

  /**
   * Returns instantaneous work and energy metrics.
   * @returns {{ instantWatts: number, cumulativeKilojoules: number, peakWatts: number, cumulativeJoules: number, repPulse: boolean }}
   */
  getWork() {
    const now = performance.now();
    const repPulse = (now - this.lastPulseTimestamp) < this.pulseDurationMs;
    const cumulativeKilojoules = Number((this.cumulativeJoules / 1000).toFixed(1));

    return {
      instantWatts: this.instantWatts,
      cumulativeKilojoules,
      peakWatts: this.peakWatts,
      cumulativeJoules: this.cumulativeJoules,
      repPulse
    };
  }

  /**
   * Resets work accumulator and power peak state for new sets.
   */
  reset() {
    this.cumulativeJoules = 0;
    this.peakWatts = 0;
    this.instantWatts = 0;
    this.filteredWatts = 0;
    this.prevCoMY = null;
    this.lastPulseTimestamp = 0;
  }
}
