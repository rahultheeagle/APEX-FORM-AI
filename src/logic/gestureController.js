/**
 * @fileoverview Layer 2: Gesture Controller.
 * Vision-based hands-free workout navigation:
 * - START_READY: Full body framed and steady for 3.0s
 * - PAUSE: Raised arm above nose with locked elbow for 1.5s
 * - STOP: Wrists crossed in front of chest for 2.0s
 * Features continuous hold progress calculation and a 2000ms debounce cooldown.
 */

export const GestureType = {
  NONE: 'NONE',
  START_READY: 'START_READY',
  PAUSE: 'PAUSE',
  STOP: 'STOP',
};

export class GestureController {
  constructor() {
    /** @type {string} Currently holding gesture */
    this.currentGesture = GestureType.NONE;
    /** @type {number} Timestamp when current gesture began */
    this.gestureStartTime = 0;
    /** @type {number} Timestamp of last successfully fired action */
    this.lastTriggerTime = 0;
    /** @type {number} Cooldown in milliseconds */
    this.DEBOUNCE_MS = 2000;

    /** @type {number} Duration required in ms */
    this.DURATIONS = {
      [GestureType.START_READY]: 3000,
      [GestureType.PAUSE]: 1500,
      [GestureType.STOP]: 2000,
    };

    /** @type {{ x: number, y: number }|null} Active anchor point for HUD ring */
    this.anchorPoint = null;

    /** @type {{ x: number, y: number }|null} Previous torso position for steadiness check */
    this.lastTorsoPos = null;
  }

  /**
   * Resets gesture hold states and timers.
   */
  reset() {
    this.currentGesture = GestureType.NONE;
    this.gestureStartTime = 0;
    this.anchorPoint = null;
    this.lastTorsoPos = null;
  }

  /**
   * Evaluates 33-landmark pose for navigation gestures.
   * 
   * @param {Array<any>} landmarks MediaPipe Pose landmarks.
   * @param {boolean} [isWorkoutActive=true] True if set is currently active.
   * @returns {{ activeGesture: string, holdProgress: number, triggeredEvent: string|null, anchorPoint: { x: number, y: number }|null }}
   */
  detectGestures(landmarks, isWorkoutActive = true) {
    const now = performance.now();

    if (!landmarks || landmarks.length < 29) {
      this.reset();
      return { activeGesture: GestureType.NONE, holdProgress: 0, triggeredEvent: null, anchorPoint: null };
    }

    const nose = landmarks[0];
    const shoulderL = landmarks[11];
    const shoulderR = landmarks[12];
    const elbowL = landmarks[13];
    const elbowR = landmarks[14];
    const wristL = landmarks[15];
    const wristR = landmarks[16];
    const hipL = landmarks[23];
    const hipR = landmarks[24];
    const kneeL = landmarks[25];
    const kneeR = landmarks[26];
    const ankleL = landmarks[27];
    const ankleR = landmarks[28];

    let detectedGesture = GestureType.NONE;
    let anchor = null;

    // 1. Check STOP Gesture: Crossed wrists over chest/sternum
    if (this._isStopGesture(wristL, wristR, elbowL, elbowR, shoulderL, shoulderR, hipL, hipR)) {
      detectedGesture = GestureType.STOP;
      anchor = {
        x: (wristL.x + wristR.x) / 2,
        y: (wristL.y + wristR.y) / 2,
      };
    }
    // 2. Check PAUSE Gesture: Either wrist raised above nose with locked elbow
    else if (this._isPauseGesture(wristL, elbowL, shoulderL, nose)) {
      detectedGesture = GestureType.PAUSE;
      anchor = { x: wristL.x, y: wristL.y };
    } else if (this._isPauseGesture(wristR, elbowR, shoulderR, nose)) {
      detectedGesture = GestureType.PAUSE;
      anchor = { x: wristR.x, y: wristR.y };
    }
    // 3. Check START_READY Gesture: Full body framed and holding steady
    else if (!isWorkoutActive && this._isStartReadyGesture(landmarks, shoulderL, shoulderR, hipL, hipR, kneeL, kneeR, ankleL, ankleR)) {
      detectedGesture = GestureType.START_READY;
      anchor = {
        x: (shoulderL.x + shoulderR.x) / 2,
        y: (shoulderL.y + shoulderR.y) / 2 - 0.08,
      };
    }

    // Process hold timers
    if (detectedGesture !== GestureType.NONE) {
      if (this.currentGesture !== detectedGesture) {
        this.currentGesture = detectedGesture;
        this.gestureStartTime = now;
        this.anchorPoint = anchor;
      } else {
        this.anchorPoint = anchor;
      }

      const requiredDuration = this.DURATIONS[detectedGesture] || 2000;
      const elapsed = now - this.gestureStartTime;
      const holdProgress = Math.min(1.0, elapsed / requiredDuration);

      let triggeredEvent = null;

      // Check if hold duration satisfied and debounce cooldown expired
      if (holdProgress >= 1.0 && (now - this.lastTriggerTime) > this.DEBOUNCE_MS) {
        triggeredEvent = detectedGesture;
        this.lastTriggerTime = now;
        this.reset();
      }

      return {
        activeGesture: detectedGesture,
        holdProgress,
        triggeredEvent,
        anchorPoint: this.anchorPoint,
      };
    }

    // No gesture detected: reset hold timer
    this.reset();
    return {
      activeGesture: GestureType.NONE,
      holdProgress: 0,
      triggeredEvent: null,
      anchorPoint: null,
    };
  }

