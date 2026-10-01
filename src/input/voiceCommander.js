/**
 * @fileoverview Layer 2: Hands-Free Voice Command System.
 * Leverages native Web SpeechRecognition / webkitSpeechRecognition API for
 * continuous low-latency command parsing during heavy gym sets, with auto-restart resilience.
 */

export class VoiceCommander {
  /**
   * @param {Object} [options]
   * @param {string} [options.lang='en-US'] Recognition language.
   * @param {boolean} [options.autoRestart=true] Restart on disconnect.
   */
  constructor(options = {}) {
    this.lang = options.lang || 'en-US';
    this.autoRestart = options.autoRestart !== undefined ? options.autoRestart : true;

    /** @type {Object<string, Array<Function>>} Event listeners registry */
    this._listeners = {
      START_SET: [],
      STOP_SET: [],
      RESET_SESSION: [],
      PLAY_REPLAY: [],
      SWITCH_EXERCISE: [],
      STATUS_CHANGE: []
    };

    /** @type {any} Native SpeechRecognition instance */
    this.recognition = null;
    this.isSupported = false;
    this.isListening = false;
    this._isIntentionalStop = false;
    this._restartTimer = null;
    this.lastRecognizedCommand = null;
    this.lastCommandTime = 0;

    this._initRecognition();
  }

