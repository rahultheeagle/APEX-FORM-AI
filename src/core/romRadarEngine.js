/**
 * @fileoverview Layer 4: 3D Joint Polar Range of Motion (ROM) Radar Engine.
 * Converts 3D Cartesian joint vectors into spherical polar coordinates (r, theta, phi),
 * tracks bilateral limb mobility perimeters, and isolates restricted kinematic sectors.
 */

/**
 * @typedef {Object} JointPoint
 * @property {number} x Normalized X coordinate.
 * @property {number} y Normalized Y coordinate.
 * @property {number} [z] Normalized Z depth coordinate.
 * @property {number} [visibility] Confidence score.
 */

/**
 * @typedef {Object} SphericalCoordinate
 * @property {number} radius Euclidean distance vector length r = sqrt(x^2 + y^2 + z^2).
 * @property {number} elevationDeg Zenith/elevation angle theta = arccos(y / r) in degrees [0 - 180]°.
 * @property {number} azimuthDeg Azimuthal horizontal angle phi = arctan2(z, x) in degrees [-180 - 180]°.
 */

/**
 * @typedef {Object} RestrictedSector
 * @property {number} sectorIndex Index of the 45° sector [0 - 7].
 * @property {number} azimuthMin Lower azimuth degree bound.
 * @property {number} azimuthMax Upper azimuth degree bound.
 * @property {'LEFT'|'RIGHT'|'BILATERAL'} limb Affected limb.
 * @property {number} deficiencyPct Percentage deficiency compared to baseline/contralateral.
 * @property {string} label Formatted restriction description.
 */

/**
 * @typedef {Object} RomRadarResult
 * @property {SphericalCoordinate} left Left limb spherical coordinates.
 * @property {SphericalCoordinate} right Right limb spherical coordinates.
 * @property {number} symmetryScore Bilateral reach symmetry percentage [0 - 100]%.
 * @property {Array<RestrictedSector>} restrictedSectors Identified restricted motion sectors.
 * @property {Array<{ azimuthDeg: number, radiusNorm: number }>} perimeterLeft Historical reach perimeter points.
 * @property {Array<{ azimuthDeg: number, radiusNorm: number }>} perimeterRight Historical reach perimeter points.
 * @property {number} sweepAngleDeg Current animated radar sweep beam angle.
 */

