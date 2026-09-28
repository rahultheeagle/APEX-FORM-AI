/**
 * @fileoverview Layer 4: Acoustic Biomechanics & Valsalva Maneuver Core-Bracing Monitor.
 * Uses the Web Audio API AnalyserNode to inspect acoustic sound pressure level (RMS in dB)
 * and vocalization band spectral energy (300 Hz - 2500 Hz) to verify intra-abdominal core bracing,
 * flagging premature exhalation leaks during high-risk loading phases (descent and bottom depth).
 */

export class ValsalvaMonitor {
  /**
   * @param {Object} [options]
   * @param {number} [options.quietDbThreshold=-42] Maximum acoustic energy for sealed glottis (dB).
   * @param {number} [options.dumpDbThreshold=-20] Acoustic energy threshold indicating breath dump (dB).
   * @param {number} [options.vocalMinHz=300] Lower vocalization frequency band (Hz).
   * @param {number} [options.vocalMaxHz=2500] Upper vocalization frequency band (Hz).
   */
  constructor(options = {}) {
    this.quietDbThreshold = options.quietDbThreshold !== undefined ? options.quietDbThreshold : -42;
    this.dumpDbThreshold = options.dumpDbThreshold !== undefined ? options.dumpDbThreshold : -20;
    this.vocalMinHz = options.vocalMinHz !== undefined ? options.vocalMinHz : 300;
    this.vocalMaxHz = options.vocalMaxHz !== undefined ? options.vocalMaxHz : 2500;

    /** @type {AudioContext|null} */
    this.audioContext = null;

    /** @type {AnalyserNode|null} */
    this.analyser = null;

    /** @type {MediaStream|null} */
    this.microphoneStream = null;

    /** @type {MediaStreamAudioSourceNode|null} */
    this.sourceNode = null;

    /** @type {boolean} True if initialized successfully */
    this.isInitialized = false;

    /** @type {boolean} True if microphone is streaming */
    this.isAvailable = false;

    /** @type {boolean} True if user explicitly denied permission */
    this.permissionDenied = false;

    /** @type {Float32Array|null} Pre-allocated time domain buffer */
    this.timeBuffer = null;

    /** @type {Float32Array|null} Pre-allocated frequency domain buffer */
    this.freqBuffer = null;

    /** @type {number} Current smoothed decibel reading */
    this.currentDb = -100;

    /** @type {boolean} Current core bracing status */
    this.isBraced = true;

    /** @type {'INHALING'|'HELD_BRACED'|'EXHALED'} Current estimated breath phase */
    this.breathPhase = 'HELD_BRACED';

    /** @type {boolean} Whether intra-abdominal pressure seal is maintained */
    this.valsalvaIntact = true;

    /** @type {string|null} Active fault message */
    this.lastError = null;
  }

