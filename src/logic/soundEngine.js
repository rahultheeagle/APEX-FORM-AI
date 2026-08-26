/**
 * @fileoverview Layer 2: Web Audio Synthesis Engine.
 * Synthesizes audio feedback chimes and buzzer alarms natively using the Web Audio API.
 */

/**
 * Audio frequencies for success and fault indicators.
 * @type {number}
 */
const FREQ_SUCCESS_NOTE_1 = 659.25; // E5

/** @type {number} */
const FREQ_SUCCESS_NOTE_2 = 880.00; // A5

/** @type {number} */
const FREQ_FAULT_BUZZ = 150.00; // Low Sawtooth Tone

/**
 * Manages Web Audio API context and synthesizes real-time sound cues.
 */
export class SoundEngine {
  constructor() {
    /**
     * Browser audio pipeline context.
     * @type {AudioContext|null}
     * @private
     */
    this.audioContext = null;
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
    gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  }
}
