/**
 * @fileoverview Dynamic Foot Arch Collapse & Medial Pronation Analyzer.
 * Measures ankle-to-metatarsal vectors, plantar heel-toe contact plane,
 * and vertical arch displacement to detect overpronation during weight-bearing phases.
 */

export class ArchCollapseAnalyzer {
  /**
   * @param {Object} [options]
   * @param {number} [options.collapseThresholdRatio=0.06] Arch drop threshold as fraction of foot length (6%).
   */
  constructor(options = {}) {
    this.collapseThresholdRatio = options.collapseThresholdRatio !== undefined ? options.collapseThresholdRatio : 0.06;

    // Resting baseline ankle vertical positions relative to plantar contact plane
    this.baselineLeftArchHeight = null;
    this.baselineRightArchHeight = null;
    this.calibrationSamples = 0;
    this.isCalibrated = false;

    /** @type {boolean} True if active arch collapse is detected on either foot */
    this.isCollapsed = false;

    /** @type {number} Overall bilateral arch integrity percentage [0 - 100] */
    this.archIntegrityPct = 100;

    /** @type {string} Corrective biomechanical feedback cue */
    this.correctiveCue = 'ARCH STABLE // OPTIMAL TRIPOD FOOT';

    /** @type {Object} Cached evaluation for Left foot */
    this.leftArch = {
      archIntegrityPct: 100,
      isCollapsed: false,
      archDrop: 0,
      footLength: 0.15,
      ankleRollInward: 0,
      anklePoint: null,
      heelPoint: null,
      toePoint: null
    };

    /** @type {Object} Cached evaluation for Right foot */
    this.rightArch = {
      archIntegrityPct: 100,
      isCollapsed: false,
      archDrop: 0,
      footLength: 0.15,
      ankleRollInward: 0,
      anklePoint: null,
      heelPoint: null,
      toePoint: null
    };
  }

  /**
   * Evaluates arch height, vertical drop, and medial pronation roll for a single foot.
   *
   * @param {{ x: number, y: number, z?: number }} ankle Ankle joint coordinate.
   * @param {{ x: number, y: number, z?: number }} heel Calcaneus heel coordinate.
   * @param {{ x: number, y: number, z?: number }} toe 1st/5th Metatarsal toe coordinate.
   * @param {boolean} isLeft True if evaluating left foot.
   * @returns {{
   *   archIntegrityPct: number,
   *   isCollapsed: boolean,
   *   correctiveCue: string,
   *   archDrop: number,
   *   footLength: number
   * }}
   */
  evaluateFootArch(ankle, heel, toe, isLeft = true) {
    if (!ankle || !heel || !toe) {
      return {
        archIntegrityPct: 100,
        isCollapsed: false,
        correctiveCue: 'ARCH STABLE // OPTIMAL TRIPOD FOOT',
        archDrop: 0,
        footLength: 0.15
      };
    }

    // 1. Plantar Vector v_heel-toe along ground contact plane
    const dx = toe.x - heel.x;
    const dy = toe.y - heel.y;
    const dz = (toe.z || 0) - (heel.z || 0);
    const footLength = Math.max(0.05, Math.hypot(dx, dy, dz));

    // Ground plane vertical reference (plantar line baseline)
    const midFootY = (heel.y + toe.y) * 0.5;
    // Current ankle height relative to ground plane (in screen coordinates, smaller Y is higher)
    const currentArchHeight = midFootY - ankle.y;

    // Establish resting baseline arch height during initial unweighted/standing frames
    if (isLeft) {
      if (this.baselineLeftArchHeight === null || this.calibrationSamples < 30) {
        this.baselineLeftArchHeight = this.baselineLeftArchHeight === null
          ? currentArchHeight
          : this.baselineLeftArchHeight * 0.9 + currentArchHeight * 0.1;
      }
    } else {
      if (this.baselineRightArchHeight === null || this.calibrationSamples < 30) {
        this.baselineRightArchHeight = this.baselineRightArchHeight === null
          ? currentArchHeight
          : this.baselineRightArchHeight * 0.9 + currentArchHeight * 0.1;
      }
    }

    const baseline = isLeft ? (this.baselineLeftArchHeight || currentArchHeight) : (this.baselineRightArchHeight || currentArchHeight);

    // Arch Drop: Delta Y_ankle - baseline (positive value indicates downward medial collapse)
    const archDrop = Math.max(0.0, baseline - currentArchHeight);

    // Medial pronation inward roll measurement
    // Left foot inward roll: ankle shifts rightward (+X) relative to heel-toe line
    // Right foot inward roll: ankle shifts leftward (-X) relative to heel-toe line
    const midFootX = (heel.x + toe.x) * 0.5;
    const medialInwardDelta = isLeft ? (ankle.x - midFootX) : (midFootX - ankle.x);

    // Collapse condition: Arch Drop >= 6% of foot length OR pronounced medial roll
    const collapseThreshold = this.collapseThresholdRatio * footLength;
    const isCollapsed = archDrop >= collapseThreshold || (archDrop >= collapseThreshold * 0.75 && medialInwardDelta > 0.02);

    // Arch integrity score [0 - 100]
    const dropRatio = archDrop / footLength;
    const integrityScore = Math.max(0, Math.min(100, Math.round(100 - (dropRatio / (this.collapseThresholdRatio * 2)) * 100)));

    const correctiveCue = isCollapsed
      ? '⚠️ PRONATION DETECTED // DRIVE THROUGH ARCH'
      : 'ARCH STABLE // OPTIMAL TRIPOD FOOT';

    return {
      archIntegrityPct: integrityScore,
      isCollapsed,
      correctiveCue,
      archDrop,
      footLength
    };
  }

