/**
 * @fileoverview Layer 2: Deterministic Exercise Repetition State Machine.
 * Tracks movement phases (descent, inflection, ascent), computes eccentric/concentric phase timings,
 * and analyzes velocity loss percentage to predict muscular fatigue.
 */

import { EXERCISE_RULES } from '../config/exerciseRules.js';

/**
 * Valid FSM operational states.
 * @enum {string}
 */
export const State = {
  IDLE: 'IDLE',
  SETUP: 'SETUP',
  IN_PROGRESS: 'IN_PROGRESS',
  VALIDATED_SUCCESS: 'VALIDATED_SUCCESS',
  FORM_FAULT: 'FORM_FAULT',
};

/**
 * Manages gym exercise transitions and repetition validation.
 */
export class StateMachine {
  constructor() {
    /** @type {string} */
    this.currentState = State.IDLE;
    /** @type {number} */
    this.repCount = 0;
    /** @type {boolean} */
    this.hasFault = false;
    /** @type {string} */
    this.faultMessage = '';
    /**
     * Set to true when the user reaches the inflection midpoint (squat bottom / curl peak).
     * @type {boolean}
     * @private
     */
    this.midpointAchieved = false;

    // Phase timings & velocity tracking
    /** @type {number} */
    this.eccentricStartTime = 0;
    /** @type {number} */
    this.concentricStartTime = 0;
    /** @type {number} In seconds */
    this.lastEccentricDuration = 0;
    /** @type {number} In seconds */
    this.lastConcentricDuration = 0;
    /** @type {number} In deg/s */
    this.lastConcentricVelocity = 0;

    /** @type {number[]} Initial reps baseline velocities */
    this.baselineVelocities = [];
    /** @type {number} Percentage velocity loss */
    this.velocityLoss = 0;
    /** @type {boolean} True if velocity loss >= 25% */
    this.isFatigued = false;

    /** @type {number} Minimum angle achieved during descent */
    this.peakDepthAngle = 180;
  }

  /**
   * Resets FSM state, flags, and rep counter.
   * @returns {Object}
   */
  reset() {
    this.currentState = State.IDLE;
    this.repCount = 0;
    this.hasFault = false;
    this.faultMessage = '';
    this.midpointAchieved = false;

    this.eccentricStartTime = 0;
    this.concentricStartTime = 0;
    this.lastEccentricDuration = 0;
    this.lastConcentricDuration = 0;
    this.lastConcentricVelocity = 0;
    this.baselineVelocities = [];
    this.velocityLoss = 0;
    this.isFatigued = false;
    this.peakDepthAngle = 180;

    return {
      currentState: this.currentState,
      repCount: this.repCount,
      hasFault: this.hasFault,
      faultMessage: this.faultMessage,
      phaseTimings: {
        eccentricDuration: 0,
        concentricDuration: 0,
        concentricVelocity: 0
      },
      velocityLoss: 0,
      isFatigued: false
    };
  }