  /**
   * Initializes the native Web Speech API recognition engine.
   * @private
   */
  _initRecognition() {
    const SpeechRecognition = typeof window !== 'undefined'
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;

    if (!SpeechRecognition) {
      console.warn('VoiceCommander: SpeechRecognition API not supported in this environment.');
      this.isSupported = false;
      return;
    }

    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.lang = this.lang;
      this.recognition.maxAlternatives = 3;
      this.isSupported = true;

      this.recognition.onstart = () => {
        this.isListening = true;
        this._notifyStatus('ACTIVE [LISTENING]');
      };

      this.recognition.onresult = (event) => {
        this._handleSpeechResult(event);
      };

      this.recognition.onerror = (event) => {
        // 'no-speech' or 'aborted' are non-critical in continuous listening
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn(`VoiceCommander: Recognition error (${event.error})`);
          this._notifyStatus(`ERROR [${event.error.toUpperCase()}]`);
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (!this._isIntentionalStop && this.autoRestart) {
          this._notifyStatus('RECONNECTING...');
          clearTimeout(this._restartTimer);
          this._restartTimer = setTimeout(() => {
            if (!this._isIntentionalStop) {
              this._startInternal();
            }
          }, 400);
        } else {
          this._notifyStatus('STANDBY');
        }
      };
    } catch (err) {
      console.error('VoiceCommander: Failed to initialize speech recognition:', err);
      this.isSupported = false;
    }
  }

  /**
   * Starts speech recognition stream.
   */
  start() {
    if (!this.isSupported) {
      this._notifyStatus('UNSUPPORTED');
      return false;
    }
    this._isIntentionalStop = false;
    return this._startInternal();
  }

  /**
   * Internal start invoker guarding against invalid state exceptions.
   * @private
   */
  _startInternal() {
    if (!this.recognition) return false;
    try {
      this.recognition.start();
      return true;
    } catch (e) {
      // If already started or aborting, suppress InvalidStateError
      return false;
    }
  }

  /**
   * Stops speech recognition stream intentionally.
   */
  stop() {
    this._isIntentionalStop = true;
    clearTimeout(this._restartTimer);
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
    this.isListening = false;
    this._notifyStatus('STANDBY');
  }

  /**
   * Parses transcripts against the exercise command dictionary.
   * @param {any} event SpeechRecognitionEvent
   * @private
   */
  _handleSpeechResult(event) {
    if (!event || !event.results) return;

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const result = event.results[i];
      if (!result.isFinal) continue;

      for (let j = 0; j < result.length; ++j) {
        const transcript = (result[j].transcript || '').trim().toLowerCase();
        if (this._parseCommand(transcript)) {
          break; // Stop after first matched command in alternative candidates
        }
      }
    }
  }

  /**
   * Maps a vocalized phrase to a system event.
   * @param {string} text Normalized speech text.
   * @returns {boolean} True if matched and emitted.
   * @private
   */
  _parseCommand(text) {
    const now = performance.now();
    // Debounce fast duplicated utterances (500ms)
    if (now - this.lastCommandTime < 500 && this.lastRecognizedCommand === text) {
      return false;
    }

    // 1. START_SET: "start", "start set", "begin", "go"
    if (/\b(start set|start|begin|commence|lets go)\b/i.test(text)) {
      this._emitCommand('START_SET', { phrase: text });
      return true;
    }

    // 2. STOP_SET: "stop", "rack", "finish", "done", "end set"
    if (/\b(stop set|stop|rack|finish|done|end set|rack it)\b/i.test(text)) {
      this._emitCommand('STOP_SET', { phrase: text });
      return true;
    }

    // 3. RESET_SESSION: "reset", "clear", "restart"
    if (/\b(reset session|reset|clear reps|restart)\b/i.test(text)) {
      this._emitCommand('RESET_SESSION', { phrase: text });
      return true;
    }

    // 4. PLAY_REPLAY: "replay", "show replay", "review"
    if (/\b(show replay|replay|playback|review fault|review)\b/i.test(text)) {
      this._emitCommand('PLAY_REPLAY', { phrase: text });
      return true;
    }

    // 5. SWITCH_EXERCISE: "squat", "pushup", "curl"
    if (/\b(squat|squats)\b/i.test(text)) {
      this._emitCommand('SWITCH_EXERCISE', { exercise: 'SQUAT', phrase: text });
      return true;
    }
    if (/\b(pushup|push up|pushups|push ups)\b/i.test(text)) {
      this._emitCommand('SWITCH_EXERCISE', { exercise: 'PUSHUP', phrase: text });
      return true;
    }
    if (/\b(bicep curl|bicep curls|curl|curls)\b/i.test(text)) {
      this._emitCommand('SWITCH_EXERCISE', { exercise: 'BICEP_CURL', phrase: text });
      return true;
    }

    return false;
  }

  /**
   * Emits an event to registered listeners.
   * @private
   */
  _emitCommand(event, payload) {
    this.lastRecognizedCommand = payload.phrase || event;
    this.lastCommandTime = performance.now();
    this.emit(event, payload);
  }

  /**
   * Subscribes an event listener.
   * @param {string} event Event key ('START_SET' | 'STOP_SET' | 'RESET_SESSION' | 'PLAY_REPLAY' | 'SWITCH_EXERCISE' | 'STATUS_CHANGE')
   * @param {Function} callback Handler callback
   */
  on(event, callback) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(callback);
    return this;
  }

  /**
   * Unsubscribes an event listener.
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }
    return this;
  }

  /**
   * Triggers event callbacks.
   * @param {string} event
   * @param {any} payload
   */
  emit(event, payload) {
    if (this._listeners[event]) {
      for (let i = 0; i < this._listeners[event].length; i++) {
        try {
          this._listeners[event][i](payload);
        } catch (e) {
          console.error(`VoiceCommander: Error in listener for ${event}:`, e);
        }
      }
    }
  }

  /**
   * Notifies status subscribers and updates current badge status text.
   * @private
   */
  _notifyStatus(status) {
    this.emit('STATUS_CHANGE', { status, isListening: this.isListening });
  }

  /**
   * Returns current status badge text.
   * @returns {string} E.g., 'ACTIVE [LISTENING]', 'STANDBY', 'UNSUPPORTED'
   */
  getStatusText() {
    if (!this.isSupported) return 'UNSUPPORTED';
    if (this.isListening) return 'ACTIVE [LISTENING]';
    return 'STANDBY';
  }

  /**
   * Cleans up all listeners and stops speech recognition.
   */
  destroy() {
    this.stop();
    this._listeners = {
      START_SET: [],
      STOP_SET: [],
      RESET_SESSION: [],
      PLAY_REPLAY: [],
      SWITCH_EXERCISE: [],
      STATUS_CHANGE: []
    };
    this.recognition = null;
  }
}
