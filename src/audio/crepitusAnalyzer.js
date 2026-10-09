/**
 * @fileoverview High-Frequency Joint Crepitus & Acoustic Friction Profiler.
 * Uses Web Audio API with BiquadFilter (1800 Hz - 5500 Hz) and AnalyserNode
 * to distinguish benign joint cavitation pops from continuous abrasive joint crepitus.
 */

export class CrepitusAnalyzer {
  /**
   * @param {Object} [options]
   * @param {number} [options.bandMinHz=1800] Lower bandpass cutoff (Hz).
   * @param {number} [options.bandMaxHz=5500] Upper bandpass cutoff (Hz).
   * @param {number} [options.frictionThresholdDb=-46] Decibel threshold for abrasive friction.
   * @param {number} [options.cavitationMinDb=-32] Minimum peak decibel for cavitation pop.
   */
  constructor(options = {}) {
    this.bandMinHz = options.bandMinHz || 1800;
    this.bandMaxHz = options.bandMaxHz || 5500;
    this.frictionThresholdDb = options.frictionThresholdDb !== undefined ? options.frictionThresholdDb : -46;
    this.cavitationMinDb = options.cavitationMinDb !== undefined ? options.cavitationMinDb : -32;

    /** @type {AudioContext|null} */
    this.audioContext = null;

    /** @type {MediaStreamAudioSourceNode|null} */
    this.sourceNode = null;

    /** @type {BiquadFilterNode|null} */
    this.bandpassFilter = null;

    /** @type {AnalyserNode|null} */
    this.analyser = null;

    /** @type {boolean} */
    this.isInitialized = false;

    /** @type {boolean} */
    this.isAvailable = false;

    // Pre-allocated analysis buffers for zero GC overhead
    this.fftSize = 512;
    this.freqData = new Float32Array(this.fftSize / 2);
    this.timeData = new Float32Array(this.fftSize);
    this.waveSamples = new Float32Array(24);

    // Temporal tracking parameters
    this.consecutiveFrictionFrames = 0;
    this.cavitationCooldownFrames = 0;
    this.lastPeakDb = -100;
    this.ambientNoiseDb = -62;

    /** @type {number} Friction score [0 - 100] */
    this.frictionScore = 0;

    /** @type {boolean} True if transient pop/cavitation was detected in recent window */
    this.hasCavitation = false;

    /** @type {boolean} True if sustained abrasive grating was detected */
    this.crepitusDetected = false;
  }

