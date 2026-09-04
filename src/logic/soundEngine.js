/**
 * @fileoverview Layer 2: Web Audio Synthesis & Spatial Audio Engine.
 * Synthesizes audio feedback chimes, buzzer alarms, 3D stereo-panned balance warnings,
 * and laser depth target hit cues natively using the Web Audio API.
 */

/**
 * Audio frequencies for success, fault, and target depth indicators.
 * @type {number}
 */
const FREQ_SUCCESS_NOTE_1 = 659.25; // E5
const FREQ_SUCCESS_NOTE_2 = 880.00; // A5
const FREQ_FAULT_BUZZ = 150.00;     // Low Sawtooth Tone
const FREQ_DEPTH_HIT = 880.00;      // Crisp A5 Chime
const FREQ_BALANCE_PULSE = 320.00;  // Panned corrective pulse

export class SoundEngine {
  constructor() {
    /**
     * Browser audio pipeline context.
     * @type {AudioContext|null}
     * @private
     */
    this.audioContext = null;

    /** @type {number} Cooldown timestamp for spatial balance warning */
    this.lastBalanceToneTime = 0;
    /** @type {number} Minimum interval between balance warning sounds (ms) */
    this.BALANCE_COOLDOWN_MS = 1400;
  }

  /**
   * Initializes or resumes the AudioContext state.
   * Required to satisfy browser mobile auto-play user gesture restrictions.
   * @public
   */
  unlockContext() {
    if (!this.audioContext) {
      // @ts-ignore - Handles legacy webkit prefixes in mobile Safari
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
      }
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch((err) => {
        console.warn('SoundEngine: Failed to resume AudioContext:', err);
      });
    }
  }

  /**
   * Plays a 3D stereo-panned balance pulse to cue the user to push off their lagging side.
   * 
   * @param {number} panRatio Value between -1.0 (full left) and +1.0 (full right).
   */
  playBalanceWarning(panRatio = 0) {
    const nowMs = Date.now();
    if (nowMs - this.lastBalanceToneTime < this.BALANCE_COOLDOWN_MS) {
      return;
    }
    this.lastBalanceToneTime = nowMs;

    this.unlockContext();
    if (!this.audioContext) return;

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(FREQ_BALANCE_PULSE, now);
    osc.frequency.exponentialRampToValueAtTime(FREQ_BALANCE_PULSE * 1.3, now + 0.15);

    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);

    // Use StereoPannerNode for spatial balance localization
    const clampedPan = Math.max(-1.0, Math.min(1.0, panRatio));
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(clampedPan, now);
      gain.connect(panner);
      panner.connect(ctx.destination);
    } else {
      gain.connect(ctx.destination);
    }

    osc.start(now);
    osc.stop(now + 0.25);
  }

  /**
   * Plays a crisp high-frequency chime when the user hits or breaches target depth.
   * 
   * @param {number} [frequency=880] Tone frequency in Hz.
   */
  playDepthChime(frequency = FREQ_DEPTH_HIT) {
    this.unlockContext();
    if (!this.audioContext) return;

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, now);

    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.18);
  }

  /**
   * Play a pleasant ascending dual-tone chime: E5 (659Hz) -> A5 (880Hz).
   */
  playSuccessChime() {
    this.unlockContext();
    if (!this.audioContext) {
      return;
    }

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Node 1: E5 Sine Wave
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(FREQ_SUCCESS_NOTE_1, now);
    
    gain1.gain.setValueAtTime(0.0, now);
    gain1.gain.linearRampToValueAtTime(0.1, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.2);

    // Node 2: A5 Sine Wave (delayed by 100ms)
    const delay = 0.1;
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(FREQ_SUCCESS_NOTE_2, now + delay);

    gain2.gain.setValueAtTime(0.0, now + delay);
    gain2.gain.linearRampToValueAtTime(0.1, now + delay + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.28);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + delay);
    osc2.stop(now + delay + 0.3);
  }

  /**
   * Play a harsh, flat alarm: 150Hz Sawtooth Wave.
   */
  playFaultTone() {
    this.unlockContext();
    if (!this.audioContext) {
      return;
    }

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(FREQ_FAULT_BUZZ, now);

    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  }
}