  /**
   * Processes current angles and resolves FSM state transition.
   * 
   * @param {string} exerciseKey Selected exercise ('SQUAT' | 'BICEP_CURL').
   * @param {number} currentAngle Current joint angle in degrees.
   * @param {number} [torsoIncline=0] Torso tilt angle relative to vertical Y-axis (Squat only).
   * @returns {{ currentState: string, repCount: number, hasFault: boolean, faultMessage: string, phaseTimings: { eccentricDuration: number, concentricDuration: number, concentricVelocity: number }, velocityLoss: number, isFatigued: boolean }}
   */
  update(exerciseKey, currentAngle, torsoIncline = 0) {
    const now = performance.now();

    if (exerciseKey === 'SQUAT') {
      const config = EXERCISE_RULES.SQUAT;

      // Incline limit verification
      if (torsoIncline > config.thresholds.maxTorsoIncline) {
        this.currentState = State.FORM_FAULT;
        this.hasFault = true;
        this.faultMessage = 'Keep torso upright';

        return this._getStatePayload();
      }

      // Recover from form fault if torso corrected
      if (this.currentState === State.FORM_FAULT) {
        this.hasFault = false;
        this.faultMessage = '';
        this.currentState = State.SETUP;
      }

      switch (this.currentState) {
        case State.IDLE:
          if (currentAngle >= config.thresholds.standingMin) {
            this.currentState = State.SETUP;
            this.midpointAchieved = false;
            this.eccentricStartTime = 0;
          }
          break;

        case State.SETUP:
          // Detect beginning of descent
          if (currentAngle < 155 && !this.eccentricStartTime) {
            this.eccentricStartTime = now;
            this.peakDepthAngle = currentAngle;
          }
          if (this.eccentricStartTime) {
            this.peakDepthAngle = Math.min(this.peakDepthAngle, currentAngle);
          }

          if (currentAngle <= config.thresholds.depthMax) {
            this.currentState = State.IN_PROGRESS;
            this.midpointAchieved = true;
            if (this.eccentricStartTime) {
              this.lastEccentricDuration = Number(((now - this.eccentricStartTime) / 1000).toFixed(2));
            }
            this.concentricStartTime = now;
          }
          break;

        case State.IN_PROGRESS:
          this.peakDepthAngle = Math.min(this.peakDepthAngle, currentAngle);

          if (currentAngle >= config.thresholds.standingMin) {
            if (this.midpointAchieved) {
              this._recordRepCompletion(now, currentAngle);
            } else {
              this.currentState = State.SETUP;
              this.eccentricStartTime = 0;
            }
          }
          break;

        case State.VALIDATED_SUCCESS:
          this.currentState = State.SETUP;
          break;

        default:
          break;
      }

    } else if (exerciseKey === 'BICEP_CURL') {
      const config = EXERCISE_RULES.BICEP_CURL;

      switch (this.currentState) {
        case State.IDLE:
          if (currentAngle >= config.thresholds.extensionMin) {
            this.currentState = State.SETUP;
            this.midpointAchieved = false;
            this.eccentricStartTime = 0;
          }
          break;

        case State.SETUP:
          if (currentAngle < 145 && !this.eccentricStartTime) {
            this.eccentricStartTime = now;
            this.peakDepthAngle = currentAngle;
          }
          if (this.eccentricStartTime) {
            this.peakDepthAngle = Math.min(this.peakDepthAngle, currentAngle);
          }

          if (currentAngle <= config.thresholds.contractionMax) {
            this.currentState = State.IN_PROGRESS;
            this.midpointAchieved = true;
            if (this.eccentricStartTime) {
              this.lastEccentricDuration = Number(((now - this.eccentricStartTime) / 1000).toFixed(2));
            }
            this.concentricStartTime = now;
          }
          break;

        case State.IN_PROGRESS:
          this.peakDepthAngle = Math.min(this.peakDepthAngle, currentAngle);

          if (currentAngle >= config.thresholds.extensionMin) {
            if (this.midpointAchieved) {
              this._recordRepCompletion(now, currentAngle);
            } else {
              this.currentState = State.SETUP;
              this.eccentricStartTime = 0;
            }
          }
          break;

        case State.VALIDATED_SUCCESS:
          this.currentState = State.SETUP;
          break;

        default:
          break;
      }
    }

    return this._getStatePayload();
  }

  /**
   * Helper to finalize repetition validation and compute velocity metrics.
   * 
   * @param {number} now
   * @param {number} currentAngle
   * @private
   */
  _recordRepCompletion(now, currentAngle) {
    this.currentState = State.VALIDATED_SUCCESS;
    this.repCount++;
    this.midpointAchieved = false;

    // Calculate concentric ascent duration & velocity
    if (this.concentricStartTime > 0) {
      this.lastConcentricDuration = Number(((now - this.concentricStartTime) / 1000).toFixed(2));
      const angularDisplacement = Math.abs(currentAngle - this.peakDepthAngle);
      this.lastConcentricVelocity = this.lastConcentricDuration > 0.05 ?
        Number((angularDisplacement / this.lastConcentricDuration).toFixed(1)) : 0;
    }

    // Velocity loss calculation (baseline vs current)
    if (this.repCount <= 2 && this.lastConcentricVelocity > 0) {
      this.baselineVelocities.push(this.lastConcentricVelocity);
    } else if (this.baselineVelocities.length > 0 && this.lastConcentricVelocity > 0) {
      const baselineAvg = this.baselineVelocities.reduce((a, b) => a + b, 0) / this.baselineVelocities.length;
      const loss = ((baselineAvg - this.lastConcentricVelocity) / baselineAvg) * 100;
      this.velocityLoss = Math.max(0, Number(loss.toFixed(1)));
      this.isFatigued = this.velocityLoss >= 25.0;
    }

    this.eccentricStartTime = 0;
    this.concentricStartTime = 0;
    this.peakDepthAngle = 180;
  }

  /**
   * Constructs the telemetry return payload.
   * @returns {Object}
   * @private
   */
  _getStatePayload() {
    return {
      currentState: this.currentState,
      repCount: this.repCount,
      hasFault: this.hasFault,
      faultMessage: this.faultMessage,
      phaseTimings: {
        eccentricDuration: this.lastEccentricDuration,
        concentricDuration: this.lastConcentricDuration,
        concentricVelocity: this.lastConcentricVelocity,
      },
      velocityLoss: this.velocityLoss,
      isFatigued: this.isFatigued,
    };
  }
}
