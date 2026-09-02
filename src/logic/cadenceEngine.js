/**
 * @fileoverview Layer 2: Cadence Tempo Engine.
 * Paces the athlete through the gold-standard 3-1-1 tempo:
 * - 3s Eccentric Descent
 * - 1s Isometric Pause at target depth
 * - 1s Concentric Ascent
 * Tracks real-time Time Under Tension (TUT) and detects rushed descents (< 1.0s).
 */

export const CadencePhase = {
  REST: 'REST',
  ECCENTRIC: 'ECCENTRIC',   // 3s
  ISOMETRIC: 'ISOMETRIC',   // 1s
  CONCENTRIC: 'CONCENTRIC', // 1s
};

export class CadenceEngine {
  constructor() {
    /** @type {string} Current tempo phase */
    this.currentPhase = CadencePhase.REST;

    /** @type {number} Target phase durations in seconds */
    this.TARGET_TEMPO = {
      [CadencePhase.ECCENTRIC]: 3.0,
      [CadencePhase.ISOMETRIC]: 1.0,
      [CadencePhase.CONCENTRIC]: 1.0,
    };

    /** @type {number} Timestamp when active phase began */
    this.phaseStartTime = 0;
    /** @type {number} Total set Time Under Tension in seconds */
    this.totalTimeUnderTension = 0;
    /** @type {number} Rep-specific Time Under Tension in seconds */
    this.repTUT = 0;
    /** @type {number} Start timestamp of current rep */
    this.repStartTime = 0;

    /** @type {boolean} Flagged if descent was completed in under 1.0 second */
    this.isRushed = false;
    /** @type {boolean} Whether current rep tempo is within acceptable variance */
    this.isPaceCompliant = true;

    /** @type {number} Recorded duration of descent */
    this.eccentricDuration = 0;
    /** @type {number} Previous FSM state */
    this.lastState = 'IDLE';
  }

  /**
   * Resets cadence states and active timers.
   */
  reset() {
    this.currentPhase = CadencePhase.REST;
    this.phaseStartTime = 0;
    this.totalTimeUnderTension = 0;
    this.repTUT = 0;
    this.repStartTime = 0;
    this.isRushed = false;
    this.isPaceCompliant = true;
    this.eccentricDuration = 0;
    this.lastState = 'IDLE';
  }

  /**
   * Updates cadence pacing against the active exercise motion state.
   * 
   * @param {string} currentState FSM state ('SETUP' | 'IN_PROGRESS' | 'VALIDATED_SUCCESS' | 'FORM_FAULT').
   * @param {number} currentAngle Joint angle in degrees.
   * @param {boolean} midpointAchieved True if user has reached bottom inflection.
   * @returns {{ phase: string, phaseProgress: number, isPaceCompliant: boolean, isRushed: boolean, repTUT: number, totalTUT: number, targetDuration: number }}
   */
  update(currentState, currentAngle, midpointAchieved) {
    const now = performance.now();

    // Detect transition into active descent (Eccentric phase)
    if (currentState === 'SETUP' && currentAngle < 155 && this.currentPhase === CadencePhase.REST) {
      this.currentPhase = CadencePhase.ECCENTRIC;
      this.phaseStartTime = now;
      this.repStartTime = now;
      this.isRushed = false;
      this.isPaceCompliant = true;
    }

    // Detect arrival at bottom inflection (Isometric hold phase)
    if (currentState === 'IN_PROGRESS' && midpointAchieved && this.currentPhase === CadencePhase.ECCENTRIC) {
      this.eccentricDuration = (now - this.phaseStartTime) / 1000;
      
      // Rushed descent detection: faster than 1.0s
      if (this.eccentricDuration < 1.0) {
        this.isRushed = true;
        this.isPaceCompliant = false;
      }

      this.currentPhase = CadencePhase.ISOMETRIC;
      this.phaseStartTime = now;
    }

    // Detect ascent beginning (Concentric phase)
    if (currentState === 'IN_PROGRESS' && this.currentPhase === CadencePhase.ISOMETRIC) {
      const holdTime = (now - this.phaseStartTime) / 1000;
      if (holdTime >= 0.75 || currentAngle > 115) {
        this.currentPhase = CadencePhase.CONCENTRIC;
        this.phaseStartTime = now;
      }
    }

    // Detect repetition completion
    if (currentState === 'VALIDATED_SUCCESS') {
      if (this.currentPhase !== CadencePhase.REST) {
        const completedRepTUT = this.repStartTime > 0 ? (now - this.repStartTime) / 1000 : 0;
        this.totalTimeUnderTension += completedRepTUT;
      }
      this.currentPhase = CadencePhase.REST;
      this.phaseStartTime = 0;
      this.repStartTime = 0;
    }

    // Accumulate active rep TUT
    if (this.currentPhase !== CadencePhase.REST && this.repStartTime > 0) {
      this.repTUT = Number(((now - this.repStartTime) / 1000).toFixed(1));
    } else {
      this.repTUT = 0;
    }

    // Calculate normalized progress [0.0 - 1.0] through current phase
    let phaseProgress = 0;
    const targetDuration = this.TARGET_TEMPO[this.currentPhase] || 1.0;

    if (this.currentPhase !== CadencePhase.REST && this.phaseStartTime > 0) {
      const elapsed = (now - this.phaseStartTime) / 1000;
      phaseProgress = Math.min(1.0, elapsed / targetDuration);
    }

    this.lastState = currentState;

    return {
      phase: this.currentPhase,
      phaseProgress,
      isPaceCompliant: this.isPaceCompliant,
      isRushed: this.isRushed,
      repTUT: this.repTUT,
      totalTUT: Number(this.totalTimeUnderTension.toFixed(1)),
      targetDuration,
    };
  }
}
