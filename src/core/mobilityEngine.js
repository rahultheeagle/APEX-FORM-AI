/**
 * @fileoverview Layer 4: Computer Vision & Ankle Dorsiflexion Diagnostic Engine.
 * Analyzes acute ankle dorsiflexion angles between the tibial shaft and plantar foot axis,
 * detects premature heel elevation relative to the calibrated resting ground plane,
 * and classifies joint mobility quality into ADEQUATE or RESTRICTED.
 */

/**
 * @typedef {Object} JointPoint
 * @property {number} x Normalized X coordinate [0.0, 1.0].
 * @property {number} y Normalized Y coordinate [0.0, 1.0].
 * @property {number} [z] Metric or normalized depth coordinate.
 * @property {number} [visibility] Confidence score [0.0, 1.0].
 */

/**
 * @typedef {Object} AnkleMobilityResult
 * @property {number} dorsiAngleDeg Acute dorsiflexion angle in degrees.
 * @property {boolean} heelLifting True if heel elevation exceeds baseline threshold.
 * @property {'ADEQUATE' | 'RESTRICTED'} mobilityScore Diagnostic classification.
 * @property {number} deltaYHeel Vertical displacement of heel above resting floor baseline.
 * @property {number|null} baselineY Calibrated floor baseline Y coordinate.
 * @property {JointPoint|null} heelContactPoint Active heel landmark coordinate.
 * @property {JointPoint|null} anklePoint Active ankle landmark coordinate.
 * @property {JointPoint|null} kneePoint Active knee landmark coordinate.
 * @property {JointPoint|null} toePoint Active toe landmark coordinate.
 * @property {{ x: number, y: number, z: number }} tibialVector Vector along tibia (knee - ankle).
 * @property {{ x: number, y: number, z: number }} footVector Vector along foot axis (toe - heel).
 * @property {boolean} isVisible True if all relevant landmarks meet minimum visibility.
 */

