/**
 * @fileoverview Layer 1 (UI): historyDrawer.js
 * Sliding glassmorphic history review drawer featuring lifetime PR cards,
 * procedural canvas dual trend sparklines (reps & accuracy), scrollable session feed
 * with expandable rep-by-rep telemetry accordions, JSON backup export, and touch swipe gestures.
 */

export class HistoryDrawer {
  /**
   * @param {HTMLElement} drawerEl Root container element for the history drawer.
   * @param {import('../storage/historyDb.js').HistoryDB} historyDb
   */
  constructor(drawerEl, historyDb) {
    if (!drawerEl) {
      throw new Error('HistoryDrawer: Initializer requires a valid drawer container element.');
    }

    this.drawerEl = drawerEl;
    this.historyDb = historyDb;

    /** @type {string|null} Active filter: null (ALL) | 'SQUAT' | 'BICEP_CURL' | 'PUSHUP' */
    this.activeFilter = null;
    /** @type {boolean} */
    this.isOpen = false;

    // Touch swipe handling
    this.touchStartX = 0;
    this.touchStartY = 0;

    this._buildDOM();
    this._attachEventListeners();
  }

  /**
   * Constructs the internal cybernetic drawer structure.
   * @private
   */
  _buildDOM() {
    this.drawerEl.innerHTML = `
      <div class="history-drawer__backdrop" id="history-backdrop"></div>
      <aside class="history-drawer__panel" id="history-panel">
        <div class="history-drawer__header">
          <div class="history-drawer__title-wrap">
            <span class="history-drawer__dot"></span>
            <h2 class="history-drawer__title">WORKOUT HISTORY & BIOMETRICS</h2>
          </div>
          <button id="history-close-btn" class="history-drawer__close-btn" title="Close Drawer">✕</button>
        </div>

        <!-- Exercise Category Filter Pills -->
        <div class="history-filter-bar">
          <button class="history-filter-pill history-filter-pill--active" data-filter="ALL">ALL EXERCISES</button>
          <button class="history-filter-pill" data-filter="SQUAT">SQUAT</button>
          <button class="history-filter-pill" data-filter="BICEP_CURL">CURL</button>
          <button class="history-filter-pill" data-filter="PUSHUP">PUSHUP</button>
        </div>

        <div class="history-drawer__scrollable">
          <!-- Lifetime Personal Records (PR) Banner -->
          <section class="history-pr-section">
            <div class="history-pr-header">
              <span class="history-pr-tag">🏆 LIFETIME ACHIEVEMENTS</span>
            </div>
            <div class="history-pr-grid">
              <div class="history-pr-card history-pr-card--reps">
                <span class="history-pr-card__label">MAX REPS</span>
                <span id="pr-max-reps" class="history-pr-card__val">0</span>
                <span class="history-pr-card__sub">SINGLE SET</span>
              </div>
              <div class="history-pr-card history-pr-card--accuracy">
                <span class="history-pr-card__label">BEST ACCURACY</span>
                <span id="pr-best-accuracy" class="history-pr-card__val">--</span>
                <span class="history-pr-card__sub">FLAWLESS FORM</span>
              </div>
              <div class="history-pr-card history-pr-card--depth">
                <span class="history-pr-card__label">AVG DEPTH</span>
                <span id="pr-deepest-depth" class="history-pr-card__val">--</span>
                <span class="history-pr-card__sub">TARGET FLEXION</span>
              </div>
            </div>
          </section>

          <!-- Procedural Canvas Trend Sparklines -->
          <section class="history-sparkline-section">
            <div class="history-sparkline-header">
              <span class="history-sparkline-title">📈 10-SESSION PROGRESSION</span>
              <div class="history-sparkline-legend">
                <span class="legend-item legend-item--reps"><span class="legend-dot"></span>REPS</span>
                <span class="legend-item legend-item--accuracy"><span class="legend-dot"></span>ACCURACY %</span>
              </div>
            </div>
            <div class="history-sparkline-canvas-wrap">
              <canvas id="history-sparkline-canvas" width="480" height="130"></canvas>
            </div>
          </section>

          <!-- Session List Cards -->
          <section class="history-sessions-section">
            <div class="history-sessions-header">
              <span class="history-sessions-title">LOGGED SESSIONS</span>
              <span id="history-session-count" class="history-sessions-badge">0 SETS</span>
            </div>
            <div id="history-sessions-list" class="history-sessions-list">
              <div class="history-empty-state">Loading history...</div>
            </div>
          </section>
        </div>

        <!-- Drawer Footer Actions -->
        <footer class="history-drawer__footer">
          <button id="history-export-btn" class="cyber-btn cyber-btn--secondary history-footer-btn">
            <span class="cyber-btn__icon">📥</span>
            <span class="cyber-btn__text">Export JSON</span>
          </button>
          <button id="history-clear-btn" class="cyber-btn cyber-btn--danger history-footer-btn">
            <span class="cyber-btn__icon">🗑️</span>
            <span class="cyber-btn__text">Clear</span>
          </button>
        </footer>
      </aside>
    `;

    // Cache elements
    this.panelEl = this.drawerEl.querySelector('#history-panel');
    this.backdropEl = this.drawerEl.querySelector('#history-backdrop');
    this.closeBtn = this.drawerEl.querySelector('#history-close-btn');
    this.sparklineCanvas = /** @type {HTMLCanvasElement|null} */ (this.drawerEl.querySelector('#history-sparkline-canvas'));
    this.sessionsListEl = this.drawerEl.querySelector('#history-sessions-list');
    this.sessionCountEl = this.drawerEl.querySelector('#history-session-count');
    this.maxRepsEl = this.drawerEl.querySelector('#pr-max-reps');
    this.bestAccEl = this.drawerEl.querySelector('#pr-best-accuracy');
    this.deepestDepthEl = this.drawerEl.querySelector('#pr-deepest-depth');
    this.exportBtn = this.drawerEl.querySelector('#history-export-btn');
    this.clearBtn = this.drawerEl.querySelector('#history-clear-btn');
  }

