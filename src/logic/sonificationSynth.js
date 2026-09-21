/**
 * @fileoverview Layer 2: Real-time Continuous Biomechanical Sonification Synthesizer.
 * Synthesizes a continuous carrier sine wave filtered through a resonant low-pass
 * BiquadFilterNode to provide immediate auditory feedback on depth progression.
 * Attaches a dedicated FM modulation operator on postural faults to inject
 * gritty harmonic distortion without audio popping or mobile latency spikes.
 */

export class SonificationSynth {
  /**
   * @param {AudioContext|null} [externalAudioContext=null] Optional existing AudioContext.
   */
  constructor(externalAudioContext = null) {
    /** @type {AudioContext|null} */
    this.audioContext = externalAudioContext;

    /** @type {OscillatorNode|null} */
    this.carrierOsc = null;
    /** @type {BiquadFilterNode|null} */
    this.filterNode = null;
    /** @type {OscillatorNode|null} */
    this.fmModulator = null;
    /** @type {GainNode|null} */
    this.fmGain = null;
    /** @type {GainNode|null} */
    this.masterGain = null;

    /** @type {boolean} */
    this.isPlaying = false;
    /** @type {number} Target volume level */
    this.targetVolume = 0.08;

    /** @type {number} Base carrier frequency (Hz) */
    this.BASE_CARRIER_FREQ = 180;
    /** @type {number} Peak carrier frequency at full depth (Hz) */
    this.PEAK_CARRIER_FREQ = 240;
    /** @type {number} Minimum filter cutoff frequency (Hz) */
    this.MIN_CUTOFF_FREQ = 220;
    /** @type {number} Maximum filter cutoff frequency at depth (Hz) */
    this.MAX_CUTOFF_FREQ = 1500;
    /** @type {number} FM Modulator frequency (Hz) */
    this.FM_MOD_FREQ = 64;
    /** @type {number} Maximum FM index depth on fault */
    this.FM_FAULT_DEPTH = 130;
  }

