/**
 * @fileoverview Layer 2 (Audio): voiceCoach.js
 * Synthesizes verbal coaching instructions using the browser SpeechSynthesis API.
 * Features a strict 2.5s debounce window and queue management to guarantee zero overlapping audio.
 */

/**
 * Throttle time block window to prevent audio overlap (milliseconds).
 * @type {number}
 */
const MIN_SPEECH_INTERVAL_MS = 2500;

/**
 * Handles real-time text-to-speech feedback cues with strict debouncing.
 */
export class VoiceCoach {
  constructor() {
    /**
     * Last voiced text cue.
     * @type {string}
     * @private
     */
    this.lastSpokenText = '';

    /**
     * Timestamp of the last utterance.
     * @type {number}
     * @private
     */
    this.lastSpokenTime = 0;
  }

  /**
   * Voices the provided feedback phrase.
   * Cancels active speech queues immediately and enforces a minimum 2.5s debounce window.
   * 
   * @param {string} text The phrase to speak.
   * @param {boolean} [force=false] If true, bypasses the text equality check while respecting timestamp debounce.
   */
  speak(text, force = false) {
    if (!text || !('speechSynthesis' in window)) {
      return;
    }

    const now = Date.now();

    // Enforce 2.5s debounce cooldown
    if (!force && (now - this.lastSpokenTime < MIN_SPEECH_INTERVAL_MS)) {
      return;
    }

    // Prevent immediate repeat of exact same text within 3.5s
    if (text === this.lastSpokenText && (now - this.lastSpokenTime < 3500)) {
      return;
    }

    try {
      // Clear pending queue to eliminate audio lag
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05; // Slightly brisk, athletic tone
      utterance.pitch = 1.0;

      // Select high-quality English voice if present
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Siri')));
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      this.lastSpokenText = text;
      this.lastSpokenTime = now;

      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn('VoiceCoach: Speech synthesis execution failed.', error);
    }
  }

  /**
   * Resets debounce timers and cancels any ongoing speech.
   */
  reset() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.lastSpokenText = '';
    this.lastSpokenTime = 0;
  }
}
