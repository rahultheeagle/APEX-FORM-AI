/**
 * @fileoverview Layer 2: Autonomous Calibration & Multi-Angle Viewpoint Engine.
 * Evaluates distance calibration (55% - 85% vertical frame span), full-body framing,
 * camera viewing orientation (SAGITTAL_VIEW vs FRONTAL_VIEW), and 1.5s stability hold timers.
 */

/**
 * Camera viewing angle orientations.
 * @enum {string}
 */
export const ViewAngle = {
  FRONTAL_VIEW: 'FRONTAL_VIEW',   // Front profile (Symmetry & Valgus tracking)
  SAGITTAL_VIEW: 'SAGITTAL_VIEW', // Side profile (Depth & Spine tracking)
};

export class CalibrationEngine {
  constructor() {
    /** @type {boolean} True if framing and distance requirements are met */
    this.isCalibrated = false;
    /** @type {boolean} True if user held calibrated stance steady for 1.5s */
    this.isSteadyCalibrated = false;
    /** @type {string} Active viewpoint angle */
    this.viewAngle = ViewAngle.FRONTAL_VIEW;
    /** @type {string} User-facing positioning guidance */
    this.calibrationMessage = 'CALIBRATING POSITION...';

    /** @type {number} Timestamp when distance & containment first passed */
    this.calibrationStartTime = 0;
    /** @type {number} Required steady hold in ms */
    this.REQUIRED_STABLE_MS = 1500;
    /** @type {number} Hold progress [0.0 - 1.0] */
    this.holdProgress = 0;

    /** @type {{ minX: number, minY: number, maxX: number, maxY: number }} */
    this.bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  }

  /**
   * Resets calibration status and stability timers.
   */
  reset() {
    this.isCalibrated = false;
    this.isSteadyCalibrated = false;
    this.calibrationStartTime = 0;
    this.holdProgress = 0;
    this.calibrationMessage = 'CALIBRATING POSITION...';
  }

  /**
   * Evaluates camera frame landmarks for autonomous calibration.
   * 
   * @param {Array<any>} landmarks MediaPipe Pose 33 landmarks.
   * @returns {{ isCalibrated: boolean, isSteadyCalibrated: boolean, viewAngle: string, calibrationMessage: string, bodyHeightSpan: number, holdProgress: number, bounds: { minX: number, minY: number, maxX: number, maxY: number } }}
   */
  evaluateFrame(landmarks) {
    const now = performance.now();

    if (!landmarks || landmarks.length < 29) {
      this.reset();
      return {
        isCalibrated: false,
        isSteadyCalibrated: false,
        viewAngle: this.viewAngle,
        calibrationMessage: 'SEARCHING FOR ATHLETE...',
        bodyHeightSpan: 0,
        holdProgress: 0,
        bounds: this.bounds
      };
    }

    const nose = landmarks[0];
    const shoulderL = landmarks[11];
    const shoulderR = landmarks[12];
    const hipL = landmarks[23];
    const hipR = landmarks[24];
    const kneeL = landmarks[25];
    const kneeR = landmarks[26];
    const ankleL = landmarks[27];
    const ankleR = landmarks[28];

    // 1. Calculate Viewing Orientation (Sagittal vs Frontal)
    const shoulderSpanX = Math.abs(shoulderL.x - shoulderR.x);
    if (shoulderSpanX < 0.12) {
      this.viewAngle = ViewAngle.SAGITTAL_VIEW;
    } else {
      this.viewAngle = ViewAngle.FRONTAL_VIEW;
    }

    // 2. Full-Body Bounding Box & Canvas Boundary Containment
    const keyPoints = [nose, shoulderL, shoulderR, hipL, hipR, kneeL, kneeR, ankleL, ankleR];
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    let anyClipped = false;
    let anyLowVisibility = false;

    for (let i = 0; i < keyPoints.length; i++) {
      const p = keyPoints[i];
      if (!p || p.visibility < 0.50) {
        anyLowVisibility = true;
      } else {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);

        // Check if joint is too close to canvas edge (< 2% or > 98%)
        if (p.x < 0.02 || p.x > 0.98 || p.y < 0.02 || p.y > 0.98) {
          anyClipped = true;
        }
      }
    }

    this.bounds = { minX, minY, maxX, maxY };

    // 3. Distance Calibration: Nose-to-ankle height span
    const lowestAnkleY = Math.max(ankleL.y, ankleR.y);
    const bodyHeightSpan = Math.abs(lowestAnkleY - nose.y);

    let frameValid = true;
    let message = 'CALIBRATING POSITION...';

    if (anyLowVisibility || anyClipped) {
      frameValid = false;
      message = 'STEP INTO FULL VIEW';
    } else if (bodyHeightSpan < 0.55) {
      frameValid = false;
      message = 'STEP CLOSER TO CAMERA';
    } else if (bodyHeightSpan > 0.85) {
      frameValid = false;
      message = 'STEP BACK SLIGHTLY';
    }

    this.isCalibrated = frameValid;

    // 4. Stability Hold Management (1.5s countdown)
    if (this.isCalibrated) {
      if (!this.calibrationStartTime) {
        this.calibrationStartTime = now;
      }
      const elapsed = now - this.calibrationStartTime;
      this.holdProgress = Math.min(1.0, elapsed / this.REQUIRED_STABLE_MS);

      if (this.holdProgress >= 1.0) {
        this.isSteadyCalibrated = true;
        message = 'CALIBRATED & READY';
      } else {
        const remainingSec = ((this.REQUIRED_STABLE_MS - elapsed) / 1000).toFixed(1);
        message = `HOLD POSITION (${remainingSec}s)`;
      }
    } else {
      this.calibrationStartTime = 0;
      this.holdProgress = 0;
      this.isSteadyCalibrated = false;
    }

    this.calibrationMessage = message;

    return {
      isCalibrated: this.isCalibrated,
      isSteadyCalibrated: this.isSteadyCalibrated,
      viewAngle: this.viewAngle,
      calibrationMessage: this.calibrationMessage,
      bodyHeightSpan,
      holdProgress: this.holdProgress,
      bounds: this.bounds
    };
  }
}