export class RomRadarEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.historySize=32] Number of samples retained for reach perimeter trails.
   * @param {number} [options.asymmetryThreshold=20] Deficit percentage flagging a restricted sector.
   * @param {number} [options.sweepSpeedDegPerSec=90] Angular speed of the circular radar sweep beam.
   */
  constructor(options = {}) {
    this.historySize = options.historySize !== undefined ? options.historySize : 32;
    this.asymmetryThreshold = options.asymmetryThreshold !== undefined ? options.asymmetryThreshold : 20;
    this.sweepSpeedDegPerSec = options.sweepSpeedDegPerSec !== undefined ? options.sweepSpeedDegPerSec : 90;

    /** @type {Array<{ azimuthDeg: number, radiusNorm: number }>} */
    this.perimeterLeft = [];

    /** @type {Array<{ azimuthDeg: number, radiusNorm: number }>} */
    this.perimeterRight = [];

    /** @type {Float32Array} Peak reach accumulator across 8 azimuthal sectors (Left) */
    this.sectorMaxLeft = new Float32Array(8);

    /** @type {Float32Array} Peak reach accumulator across 8 azimuthal sectors (Right) */
    this.sectorMaxRight = new Float32Array(8);

    /** @type {number} Current animated radar sweep beam angle */
    this.sweepAngleDeg = 0;
    this.lastTimestamp = 0;

    /** @type {RomRadarResult} Last evaluated polar radar result */
    this.lastResult = {
      left: { radius: 0, elevationDeg: 90, azimuthDeg: 0 },
      right: { radius: 0, elevationDeg: 90, azimuthDeg: 0 },
      symmetryScore: 100,
      restrictedSectors: [],
      perimeterLeft: [],
      perimeterRight: [],
      sweepAngleDeg: 0
    };
  }

  /**
   * Computes 3D spherical polar coordinates for a vector connecting proximal to distal joints:
   *   Vector v = P_distal - P_proximal = (x, y, z)
   *   Radius r = sqrt(x^2 + y^2 + z^2)
   *   Elevation Angle: theta = arccos(y / r) * (180 / PI)
   *   Azimuthal Angle: phi = arctan2(z, x) * (180 / PI)
   * 
   * @param {JointPoint} proximalJoint Root joint (e.g., Shoulder or Hip).
   * @param {JointPoint} distalJoint Terminal joint (e.g., Wrist or Ankle).
   * @returns {SphericalCoordinate}
   */
  calculateSphericalCoordinates(proximalJoint, distalJoint) {
    if (!proximalJoint || !distalJoint) {
      return { radius: 0, elevationDeg: 90, azimuthDeg: 0 };
    }

    const x = distalJoint.x - proximalJoint.x;
    const y = distalJoint.y - proximalJoint.y;
    const z = (distalJoint.z || 0) - (proximalJoint.z || 0);

    const r = Math.hypot(x, y, z);
    if (r < 1e-6) {
      return { radius: 0, elevationDeg: 90, azimuthDeg: 0 };
    }

    // Elevation angle: theta = arccos(y / r) * (180 / PI)
    // Clamped strictly to [-1.0, 1.0] to prevent floating point domain errors
    const clampedRatio = Math.max(-1.0, Math.min(1.0, y / r));
    const elevationDeg = Math.acos(clampedRatio) * (180 / Math.PI);

    // Azimuthal angle: phi = arctan2(z, x) * (180 / PI)
    const azimuthDeg = Math.atan2(z, x) * (180 / Math.PI);

    return {
      radius: Math.round(r * 1000) / 1000,
      elevationDeg: Math.round(elevationDeg * 10) / 10,
      azimuthDeg: Math.round(azimuthDeg * 10) / 10
    };
  }

  /**
   * Evaluates bilateral limb polar kinematics, maintains reach perimeters,
   * detects restricted sectors, and scores bilateral symmetry.
   * 
   * @param {JointPoint} leftProximal Left root joint.
   * @param {JointPoint} leftDistal Left terminal joint.
   * @param {JointPoint} rightProximal Right root joint.
   * @param {JointPoint} rightDistal Right terminal joint.
   * @param {number} [timestamp=performance.now()] High-resolution timestamp.
   * @returns {RomRadarResult}
   */
  evaluateLimbs(leftProximal, leftDistal, rightProximal, rightDistal, timestamp = performance.now()) {
    const leftPolar = this.calculateSphericalCoordinates(leftProximal, leftDistal);
    const rightPolar = this.calculateSphericalCoordinates(rightProximal, rightDistal);

    // Advance continuous radar sweep beam
    if (this.lastTimestamp) {
      const dt = (timestamp - this.lastTimestamp) / 1000;
      this.sweepAngleDeg = (this.sweepAngleDeg + dt * this.sweepSpeedDegPerSec) % 360;
    }
    this.lastTimestamp = timestamp;

    // Normalize radii relative to typical limb length (~0.45 in normalized space)
    const normL = Math.min(1.0, Math.max(0.05, leftPolar.radius / 0.45));
    const normR = Math.min(1.0, Math.max(0.05, rightPolar.radius / 0.45));

    // Map azimuth [-180, 180] into 8 sectors of 45° each [0 - 7]
    const sectorL = Math.floor(((leftPolar.azimuthDeg + 180) % 360) / 45);
    const sectorR = Math.floor(((rightPolar.azimuthDeg + 180) % 360) / 45);

    if (sectorL >= 0 && sectorL < 8) {
      this.sectorMaxLeft[sectorL] = Math.max(this.sectorMaxLeft[sectorL], normL);
    }
    if (sectorR >= 0 && sectorR < 8) {
      this.sectorMaxRight[sectorR] = Math.max(this.sectorMaxRight[sectorR], normR);
    }

    // Maintain history trail for radar reach display
    this.perimeterLeft.push({ azimuthDeg: leftPolar.azimuthDeg, radiusNorm: normL });
    if (this.perimeterLeft.length > this.historySize) this.perimeterLeft.shift();

    this.perimeterRight.push({ azimuthDeg: rightPolar.azimuthDeg, radiusNorm: normR });
    if (this.perimeterRight.length > this.historySize) this.perimeterRight.shift();

    // Compute bilateral symmetry score comparing reach and elevation
    const radiusDiff = Math.abs(leftPolar.radius - rightPolar.radius);
    const maxR = Math.max(0.001, leftPolar.radius, rightPolar.radius);
    const radiusSymmetry = Math.max(0, 100 - (radiusDiff / maxR) * 100);

    const elevDiff = Math.abs(leftPolar.elevationDeg - rightPolar.elevationDeg);
    const elevSymmetry = Math.max(0, 100 - (elevDiff / 180) * 100);

    const symmetryScore = Math.round((radiusSymmetry * 0.6) + (elevSymmetry * 0.4));

    // Identify restricted sectors (where left/right deficit > asymmetryThreshold)
    const restrictedSectors = [];
    for (let s = 0; s < 8; s++) {
      const maxL = this.sectorMaxLeft[s];
      const maxR = this.sectorMaxRight[s];

      if (maxL > 0.15 || maxR > 0.15) {
        const peak = Math.max(maxL, maxR);
        const diff = Math.abs(maxL - maxR);
        const defPct = (diff / peak) * 100;

        if (defPct >= this.asymmetryThreshold) {
          const azMin = -180 + s * 45;
          const azMax = azMin + 45;
          const affectedLimb = maxL < maxR ? 'LEFT' : 'RIGHT';
          restrictedSectors.push({
            sectorIndex: s,
            azimuthMin: azMin,
            azimuthMax: azMax,
            limb: affectedLimb,
            deficiencyPct: Math.round(defPct),
            label: `SECTOR ${s + 1} (${azMin}°..${azMax}°): ${affectedLimb} RESTRICTED (-${Math.round(defPct)}%)`
          });
        }
      }
    }

    this.lastResult = {
      left: leftPolar,
      right: rightPolar,
      symmetryScore,
      restrictedSectors,
      perimeterLeft: this.perimeterLeft,
      perimeterRight: this.perimeterRight,
      sweepAngleDeg: Math.round(this.sweepAngleDeg)
    };

    return this.lastResult;
  }

  /**
   * Automatic landmark extractor mapping appropriate limbs based on active exercise.
   * 
   * @param {Array<JointPoint>} landmarks 33 MediaPipe pose landmarks.
   * @param {string} [exerciseType='SQUAT'] Active exercise key.
   * @param {number} [timestamp=performance.now()] High-resolution timestamp.
   * @returns {RomRadarResult}
   */
  updateFromLandmarks(landmarks, exerciseType = 'SQUAT', timestamp = performance.now()) {
    if (!landmarks || landmarks.length < 29) {
      return this.lastResult;
    }

    let leftProximal, leftDistal, rightProximal, rightDistal;

    if (exerciseType === 'SQUAT') {
      // Lower body kinetic chain: Hips (23, 24) to Ankles (27, 28)
      leftProximal = landmarks[23];
      leftDistal = landmarks[27];
      rightProximal = landmarks[24];
      rightDistal = landmarks[28];
    } else {
      // Upper body kinetic chain (Pushups, Bicep Curls, Overhead): Shoulders (11, 12) to Wrists (15, 16)
      leftProximal = landmarks[11];
      leftDistal = landmarks[15];
      rightProximal = landmarks[12];
      rightDistal = landmarks[16];
    }

    return this.evaluateLimbs(leftProximal, leftDistal, rightProximal, rightDistal, timestamp);
  }

  /**
   * Returns latest cached polar result.
   * @returns {RomRadarResult}
   */
  getLastResult() {
    return this.lastResult;
  }

  /**
   * Resets sector accumulators and historical trails.
   */
  reset() {
    this.perimeterLeft = [];
    this.perimeterRight = [];
    this.sectorMaxLeft.fill(0);
    this.sectorMaxRight.fill(0);
    this.sweepAngleDeg = 0;
    this.lastTimestamp = 0;
    this.lastResult = {
      left: { radius: 0, elevationDeg: 90, azimuthDeg: 0 },
      right: { radius: 0, elevationDeg: 90, azimuthDeg: 0 },
      symmetryScore: 100,
      restrictedSectors: [],
      perimeterLeft: [],
      perimeterRight: [],
      sweepAngleDeg: 0
    };
  }
}
