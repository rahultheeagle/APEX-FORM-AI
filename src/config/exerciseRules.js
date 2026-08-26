/**
 * @fileoverview Exercise rules configuration for biomechanical analysis (Layer 3).
 * Defines body joint indices and joint threshold boundaries.
 */

/**
 * Immutable configuration defining target joint landmarks and threshold values.
 * Coordinates index definitions map directly to Google MediaPipe Pose landmarks:
 * - Shoulder: 11 (Left), 12 (Right)
 * - Elbow: 13 (Left), 14 (Right)
 * - Wrist: 15 (Left), 16 (Right)
 * - Hip: 23 (Left), 24 (Right)
 * - Knee: 25 (Left), 26 (Right)
 * - Ankle: 27 (Left), 28 (Right)
 */
export const EXERCISE_RULES = Object.freeze({
  SQUAT: Object.freeze({
    name: 'Squat',
    joints: Object.freeze({
      hipLeft: 23,
      hipRight: 24,
      kneeLeft: 25,
      kneeRight: 26,
      ankleLeft: 27,
      ankleRight: 28,
      shoulderLeft: 11,
      shoulderRight: 12,
    }),
    thresholds: Object.freeze({
      standingMin: 160,
      depthMax: 90,
      maxTorsoIncline: 60,
    }),
  }),
  BICEP_CURL: Object.freeze({
    name: 'Biceps Curl',
    joints: Object.freeze({
      shoulderLeft: 11,
      shoulderRight: 12,
      elbowLeft: 13,
      elbowRight: 14,
      wristLeft: 15,
      wristRight: 16,
    }),
    thresholds: Object.freeze({
      extensionMin: 155,
      contractionMax: 45,
    }),
  }),
});
