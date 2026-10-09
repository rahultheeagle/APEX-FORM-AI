/**
 * @fileoverview Segmental Moment of Inertia & Rotational Angular Momentum Engine.
 * Implements Dempster's body segment parameters (trunk 43%, thighs 20%, shanks 9%, upper body 28%)
 * to calculate perpendicular distances from the vertical centroidal axis, instantaneous rotational inertia,
 * and explosive angular momentum: L = I * omega.
 */

export class InertiaEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.defaultMassKg=75] Standard athlete body mass in kilograms.
   * @param {number} [options.statureScale=1.75] Metric scaling factor for normalized coordinates.
   */
  constructor(options = {}) {
    this.defaultMassKg = options.defaultMassKg || 75;
    this.statureScale = options.statureScale || 1.75;

    // Dempster's body segment mass fractions
    this.massFractions = {
      trunk: 0.43,
      thighLeft: 0.10,
      thighRight: 0.10,
      shankLeft: 0.045,
      shankRight: 0.045,
      upperLeft: 0.14,
      upperRight: 0.14
    };

    // Pre-allocated segment cache to prevent GC allocations
    this.segments = [
      { name: 'trunk', massFraction: 0.43, x: 0, z: 0, r: 0 },
      { name: 'thighLeft', massFraction: 0.10, x: 0, z: 0, r: 0 },
      { name: 'thighRight', massFraction: 0.10, x: 0, z: 0, r: 0 },
      { name: 'shankLeft', massFraction: 0.045, x: 0, z: 0, r: 0 },
      { name: 'shankRight', massFraction: 0.045, x: 0, z: 0, r: 0 },
      { name: 'upperLeft', massFraction: 0.14, x: 0, z: 0, r: 0 },
      { name: 'upperRight', massFraction: 0.14, x: 0, z: 0, r: 0 }
    ];

    // Temporal kinematics tracking for angular velocity (omega = dTheta / dt)
    this.lastTheta = null;
    this.lastTimestamp = 0;
    this.smoothedOmega = 0;

    /** @type {number} Instantaneous moment of inertia (kg*m^2) */
    this.momentOfInertia = 12.0;

    /** @type {number} Instantaneous angular velocity (rad/s) */
    this.angularVelocity = 0;

    /** @type {number} Instantaneous angular momentum (kg*m^2/s) */
    this.angularMomentum = 0;

    /** @type {'STEADY'|'MODERATE'|'FAST'} Turnover speed classification */
    this.turnoverSpeed = 'STEADY';
  }

  /**
   * Computes segmental moment of inertia and rotational momentum from 3D pose landmarks.
   *
   * @param {Array<{ x: number, y: number, z?: number }>} landmarks 33 MediaPipe pose landmarks.
   * @param {number} [athleteMassKg=75] Athlete body mass in kilograms.
   * @param {number} [timestamp=performance.now()] Current frame timestamp in ms.
   * @returns {{
   *   momentOfInertia: number,
   *   angularVelocity: number,
   *   angularMomentum: number,
   *   turnoverSpeed: 'STEADY'|'MODERATE'|'FAST',
   *   displayLabel: string
   * }}
   */
  computeRotationalInertia(landmarks, athleteMassKg = this.defaultMassKg, timestamp = performance.now()) {
    if (!landmarks || landmarks.length < 29) {
      return this.getLastResult();
    }

    const mass = athleteMassKg > 0 ? athleteMassKg : this.defaultMassKg;
    const S = this.statureScale;

    // Landmark references
    const shL = landmarks[11];
    const shR = landmarks[12];
    const hipL = landmarks[23];
    const hipR = landmarks[24];
    const kneeL = landmarks[25];
    const kneeR = landmarks[26];
    const ankL = landmarks[27];
    const ankR = landmarks[28];
    const wrL = landmarks[15] || shL;
    const wrR = landmarks[16] || shR;

    // Helper for safe Z coordinate
    const getZ = (pt) => (pt && typeof pt.z === 'number' ? pt.z : 0.0);

    // 1. Compute Center of Mass (CoM) for each Dempster segment
    // Segment 0: Trunk (midpoint between shoulders and hips)
    const trunk = this.segments[0];
    trunk.x = (shL.x + shR.x + hipL.x + hipR.x) * 0.25;
    trunk.z = (getZ(shL) + getZ(shR) + getZ(hipL) + getZ(hipR)) * 0.25;

    // Segment 1: Thigh Left (midpoint hip to knee)
    const thighL = this.segments[1];
    thighL.x = (hipL.x + kneeL.x) * 0.5;
    thighL.z = (getZ(hipL) + getZ(kneeL)) * 0.5;

    // Segment 2: Thigh Right (midpoint hip to knee)
    const thighR = this.segments[2];
    thighR.x = (hipR.x + kneeR.x) * 0.5;
    thighR.z = (getZ(hipR) + getZ(kneeR)) * 0.5;

    // Segment 3: Shank Left (midpoint knee to ankle)
    const shankL = this.segments[3];
    shankL.x = (kneeL.x + ankL.x) * 0.5;
    shankL.z = (getZ(kneeL) + getZ(ankL)) * 0.5;

    // Segment 4: Shank Right (midpoint knee to ankle)
    const shankR = this.segments[4];
    shankR.x = (kneeR.x + ankR.x) * 0.5;
    shankR.z = (getZ(kneeR) + getZ(ankR)) * 0.5;

    // Segment 5: Upper Body / Arm Left (midpoint shoulder to wrist)
    const upperL = this.segments[5];
    upperL.x = (shL.x + wrL.x) * 0.5;
    upperL.z = (getZ(shL) + getZ(wrL)) * 0.5;

    // Segment 6: Upper Body / Arm Right (midpoint shoulder to wrist)
    const upperR = this.segments[6];
    upperR.x = (shR.x + wrR.x) * 0.5;
    upperR.z = (getZ(shR) + getZ(wrR)) * 0.5;

    // 2. Compute Vertical Centroidal Axis (Weighted CoM X and Z)
    let comX = 0;
    let comZ = 0;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      comX += seg.x * seg.massFraction;
      comZ += seg.z * seg.massFraction;
    }

    // 3. Compute Perpendicular Distance (r_perp) and Sum: I = sum(m_i * r_i^2)
    let totalInertia = 0.85; // Baseline intrinsic body cylinder inertia
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      const dx = (seg.x - comX) * S;
      const dz = (seg.z - comZ) * S;
      const rPerp = Math.hypot(dx, dz);
      seg.r = rPerp;

      const segMass = seg.massFraction * mass;
      totalInertia += segMass * (rPerp * rPerp);
    }

    this.momentOfInertia = Number(totalInertia.toFixed(2));

    // 4. Compute Transverse Angular Velocity (omega = dTheta / dt)
    // Transverse shoulder orientation relative to X-Z plane
    const dxShoulders = (shR.x - shL.x) * S;
    const dzShoulders = (getZ(shR) - getZ(shL)) * S;
    const currentTheta = Math.atan2(dzShoulders, dxShoulders);

    if (this.lastTheta !== null && this.lastTimestamp > 0) {
      let dt = (timestamp - this.lastTimestamp) / 1000.0;
      if (dt > 0.001 && dt < 0.2) {
        let dTheta = currentTheta - this.lastTheta;
        // Unwrap angular discontinuity [-PI, PI]
        while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
        while (dTheta < -Math.PI) dTheta += 2 * Math.PI;

        const rawOmega = dTheta / dt;
        // EMA filter on angular velocity to suppress high-frequency landmark tremor
        this.smoothedOmega = this.smoothedOmega * 0.65 + rawOmega * 0.35;
      }
    }

    this.lastTheta = currentTheta;
    this.lastTimestamp = timestamp;

    this.angularVelocity = Number(this.smoothedOmega.toFixed(2));

    // 5. Calculate Angular Momentum: L = I * omega
    const L = totalInertia * Math.abs(this.smoothedOmega);
    this.angularMomentum = Number(L.toFixed(2));

    // 6. Turnover Speed Classification
    const absOmega = Math.abs(this.smoothedOmega);
    if (absOmega >= 2.2) {
      this.turnoverSpeed = 'FAST';
    } else if (absOmega >= 0.8) {
      this.turnoverSpeed = 'MODERATE';
    } else {
      this.turnoverSpeed = 'STEADY';
    }

    return this.getLastResult();
  }

  /**
   * Returns current cached inertia calculation result.
   */
  getLastResult() {
    const displayLabel = `INERTIA (I): ${this.momentOfInertia.toFixed(1)} kg·m² | TURNOVER SPEED: ${this.turnoverSpeed}`;
    return {
      momentOfInertia: this.momentOfInertia,
      angularVelocity: this.angularVelocity,
      angularMomentum: this.angularMomentum,
      turnoverSpeed: this.turnoverSpeed,
      displayLabel
    };
  }

  /**
   * Resets temporal velocity tracking between reps/sets.
   */
  reset() {
    this.lastTheta = null;
    this.lastTimestamp = 0;
    this.smoothedOmega = 0;
    this.angularVelocity = 0;
    this.angularMomentum = 0;
    this.turnoverSpeed = 'STEADY';
  }
}