  /**
   * Defensive AudioContext initialization / resumption.
   * Satisfies mobile browser user gesture autoplay requirements.
   * @private
   */
  _ensureContext() {
    if (!this.audioContext) {
      // @ts-ignore - Handle webkit prefix on legacy Safari
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
      }
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch((err) => {
        console.warn('SonificationSynth: AudioContext resume failed:', err);
      });
    }
  }

  /**
   * Starts the continuous auditory sonification stream with soft fade-in.
   */
  start() {
    this._ensureContext();
    if (!this.audioContext) return;
    if (this.isPlaying) return;

    try {
      const ctx = this.audioContext;
      const now = ctx.currentTime;

      // 1. Master Output Gain with smooth fade-in
      this.masterGain = ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.0001, now);
      this.masterGain.gain.exponentialRampToValueAtTime(this.targetVolume, now + 0.06);
      this.masterGain.connect(ctx.destination);

      // 2. Resonant Low-Pass Filter
      this.filterNode = ctx.createBiquadFilter();
      this.filterNode.type = 'lowpass';
      this.filterNode.frequency.setValueAtTime(this.MIN_CUTOFF_FREQ, now);
      this.filterNode.Q.setValueAtTime(3.2, now);
      this.filterNode.connect(this.masterGain);

      // 3. Carrier Oscillator (Sine Wave)
      this.carrierOsc = ctx.createOscillator();
      this.carrierOsc.type = 'sine';
      this.carrierOsc.frequency.setValueAtTime(this.BASE_CARRIER_FREQ, now);
      this.carrierOsc.connect(this.filterNode);

      // 4. FM Modulator Operator (Sawtooth Wave for gritty distortion on faults)
      this.fmModulator = ctx.createOscillator();
      this.fmModulator.type = 'sawtooth';
      this.fmModulator.frequency.setValueAtTime(this.FM_MOD_FREQ, now);

      this.fmGain = ctx.createGain();
      this.fmGain.gain.setValueAtTime(0.0, now); // Initially clean
      this.fmModulator.connect(this.fmGain);
      this.fmGain.connect(this.carrierOsc.frequency);

      // Start synthesis
      this.carrierOsc.start(now);
      this.fmModulator.start(now);
      this.isPlaying = true;
    } catch (err) {
      console.warn('SonificationSynth: Failed to start synthesis stream:', err);
    }
  }

  /**
   * Stops the sonification stream with soft click-free fade-out.
   */
  stop() {
    if (!this.isPlaying || !this.audioContext || !this.masterGain) {
      this.isPlaying = false;
      return;
    }

    try {
      const ctx = this.audioContext;
      const now = ctx.currentTime;

      // Gentle fade-out (60ms) to avoid audio popping
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

      const oscToStop = this.carrierOsc;
      const modToStop = this.fmModulator;
      const masterToDisconnect = this.masterGain;

      setTimeout(() => {
        try {
          if (oscToStop) oscToStop.stop();
          if (modToStop) modToStop.stop();
          if (masterToDisconnect) masterToDisconnect.disconnect();
        } catch (_) {
          // Ignore if already stopped
        }
      }, 70);

      this.carrierOsc = null;
      this.fmModulator = null;
      this.filterNode = null;
      this.fmGain = null;
      this.masterGain = null;
      this.isPlaying = false;
    } catch (err) {
      console.warn('SonificationSynth: Failed to stop synthesis stream:', err);
      this.isPlaying = false;
    }
  }

  /**
   * Modulates the filter cutoff frequency and pitch based on exercise joint progression,
   * and modulates the FM operator to inject gritty harmonic distortion during form faults.
   * 
   * Uses exponential parameter smoothing (`setTargetAtTime`) to guarantee ZERO pops.
   * 
   * @param {number} currentAngle Instantaneous joint angle (e.g., knee or elbow).
   * @param {number} [targetAngle=90] Target bottom/inflection angle.
   * @param {boolean} [isFault=false] Whether active frame has posture fault.
   */
  updateStream(currentAngle, targetAngle = 90, isFault = false) {
    if (!this.isPlaying || !this.audioContext || !this.filterNode || !this.carrierOsc || !this.fmGain) {
      return;
    }

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // 1. Calculate progression ratio from full extension (180°) towards target angle
    const angleSpan = Math.max(20, 180 - targetAngle);
    const rawProgress = (180 - currentAngle) / angleSpan;
    const progress = Math.max(0, Math.min(1.25, rawProgress));

    // 2. Modulate Low-Pass Filter Cutoff Frequency (220 Hz -> 1500 Hz)
    const targetCutoff = this.MIN_CUTOFF_FREQ + (progress * (this.MAX_CUTOFF_FREQ - this.MIN_CUTOFF_FREQ));
    this.filterNode.frequency.setTargetAtTime(targetCutoff, now, 0.04);

    // 3. Modulate Carrier Base Pitch subtly (180 Hz -> 240 Hz)
    const targetPitch = this.BASE_CARRIER_FREQ + (progress * (this.PEAK_CARRIER_FREQ - this.BASE_CARRIER_FREQ));
    this.carrierOsc.frequency.setTargetAtTime(targetPitch, now, 0.04);

    // 4. FM Fault Operator: inject gritty harmonic distortion when form fault occurs
    const targetFmDepth = isFault ? this.FM_FAULT_DEPTH : 0.0;
    this.fmGain.gain.setTargetAtTime(targetFmDepth, now, 0.035);
  }

  /**
   * Adjusts master stream volume defensively.
   * @param {number} volume [0.0 - 1.0]
   */
  setVolume(volume) {
    this.targetVolume = Math.max(0, Math.min(0.3, volume));
    if (this.masterGain && this.audioContext && this.isPlaying) {
      const now = this.audioContext.currentTime;
      this.masterGain.gain.setTargetAtTime(this.targetVolume, now, 0.03);
    }
  }
}