  /**
   * Detects raised wrist above nose with locked/extended arm.
   * 
   * @param {any} wrist
   * @param {any} elbow
   * @param {any} shoulder
   * @param {any} nose
   * @returns {boolean}
   * @private
   */
  _isPauseGesture(wrist, elbow, shoulder, nose) {
    if (!wrist || !elbow || !shoulder || !nose) return false;
    if (wrist.visibility < 0.6 || elbow.visibility < 0.6 || nose.visibility < 0.6) return false;

    // Wrist must be elevated above nose
    const isAboveNose = wrist.y < (nose.y - 0.05);

    // Elbow extended (distance between shoulder and wrist near full reach)
    const armDistance = Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y);
    const upperArm = Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y);
    const foreArm = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y);
    const isExtended = armDistance > (0.75 * (upperArm + foreArm));

    return isAboveNose && isExtended;
  }

  /**
   * Detects forearms crossed in front of chest (wrists overlapping near sternum).
   * 
   * @param {any} wristL
   * @param {any} wristR
   * @param {any} elbowL
   * @param {any} elbowR
   * @param {any} shoulderL
   * @param {any} shoulderR
   * @param {any} hipL
   * @param {any} hipR
   * @returns {boolean}
   * @private
   */
  _isStopGesture(wristL, wristR, elbowL, elbowR, shoulderL, shoulderR, hipL, hipR) {
    if (!wristL || !wristR || !shoulderL || !shoulderR || !hipL || !hipR) return false;
    if (wristL.visibility < 0.6 || wristR.visibility < 0.6) return false;

    // Both wrists between shoulders and hips (chest zone)
    const avgShoulderY = (shoulderL.y + shoulderR.y) / 2;
    const avgHipY = (hipL.y + hipR.y) / 2;

    const inChestZoneL = wristL.y > (avgShoulderY - 0.05) && wristL.y < avgHipY;
    const inChestZoneR = wristR.y > (avgShoulderY - 0.05) && wristR.y < avgHipY;

    // Wrists overlapping in close proximity (< 12% viewport distance)
    const wristDistance = Math.hypot(wristL.x - wristR.x, wristL.y - wristR.y);
    const isOverlapping = wristDistance < 0.12;

    return inChestZoneL && inChestZoneR && isOverlapping;
  }

  /**
   * Detects full-body visibility and steady stance.
   * 
   * @param {Array<any>} landmarks
   * @param {any} sL
   * @param {any} sR
   * @param {any} hL
   * @param {any} hR
   * @param {any} kL
   * @param {any} kR
   * @param {any} aL
   * @param {any} aR
   * @returns {boolean}
   * @private
   */
  _isStartReadyGesture(landmarks, sL, sR, hL, hR, kL, kR, aL, aR) {
    const keyJoints = [sL, sR, hL, hR, kL, kR, aL, aR];
    const fullyVisible = keyJoints.every(j => j && j.visibility > 0.80);

    if (!fullyVisible) return false;

    // Steadiness check: torso drift < 2% of screen
    const torsoX = (sL.x + sR.x + hL.x + hR.x) / 4;
    const torsoY = (sL.y + sR.y + hL.y + hR.y) / 4;

    let isSteady = true;
    if (this.lastTorsoPos) {
      const drift = Math.hypot(torsoX - this.lastTorsoPos.x, torsoY - this.lastTorsoPos.y);
      if (drift > 0.035) {
        isSteady = false;
      }
    }
    this.lastTorsoPos = { x: torsoX, y: torsoY };

    return isSteady;
  }
}
