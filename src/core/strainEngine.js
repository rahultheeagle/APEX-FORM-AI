/**
 * @fileoverview Layer 3 (Biomechanics): strainEngine.js
 * Kinetic Muscle Strain & Joint Torque Estimation Engine.
 * Analyzes 3D metric world landmarks to compute gravitational moment arms,
 * perpendicular lever distances (d_perp), and normalized instantaneous mechanical
 * strain loads (0.0 - 1.0) across major muscle groups:
 * - Quadriceps (knee moment arm & deep flexion under load)
 * - Erector Spinae (lumbar shear moment arm & torso inclination)
 * - Gluteals (hip hinge transition & pelvic moment arm)
 */

export class StrainEngine {
  constructor() {
    /** @type {number} Exponential smoothing factor for muscle load telemetry */
    this.SMOOTHING_ALPHA = 0.45;

    // Smoothed historical loads
    this.smoothedQuads = 0;
    this.smoothedLowerBack = 0;
    this.smoothedGlutes = 0;
  }

  /**
   * Resets internal smoothing accumulators.
   */
  reset() {
    this.smoothedQuads = 0;
    this.smoothedLowerBack = 0;
    this.smoothedGlutes = 0;
  }

  /**
   * Computes instantaneous kinetic joint torques and normalized muscle strain.
   * 
   * @param {Array<{ x: number, y: number, z: number, visibility?: number }>} worldLandmarks 3D pose landmarks in metric space.
   * @param {string} [exerciseType='SQUAT'] 'SQUAT' | 'BICEP_CURL' | 'PUSHUP'
   * @returns {{
   *   quadsLoad: number,
   *   lowerBackLoad: number,
   *   gluteLoad: number,
   *   quadsPct: number,
   *   lowerBackPct: number,
   *   glutePct: number,
   *   peakJoint: string,
   *   peakLoad: number,
   *   status: 'SAFE' | 'MODERATE' | 'OVERLOAD'
   * }}
   */
  computeJointTorques(worldLandmarks, exerciseType = 'SQUAT') {
    if (!worldLandmarks || worldLandmarks.length < 29) {
      return {
        quadsLoad: 0,
        lowerBackLoad: 0,
        gluteLoad: 0,
        quadsPct: 0,
        lowerBackPct: 0,
        glutePct: 0,
        peakJoint: 'NONE',
        peakLoad: 0,
        status: 'SAFE'
      };
    }

    const shoulderL = worldLandmarks[11];
    const shoulderR = worldLandmarks[12];
    const hipL = worldLandmarks[23];
    const hipR = worldLandmarks[24];
    const kneeL = worldLandmarks[25];
    const kneeR = worldLandmarks[26];
    const ankleL = worldLandmarks[27];
    const ankleR = worldLandmarks[28];

    // Midpoints
    const midShoulder = {
      x: (shoulderL.x + shoulderR.x) / 2,
      y: (shoulderL.y + shoulderR.y) / 2,
      z: ((shoulderL.z || 0) + (shoulderR.z || 0)) / 2
    };

    const midHip = {
      x: (hipL.x + hipR.x) / 2,
      y: (hipL.y + hipR.y) / 2,
      z: ((hipL.z || 0) + (hipR.z || 0)) / 2
    };

    const midKnee = {
      x: (kneeL.x + kneeR.x) / 2,
      y: (kneeL.y + kneeR.y) / 2,
      z: ((kneeL.z || 0) + (kneeR.z || 0)) / 2
    };

    const midAnkle = {
      x: (ankleL.x + ankleR.x) / 2,
      y: (ankleL.y + ankleR.y) / 2,
      z: ((ankleL.z || 0) + (ankleR.z || 0)) / 2
    };

    // Estimated center of mass (torso + head dominant ~65% along spine from hip to shoulder)
    const com = {
      x: midHip.x * 0.45 + midShoulder.x * 0.55,
      y: midHip.y * 0.45 + midShoulder.y * 0.55,
      z: midHip.z * 0.45 + midShoulder.z * 0.55
    };

    let rawQuadsLoad = 0;
    let rawLowerBackLoad = 0;
    let rawGluteLoad = 0;

    if (exerciseType === 'SQUAT') {
      // 1. Quadriceps Moment Arm: Horizontal perpendicular distance (d_perp) from knee to CoM vector
      // In sagittal/lateral plane (Z/X depth vs Y vertical gravity), distance along horizontal axis:
      const dPerpKnee = Math.hypot(com.x - midKnee.x, (com.z || 0) - (midKnee.z || 0));
      // Knee flexion angle estimation
      const thighLength = Math.max(0.25, Math.hypot(midHip.x - midKnee.x, midHip.y - midKnee.y, (midHip.z || 0) - (midKnee.z || 0)));
      const normalizedKneeLever = Math.min(1.0, dPerpKnee / (thighLength * 0.85));

      // Knee depth factor (lower hip Y relative to knee Y increases extensor torque)
      const depthFactor = Math.max(0, Math.min(1.0, (midHip.y - midKnee.y + 0.15) / 0.35));
      rawQuadsLoad = Math.min(1.0, (normalizedKneeLever * 0.65) + (depthFactor * 0.45));

      // 2. Erector Spinae (Lower Back) Lumbar Shear Moment Arm:
      // Horizontal perpendicular distance between Lumbar (midHip) and Torso CoM / Shoulders
      const dPerpLumbar = Math.hypot(midShoulder.x - midHip.x, (midShoulder.z || 0) - (midHip.z || 0));
      const torsoLength = Math.max(0.35, Math.hypot(midShoulder.x - midHip.x, midShoulder.y - midHip.y, (midShoulder.z || 0) - (midHip.z || 0)));
      // Torso inclination relative to vertical: sin(theta) = dPerpLumbar / torsoLength
      const sinTorsoIncline = Math.min(1.0, dPerpLumbar / torsoLength);
      rawLowerBackLoad = Math.min(1.0, sinTorsoIncline * 1.25);

      // 3. Gluteals: Hip Hinge moment arm + pelvic rearward displacement relative to midAnkle
      const dPerpHip = Math.hypot(midHip.x - midAnkle.x, (midHip.z || 0) - (midAnkle.z || 0));
      const gluteFlexFactor = (sinTorsoIncline * 0.5) + (depthFactor * 0.5);
      rawGluteLoad = Math.min(1.0, Math.max(0, gluteFlexFactor * (dPerpHip > 0.1 ? 1.1 : 0.8)));

    } else if (exerciseType === 'PUSHUP') {
      // In Pushup: Pectorals & Triceps take primary, Lumbar acts as anti-extension core stabilizer
      const dPerpTorso = Math.abs(midShoulder.y - midHip.y);
      const sagittalSag = Math.abs(midHip.y - (midShoulder.y + midAnkle.y) / 2);
      rawLowerBackLoad = Math.min(1.0, sagittalSag * 3.5); // Spine sag under gravity
      rawQuadsLoad = 0.15; // Isometric leg extension
      rawGluteLoad = Math.min(1.0, 0.35 + (rawLowerBackLoad * 0.4));

    } else if (exerciseType === 'BICEP_CURL') {
      // Bicep curl: Low lower back & quads, slight lumbar stabilization if leaning back
      const dPerpTorso = Math.hypot(midShoulder.x - midHip.x, (midShoulder.z || 0) - (midHip.z || 0));
      rawLowerBackLoad = Math.min(1.0, dPerpTorso * 2.2);
      rawQuadsLoad = 0.08;
      rawGluteLoad = 0.10;
    }

    // Apply EMA smoothing filter
    this.smoothedQuads = this.smoothedQuads * (1 - this.SMOOTHING_ALPHA) + rawQuadsLoad * this.SMOOTHING_ALPHA;
    this.smoothedLowerBack = this.smoothedLowerBack * (1 - this.SMOOTHING_ALPHA) + rawLowerBackLoad * this.SMOOTHING_ALPHA;
    this.smoothedGlutes = this.smoothedGlutes * (1 - this.SMOOTHING_ALPHA) + rawGluteLoad * this.SMOOTHING_ALPHA;

    const quadsLoad = Number(Math.max(0, Math.min(1.0, this.smoothedQuads)).toFixed(2));
    const lowerBackLoad = Number(Math.max(0, Math.min(1.0, this.smoothedLowerBack)).toFixed(2));
    const gluteLoad = Number(Math.max(0, Math.min(1.0, this.smoothedGlutes)).toFixed(2));

    const quadsPct = Math.round(quadsLoad * 100);
    const lowerBackPct = Math.round(lowerBackLoad * 100);
    const glutePct = Math.round(gluteLoad * 100);

    // Identify peak joint torque
    let peakJoint = 'QUADRICEPS';
    let peakLoad = quadsLoad;

    if (lowerBackLoad > peakLoad) {
      peakJoint = 'LUMBAR SPINE';
      peakLoad = lowerBackLoad;
    }
    if (gluteLoad > peakLoad) {
      peakJoint = 'GLUTEUS MAX';
      peakLoad = gluteLoad;
    }

    let status = 'SAFE';
    if (peakLoad > 0.72) {
      status = 'OVERLOAD';
    } else if (peakLoad > 0.38) {
      status = 'MODERATE';
    }

    return {
      quadsLoad,
      lowerBackLoad,
      gluteLoad,
      quadsPct,
      lowerBackPct,
      glutePct,
      peakJoint,
      peakLoad,
      status
    };
  }
}
