/**
 * @fileoverview Layer 1 (UI): summaryModal.js
 * Controls the visibility and advanced data bindings of the post-set Analytics Modal:
 * - Bar path consistency grade (A/B/C/D)
 * - Concentric rep velocity breakdown chart
 * - Bilateral symmetry score
 * - Total estimated mechanical work (Joules / kcal)
 */

export class SummaryModal {
  /**
   * @param {HTMLElement} modalEl Root modal overlay container element.
   */
  constructor(modalEl) {
    if (!modalEl) {
      throw new Error('SummaryModal: Initializer requires valid modal container element.');
    }

    /** @type {HTMLElement} @private */
    this.modalEl = modalEl;
    /** @type {HTMLElement|null} @private */
    this.repsEl = modalEl.querySelector('#stat-reps');
    /** @type {HTMLElement|null} @private */
    this.accuracyEl = modalEl.querySelector('#stat-accuracy');
    /** @type {HTMLElement|null} @private */
    this.angleEl = modalEl.querySelector('#stat-angle');
    /** @type {HTMLElement|null} @private */
    this.barPathEl = modalEl.querySelector('#stat-barpath');
    /** @type {HTMLElement|null} @private */
    this.symmetryEl = modalEl.querySelector('#stat-symmetry');
    /** @type {HTMLElement|null} @private */
    this.workEl = modalEl.querySelector('#stat-work');
    /** @type {HTMLElement|null} @private */
    this.velocityBarsEl = modalEl.querySelector('#velocity-bars-container');
    /** @type {HTMLButtonElement|null} @private */
    this.closeBtnEl = modalEl.querySelector('#modal-close-btn');

    if (this.closeBtnEl) {
      this.closeBtnEl.addEventListener('click', () => {
        this.close();
      });
    }
  }

  /**
   * Opens the summary card and computes/stores metrics in local storage.
   * 
   * @param {Object} stats Analytics values for the workout set.
   * @param {number} stats.totalReps Total repetitions completed.
   * @param {number} stats.accuracyRate Percentage of repetitions executed without form faults.
   * @param {number} stats.avgDepthAngle Average peak joint flex angle achieved during reps.
   * @param {string} stats.exerciseKey The key of the performed movement ('SQUAT' | 'BICEP_CURL').
   * @param {string} [stats.barPathGrade='A'] Consistency letter grade.
   * @param {number} [stats.avgSymmetry=100] Average bilateral balance score.
   * @param {number[]} [stats.repVelocities=[]] List of concentric velocities per completed rep.
   * @param {{ joules: number, kcal: number }} [stats.mechanicalWork] Total mechanical work output.
   */
  open({
    totalReps,
    accuracyRate,
    avgDepthAngle,
    exerciseKey,
    barPathGrade = 'A',
    avgSymmetry = 100,
    repVelocities = [],
    mechanicalWork = { joules: 0, kcal: 0 }
  }) {
    if (this.repsEl) this.repsEl.textContent = String(totalReps);
    if (this.accuracyEl) this.accuracyEl.textContent = `${Math.round(accuracyRate)}%`;
    if (this.angleEl) this.angleEl.textContent = `${Math.round(avgDepthAngle)}°`;
    
    if (this.barPathEl) {
      this.barPathEl.textContent = barPathGrade;
      this.barPathEl.className = `modal__stat-value modal__stat-value--grade grade-${barPathGrade.toLowerCase()}`;
    }

    if (this.symmetryEl) {
      this.symmetryEl.textContent = `${Math.round(avgSymmetry)}%`;
    }

    if (this.workEl) {
      const kj = (mechanicalWork.joules / 1000).toFixed(1);
      this.workEl.textContent = `${kj} kJ (${mechanicalWork.kcal} kcal)`;
    }

    // Populate concentric velocity breakdown chart
    if (this.velocityBarsEl) {
      this.velocityBarsEl.innerHTML = '';
      if (!repVelocities || repVelocities.length === 0) {
        const placeholder = document.createElement('span');
        placeholder.className = 'modal__velocity-empty';
        placeholder.textContent = 'No concentric velocity samples recorded.';
        this.velocityBarsEl.appendChild(placeholder);
      } else {
        const maxV = Math.max(...repVelocities, 1);
        repVelocities.forEach((v, idx) => {
          const col = document.createElement('div');
          col.className = 'velocity-bar-col';

          const val = document.createElement('span');
          val.className = 'velocity-bar-val';
          val.textContent = `${Math.round(v)}`;

          const fill = document.createElement('div');
          fill.className = 'velocity-bar-fill';
          const heightPct = Math.max(15, Math.min(100, (v / maxV) * 100));
          fill.style.height = `${heightPct}%`;

          const label = document.createElement('span');
          label.className = 'velocity-bar-label';
          label.textContent = `R${idx + 1}`;

          col.appendChild(val);
          col.appendChild(fill);
          col.appendChild(label);
          this.velocityBarsEl.appendChild(col);
        });
      }
    }

    // Display modal
    this.modalEl.classList.add('modal--active');

    // Archive session payload in localStorage history
    const sessionPayload = {
      id: `set_${Date.now()}`,
      timestamp: new Date().toISOString(),
      exercise: exerciseKey,
      completedReps: totalReps,
      accuracy: accuracyRate,
      averageAngle: avgDepthAngle,
      barPathGrade,
      averageSymmetry: avgSymmetry,
      repVelocities,
      mechanicalWork
    };

    try {
      const storedHistory = JSON.parse(localStorage.getItem('apex_form_history') || '[]');
      storedHistory.push(sessionPayload);
      localStorage.setItem('apex_form_history', JSON.stringify(storedHistory));
    } catch (error) {
      console.warn('SummaryModal: Failed to save analytics to localStorage history.', error);
    }
  }

  /**
   * Hides the modal overlay.
   */
  close() {
    this.modalEl.classList.remove('modal--active');
  }
}
