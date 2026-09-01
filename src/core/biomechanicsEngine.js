/**
 * @fileoverview Layer 3: Biomechanics Engine.
 * Computes advanced sports science metrics: Knee Valgus (medial collapse),
 * concentric rep velocities, bilateral symmetry index, and trailing bar path coordinates.
 */

/**
 * Velocity categories for color grading trajectories.
 * @enum {string}
 */
export const VelocityCategory = {
  NORMAL: 'NORMAL',       // Cyan
  EXPLOSIVE: 'EXPLOSIVE', // Magenta
  FATIGUE: 'FATIGUE',     // Amber
};

export class BiomechanicsEngine {
  constructor() {
    /**
     * Trailing coordinates buffer for bar path tracing.
     * @type {Array<{ x: number, y: number, z: number, velocity: number, category: string, time: number }>}
     */
    this.barPath = [];

    /** @type {number} Maximum trailing points retained */
    this.MAX_PATH_POINTS = 35;

    /** @type {number} Timestamp of last velocity sample */
    this.lastSampleTime = 0;
    /** @type {number} Previous vertical position (normalized) */
    this.lastPositionY = 0;
  }

  /**
   * Evaluates frontal-plane knee valgus (inward knee collapse) during squats.
   * Compares knee medial displacement relative to the hip-ankle axis.
   * 
   * @param {{ x: number, y: number }} hip
   * @param {{ x: number, y: number }} knee
   * @param {{ x: number, y: number }} ankle
   * @param {number} midHipX X coordinate of body center (midpoint of both hips)
   * @param {boolean} isLeft True if analyzing left leg
   * @returns {{ hasValgus: boolean, deviation: number, correctiveVector: { startX: number, startY: number, targetX: number, targetY: number } }}
   */
  calculateValgus(hip, knee, ankle, midHipX, isLeft) {
    if (!hip || !knee || !ankle) {
      return { hasValgus: false, deviation: 0, correctiveVector: { startX: 0, startY: 0, targetX: 0, targetY: 0 } };
    }

    // Expected neutral knee X is along line from hip to ankle at knee Y
    const t = (knee.y - hip.y) / (ankle.y - hip.y || 1);
    const expectedNeutralX = hip.x + t * (ankle.x - hip.x);

    // Medial displacement: knee moving closer to body centerline midHipX than expected
    const expectedDistToCenter = Math.abs(expectedNeutralX - midHipX);
    const actualDistToCenter = Math.abs(knee.x - midHipX);

    // Deviation in normalized screen space
    const medialDisplacement = expectedDistToCenter - actualDistToCenter;
    const safetyThreshold = 0.045; // ~4.5% of viewport width

    const hasValgus = medialDisplacement > safetyThreshold;

    // Corrective vector points outward (away from body center)
    const outwardDirection = isLeft ? -1 : 1;
    const arrowLength = 0.06;

    return {
      hasValgus,
      deviation: Math.max(0, medialDisplacement),
      correctiveVector: {
        startX: knee.x,
        startY: knee.y,
        targetX: knee.x + (outwardDirection * arrowLength),
        targetY: knee.y
      }
    };
  }

  /**
   * Computes concentric (ascent) vertical velocity in estimated m/s.
   * 
   * @param {number} currentY Current normalized vertical position.
   * @param {number} currentTime Current timestamp in milliseconds.
   * @returns {number} Velocity in meters per second.
   */
  calculateRepVelocity(currentY, currentTime) {
    if (!this.lastSampleTime || !this.lastPositionY) {
      this.lastSampleTime = currentTime;
      this.lastPositionY = currentY;
      return 0;
    }

    const deltaSec = (currentTime - this.lastSampleTime) / 1000;
    if (deltaSec <= 0.001) return 0;

    // Upward movement is negative delta in screen coordinates (Y=0 at top)
    const deltaY = this.lastPositionY - currentY;
    
    // Scale normalized delta to human height estimate (1.75m full height)
    const metersDisplaced = Math.max(0, deltaY * 1.75);
    const velocity = metersDisplaced / deltaSec;

    this.lastSampleTime = currentTime;
    this.lastPositionY = currentY;

    return velocity;
  }

