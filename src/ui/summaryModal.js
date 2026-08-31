/**
 * @fileoverview Layer 1 (UI): summaryModal.js
 * Controls the visibility and data bindings of the analytics Summary Modal.
 */

/**
 * Handles set summary statistics rendering and saving analytics data to localStorage.
 */
export class SummaryModal {
  /**
   * @param {HTMLElement} modalEl Root modal overlay container element.
   * @param {HTMLElement} repsEl Element displaying total reps.
   * @param {HTMLElement} accuracyEl Element displaying form accuracy percentage.
   * @param {HTMLElement} angleEl Element displaying average peak depth angle.
   * @param {HTMLButtonElement} closeBtnEl Save & Close trigger button.
   */
  constructor(modalEl, repsEl, accuracyEl, angleEl, closeBtnEl) {
    if (!modalEl || !repsEl || !accuracyEl || !angleEl || !closeBtnEl) {
      throw new Error('SummaryModal: Initializer requires valid DOM nodes.');
    }

    /** @type {HTMLElement} @private */
    this.modalEl = modalEl;
    /** @type {HTMLElement} @private */
    this.repsEl = repsEl;
    /** @type {HTMLElement} @private */
    this.accuracyEl = accuracyEl;
    /** @type {HTMLElement} @private */
    this.angleEl = angleEl;
    /** @type {HTMLButtonElement} @private */
    this.closeBtnEl = closeBtnEl;

    // Default binding
    this.closeBtnEl.addEventListener('click', () => {
      this.close();
    });
  }

  /**
   * Opens the summary card and computes/stores metrics in local storage.
   * 
   * @param {Object} stats Analytics values for the workout set.
   * @param {number} stats.totalReps Total repetitions completed.
   * @param {number} stats.accuracyRate Percentage of repetitions executed without form faults.
   * @param {number} stats.avgDepthAngle Average peak joint flex angle achieved during reps.
   * @param {string} stats.exerciseKey The key of the performed movement ('SQUAT' | 'BICEP_CURL').
   */
  open({ totalReps, accuracyRate, avgDepthAngle, exerciseKey }) {
    this.repsEl.textContent = String(totalReps);
    this.accuracyEl.textContent = `${Math.round(accuracyRate)}%`;
    this.angleEl.textContent = `${Math.round(avgDepthAngle)}°`;

    // Trigger CSS active state
    this.modalEl.classList.add('modal--active');

    // Archive session payload in localStorage history
    const sessionPayload = {
      id: `set_${Date.now()}`,
      timestamp: new Date().toISOString(),
      exercise: exerciseKey,
      completedReps: totalReps,
      accuracy: accuracyRate,
      averageAngle: avgDepthAngle
    };

    try {
      const storedHistory = JSON.parse(localStorage.getItem('apex_form_history') || '[]');
      storedHistory.push(sessionPayload);
      localStorage.setItem('apex_form_history', JSON.stringify(storedHistory));
    } catch (error) {
      console.warn('SummaryModal: Failed to write analytics set metrics to localStorage history.', error);
    }
  }

  /**
   * Hides the modal overlay.
   */
  close() {
    this.modalEl.classList.remove('modal--active');
  }
}
