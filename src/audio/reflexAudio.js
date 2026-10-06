/**
 * @fileoverview Layer 2: Zero-Latency Web Audio Reflex Synthesizer.
 * Synthesizes instantaneous acoustic cues for depth target hits, elastic stretch-shortening snaps,
 * and horizontal barbell wobble warnings directly via Web Audio API.
 */

export class ReflexAudio {
  /**
   * @param {Object} [options]
   * @param {number} [options.masterVolume=0.40] Master gain attenuation [0.0 - 1.0].
   */
  constructor(options = {}) {
    this.masterVolume = options.masterVolume !== undefined ? options.masterVolume : 0.40;

    /** @type {AudioContext|null} */
    this.ctx = null;

    /** @type {boolean} Mute toggle */
    this.muted = false;

    // Cooldown timers to prevent acoustic clipping or rapid machine-gunning
    this.lastDepthHitTime = 0;
    this.lastSnapTime = 0;
    this.lastWobbleTime = 0;

    this.DEPTH_COOLDOWN_MS = 180;
    this.SNAP_COOLDOWN_MS = 250;
    this.WOBBLE_COOLDOWN_MS = 400;
  }

  /**
   * Lazily initializes and unlocks the Web Audio AudioContext on user interaction.
   * @returns {AudioContext|null}
   */
  unlock() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  /**
   * Plays a crisp 880 Hz sine blip with a 30 ms decay on laser depth / target hits.
   */
  playDepthHit() {
    if (this.muted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastDepthHitTime < this.DEPTH_COOLDOWN_MS) return;
    this.lastDepthHitTime = nowMs;

    const ctx = this.unlock();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880.0, t); // A5

      // Rapid crisp 30 ms decay
      gain.gain.setValueAtTime(0.0, t);
      gain.gain.linearRampToValueAtTime(0.35 * this.masterVolume, t + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.030);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.035);
    } catch (e) {
      // Audio context fail-safe
    }
  }

  /**
   * Plays a bright 1200 Hz ascending chime for fast SSC turnarounds (< 160 ms).
   */
  playElasticSnap() {
    if (this.muted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastSnapTime < this.SNAP_COOLDOWN_MS) return;
    this.lastSnapTime = nowMs;

    const ctx = this.unlock();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      // Ascending chime frequency ramp: 1200 Hz -> 2200 Hz
      osc.frequency.setValueAtTime(1200.0, t);
      osc.frequency.exponentialRampToValueAtTime(2200.0, t + 0.055);

      gain.gain.setValueAtTime(0.0, t);
      gain.gain.linearRampToValueAtTime(0.40 * this.masterVolume, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.075);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.080);
    } catch (e) {
      // Audio context fail-safe
    }
  }

  /**
   * Plays a low-frequency dissonant buzz for excessive horizontal bar deviation.
   */
  playWobbleWarning() {
    if (this.muted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastWobbleTime < this.WOBBLE_COOLDOWN_MS) return;
    this.lastWobbleTime = nowMs;

    const ctx = this.unlock();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      // Dissonant low frequency pairing (110 Hz and 116 Hz)
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(110.0, t);

      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(116.5, t);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450, t);

      gain.gain.setValueAtTime(0.0, t);
      gain.gain.linearRampToValueAtTime(0.28 * this.masterVolume, t + 0.010);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.140);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.150);
      osc2.stop(t + 0.150);
    } catch (e) {
      // Audio context fail-safe
    }
  }

  /**
   * Sets mute state.
   * @param {boolean} isMuted
   */
  setMuted(isMuted) {
    this.muted = Boolean(isMuted);
  }

  /**
   * Returns current mute state.
   * @returns {boolean}
   */
  isMuted() {
    return this.muted;
  }
}
