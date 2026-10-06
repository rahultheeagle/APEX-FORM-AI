/**
 * @fileoverview Layer 4: Bar Path Mechanical Efficiency Ratio (MER) Engine.
 * Evaluates the 3D trajectory traveled by the barbell or primary movement vertex,
 * comparing actual 3D Euclidean path length against ideal vertical displacement.
 */

/**
 * @typedef {Object} TrajectoryPoint
 * @property {number} x Normalized X coordinate [0.0, 1.0].
 * @property {number} y Normalized Y coordinate [0.0, 1.0].
 * @property {number} [z] Normalized Z depth coordinate.
 * @property {number} [timestamp] Timestamp in milliseconds.
 */

/**
 * @typedef {Object} BarEfficiencyResult
 * @property {number} merPercent Mechanical Efficiency Ratio percentage [0.0 - 100.0]%.
 * @property {number} horizontalDriftMm Maximum horizontal deviation across the repetition in mm.
 * @property {number} wastedEnergyRatio Fraction of non-vertical displacement [0.0 - 1.0].
 * @property {number} totalPathLength Total 3D path length in normalized units.
 * @property {number} netVerticalTravel Total vertical displacement along the vertical axis.
 * @property {string} rating Qualitative groove assessment ('VERTICAL GROOVE' | 'MODERATE SWAY' | 'EXCESSIVE DRIFT').
 * @property {string} displayLabel Formatted badge label for HUD.
 */

export class BarEfficiencyEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.metricScaleMm=1400] Millimeter conversion factor for normalized width.
   * @param {number} [options.grooveThreshold=90.0] Minimum MER percentage for optimal groove.
   * @param {number} [options.moderateThreshold=80.0] Minimum MER percentage for moderate sway.
   */
  constructor(options = {}) {
    this.metricScaleMm = options.metricScaleMm !== undefined ? options.metricScaleMm : 1400;
    this.grooveThreshold = options.grooveThreshold !== undefined ? options.grooveThreshold : 90.0;
    this.moderateThreshold = options.moderateThreshold !== undefined ? options.moderateThreshold : 80.0;

    /** @type {BarEfficiencyResult} Last evaluated repetition efficiency */
    this.lastResult = {
      merPercent: 100.0,
      horizontalDriftMm: 0,
      wastedEnergyRatio: 0,
      totalPathLength: 0,
      netVerticalTravel: 0,
      rating: 'VERTICAL GROOVE',
      displayLabel: 'BAR EFFICIENCY: 100.0% [VERTICAL GROOVE]'
    };

    /** @type {Array<number>} History of MER percentages per rep */
    this.repHistory = [];
  }

  /**
   * Evaluates the Mechanical Efficiency Ratio and horizontal drift from a sequence of points.
   * 
   * @param {Array<TrajectoryPoint>} pathCoordinates Ordered array of trajectory points for the rep.
   * @returns {BarEfficiencyResult}
   */
  evaluateRepTrajectory(pathCoordinates) {
    if (!Array.isArray(pathCoordinates) || pathCoordinates.length < 2) {
      return this.lastResult;
    }

    let totalPathLength = 0;
    let netVerticalTravel = 0;
    let minX = Infinity;
    let maxX = -Infinity;

    const len = pathCoordinates.length;

    for (let i = 0; i < len; i++) {
      const pt = pathCoordinates[i];
      if (!pt) continue;

      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;

      if (i > 0) {
        const prev = pathCoordinates[i - 1];
        if (!prev) continue;

        const dx = pt.x - prev.x;
        const dy = pt.y - prev.y;
        const dz = (pt.z || 0) - (prev.z || 0);

        const segmentDist = Math.hypot(dx, dy, dz);
        totalPathLength += segmentDist;
        netVerticalTravel += Math.abs(dy);
      }
    }

    if (totalPathLength <= 0.0001) {
      return this.lastResult;
    }

    // Mechanical Efficiency Ratio: (Delta Y_net / L_total) * 100
    // Pure vertical travel with zero lateral/depth drift yields 100.0%
    const rawMER = Math.min(100.0, Math.max(0.0, (netVerticalTravel / totalPathLength) * 100));
    const merPercent = Math.round(rawMER * 10) / 10;

    // Horizontal drift in millimeters
    const driftX = (maxX > minX && minX !== Infinity) ? (maxX - minX) : 0;
    const horizontalDriftMm = Math.round(driftX * this.metricScaleMm * 10) / 10;

    // Wasted energy ratio: fraction of non-vertical displacement
    const wastedRatio = Math.max(0, Math.min(1.0, (totalPathLength - netVerticalTravel) / totalPathLength));
    const wastedEnergyRatio = Math.round(wastedRatio * 1000) / 1000;

    // Qualitative groove assessment
    let rating = 'VERTICAL GROOVE';
    if (merPercent < this.moderateThreshold) {
      rating = 'EXCESSIVE DRIFT';
    } else if (merPercent < this.grooveThreshold) {
      rating = 'MODERATE SWAY';
    }

    const displayLabel = `BAR EFFICIENCY: ${merPercent.toFixed(1)}% [${rating}]`;

    this.lastResult = {
      merPercent,
      horizontalDriftMm,
      wastedEnergyRatio,
      totalPathLength: Math.round(totalPathLength * 1000) / 1000,
      netVerticalTravel: Math.round(netVerticalTravel * 1000) / 1000,
      rating,
      displayLabel
    };

    this.repHistory.push(merPercent);
    return this.lastResult;
  }

  /**
   * Returns latest evaluated efficiency metrics.
   * @returns {BarEfficiencyResult}
   */
  getLastResult() {
    return this.lastResult;
  }

  /**
   * Resets rep history and baseline values.
   */
  reset() {
    this.repHistory = [];
    this.lastResult = {
      merPercent: 100.0,
      horizontalDriftMm: 0,
      wastedEnergyRatio: 0,
      totalPathLength: 0,
      netVerticalTravel: 0,
      rating: 'VERTICAL GROOVE',
      displayLabel: 'BAR EFFICIENCY: 100.0% [VERTICAL GROOVE]'
    };
  }
}
