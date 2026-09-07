/**
 * @fileoverview Layer 1 (UI): settingsModal.js
 * Controls the glassmorphic Settings Drawer for multilingual voice selection,
 * volume, speech rate, pitch calibration, and test audio playback.
 * Automatically persists user audio preferences in localStorage.
 */

import { SUPPORTED_LANGUAGES, PhraseKey } from '../logic/voiceCoach.js';

const STORAGE_KEY = 'apex_voice_settings';

export class SettingsModal {
  /**
   * @param {HTMLElement} modalEl Modal overlay element.
   * @param {import('../logic/voiceCoach.js').VoiceCoach} voiceCoach
   */
  constructor(modalEl, voiceCoach) {
    if (!modalEl) {
      throw new Error('SettingsModal: Valid modal overlay DOM node required.');
    }

    /** @type {HTMLElement} @private */
    this.modalEl = modalEl;
    /** @type {import('../logic/voiceCoach.js').VoiceCoach} @private */
    this.voiceCoach = voiceCoach;

    /** @type {HTMLSelectElement|null} @private */
    this.langSelect = modalEl.querySelector('#settings-lang-select');
    /** @type {HTMLInputElement|null} @private */
    this.volumeSlider = modalEl.querySelector('#settings-volume-slider');
    /** @type {HTMLInputElement|null} @private */
    this.rateSlider = modalEl.querySelector('#settings-rate-slider');
    /** @type {HTMLInputElement|null} @private */
    this.pitchSlider = modalEl.querySelector('#settings-pitch-slider');
    /** @type {HTMLElement|null} @private */
    this.volumeValLabel = modalEl.querySelector('#settings-volume-val');
    /** @type {HTMLElement|null} @private */
    this.rateValLabel = modalEl.querySelector('#settings-rate-val');
    /** @type {HTMLElement|null} @private */
    this.pitchValLabel = modalEl.querySelector('#settings-pitch-val');
    /** @type {HTMLButtonElement|null} @private */
    this.testBtn = modalEl.querySelector('#settings-test-btn');
    /** @type {HTMLButtonElement|null} @private */
    this.closeBtn = modalEl.querySelector('#settings-close-btn');

    this._populateLanguageOptions();
    this._loadSavedSettings();
    this._bindEvents();
  }

  /**
   * Populates the language selector with supported global languages.
   * @private
   */
  _populateLanguageOptions() {
    if (!this.langSelect) return;

    this.langSelect.innerHTML = '';
    Object.values(SUPPORTED_LANGUAGES).forEach((lang) => {
      const opt = document.createElement('option');
      opt.value = lang.code;
      opt.textContent = `${lang.native} — ${lang.label}`;
      this.langSelect.appendChild(opt);
    });
  }

  /**
   * Binds UI input events and audio synchronization.
   * @private
   */
  _bindEvents() {
    if (this.langSelect) {
      this.langSelect.addEventListener('change', () => {
        const lang = this.langSelect.value;
        this.voiceCoach.setLanguage(lang);
        this._saveSettings();
      });
    }

    if (this.volumeSlider) {
      this.volumeSlider.addEventListener('input', () => {
        const vol = parseFloat(this.volumeSlider.value);
        this.voiceCoach.setVolume(vol);
        if (this.volumeValLabel) this.volumeValLabel.textContent = `${Math.round(vol * 100)}%`;
        this._saveSettings();
      });
    }

    if (this.rateSlider) {
      this.rateSlider.addEventListener('input', () => {
        const rate = parseFloat(this.rateSlider.value);
        this.voiceCoach.setRate(rate);
        if (this.rateValLabel) this.rateValLabel.textContent = `${rate.toFixed(2)}x`;
        this._saveSettings();
      });
    }

    if (this.pitchSlider) {
      this.pitchSlider.addEventListener('input', () => {
        const pitch = parseFloat(this.pitchSlider.value);
        this.voiceCoach.setPitch(pitch);
        if (this.pitchValLabel) this.pitchValLabel.textContent = `${pitch.toFixed(2)}x`;
        this._saveSettings();
      });
    }

    if (this.testBtn) {
      this.testBtn.addEventListener('click', () => {
        this.voiceCoach.speakPhrase(PhraseKey.REP_SUCCESS, true);
      });
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => {
        this.close();
      });
    }

    // Close when clicking outside content
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) {
        this.close();
      }
    });
  }

  /**
   * Loads saved settings from localStorage.
   * @private
   */
  _loadSavedSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (parsed.language && this.langSelect) {
        this.langSelect.value = parsed.language;
        this.voiceCoach.setLanguage(parsed.language);
      }
      if (typeof parsed.volume === 'number' && this.volumeSlider) {
        this.volumeSlider.value = String(parsed.volume);
        this.voiceCoach.setVolume(parsed.volume);
        if (this.volumeValLabel) this.volumeValLabel.textContent = `${Math.round(parsed.volume * 100)}%`;
      }
      if (typeof parsed.rate === 'number' && this.rateSlider) {
        this.rateSlider.value = String(parsed.rate);
        this.voiceCoach.setRate(parsed.rate);
        if (this.rateValLabel) this.rateValLabel.textContent = `${parsed.rate.toFixed(2)}x`;
      }
      if (typeof parsed.pitch === 'number' && this.pitchSlider) {
        this.pitchSlider.value = String(parsed.pitch);
        this.voiceCoach.setPitch(parsed.pitch);
        if (this.pitchValLabel) this.pitchValLabel.textContent = `${parsed.pitch.toFixed(2)}x`;
      }
    } catch (e) {
      console.warn('SettingsModal: Failed to read saved settings from localStorage', e);
    }
  }

  /**
   * Saves current settings to localStorage.
   * @private
   */
  _saveSettings() {
    try {
      const settings = {
        language: this.langSelect ? this.langSelect.value : 'en-US',
        volume: this.volumeSlider ? parseFloat(this.volumeSlider.value) : 1.0,
        rate: this.rateSlider ? parseFloat(this.rateSlider.value) : 1.05,
        pitch: this.pitchSlider ? parseFloat(this.pitchSlider.value) : 1.0,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('SettingsModal: Failed to persist settings to localStorage', e);
    }
  }

  /**
   * Opens the settings modal drawer.
   */
  open() {
    this.modalEl.classList.add('modal--active');
  }

  /**
   * Closes the settings modal drawer.
   */
  close() {
    this.modalEl.classList.remove('modal--active');
  }

  /**
   * Toggles visibility.
   */
  toggle() {
    if (this.modalEl.classList.contains('modal--active')) {
      this.close();
    } else {
      this.open();
    }
  }
}
