/**
 * @fileoverview Layer 0: Screen Wake Lock Display Guard.
 * Interfaces with the W3C Screen Wake Lock API to prevent mobile and desktop screens
 * from dimming or locking during active workout sets.
 *
 * Implements defensive capability checks and automatic re-acquisition on tab visibility changes.
 */

export class WakeLockManager {
  constructor() {
    /** @type {WakeLockSentinel|null} */
    this.sentinel = null;
    /** @type {boolean} User/app requested active state */
    this.isActive = false;

    this._onVisibilityChange = this._onVisibilityChange.bind(this);
  }

  /**
   * Evaluates if the current browser environment supports the Screen Wake Lock API.
   * @returns {boolean}
   */
  static isSupported() {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  /**
   * Requests a screen wake lock from the operating system.
   * Automatically re-acquires lock if tab visibility is restored.
   * 
   * @returns {Promise<boolean>} True if lock was successfully acquired.
   */
  async requestWakeLock() {
    this.isActive = true;

    if (!WakeLockManager.isSupported()) {
      console.warn('WakeLockManager: Screen Wake Lock API is not supported in this browser.');
      return false;
    }

    try {
      if (this.sentinel !== null && !this.sentinel.released) {
        return true;
      }

      // @ts-ignore - W3C Screen Wake Lock API
      this.sentinel = await navigator.wakeLock.request('screen');

      this.sentinel.addEventListener('release', () => {
        console.log('WakeLockManager: Screen wake lock was released.');
        this.sentinel = null;
      });

      // Listen for visibility changes to re-acquire when user returns to tab
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      document.addEventListener('visibilitychange', this._onVisibilityChange);

      console.log('WakeLockManager: Screen wake lock acquired successfully.');
      return true;
    } catch (error) {
      console.warn('WakeLockManager: Failed to acquire wake lock:', error);
      return false;
    }
  }

  /**
   * Releases active screen wake lock and removes event listeners.
   * @returns {Promise<void>}
   */
  async releaseWakeLock() {
    this.isActive = false;
    document.removeEventListener('visibilitychange', this._onVisibilityChange);

    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch (error) {
        console.warn('WakeLockManager: Error releasing wake lock:', error);
      }
      this.sentinel = null;
    }
  }

  /**
   * Visibility change listener to restore wake lock when tab returns to foreground.
   * @private
   */
  async _onVisibilityChange() {
    if (this.isActive && document.visibilityState === 'visible' && !this.sentinel) {
      console.log('WakeLockManager: Tab visible, re-acquiring screen wake lock...');
      await this.requestWakeLock();
    }
  }

  /**
   * Returns whether the screen wake lock is currently held.
   * @returns {boolean}
   */
  isLocked() {
    return this.sentinel !== null && !this.sentinel.released;
  }
}