  /**
   * Binds interaction events for drawer controls, filters, touch gestures, and buttons.
   * @private
   */
  _attachEventListeners() {
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }

    if (this.backdropEl) {
      this.backdropEl.addEventListener('click', () => this.close());
    }

    // Filter pills
    const filterPills = this.drawerEl.querySelectorAll('.history-filter-pill');
    filterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        filterPills.forEach(p => p.classList.remove('history-filter-pill--active'));
        pill.classList.add('history-filter-pill--active');
        const filterVal = pill.getAttribute('data-filter');
        this.activeFilter = filterVal === 'ALL' ? null : filterVal;
        this.refresh();
      });
    });

    // Backup Export JSON button
    if (this.exportBtn) {
      this.exportBtn.addEventListener('click', async () => {
        try {
          const jsonString = await this.historyDb.exportDataJSON();
          const blob = new Blob([jsonString], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          link.href = url;
          link.download = `apex_form_history_${timestamp}.json`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        } catch (err) {
          console.error('HistoryDrawer: Failed to export history JSON:', err);
        }
      });
    }

    // Clear History button
    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', async () => {
        const confirmed = window.confirm('⚠️ Are you sure you want to delete all stored workout session history? This action cannot be undone.');
        if (confirmed) {
          try {
            await this.historyDb.clearHistory();
            await this.refresh();
          } catch (err) {
            console.error('HistoryDrawer: Failed to clear history:', err);
          }
        }
      });
    }

    // Mobile touch swipe-to-close listener
    if (this.panelEl) {
      this.panelEl.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length === 1) {
          this.touchStartX = e.touches[0].clientX;
          this.touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      this.panelEl.addEventListener('touchend', (e) => {
        if (e.changedTouches && e.changedTouches.length === 1) {
          const touchEndX = e.changedTouches[0].clientX;
          const touchEndY = e.changedTouches[0].clientY;
          const deltaX = touchEndX - this.touchStartX;
          const deltaY = Math.abs(touchEndY - this.touchStartY);

          // Horizontal swipe right > 55px and vertical movement < 45px
          if (deltaX > 55 && deltaY < 45) {
            this.close();
          }
        }
      }, { passive: true });
    }
  }

  /**
   * Toggles drawer open/close visibility.
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Opens the history drawer and updates metrics.
   */
  async open() {
    this.isOpen = true;
    this.drawerEl.classList.add('history-drawer--active');
    await this.refresh();
  }

  /**
   * Closes the history drawer.
   */
  close() {
    this.isOpen = false;
    this.drawerEl.classList.remove('history-drawer--active');
  }

  /**
   * Refreshes PR cards, trend sparklines, and session cards from IndexedDB.
   */
  async refresh() {
    try {
      const allSessions = await this.historyDb.getAllSessions();
      const filtered = this.activeFilter
        ? allSessions.filter(s => s.exerciseType === this.activeFilter)
        : allSessions;

      const prs = await this.historyDb.getPersonalRecords(this.activeFilter);

      // 1. Update PR Cards
      if (this.maxRepsEl) {
        this.maxRepsEl.textContent = String(prs.maxReps || 0);
      }
      if (this.bestAccEl) {
        this.bestAccEl.textContent = prs.bestAccuracy > 0 ? `${Math.round(prs.bestAccuracy)}%` : '--';
      }
      if (this.deepestDepthEl) {
        this.deepestDepthEl.textContent = prs.deepestAngle > 0 ? `${Math.round(prs.deepestAngle)}°` : '--';
      }

      // 2. Render Sparkline Chart (last 10 sessions)
      this._renderSparklines(filtered.slice(0, 10).reverse());

      // 3. Render Sessions Feed
      this._renderSessionsList(filtered);
    } catch (err) {
      console.error('HistoryDrawer: Refresh error:', err);
      if (this.sessionsListEl) {
        this.sessionsListEl.innerHTML = '<div class="history-empty-state">Error loading session history.</div>';
      }
    }
  }

  /**
   * Renders procedural dual glowing trend sparklines on the 2D canvas.
   * 
   * @param {Array<Object>} sessions Up to 10 chronologically ordered sessions.
   * @private
   */
  _renderSparklines(sessions) {
    if (!this.sparklineCanvas) return;

    const canvas = this.sparklineCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Subtle holographic grid lines
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.08)';
    ctx.lineWidth = 1;

    for (let y = 20; y < height; y += 30) {
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(width - 10, y);
      ctx.stroke();
    }

    if (!sessions || sessions.length === 0) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.font = 'bold 11px "Orbitron", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('NO SESSIONS LOGGED YET', width / 2, height / 2 + 4);
      return;
    }

    const padX = 24;
    const padY = 18;
    const chartW = width - padX * 2;
    const chartH = height - padY * 2;

    const count = sessions.length;
    const maxReps = Math.max(10, ...sessions.map(s => Number(s.totalReps) || 0));

    // Helper to calculate coordinates
    const getX = (i) => count === 1 ? width / 2 : padX + (i / (count - 1)) * chartW;
    const getYReps = (reps) => height - padY - ((reps / maxReps) * chartH);
    const getYAcc = (acc) => height - padY - ((Math.min(100, Math.max(0, acc)) / 100) * chartH);

    // --- Line 1: Rep Volume Trend (Cyan) ---
    ctx.save();
    ctx.beginPath();
    sessions.forEach((s, idx) => {
      const x = getX(idx);
      const y = getYReps(Number(s.totalReps) || 0);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.9)';
    ctx.lineWidth = 2.4;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00f2fe';
    ctx.stroke();

    // Data points
    sessions.forEach((s, idx) => {
      const x = getX(idx);
      const y = getYReps(Number(s.totalReps) || 0);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#00f2fe';
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#00f2fe';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    });
    ctx.restore();

    // --- Line 2: Form Accuracy Trend (Mint Green) ---
    ctx.save();
    ctx.beginPath();
    sessions.forEach((s, idx) => {
      const x = getX(idx);
      const y = getYAcc(Number(s.formAccuracy) || 0);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(0, 255, 135, 0.85)';
    ctx.lineWidth = 2.0;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00ff87';
    ctx.stroke();

    // Data points
    sessions.forEach((s, idx) => {
      const x = getX(idx);
      const y = getYAcc(Number(s.formAccuracy) || 0);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#00ff87';
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#00ff87';
      ctx.fill();
    });
    ctx.restore();
  }

  /**
   * Generates interactive session cards with accordion dropdowns.
   * 
   * @param {Array<Object>} sessions
   * @private
   */
  _renderSessionsList(sessions) {
    if (!this.sessionsListEl) return;

    if (this.sessionCountEl) {
      this.sessionCountEl.textContent = `${sessions.length} SET${sessions.length === 1 ? '' : 'S'}`;
    }

    if (sessions.length === 0) {
      this.sessionsListEl.innerHTML = `
        <div class="history-empty-state">
          <span class="history-empty-icon">📊</span>
          <p>No workout sessions found.</p>
          <span class="history-empty-sub">Complete a training set with Optics Live to generate telemetry.</span>
        </div>
      `;
      return;
    }

    const cardsHtml = sessions.map((s, idx) => {
      const dateStr = s.timestamp ? new Date(s.timestamp).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) : 'Recent Session';

      const accuracy = Math.round(Number(s.formAccuracy) || 100);
      const isFlawless = accuracy >= 95;
      const accClass = isFlawless ? 'acc-badge--flawless' : accuracy >= 80 ? 'acc-badge--good' : 'acc-badge--warning';
      const duration = s.durationSeconds ? `${s.durationSeconds}s` : '--';
      const workKj = s.mechanicalWork && s.mechanicalWork.joules ? (s.mechanicalWork.joules / 1000).toFixed(1) : null;

      // Format exercise title
      let exLabel = 'SQUAT';
      if (s.exerciseType === 'BICEP_CURL') exLabel = 'BICEP CURL';
      else if (s.exerciseType === 'PUSHUP') exLabel = 'PUSHUP';

      // Rep details markup
      const repDetails = s.repDetails || [];
      const repRows = repDetails.length > 0 ? repDetails.map(r => `
        <div class="rep-telemetry-row">
          <span class="rep-telemetry-num">REP #${r.repNum}</span>
          <span class="rep-telemetry-angle">${r.peakAngle}° Depth</span>
          <span class="rep-telemetry-vel">${Math.round(r.velocity || 0)}°/s</span>
          <span class="rep-telemetry-tag ${r.hadFault ? 'rep-telemetry-tag--fault' : 'rep-telemetry-tag--clean'}">
            ${r.hadFault ? 'FAULT' : 'CLEAN'}
          </span>
        </div>
      `).join('') : '<div class="rep-telemetry-empty">No individual rep metrics captured.</div>';

      return `
        <article class="session-card" data-session-idx="${idx}">
          <div class="session-card__header">
            <div class="session-card__type-wrap">
              <span class="session-card__exercise-badge">${exLabel}</span>
              <span class="session-card__date">${dateStr}</span>
            </div>
            <span class="session-card__acc-badge ${accClass}">${accuracy}% ACCURACY</span>
          </div>

          <div class="session-card__metrics-grid">
            <div class="session-metric">
              <span class="session-metric__label">REPS</span>
              <span class="session-metric__val">${s.totalReps}</span>
            </div>
            <div class="session-metric">
              <span class="session-metric__label">AVG DEPTH</span>
              <span class="session-metric__val">${s.avgDepthAngle}°</span>
            </div>
            <div class="session-metric">
              <span class="session-metric__label">GRADE</span>
              <span class="session-metric__val session-metric__val--grade">${s.barPathGrade || 'A'}</span>
            </div>
            <div class="session-metric">
              <span class="session-metric__label">TIME</span>
              <span class="session-metric__val">${duration}</span>
            </div>
            ${workKj ? `
            <div class="session-metric">
              <span class="session-metric__label">WORK</span>
              <span class="session-metric__val">${workKj} kJ</span>
            </div>` : ''}
          </div>

          <!-- Expandable Rep Telemetry Accordion -->
          <button class="session-card__accordion-toggle" type="button">
            <span class="accordion-text">View Rep Telemetry (${repDetails.length})</span>
            <span class="accordion-arrow">▾</span>
          </button>
          <div class="session-card__rep-details">
            <div class="rep-telemetry-list">
              ${repRows}
            </div>
          </div>
        </article>
      `;
    }).join('');

    this.sessionsListEl.innerHTML = cardsHtml;

    // Attach accordion toggle handlers
    const toggles = this.sessionsListEl.querySelectorAll('.session-card__accordion-toggle');
    toggles.forEach((toggle) => {
      toggle.addEventListener('click', (e) => {
        const card = toggle.closest('.session-card');
        if (card) {
          card.classList.toggle('session-card--expanded');
          const arrow = toggle.querySelector('.accordion-arrow');
          if (arrow) {
            arrow.textContent = card.classList.contains('session-card--expanded') ? '▴' : '▾';
          }
        }
      });
    });
  }
}