export class MobilityEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.heelLiftThreshold=0.022] Vertical delta threshold for heel elevation (normalized screen space).
   * @param {number} [options.restrictedAngleThreshold=78] Dorsiflexion angle threshold above which ankle is restricted during deep flexion.
   * @param {number} [options.minVisibility=0.35] Landmark visibility threshold.
   * @param {number} [options.smoothingAlpha=0.30] EMA smoothing factor for angle stabilization.
   */
  constructor(options = {}) {
    this.heelLiftThreshold = options.heelLiftThreshold !== undefined ? options.heelLiftThreshold : 0.022;
    this.restrictedAngleThreshold = options.restrictedAngleThreshold !== undefined ? options.restrictedAngleThreshold : 78;
    this.minVisibility = options.minVisibility !== undefined ? options.minVisibility : 0.35;
    this.smoothingAlpha = options.smoothingAlpha !== undefined ? options.smoothingAlpha : 0.30;

    /** @type {number|null} Calibrated ground plane baseline Y coordinate (highest Y on screen = lowest physical floor) */
    this.groundBaselineY = null;

    /** @type {number} Temporally smoothed dorsiflexion angle in degrees */
    this.smoothedDorsiDeg = 90;

    /** @type {boolean} True if initial reading was recorded */
    this.hasReading = false;

    /** @type {number} Deepest dorsiflexion angle recorded in active repetition */
    this.peakRepDorsiDeg = 90;

    /** @type {boolean} True if heel lift was triggered during current repetition */
    this.repHadHeelLift = false;
  }

  /**
   * Analyzes acute ankle dorsiflexion angle and premature heel elevation.
   * 
   * Vector 1: Tibial shaft (P_knee - P_ankle).
   * Vector 2: Plantar foot axis (P_toe - P_heel).
   * Acute dorsiflexion angle:
   *   theta_dorsi = arccos((v_tibia . v_foot) / (||v_tibia|| * ||v_foot||))
   * 
   * @param {JointPoint|null} knee Landmark 25 or 26.
   * @param {JointPoint|null} ankle Landmark 27 or 28.
   * @param {JointPoint|null} heel Landmark 29 or 30.
   * @param {JointPoint|null} toe Landmark 31 or 32 (Foot index).
   * @returns {AnkleMobilityResult}
   */
  analyzeAnkleMobility(knee, ankle, heel, toe) {
    if (!knee || !ankle || !heel || !toe) {
      return this._createFallbackResult(knee, ankle, heel, toe);
    }

    const kneeVis = knee.visibility !== undefined ? knee.visibility : 1.0;
    const ankleVis = ankle.visibility !== undefined ? ankle.visibility : 1.0;
    const heelVis = heel.visibility !== undefined ? heel.visibility : 1.0;
    const toeVis = toe.visibility !== undefined ? toe.visibility : 1.0;

    if (kneeVis < this.minVisibility || ankleVis < this.minVisibility ||
        heelVis < this.minVisibility || toeVis < this.minVisibility) {
      return this._createFallbackResult(knee, ankle, heel, toe);
    }

    // 1. Vector 1: Tibial shaft (P_knee - P_ankle)
    const tibialVector = {
      x: knee.x - ankle.x,
      y: knee.y - ankle.y,
      z: (knee.z || 0) - (ankle.z || 0)
    };

    // 2. Vector 2: Plantar foot axis (P_toe - P_heel)
    const footVector = {
      x: toe.x - heel.x,
      y: toe.y - heel.y,
      z: (toe.z || 0) - (heel.z || 0)
    };

    // Magnitudes
    const normTibia = Math.hypot(tibialVector.x, tibialVector.y, tibialVector.z);
    const normFoot = Math.hypot(footVector.x, footVector.y, footVector.z);

    if (normTibia < 0.001 || normFoot < 0.001) {
      return this._createFallbackResult(knee, ankle, heel, toe);
    }

    // 3. Dot product & Acute angle computation
    const dotProduct = (tibialVector.x * footVector.x) +
                       (tibialVector.y * footVector.y) +
                       (tibialVector.z * footVector.z);

    const cosTheta = Math.max(-1.0, Math.min(1.0, dotProduct / (normTibia * normFoot)));
    let rawDeg = (Math.acos(cosTheta) * 180) / Math.PI;

    // Maintain strictly the acute angle between tibial shaft and foot axis [0°, 90°]
    if (rawDeg > 90) {
      rawDeg = 180 - rawDeg;
    }
    rawDeg = Math.max(0, Math.min(90, rawDeg));

    // Temporal EMA smoothing for visual HUD stability
    if (!this.hasReading) {
      this.smoothedDorsiDeg = rawDeg;
      this.hasReading = true;
    } else {
      const alpha = this.smoothingAlpha;
      this.smoothedDorsiDeg = (alpha * rawDeg) + ((1.0 - alpha) * this.smoothedDorsiDeg);
    }

    const dorsiAngleDeg = Math.round(this.smoothedDorsiDeg * 10) / 10;
    this.peakRepDorsiDeg = Math.min(this.peakRepDorsiDeg, dorsiAngleDeg);

    // 4. Ground baseline auto-calibration & Heel elevation detection
    // In screen coordinates: larger Y is physically lower (closer to ground).
    // The resting baseline heel position is the maximum heel Y seen during normal ground contact.
    if (this.groundBaselineY === null) {
      this.groundBaselineY = heel.y;
    } else {
      // Relax baseline downward if athlete is lower on screen
      if (heel.y > this.groundBaselineY) {
        this.groundBaselineY = (0.20 * heel.y) + (0.80 * this.groundBaselineY);
      }
    }

    // Vertical displacement relative to resting baseline:
    // If heel lifts, heel.y decreases (moves upward toward 0)
    const deltaYHeel = Math.max(0, (this.groundBaselineY - heel.y));
    const heelLifting = deltaYHeel > this.heelLiftThreshold;

    if (heelLifting) {
      this.repHadHeelLift = true;
    }

    // 5. Clinical mobility classification:
    // Restricted if heel lifts to compensate, or if acute dorsiflexion cannot reach adequate depth
    let mobilityScore = 'ADEQUATE';
    if (heelLifting || dorsiAngleDeg > this.restrictedAngleThreshold) {
      mobilityScore = 'RESTRICTED';
    }

    return {
      dorsiAngleDeg,
      heelLifting,
      mobilityScore,
      deltaYHeel: Math.round(deltaYHeel * 1000) / 1000,
      baselineY: this.groundBaselineY,
      heelContactPoint: { x: heel.x, y: heel.y },
      anklePoint: { x: ankle.x, y: ankle.y },
      kneePoint: { x: knee.x, y: knee.y },
      toePoint: { x: toe.x, y: toe.y },
      tibialVector,
      footVector,
      isVisible: true
    };
  }

  /**
   * Evaluates ankle mobility across 33 MediaPipe pose landmarks,
   * automatically prioritizing the profile view side with highest joint visibility.
   * 
   * @param {Array<JointPoint>} landmarks
   * @returns {AnkleMobilityResult}
   */
  analyzeLandmarks(landmarks) {
    if (!landmarks || landmarks.length < 33) {
      return this._createFallbackResult(null, null, null, null);
    }

    // Left leg indices: Knee (25), Ankle (27), Heel (29), Toe/Foot Index (31)
    const kneeL = landmarks[25];
    const ankleL = landmarks[27];
    const heelL = landmarks[29];
    const toeL = landmarks[31];

    // Right leg indices: Knee (26), Ankle (28), Heel (30), Toe/Foot Index (32)
    const kneeR = landmarks[26];
    const ankleR = landmarks[28];
    const heelR = landmarks[30];
    const toeR = landmarks[32];

    const scoreL = ((kneeL?.visibility || 0) + (ankleL?.visibility || 0) +
                    (heelL?.visibility || 0) + (toeL?.visibility || 0)) / 4;
    const scoreR = ((kneeR?.visibility || 0) + (ankleR?.visibility || 0) +
                    (heelR?.visibility || 0) + (toeR?.visibility || 0)) / 4;

    const useLeft = scoreL >= scoreR;
    const knee = useLeft ? kneeL : kneeR;
    const ankle = useLeft ? ankleL : ankleR;
    const heel = useLeft ? heelL : heelR;
    const toe = useLeft ? toeL : toeR;

    return this.analyzeAnkleMobility(knee, ankle, heel, toe);
  }

  /**
   * Resets temporal state and baseline calibration.
   */
  reset() {
    this.groundBaselineY = null;
    this.smoothedDorsiDeg = 90;
    this.hasReading = false;
    this.peakRepDorsiDeg = 90;
    this.repHadHeelLift = false;
  }

  /**
   * Repetition completion callback to reset intra-rep peak tracking.
   */
  onRepComplete() {
    const summary = {
      peakDorsiDeg: this.peakRepDorsiDeg,
      hadHeelLift: this.repHadHeelLift,
      mobilityRating: (this.repHadHeelLift || this.peakRepDorsiDeg > this.restrictedAngleThreshold) ? 'RESTRICTED' : 'ADEQUATE'
    };
    this.peakRepDorsiDeg = 90;
    this.repHadHeelLift = false;
    return summary;
  }

  /**
   * Creates safe fallback result when joints are obscured.
   * @private
   */
  _createFallbackResult(knee, ankle, heel, toe) {
    return {
      dorsiAngleDeg: 90,
      heelLifting: false,
      mobilityScore: 'ADEQUATE',
      deltaYHeel: 0,
      baselineY: this.groundBaselineY,
      heelContactPoint: heel ? { x: heel.x, y: heel.y } : null,
      anklePoint: ankle ? { x: ankle.x, y: ankle.y } : null,
      kneePoint: knee ? { x: knee.x, y: knee.y } : null,
      toePoint: toe ? { x: toe.x, y: toe.y } : null,
      tibialVector: { x: 0, y: -1, z: 0 },
      footVector: { x: 1, y: 0, z: 0 },
      isVisible: false
    };
  }
}
