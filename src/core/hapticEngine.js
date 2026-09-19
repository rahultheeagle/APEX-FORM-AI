/**
 * @fileoverview Layer 0: Haptic Feedback Engine.
 * Utilizes the HTML5 Vibration API to emit tactile biofeedback cues for rep milestones,
 * depth validation, and biomechanical form faults.
 *
 * Implements defensive checks for hardware/browser support and permission status.
 */

export class HapticEngine {
  /**
   * @param {boolean} [enabled=true]
   */
  constructor(enabled = true) {
    this.isEnabled = enabled;
  }

  /**
   * Evaluates if current device hardware and browser runtime support navigator.vibrate.
   * @returns {boolean}
   */
  static isSupported() {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  /**
   * Emits a vibration pattern if supported and enabled.
   * @param {number|number[]} pattern Duration in ms or pattern array [vibrate, pause, vibrate, ...]
   * @returns {boolean} True if vibration was dispatched.
   * @private
   */
  _vibrate(pattern) {
    if (!this.isEnabled || !HapticEngine.isSupported()) {
      return false;
    }

    try {
      return navigator.vibrate(pattern);
    } catch (e) {
      console.warn('HapticEngine: Vibration dispatch failed:', e);
      return false;
    }
  }

  /**
   * Dispatches a crisp double pulse tactile confirmation on valid repetition completion.
   * Pattern: 40ms buzz, 60ms pause, 40ms buzz.
   * @returns {boolean}
   */
  triggerRepSuccess() {
    return this._vibrate([40, 60, 40]);
  }

  /**
   * Dispatches a heavy alert vibration on form fault detection (knee valgus, lumbar rounding).
   * Pattern: 120ms continuous buzz.
   * @returns {boolean}
   */
  triggerFormFault() {
    return this._vibrate([120]);
  }

  /**
   * Soft single pulse acknowledging session initiation or gesture trigger.
   * Pattern: 50ms buzz.
   * @returns {boolean}
   */
  triggerStart() {
    return this._vibrate([50]);
  }

  /**
   * Finishing vibration on set or session completion.
   * Pattern: 70ms buzz, 80ms pause, 70ms buzz.
   * @returns {boolean}
   */
  triggerStop() {
    return this._vibrate([70, 80, 70]);
  }

  /**
   * Cancels any currently executing vibration pattern.
   */
  cancel() {
    if (HapticEngine.isSupported()) {
      try {
        navigator.vibrate(0);
      } catch (e) {}
    }
  }
}
