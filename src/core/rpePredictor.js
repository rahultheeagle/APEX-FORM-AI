/**
 * @fileoverview Layer 4: Velocity-Loss Objective RPE & Metabolic Fatigue Predictor.
 * Tracks repetition-by-repetition mean concentric velocities (MCV), computes percentage
 * velocity-loss decay from established baselines, predicts clinical Objective RPE,
 * and categorizes athlete metabolic strain (Aerobic, Lactic Glycolysis, Failure).
 */

/**
 * @typedef {Object} RpeResult
 * @property {number} velocityLossPct Percentage velocity loss relative to baseline [0.0 - 100.0]%.
 * @property {number} calculatedRPE Predicted Borg/RIR Objective RPE [6.0 - 10.0].
 * @property {'AEROBIC'|'LACTIC'|'FAILURE'} metabolicState Physiological fatigue state.
 * @property {string} strainLabel Qualitative strain assessment ('LOW' | 'MODERATE' | 'HIGH' | 'MAXIMAL').
 * @property {string} displayLabel Formatted badge label string.
 * @property {number} baselineVelocity Baseline MCV established on initial repetitions (m/s).
 * @property {number} latestVelocity Most recently recorded/evaluated velocity (m/s).
 * @property {Array<number>} velocityHistory History of recorded rep velocities.
 * @property {Array<number>} lossHistory History of percentage velocity losses per rep.
 */

export class RpePredictor {
  /**
   * @param {Object} [options]
   * @param {number} [options.defaultBaseline=0.70] Default fallback baseline velocity in m/s.
   */
  constructor(options = {}) {
    this.defaultBaseline = options.defaultBaseline !== undefined ? options.defaultBaseline : 0.70;

    /** @type {Array<number>} Chronological list of mean concentric velocities per rep */
    this.velocityHistory = [];

    /** @type {Array<number>} Chronological list of velocity loss percentages per rep */
    this.lossHistory = [];

    /** @type {number|null} Established baseline velocity (Rep 1 or highest of first 2 reps) */
    this.baselineVelocity = null;

    /** @type {RpeResult} Last evaluated strain result */
    this.lastResult = {
      velocityLossPct: 0.0,
      calculatedRPE: 6.0,
      metabolicState: 'AEROBIC',
      strainLabel: 'LOW',
      displayLabel: 'OBJECTIVE RPE: 6.0 [METABOLIC STRAIN: LOW]',
      baselineVelocity: this.defaultBaseline,
      latestVelocity: this.defaultBaseline,
      velocityHistory: [],
      lossHistory: []
    };
  }

  /**
   * Ingests a completed repetition's mean concentric velocity (MCV) and computes set strain.
   * 
   * @param {number} repMCV Completed repetition velocity in m/s.
   * @returns {RpeResult}
   */
  recordRep(repMCV) {
    const v = typeof repMCV === 'number' && !isNaN(repMCV) && repMCV > 0.05
      ? Math.round(repMCV * 100) / 100
      : 0.65;

    this.velocityHistory.push(v);

    // Establish or refine baseline velocity on early reps
    if (this.baselineVelocity === null || this.velocityHistory.length === 1) {
      this.baselineVelocity = v;
    } else if (this.velocityHistory.length === 2 && v > this.baselineVelocity) {
      // Potentiation: if rep 2 is faster than rep 1, elevate baseline
      this.baselineVelocity = v;
    }

    const result = this.evaluateSetStrain(v);
    this.lossHistory.push(result.velocityLossPct);
    return result;
  }

  /**
   * Computes velocity loss percentage, objective RPE, and metabolic state.
   * 
   * @param {number} [currentVelocity] Live instantaneous or latest recorded velocity in m/s.
   * @returns {RpeResult}
   */
  evaluateSetStrain(currentVelocity) {
    const baseline = this.baselineVelocity !== null ? this.baselineVelocity : this.defaultBaseline;
    const latest = typeof currentVelocity === 'number' && !isNaN(currentVelocity) && currentVelocity > 0.01
      ? currentVelocity
      : (this.velocityHistory.length > 0 ? this.velocityHistory[this.velocityHistory.length - 1] : baseline);

    // Velocity Loss Percentage: Loss = ((v_baseline - v_latest) / v_baseline) * 100
    let rawLoss = 0;
    if (baseline > 0.05) {
      rawLoss = ((baseline - latest) / baseline) * 100;
    }
    const velocityLossPct = Math.max(0.0, Math.min(100.0, Math.round(rawLoss * 10) / 10));

    // Objective RPE mapping thresholds:
    //   Loss < 10% -> RPE 6.0
    //   Loss < 20% -> RPE 7.5
    //   Loss < 30% -> RPE 8.5
    //   Loss < 40% -> RPE 9.5
    //   Loss >= 40% -> RPE 10.0
    let calculatedRPE = 6.0;
    let strainLabel = 'LOW';

    if (velocityLossPct >= 40.0) {
      calculatedRPE = 10.0;
      strainLabel = 'MAXIMAL';
    } else if (velocityLossPct >= 30.0) {
      calculatedRPE = 9.5;
      strainLabel = 'HIGH';
    } else if (velocityLossPct >= 20.0) {
      calculatedRPE = 8.5;
      strainLabel = 'HIGH';
    } else if (velocityLossPct >= 10.0) {
      calculatedRPE = 7.5;
      strainLabel = 'MODERATE';
    } else {
      calculatedRPE = 6.0;
      strainLabel = 'LOW';
    }

    // Metabolic State classification:
    //   Loss < 15%: AEROBIC / Phosphagen ATP-PCr dominance
    //   Loss 15% - 35%: LACTIC Glycolysis accumulation
    //   Loss >= 35%: METABOLIC FAILURE / High Acidosis
    let metabolicState = 'AEROBIC';
    if (velocityLossPct >= 35.0) {
      metabolicState = 'FAILURE';
    } else if (velocityLossPct >= 15.0) {
      metabolicState = 'LACTIC';
    }

    const displayLabel = `OBJECTIVE RPE: ${calculatedRPE.toFixed(1)} [METABOLIC STRAIN: ${strainLabel}]`;

    this.lastResult = {
      velocityLossPct,
      calculatedRPE,
      metabolicState,
      strainLabel,
      displayLabel,
      baselineVelocity: Math.round(baseline * 100) / 100,
      latestVelocity: Math.round(latest * 100) / 100,
      velocityHistory: [...this.velocityHistory],
      lossHistory: [...this.lossHistory]
    };

    return this.lastResult;
  }

  /**
   * Returns latest cached RPE strain result.
   * @returns {RpeResult}
   */
  getLastResult() {
    return this.lastResult;
  }

  /**
   * Returns history of velocity losses across reps.
   * @returns {Array<number>}
   */
  getLossHistory() {
    return this.lossHistory;
  }

  /**
   * Resets set history and baseline values.
   */
  reset() {
    this.velocityHistory = [];
    this.lossHistory = [];
    this.baselineVelocity = null;
    this.lastResult = {
      velocityLossPct: 0.0,
      calculatedRPE: 6.0,
      metabolicState: 'AEROBIC',
      strainLabel: 'LOW',
      displayLabel: 'OBJECTIVE RPE: 6.0 [METABOLIC STRAIN: LOW]',
      baselineVelocity: this.defaultBaseline,
      latestVelocity: this.defaultBaseline,
      velocityHistory: [],
      lossHistory: []
    };
  }
}
