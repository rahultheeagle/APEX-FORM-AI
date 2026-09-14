/**
 * @fileoverview Layer 2: exerciseClassifier.js
 * Automated Dynamic Exercise Classification Engine.
 * Analyzes real-time kinematic posture (torso-to-ground inclination and arm vectors),
 * debouncing over 15 consecutive frames to automatically switch between SQUAT, BICEP_CURL, and PUSHUP.
 */

export class ExerciseClassifier {
  /**
   * @param {(exercise: string) => void} [onExerciseChanged] Optional change callback.
   */
  constructor(onExerciseChanged) {
    /** @type {string} Active confirmed exercise */
    this.currentExercise = 'SQUAT';

    /** @type {string|null} Candidate exercise currently being debounced */
    this.pendingCandidate = null;

    /** @type {number} Consecutive frame match counter */
    this.debounceCount = 0;

    /** @type {number} Required consecutive frames before switching */
    this.DEBOUNCE_FRAMES = 15;

    /** @type {((exercise: string) => void)|null} */
    this.onExerciseChanged = onExerciseChanged || null;
  }

  /**
   * Evaluates current pose landmarks and resolves exercise classification.
   * 
   * @param {Array<{x: number, y: number, z: number, visibility: number}>} landmarks
   * @returns {{ currentExercise: string, candidate: string, hasChanged: boolean, torsoAngleDeg: number }}
   */
  classifyPose(landmarks) {
    if (!landmarks || landmarks.length < 25) {
      return { currentExercise: this.currentExercise, candidate: this.currentExercise, hasChanged: false, torsoAngleDeg: 90 };
    }

    const sL = landmarks[11];
    const sR = landmarks[12];
    const hL = landmarks[23];
    const hR = landmarks[24];
    const eL = landmarks[13];
    const eR = landmarks[14];
    const wL = landmarks[15];
    const wR = landmarks[16];

    if (!sL || !sR || !hL || !hR) {
      return { currentExercise: this.currentExercise, candidate: this.currentExercise, hasChanged: false, torsoAngleDeg: 90 };
    }

    // Mid-torso points
    const midShoulderX = (sL.x + sR.x) / 2;
    const midShoulderY = (sL.y + sR.y) / 2;
    const midHipX = (hL.x + hR.x) / 2;
    const midHipY = (hL.y + hR.y) / 2;

    const dx = Math.abs(midShoulderX - midHipX);
    const dy = Math.abs(midShoulderY - midHipY);

    // Torso angle relative to horizontal ground (0° = flat/prone, 90° = vertical standing)
    const torsoAngleRad = Math.atan2(dy, dx);
    const torsoAngleDeg = (torsoAngleRad * 180) / Math.PI;

    let candidate = 'SQUAT';

    // 1. Check for Pushup (Prone/Plank Horizontal Posture)
    if (torsoAngleDeg < 35) {
      candidate = 'PUSHUP';
    } else if (torsoAngleDeg >= 65) {
      // 2. Standing upright: Check arm kinematics for Bicep Curl vs Squat
      let isBicepCurlPose = false;

      if (wL && wR && eL && eR) {
        // Wrists positioned vertically between hips and shoulders
        const wristsInMidTorso = (wL.y < midHipY + 0.08 && wL.y > midShoulderY - 0.05) ||
                                (wR.y < midHipY + 0.08 && wR.y > midShoulderY - 0.05);

        // Elbows tucked near ribs horizontally
        const elbowsTucked = Math.abs(eL.x - hL.x) < 0.16 || Math.abs(eR.x - hR.x) < 0.16;

        if (wristsInMidTorso && elbowsTucked) {
          isBicepCurlPose = true;
        }
      }

      candidate = isBicepCurlPose ? 'BICEP_CURL' : 'SQUAT';
    } else {
      // Transitional range (35° - 65°): maintain current
      candidate = this.currentExercise;
    }

    // 3. 15-Frame Debounce Filter
    let hasChanged = false;

    if (candidate === this.pendingCandidate) {
      this.debounceCount++;
      if (this.debounceCount >= this.DEBOUNCE_FRAMES && candidate !== this.currentExercise) {
        this.currentExercise = candidate;
        hasChanged = true;
        if (typeof this.onExerciseChanged === 'function') {
          this.onExerciseChanged(this.currentExercise);
        }
      }
    } else {
      this.pendingCandidate = candidate;
      this.debounceCount = 1;
    }

    return {
      currentExercise: this.currentExercise,
      candidate,
      hasChanged,
      torsoAngleDeg: Math.round(torsoAngleDeg)
    };
  }

  /**
   * Resets debounce buffers.
   */
  reset() {
    this.pendingCandidate = null;
    this.debounceCount = 0;
  }
}
