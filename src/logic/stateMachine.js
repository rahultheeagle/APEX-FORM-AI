/**
 * @fileoverview Layer 2: Deterministic Exercise Repetition State Machine.
 * Tracks movement phases (descent, extension, contraction) and detects posture violations.
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
  }

  /**
   * Resets FSM state, flags, and rep counter.
   * @returns {{currentState: string, repCount: number, hasFault: boolean, faultMessage: string}}
   */
  reset() {
    this.currentState = State.IDLE;
    this.repCount = 0;
    this.hasFault = false;
    this.faultMessage = '';
    this.midpointAchieved = false;

    return {
      currentState: this.currentState,
      repCount: this.repCount,
      hasFault: this.hasFault,
      faultMessage: this.faultMessage,
    };
  }

  /**
   * Processes current angles and resolves FSM state transition.
   * 
   * @param {string} exerciseKey Selected exercise ('SQUAT' | 'BICEP_CURL').
   * @param {number} currentAngle Current joint angle in degrees.
   * @param {number} [torsoIncline=0] Torso tilt angle relative to vertical Y-axis (Squat only).
   * @returns {{currentState: string, repCount: number, hasFault: boolean, faultMessage: string}}
   */
  update(exerciseKey, currentAngle, torsoIncline = 0) {
    if (exerciseKey === 'SQUAT') {
      const config = EXERCISE_RULES.SQUAT;

      // Incline limit verification
      if (torsoIncline > config.thresholds.maxTorsoIncline) {
        this.currentState = State.FORM_FAULT;
        this.hasFault = true;
        this.faultMessage = 'Keep torso upright';

        return {
          currentState: this.currentState,
          repCount: this.repCount,
          hasFault: this.hasFault,
          faultMessage: this.faultMessage,
        };
      }

      // Recover from form fault if torso corrected
      if (this.currentState === State.FORM_FAULT) {
        this.hasFault = false;
        this.faultMessage = '';
        this.currentState = State.SETUP; // Fall back to setup state
      }

      switch (this.currentState) {
        case State.IDLE:
          if (currentAngle >= config.thresholds.standingMin) {
            this.currentState = State.SETUP;
            this.midpointAchieved = false;
          }
          break;

        case State.SETUP:
          if (currentAngle <= config.thresholds.depthMax) {
            this.currentState = State.IN_PROGRESS;
            this.midpointAchieved = true;
          }
          break;

        case State.IN_PROGRESS:
          if (currentAngle >= config.thresholds.standingMin) {
            if (this.midpointAchieved) {
              this.currentState = State.VALIDATED_SUCCESS;
              this.repCount++;
              this.midpointAchieved = false;
            } else {
              this.currentState = State.SETUP;
            }
          }
          break;

        case State.VALIDATED_SUCCESS:
          // Validate success state lasts exactly one telemetry frame before preparing for the next rep
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
          }
          break;

        case State.SETUP:
          if (currentAngle <= config.thresholds.contractionMax) {
            this.currentState = State.IN_PROGRESS;
            this.midpointAchieved = true;
          }
          break;

        case State.IN_PROGRESS:
          if (currentAngle >= config.thresholds.extensionMin) {
            if (this.midpointAchieved) {
              this.currentState = State.VALIDATED_SUCCESS;
              this.repCount++;
              this.midpointAchieved = false;
            } else {
              this.currentState = State.SETUP;
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

    return {
      currentState: this.currentState,
      repCount: this.repCount,
      hasFault: this.hasFault,
      faultMessage: this.faultMessage,
    };
  }
}