  /**
   * Initializes Web Audio nodes using an existing or new MediaStream.
   *
   * @param {MediaStream} [existingStream] Optional active microphone stream.
   * @param {AudioContext} [existingContext] Optional active AudioContext.
   * @returns {Promise<boolean>} True if initialized and listening.
   */
  async init(existingStream = null, existingContext = null) {
    if (this.isInitialized && this.isAvailable) {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume();
        } catch (_) {}
      }
      return true;
    }

    try {
      let stream = existingStream;
      if (!stream) {
        if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
          this.isAvailable = false;
          return false;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false
          },
          video: false
        });
      }

      const AudioCtxConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxConstructor) {
        this.isAvailable = false;
        return false;
      }

      this.audioContext = existingContext || new AudioCtxConstructor();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // 1. Create Biquad Bandpass Filter (1800 Hz - 5500 Hz)
      // Center frequency f0 = sqrt(1800 * 5500) ~= 3146 Hz, Q ~= 0.85
      this.bandpassFilter = this.audioContext.createBiquadFilter();
      this.bandpassFilter.type = 'bandpass';
      this.bandpassFilter.frequency.value = 3150;
      this.bandpassFilter.Q.value = 0.85;

      // 2. Create AnalyserNode
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.25;

      // 3. Connect Graph: Source -> Bandpass Filter -> AnalyserNode (Isolated from output)
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.sourceNode.connect(this.bandpassFilter);
      this.bandpassFilter.connect(this.analyser);

      this.isInitialized = true;
      this.isAvailable = true;
      console.log('CrepitusAnalyzer: Joint acoustic friction monitor initialized (1800 Hz - 5500 Hz).');
      return true;
    } catch (err) {
      console.warn('CrepitusAnalyzer: Audio access unavailable, falling back gracefully:', err?.message || err);
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Analyzes high-frequency joint acoustic friction and distinguishes
   * benign cavitation pops from continuous abrasive crepitus.
   *
   * @param {string|{ isDescent?: boolean, phase?: string, currentState?: string }} [currentRepPhase='ECCENTRIC']
   * @returns {{
   *   frictionScore: number,
   *   hasCavitation: boolean,
   *   crepitusDetected: boolean,
   *   displayLabel: string,
   *   waveSamples: Float32Array
   * }}
   */
  analyzeJointAcoustics(currentRepPhase = 'ECCENTRIC') {
    if (!this.isInitialized || !this.isAvailable || !this.analyser) {
      return {
        frictionScore: 0,
        hasCavitation: false,
        crepitusDetected: false,
        displayLabel: 'ACOUSTIC: STANDBY',
        waveSamples: this.waveSamples
      };
    }

    // Read frequency spectrum and time domain waveform
    this.analyser.getFloatFrequencyData(this.freqData);
    this.analyser.getFloatTimeDomainData(this.timeData);

    const sampleRate = this.audioContext ? this.audioContext.sampleRate : 48000;
    const binHz = sampleRate / this.fftSize;

    const startBin = Math.max(1, Math.floor(this.bandMinHz / binHz));
    const endBin = Math.min(this.freqData.length - 1, Math.ceil(this.bandMaxHz / binHz));

    // Calculate band acoustic energy (RMS dB)
    let sumLinear = 0.0;
    let peakBandDb = -120;
    let count = 0;

    for (let i = startBin; i <= endBin; i++) {
      const db = this.freqData[i];
      if (Number.isFinite(db)) {
        if (db > peakBandDb) peakBandDb = db;
        sumLinear += Math.pow(10, db / 20);
        count++;
      }
    }

    const bandRms = count > 0 ? (sumLinear / count) : 0.00001;
    const currentBandDb = 20 * Math.log10(Math.max(0.00001, bandRms));

    // Adaptively track ambient noise floor
    if (currentBandDb < this.ambientNoiseDb + 6 && currentBandDb > -90) {
      this.ambientNoiseDb = this.ambientNoiseDb * 0.95 + currentBandDb * 0.05;
    }

    // Populate 24-sample mini spectrogram wave for HUD rendering
    const waveCount = this.waveSamples.length;
    const step = Math.max(1, Math.floor((endBin - startBin) / waveCount));
    for (let w = 0; w < waveCount; w++) {
      const bIdx = startBin + w * step;
      const bVal = bIdx < this.freqData.length ? this.freqData[bIdx] : -100;
      // Normalize dB [-80, -20] to [0.0, 1.0]
      const norm = Math.max(0.0, Math.min(1.0, (bVal + 80) / 60));
      this.waveSamples[w] = this.waveSamples[w] * 0.6 + norm * 0.4;
    }

    // Evaluate Phase: Eccentric descent vs Concentric ascent
    const isDescent = typeof currentRepPhase === 'object'
      ? (currentRepPhase.isDescent || currentRepPhase.phase === 'ECCENTRIC' || currentRepPhase.currentState === 'IN_PROGRESS')
      : (typeof currentRepPhase === 'string' && (currentRepPhase.includes('ECCENTRIC') || currentRepPhase.includes('DESCENT')));

    const elevatedDbDelta = currentBandDb - this.ambientNoiseDb;

    // 1. Benign Cavitation / Joint Pop Detection (high transient peak, short duration < 80ms)
    if (this.cavitationCooldownFrames > 0) {
      this.cavitationCooldownFrames--;
      this.hasCavitation = false;
    } else if (peakBandDb > this.cavitationMinDb && elevatedDbDelta > 16) {
      this.hasCavitation = true;
      this.cavitationCooldownFrames = 6; // Cooldown ~100ms
    } else {
      this.hasCavitation = false;
    }

    // 2. Sustained Joint Crepitus Detection (continuous abrasive grating)
    if (currentBandDb > this.frictionThresholdDb && elevatedDbDelta > 8) {
      this.consecutiveFrictionFrames++;
    } else {
      this.consecutiveFrictionFrames = Math.max(0, this.consecutiveFrictionFrames - 2);
    }

    // Flag crepitus when sustained for >= 6 consecutive frames (> 100ms)
    // Extra sensitivity during eccentric descent
    const thresholdFrames = isDescent ? 6 : 9;
    this.crepitusDetected = this.consecutiveFrictionFrames >= thresholdFrames;

    // Calculate Friction Score [0 - 100]
    const rawScore = Math.max(0, Math.min(100, (elevatedDbDelta / 24) * 100));
    this.frictionScore = Math.round(this.frictionScore * 0.7 + rawScore * 0.3);

    let displayLabel = 'ACOUSTIC: SMOOTH';
    if (this.crepitusDetected) {
      displayLabel = '⚠️ JOINT FRICTION ELEVATED';
    } else if (this.hasCavitation) {
      displayLabel = '✨ JOINT CAVITATION (POP)';
    }

    return {
      frictionScore: this.frictionScore,
      hasCavitation: this.hasCavitation,
      crepitusDetected: this.crepitusDetected,
      displayLabel,
      waveSamples: this.waveSamples
    };
  }

  /**
   * Resets temporal counters for new repetition.
   */
  reset() {
    this.consecutiveFrictionFrames = 0;
    this.cavitationCooldownFrames = 0;
    this.frictionScore = 0;
    this.hasCavitation = false;
    this.crepitusDetected = false;
    this.waveSamples.fill(0);
  }

  /**
   * Halts audio analysis.
   */
  stop() {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (_) {}
      this.sourceNode = null;
    }
    this.isAvailable = false;
  }
}