  /**
   * Records a trailing point along the active joint path.
   * 
   * @param {{ x: number, y: number, z?: number }} point
   * @param {number} velocity Current velocity in m/s.
   * @returns {Array<{ x: number, y: number, z: number, velocity: number, category: string }>}
   */
  trackBarPath(point, velocity) {
    if (!point) return this.barPath;

    let category = VelocityCategory.NORMAL;
    if (velocity >= 0.50) {
      category = VelocityCategory.EXPLOSIVE;
    } else if (velocity > 0 && velocity < 0.22) {
      category = VelocityCategory.FATIGUE;
    }

    this.barPath.push({
      x: point.x,
      y: point.y,
      z: point.z || 0,
      velocity,
      category,
      time: performance.now()
    });

    if (this.barPath.length > this.MAX_PATH_POINTS) {
      this.barPath.shift();
    }

    return this.barPath;
  }

  /**
   * Computes bilateral asymmetry index and left/right balance percentages.
   * 
   * @param {number} leftAngle Angle of left joint in degrees.
   * @param {number} rightAngle Angle of right joint in degrees.
   * @returns {{ asymmetryPct: number, symmetryScore: number, leftPct: number, rightPct: number }}
   */
  calculateSymmetry(leftAngle, rightAngle) {
    if (!leftAngle || !rightAngle) {
      return { asymmetryPct: 0, symmetryScore: 100, leftPct: 50, rightPct: 50 };
    }

    const maxAngle = Math.max(leftAngle, rightAngle, 1);
    const diff = Math.abs(leftAngle - rightAngle);
    const asymmetryPct = (diff / maxAngle) * 100;
    const symmetryScore = Math.max(0, 100 - asymmetryPct);

    // Distribution: greater angle flex / extension
    const sum = leftAngle + rightAngle;
    const leftPct = Math.round((leftAngle / sum) * 100);
    const rightPct = 100 - leftPct;

    return {
      asymmetryPct: Number(asymmetryPct.toFixed(1)),
      symmetryScore: Number(symmetryScore.toFixed(1)),
      leftPct,
      rightPct
    };
  }

  /**
   * Calculates bar path sway consistency rating (A/B/C/D) based on horizontal deviation.
   * 
   * @param {Array<{ x: number, y: number }>} fullPath
   * @returns {{ rating: string, horizontalVariance: number }}
   */
  evaluateBarPathConsistency(fullPath) {
    if (!fullPath || fullPath.length < 5) {
      return { rating: 'A', horizontalVariance: 0 };
    }

    const xCoords = fullPath.map(p => p.x);
    const meanX = xCoords.reduce((a, b) => a + b, 0) / xCoords.length;
    const variance = xCoords.reduce((acc, x) => acc + Math.pow(x - meanX, 2), 0) / xCoords.length;
    const stdDevPct = Math.sqrt(variance) * 100;

    let rating = 'A';
    if (stdDevPct > 15) {
      rating = 'D';
    } else if (stdDevPct > 10) {
      rating = 'C';
    } else if (stdDevPct > 5) {
      rating = 'B';
    }

    return { rating, horizontalVariance: Number(stdDevPct.toFixed(1)) };
  }

  /**
   * Estimates total mechanical work done during workout in Joules and kcal.
   * 
   * @param {number} totalReps
   * @param {string} exerciseKey
   * @param {number} [userBodyweightKg=75]
   * @returns {{ joules: number, kcal: number }}
   */
  calculateMechanicalWork(totalReps, exerciseKey, userBodyweightKg = 75) {
    // Work = Force * Distance = (mass * g) * displacement * reps
    // Squat: moves ~70% of body mass through ~0.55m vertical displacement per rep
    // Curl: moves ~15% of body mass (arms/weights) through ~0.40m displacement
    const effectiveMassKg = exerciseKey === 'SQUAT' ? (userBodyweightKg * 0.70) : (userBodyweightKg * 0.15);
    const displacementM = exerciseKey === 'SQUAT' ? 0.55 : 0.40;
    const g = 9.81;

    const joulesPerRep = effectiveMassKg * g * displacementM * 2; // concentric + eccentric
    const totalJoules = Math.round(joulesPerRep * totalReps);
    const kcal = Number((totalJoules / 4184).toFixed(1));

    return { joules: totalJoules, kcal };
  }

  /**
   * Resets trailing buffer for memory-safe state cleanup.
   */
  clearBarPath() {
    this.barPath = [];
    this.lastSampleTime = 0;
    this.lastPositionY = 0;
  }
}