  /**
   * Analyzes bilateral foot arches from 33 MediaPipe pose landmarks.
   *
   * @param {Array<{ x: number, y: number, z?: number }>} landmarks MediaPipe pose landmarks.
   * @param {boolean} [isWeightBearing=true] True if user is in active loaded repetition.
   * @returns {{
   *   archIntegrityPct: number,
   *   isCollapsed: boolean,
   *   correctiveCue: string,
   *   leftArch: Object,
   *   rightArch: Object,
   *   displayLabel: string
   * }}
   */
  analyzeLandmarks(landmarks, isWeightBearing = true) {
    if (!landmarks || landmarks.length < 33) {
      return this.getLastResult();
    }

    this.calibrationSamples++;
    if (this.calibrationSamples >= 30) {
      this.isCalibrated = true;
    }

    // MediaPipe landmarks:
    // Left Ankle: 27, Left Heel: 29, Left Toe (Foot Index): 31
    // Right Ankle: 28, Right Heel: 30, Right Toe (Foot Index): 32
    const leftAnkle = landmarks[27];
    const leftHeel = landmarks[29];
    const leftToe = landmarks[31];

    const rightAnkle = landmarks[28];
    const rightHeel = landmarks[30];
    const rightToe = landmarks[32];

    const leftEval = this.evaluateFootArch(leftAnkle, leftHeel, leftToe, true);
    const rightEval = this.evaluateFootArch(rightAnkle, rightHeel, rightToe, false);

    this.leftArch = {
      ...leftEval,
      anklePoint: leftAnkle,
      heelPoint: leftHeel,
      toePoint: leftToe
    };

    this.rightArch = {
      ...rightEval,
      anklePoint: rightAnkle,
      heelPoint: rightHeel,
      toePoint: rightToe
    };

    this.isCollapsed = isWeightBearing && (leftEval.isCollapsed || rightEval.isCollapsed);
    this.archIntegrityPct = Math.round((leftEval.archIntegrityPct + rightEval.archIntegrityPct) * 0.5);

    if (this.isCollapsed) {
      this.correctiveCue = '⚠️ PRONATION DETECTED // DRIVE THROUGH ARCH';
    } else {
      this.correctiveCue = 'ARCH STABLE // OPTIMAL TRIPOD FOOT';
    }

    return this.getLastResult();
  }

  /**
   * Returns current cached arch assessment.
   */
  getLastResult() {
    const displayLabel = this.isCollapsed
      ? '⚠️ PRONATION DETECTED // DRIVE THROUGH ARCH'
      : `ARCH INTEGRITY: ${this.archIntegrityPct}% [STABLE TRIPOD]`;

    return {
      archIntegrityPct: this.archIntegrityPct,
      isCollapsed: this.isCollapsed,
      correctiveCue: this.correctiveCue,
      leftArch: this.leftArch,
      rightArch: this.rightArch,
      displayLabel
    };
  }

  /**
   * Resets baseline calibration and temporal tracking.
   */
  reset() {
    this.baselineLeftArchHeight = null;
    this.baselineRightArchHeight = null;
    this.calibrationSamples = 0;
    this.isCalibrated = false;
    this.isCollapsed = false;
    this.archIntegrityPct = 100;
    this.correctiveCue = 'ARCH STABLE // OPTIMAL TRIPOD FOOT';
  }
}
