/**
 * @fileoverview Layer 1: AR Spatial Laser Constraints & Corridor Boundary Enforcement.
 * Defines real-time geometrical movement limit planes (e.g. forward knee travel, bilateral
 * hip sway corridor, and lumbar sag limits). Checks joint violations against boundary planes
 * and generates biomechanical corrective penances when movement corridors are breached.
 */

export class LaserConstraints {
  constructor() {
    /**
     * Active constraint boundaries.
     * @type {Array<{
     *   id: string,
     *   axis: 'x'|'y',
     *   limitValue: number,
     *   constraintType: string,
     *   jointIndices: number[],
     *   jointName: string,
     *   direction: 'greater'|'less',
     *   label: string,
     *   penance: string,
     *   isBreached: boolean
     * }>}
     */
    this.walls = [];

    /** @type {boolean} */
    this.isAutoCalibrated = false;

    /** @type {number} Timestamp of the latest boundary breach */
    this.lastBreachedTime = 0;
  }

  /**
   * Defines or updates a spatial limit plane along an axis.
   * 
   * @param {'x'|'y'} axis Constraint coordinate axis ('x' for vertical plane, 'y' for horizontal).
   * @param {number} limitValue Normalized coordinate threshold [0.0 - 1.0].
   * @param {string} constraintType Unique type identifier (e.g., 'MAX_KNEE_FORWARD').
   * @param {Object} [options]
   * @param {number[]} [options.jointIndices] Target landmark indices to test.
   * @param {string} [options.jointName='JOINT'] Name of target joint.
   * @param {'greater'|'less'} [options.direction='greater'] Breach condition direction.
   * @param {string} [options.label] Display label for HUD.
   * @param {string} [options.penance] Corrective coaching feedback cue.
   */
  setLimitWall(axis, limitValue, constraintType, options = {}) {
    const existingIndex = this.walls.findIndex(w => w.constraintType === constraintType);

    const wallEntry = {
      id: constraintType,
      axis: axis === 'y' ? 'y' : 'x',
      limitValue: Math.max(0.02, Math.min(0.98, limitValue)),
      constraintType,
      jointIndices: options.jointIndices || (constraintType.includes('KNEE') ? [25, 26] : [23, 24]),
      jointName: options.jointName || 'JOINT',
      direction: options.direction || 'greater',
      label: options.label || constraintType.replace(/_/g, ' '),
      penance: options.penance || 'MOVEMENT BOUNDARY BREACHED - RE-CENTER FORM',
      isBreached: false
    };

    if (existingIndex >= 0) {
      this.walls[existingIndex] = wallEntry;
    } else {
      this.walls.push(wallEntry);
    }
  }

  /**
   * Evaluates landmark coordinates against all active laser constraint limit walls.
   * 
   * @param {Array<{ x: number, y: number, z?: number, visibility?: number }>} landmarks
   * @returns {{ isBreached: boolean, breachedJoint: string, penance: string, walls: Array<Object> }}
   */
  checkViolations(landmarks) {
    if (!landmarks || landmarks.length < 25) {
      return {
        isBreached: false,
        breachedJoint: '',
        penance: '',
        walls: this.getWalls()
      };
    }

    let isAnyBreached = false;
    let firstBreachedJoint = '';
    let firstBreachedPenance = '';

    for (let i = 0; i < this.walls.length; i++) {
      const wall = this.walls[i];
      let wallViolated = false;

      for (let j = 0; j < wall.jointIndices.length; j++) {
        const jointIdx = wall.jointIndices[j];
        const pt = landmarks[jointIdx];

        if (pt && (pt.visibility === undefined || pt.visibility > 0.35)) {
          const coord = wall.axis === 'x' ? pt.x : pt.y;

          if (wall.direction === 'greater' && coord > wall.limitValue) {
            wallViolated = true;
          } else if (wall.direction === 'less' && coord < wall.limitValue) {
            wallViolated = true;
          }
        }
      }

      wall.isBreached = wallViolated;
      if (wallViolated) {
        isAnyBreached = true;
        if (!firstBreachedJoint) {
          firstBreachedJoint = wall.jointName;
          firstBreachedPenance = wall.penance;
        }
      }
    }

    if (isAnyBreached) {
      this.lastBreachedTime = performance.now();
    }

    return {
      isBreached: isAnyBreached,
      breachedJoint: firstBreachedJoint,
      penance: firstBreachedPenance,
      walls: this.getWalls()
    };
  }