  /**
   * Requests microphone access and initializes the Web Audio Analyser graph.
   * Gracefully falls back with isAvailable = false if denied or unsupported.
   * 
   * @returns {Promise<boolean>} True if microphone audio streaming is active.
   */
  async init() {
    if (this.isInitialized && this.isAvailable) {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume();
        } catch (_) {}
      }
      return true;
    }

    if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
      console.warn('ValsalvaMonitor: getUserMedia not supported in this runtime.');
      this.isAvailable = false;
      return false;
    }

    try {
      this.microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false, // Keep raw dynamics of grunts/breaths
          autoGainControl: false
        },
        video: false
      });

      const AudioCtxConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxConstructor) {
        throw new Error('Web Audio API is not supported in this browser.');
      }

      this.audioContext = new AudioCtxConstructor();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.35;

      this.sourceNode = this.audioContext.createMediaStreamSource(this.microphoneStream);
      // Connect to analyser only (NOT to destination to prevent speaker feedback loop)
      this.sourceNode.connect(this.analyser);

      // Pre-allocate analysis arrays to ensure zero garbage collection spikes during 60 FPS loop
      this.timeBuffer = new Float32Array(this.analyser.fftSize);
      this.freqBuffer = new Float32Array(this.analyser.frequencyBinCount);

      this.isInitialized = true;
      this.isAvailable = true;
      this.permissionDenied = false;
      console.log('ValsalvaMonitor: Web Audio microphone analyzer initialized successfully.');
      return true;
    } catch (err) {
      console.warn('ValsalvaMonitor: Microphone access denied or unavailable:', err?.message || err);
      this.permissionDenied = true;
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Analyzes acoustic energy in the vocalization spectrum and verifies core bracing.
   * 
   * @param {string|{ isAtBottom?: boolean, isDescent?: boolean, isAscentComplete?: boolean, phase?: string }} currentRepPhase
   * @returns {{
   *   isBraced: boolean,
   *   breathPhase: 'INHALING'|'HELD_BRACED'|'EXHALED',
   *   valsalvaIntact: boolean,
   *   dbLevel: number,
   *   error: string|null,
   *   spectralEnergy: number,
   *   isMicActive: boolean
   * }}
   */
  analyzeBreathState(currentRepPhase = 'IDLE') {
    if (!this.isAvailable || !this.analyser || !this.timeBuffer) {
      return {
        isBraced: this.isBraced,
        breathPhase: this.breathPhase,
        valsalvaIntact: this.valsalvaIntact,
        dbLevel: this.currentDb,
        error: this.lastError,
        spectralEnergy: 0,
        isMicActive: false
      };
    }

    // Ensure audio context is running
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    // 1. Time-Domain RMS Volume (dB)
    this.analyser.getFloatTimeDomainData(this.timeBuffer);
    let sumSquares = 0;
    for (let i = 0; i < this.timeBuffer.length; i++) {
      const s = this.timeBuffer[i];
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / this.timeBuffer.length);
    // Convert to decibels full scale (dBFS): 20 * log10(rms)
    const rawDb = rms > 0.00001 ? Math.max(-100, Math.min(0, 20 * Math.log10(rms))) : -100;

    // Temporal smoothing of dB reading
    this.currentDb = (0.40 * rawDb) + (0.60 * this.currentDb);
    const dbLevel = Math.round(this.currentDb * 10) / 10;

    // 2. Spectral Energy in Vocalization Band (300 Hz - 2500 Hz)
    let spectralEnergy = 0;
    if (this.freqBuffer && this.audioContext) {
      this.analyser.getFloatFrequencyData(this.freqBuffer);
      const sampleRate = this.audioContext.sampleRate || 44100;
      const binWidth = (sampleRate / 2) / this.freqBuffer.length;
      const minBin = Math.max(0, Math.floor(this.vocalMinHz / binWidth));
      const maxBin = Math.min(this.freqBuffer.length - 1, Math.ceil(this.vocalMaxHz / binWidth));

      let bandSum = 0;
      let binCount = 0;
      for (let b = minBin; b <= maxBin; b++) {
        // freqBuffer contains values in dB [-100, 0]
        const dbVal = this.freqBuffer[b];
        if (dbVal > -90) {
          bandSum += Math.pow(10, dbVal / 20); // convert dB to linear amplitude
          binCount++;
        }
      }
      spectralEnergy = binCount > 0 ? (bandSum / binCount) : 0;
    }

    // 3. Normalized Phase Extraction
    let phaseStr = typeof currentRepPhase === 'string' ? currentRepPhase.toUpperCase() : (currentRepPhase?.phase || 'IDLE');
    const isAtBottom = typeof currentRepPhase === 'object' ? Boolean(currentRepPhase.isAtBottom) : (phaseStr === 'BOTTOM' || phaseStr === 'INFLECTION');
    const isDescent = typeof currentRepPhase === 'object' ? Boolean(currentRepPhase.isDescent) : (phaseStr === 'DESCENT' || phaseStr === 'ECCENTRIC');
    const isAscentComplete = typeof currentRepPhase === 'object' ? Boolean(currentRepPhase.isAscentComplete) : (phaseStr === 'ASCENT_COMPLETE' || phaseStr === 'VALIDATED_SUCCESS');

    // 4. Acoustic Valsalva Maneuver Biomechanical Logic
    let isBraced = true;
    let breathPhase = this.breathPhase;
    let valsalvaIntact = true;
    let error = null;

    if (isAtBottom || isDescent) {
      // Under load in eccentric/bottom phase:
      // Glottis should be tightly sealed (acoustic quiet < -42 dB).
      // If loud audio energy (> -20 dB) occurs, lifter dumped breath prematurely!
      if (dbLevel > this.dumpDbThreshold) {
        valsalvaIntact = false;
        error = 'PREMATURE_EXHALATION';
        isBraced = false;
        breathPhase = 'EXHALED';
      } else if (dbLevel < this.quietDbThreshold) {
        // Ideal Valsalva hold
        valsalvaIntact = true;
        isBraced = true;
        breathPhase = 'HELD_BRACED';
        error = null;
      } else {
        // Mild vocal strain / grunting under heavy load (acceptable intra-thoracic grunting)
        valsalvaIntact = true;
        isBraced = true;
        breathPhase = 'HELD_BRACED';
        error = null;
      }
    } else if (isAscentComplete) {
      // Top of repetition: expect exhalation transient
      if (dbLevel > -36) {
        breathPhase = 'EXHALED';
      }
      isBraced = false;
      valsalvaIntact = true;
    } else if (phaseStr === 'SETUP' || phaseStr === 'STANDBY' || phaseStr === 'CALIBRATING') {
      // Deep pre-rep breath intake
      breathPhase = dbLevel > -38 ? 'INHALING' : 'HELD_BRACED';
      isBraced = true;
      valsalvaIntact = true;
    }

    this.isBraced = isBraced;
    this.breathPhase = breathPhase;
    this.valsalvaIntact = valsalvaIntact;
    this.lastError = error;

    return {
      isBraced,
      breathPhase,
      valsalvaIntact,
      dbLevel,
      error,
      spectralEnergy: Math.round(spectralEnergy * 1000) / 1000,
      isMicActive: true
    };
  }

  /**
   * Resets internal bracing states.
   */
  reset() {
    this.currentDb = -100;
    this.isBraced = true;
    this.breathPhase = 'HELD_BRACED';
    this.valsalvaIntact = true;
    this.lastError = null;
  }

  /**
   * Disconnects nodes, closes audio context, and terminates microphone tracks cleanly.
   */
  stop() {
    if (this.microphoneStream) {
      this.microphoneStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      this.microphoneStream = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (_) {}
      this.sourceNode = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (_) {}
      this.audioContext = null;
    }

    this.isInitialized = false;
    this.isAvailable = false;
    this.reset();
  }
}
