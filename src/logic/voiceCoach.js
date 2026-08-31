/**
 * @fileoverview Layer 2 (Audio): voiceCoach.js
 * Synthesizes verbal coaching instructions using the browser SpeechSynthesis API.
 */

/**
 * Throttle time block window to prevent repeat announcements (milliseconds).
 * @type {number}
 */
const MIN_SPEECH_INTERVAL_MS = 1800;

/**
 * Handles text-to-speech feedback cues, throttling, and queue management defensively.
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
     * Time stamp of the last completed utterance.
     * @type {number}
     * @private
     */
    this.lastSpokenTime = 0;
  }

  /**
   * Voices the provided feedback phrase.
   * Cancels any active speech queues immediately to avoid lag and debounces repeat calls.
   * 
   * @param {string} text The phrase to speak.
   */
  speak(text) {
    if (!text || !('speechSynthesis' in window)) {
      return;
    }

    const now = Date.now();

    // Prevent flooding duplicate alerts within the minimum cooldown period
    if (text === this.lastSpokenText && (now - this.lastSpokenTime < MIN_SPEECH_INTERVAL_MS)) {
      return;
    }

    try {
      // Clear current speech queue to keep latency to zero
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Update trackers
      this.lastSpokenText = text;
      this.lastSpokenTime = now;

      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn('VoiceCoach: Speech synthesis failed to execute.', error);
    }
  }
}