  /**
   * Automatically calibrates biomechanical laser corridor boundaries based on initial stance.
   * 
   * @param {string} exerciseKey 'SQUAT' | 'PUSHUP' | 'BICEP_CURL'
   * @param {Array<{ x: number, y: number, z?: number, visibility?: number }>} landmarks
   */
  autoCalibrate(exerciseKey, landmarks) {
    if (!landmarks || landmarks.length < 29) return;

    this.walls = [];

    if (exerciseKey === 'SQUAT') {
      const hipL = landmarks[23];
      const hipR = landmarks[24];
      const ankleL = landmarks[27];
      const ankleR = landmarks[28];

      if (hipL && hipR) {
        const midHipX = (hipL.x + hipR.x) / 2;
        const hipWidth = Math.abs(hipL.x - hipR.x);
        const lateralTolerance = Math.max(0.06, hipWidth * 0.75);

        // Bilateral Hip Sway Corridor (Left & Right limit planes)
        this.setLimitWall('x', midHipX - lateralTolerance, 'HIP_SWAY_LEFT', {
          direction: 'less',
          jointIndices: [23, 24],
          jointName: 'HIP',
          label: 'CORRIDOR BOUNDARY (L)',
          penance: 'EXCESSIVE LEFT HIP SWAY - ENGAGE CORE'
        });

        this.setLimitWall('x', midHipX + lateralTolerance, 'HIP_SWAY_RIGHT', {
          direction: 'greater',
          jointIndices: [23, 24],
          jointName: 'HIP',
          label: 'CORRIDOR BOUNDARY (R)',
          penance: 'EXCESSIVE RIGHT HIP SWAY - ENGAGE CORE'
        });
      }

      if (ankleL && ankleR) {
        // Anterior Knee Travel Limit (Sagittal Knee-over-Toes Wall)
        const forwardToeLimit = Math.max(ankleL.x, ankleR.x) + 0.08;
        this.setLimitWall('x', forwardToeLimit, 'MAX_KNEE_FORWARD', {
          direction: 'greater',
          jointIndices: [25, 26],
          jointName: 'KNEE',
          label: 'MAX KNEE FORWARD',
          penance: 'KNEE OVER TOES DETECTED - SHIFT WEIGHT BACK'
        });
      }
    } else if (exerciseKey === 'PUSHUP') {
      const hipL = landmarks[23];
      const hipR = landmarks[24];
      if (hipL && hipR) {
        const midHipY = (hipL.y + hipR.y) / 2;
        // Lumbar spine sag limit plane (Horizontal limit)
        this.setLimitWall('y', midHipY + 0.10, 'HIP_SAG_LIMIT', {
          direction: 'greater',
          jointIndices: [23, 24],
          jointName: 'LUMBAR',
          label: 'LUMBAR SAG LIMIT',
          penance: 'HIPS SAGGING - SQUEEZE GLUTES & BRACE CORE'
        });
      }
    } else if (exerciseKey === 'BICEP_CURL') {
      const elbowL = landmarks[13];
      const elbowR = landmarks[14];
      if (elbowL && elbowR) {
        this.setLimitWall('x', elbowL.x - 0.07, 'ELBOW_FLARE_LEFT', {
          direction: 'less',
          jointIndices: [13],
          jointName: 'ELBOW',
          label: 'ELBOW FLARE (L)',
          penance: 'ELBOW FLARING OUT - KEEP ELBOW TUCKED'
        });
        this.setLimitWall('x', elbowR.x + 0.07, 'ELBOW_FLARE_RIGHT', {
          direction: 'greater',
          jointIndices: [14],
          jointName: 'ELBOW',
          label: 'ELBOW FLARE (R)',
          penance: 'ELBOW FLARING OUT - KEEP ELBOW TUCKED'
        });
      }
    }

    this.isAutoCalibrated = true;
  }

  /**
   * Returns current active boundary limit walls.
   * @returns {Array<Object>}
   */
  getWalls() {
    return this.walls.map(w => ({ ...w }));
  }

  /**
   * Clears active limit walls.
   */
  reset() {
    this.walls = [];
    this.isAutoCalibrated = false;
    this.lastBreachedTime = 0;
  }
}
