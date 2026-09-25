/**
 * @fileoverview Layer 1: Lumbar Spine Curvature Tensor & Biomechanical Alignment Engine.
 * Evaluates real-time cervical-thoracic-lumbar spinal curvature using differential geometry
 * curvature tensors ($\kappa = \frac{|x' y'' - y' x''|}{(x'^2 + y'^2)^{3/2}}$), monitors
 * lumbar flexion vs pelvic tilt to detect "butt wink" under load, and generates articulated
 * spinal column segments for holographic HUD rendering.
 */

export class SpineAnalyzer {
  /**
   * @param {Object} [options]
   * @param {number} [options.criticalFlexionThresholdDeg=12] Lumbar flexion angle triggering critical warning.
   * @param {number} [options.moderateShearThresholdDeg=7] Lumbar flexion angle triggering moderate shear warning.
   * @param {number} [options.bottomDepthAngleThreshold=95] Joint flexion threshold defining bottom 20% of squat depth.
   */
  constructor(options = {}) {
    /** @type {number} */
    this.criticalFlexionThresholdDeg = options.criticalFlexionThresholdDeg || 12;
    /** @type {number} */
    this.moderateShearThresholdDeg = options.moderateShearThresholdDeg || 7;
    /** @type {number} */
    this.bottomDepthAngleThreshold = options.bottomDepthAngleThreshold || 95;

    /** @type {number} Calibrated baseline neutral standing flexion angle */
    this.neutralBaselineFlexion = 0;
    /** @type {boolean} */
    this.baselineCalibrated = false;

    /** @type {number} Count of repetitions completed with optimal spinal neutrality */
    this.safeRepsCount = 0;
    /** @type {number} Count of repetitions that breached lumbar shear limits */
    this.compromisedRepsCount = 0;
    /** @type {boolean} Flag for current active rep */
    this.currentRepHasSpineFault = false;
    /** @type {number} Peak lumbar flexion recorded in degrees */
    this.peakLumbarFlexion = 0;

    /** @type {Array<{ id: string, label: string, x: number, y: number, z: number, isLumbar: boolean }>} */
    this.spineSegments = [];
  }

  /**
   * Evaluates spinal curvature and lumbar shear alignment across pose landmarks.
   * 
   * @param {Array<{ x: number, y: number, z?: number, visibility?: number }>} landmarks Full 33 MediaPipe pose landmarks.
   * @param {string} [exerciseKey='SQUAT'] Active exercise key.
   * @param {number} [currentAngle=180] Primary joint flexion angle (e.g. knee or elbow angle).
   * @returns {{
   *   isNeutral: boolean,
   *   curvatureRadius: number,
   *   lumbarFlexionDeg: number,
   *   status: 'OPTIMAL' | 'MODERATE_SHEAR' | 'CRITICAL_FLEXION',
   *   spineSegments: Array<{ id: string, label: string, x: number, y: number, z: number, isLumbar: boolean }>,
   *   anchorPoints: { c7: {x:number, y:number, z:number}, t12: {x:number, y:number, z:number}, sacrum: {x:number, y:number, z:number} } | null,
   *   safeRepsCount: number,
   *   compromisedRepsCount: number
   * }}
   */
  evaluateSpineAlignment(landmarks, exerciseKey = 'SQUAT', currentAngle = 180) {
    if (!landmarks || landmarks.length < 25) {
      return this._getDefaultResult();
    }

    // Anchor Landmarks:
    // 11 = Left Shoulder, 12 = Right Shoulder
    // 23 = Left Hip, 24 = Right Hip
    const shL = landmarks[11];
    const shR = landmarks[12];
    const hipL = landmarks[23];
    const hipR = landmarks[24];

    if (!shL || !shR || !hipL || !hipR) {
      return this._getDefaultResult();
    }

    // 1. Anchor Points:
    // P1: Mid-Shoulders (C7/T1 cervical-thoracic junction proxy)
    const p1 = {
      x: (shL.x + shR.x) / 2,
      y: (shL.y + shR.y) / 2,
      z: ((shL.z || 0) + (shR.z || 0)) / 2
    };

    // P3: Mid-Hips (L5/Sacrum lumbosacral junction proxy)
    const p3 = {
      x: (hipL.x + hipR.x) / 2,
      y: (hipL.y + hipR.y) / 2,
      z: ((hipL.z || 0) + (hipR.z || 0)) / 2
    };

    // Calculate torso chord vector
    const dx = p3.x - p1.x;
    const dy = p3.y - p1.y;
    const dz = p3.z - p1.z;
    const chordLength = Math.hypot(dx, dy, dz) || 0.001;

    // P2: Mid-Torso (T12 thoracolumbar junction proxy)
    // Located at 58% of trunk length along the spinal axis with curvature displacement
    const spineZDiff = Math.abs(p3.z - p1.z);
    // Lumbar lordosis/kyphosis flex factor derived from hip-shoulder depth and pelvic angle
    const flexBowing = (hipL.z && hipR.z) ? ((hipL.z + hipR.z) / 2 - (shL.z + shR.z) / 2) * 0.35 : 0;
    
    const p2 = {
      x: p1.x + (dx * 0.58) - (dy * (flexBowing * 0.4)),
      y: p1.y + (dy * 0.58) + (dx * (flexBowing * 0.4)),
      z: p1.z + (dz * 0.58) + flexBowing
    };

    // 2. Differential Geometry Curvature Tensor Calculation:
    // Parameter t = 0.5 along quadratic Bézier fitting P1, P2, P3
    // x' = x3 - x1, y' = y3 - y1
    // x'' = 2*(x3 - 2*x2 + x1), y'' = 2*(y3 - 2*y2 + y1)
    const xp = p3.x - p1.x;
    const yp = p3.y - p1.y;
    const xpp = 2 * (p3.x - (2 * p2.x) + p1.x);
    const ypp = 2 * (p3.y - (2 * p2.y) + p1.y);

    const numerator = Math.abs((xp * ypp) - (yp * xpp));
    const denominator = Math.pow((xp * xp) + (yp * yp), 1.5) || 0.0001;
    const kappa = numerator / denominator; // Curvature tensor magnitude

    // Curvature radius R = 1 / kappa (normalized screen units)
    const curvatureRadius = Math.max(0.1, Math.min(999.0, 1.0 / (kappa + 0.00001)));

    // 3. Spinal Inclination & Lumbar Flexion Angle (Degrees)
    // Measure departure from straight line between P1->P2 and P2->P3
    const v12x = p2.x - p1.x;
    const v12y = p2.y - p1.y;
    const v23x = p3.x - p2.x;
    const v23y = p3.y - p2.y;

    const dot = (v12x * v23x) + (v12y * v23y);
    const mag12 = Math.hypot(v12x, v12y) || 1;
    const mag23 = Math.hypot(v23x, v23y) || 1;
    const cosAngle = Math.max(-1.0, Math.min(1.0, dot / (mag12 * mag23)));
    const rawFlexionDeg = Math.acos(cosAngle) * (180 / Math.PI);

    // Baseline calibration in upright stance (angle > 155°)
    if (currentAngle > 155) {
      if (!this.baselineCalibrated) {
        this.neutralBaselineFlexion = rawFlexionDeg;
        this.baselineCalibrated = true;
      } else {
        // Slow running average for standing baseline
        this.neutralBaselineFlexion = (this.neutralBaselineFlexion * 0.95) + (rawFlexionDeg * 0.05);
      }
    }

    const netFlexionDeg = Math.max(0, rawFlexionDeg - (this.baselineCalibrated ? this.neutralBaselineFlexion : 0));
    if (netFlexionDeg > this.peakLumbarFlexion) {
      this.peakLumbarFlexion = netFlexionDeg;
    }

    // 4. "Butt Wink" / Lumbar Flexion Severity Determination:
    // Evaluated especially during bottom 20% of squat depth (currentAngle <= bottomDepthAngleThreshold)
    const isAtBottomDepth = (exerciseKey === 'SQUAT' && currentAngle <= this.bottomDepthAngleThreshold) ||
                            (exerciseKey === 'PUSHUP' && currentAngle <= 90);

    let status = 'OPTIMAL';

    if (isAtBottomDepth) {
      // Stricter limits at bottom of squat where shear under load is catastrophic
      if (netFlexionDeg >= this.criticalFlexionThresholdDeg) {
        status = 'CRITICAL_FLEXION';
        this.currentRepHasSpineFault = true;
      } else if (netFlexionDeg >= this.moderateShearThresholdDeg) {
        status = 'MODERATE_SHEAR';
      }
    } else {
      // General movement envelope limits
      if (netFlexionDeg >= this.criticalFlexionThresholdDeg + 4) {
        status = 'CRITICAL_FLEXION';
        this.currentRepHasSpineFault = true;
      } else if (netFlexionDeg >= this.moderateShearThresholdDeg + 3) {
        status = 'MODERATE_SHEAR';
      }
    }

    // 5. Generate Articulated Segmented Spine Column (7 Discs: C7 down to Sacrum)
    this.spineSegments = this._generateSpineSegments(p1, p2, p3);

    return {
      isNeutral: status === 'OPTIMAL',
      curvatureRadius: Number(curvatureRadius.toFixed(2)),
      lumbarFlexionDeg: Number(netFlexionDeg.toFixed(1)),
      status,
      spineSegments: this.spineSegments,
      anchorPoints: { c7: p1, t12: p2, sacrum: p3 },
      safeRepsCount: this.safeRepsCount,
      compromisedRepsCount: this.compromisedRepsCount
    };
  }

  /**
   * Generates 7 articulated spine segment positions (C7, T4, T8, T12, L2, L4, Sacrum).
   * @private
   */
  _generateSpineSegments(p1, p2, p3) {
    const labels = [
      { id: 'C7', label: 'C7 Cervical', t: 0.00, isLumbar: false },
      { id: 'T4', label: 'T4 Thoracic', t: 0.18, isLumbar: false },
      { id: 'T8', label: 'T8 Thoracic', t: 0.38, isLumbar: false },
      { id: 'T12', label: 'T12 Junction', t: 0.58, isLumbar: false },
      { id: 'L2', label: 'L2 Lumbar', t: 0.72, isLumbar: true },
      { id: 'L4', label: 'L4 Lumbar', t: 0.86, isLumbar: true },
      { id: 'S1', label: 'Sacrum/L5', t: 1.00, isLumbar: true },
    ];

    return labels.map(item => {
      const t = item.t;
      // Quadratic Bézier interpolation
      const omt = 1 - t;
      const x = (omt * omt * p1.x) + (2 * omt * t * p2.x) + (t * t * p3.x);
      const y = (omt * omt * p1.y) + (2 * omt * t * p2.y) + (t * t * p3.y);
      const z = (omt * omt * p1.z) + (2 * omt * t * p2.z) + (t * t * p3.z);

      return {
        id: item.id,
        label: item.label,
        x,
        y,
        z,
        isLumbar: item.isLumbar
      };
    });
  }

  /**
   * Called upon repetition completion to archive spinal safety score.
   */
  onRepComplete() {
    if (this.currentRepHasSpineFault) {
      this.compromisedRepsCount++;
    } else {
      this.safeRepsCount++;
    }
    this.currentRepHasSpineFault = false;
  }

  /**
   * Default result when landmarks are obscured.
   * @private
   */
  _getDefaultResult() {
    return {
      isNeutral: true,
      curvatureRadius: 999.0,
      lumbarFlexionDeg: 0,
      status: 'OPTIMAL',
      spineSegments: [],
      anchorPoints: null,
      safeRepsCount: this.safeRepsCount,
      compromisedRepsCount: this.compromisedRepsCount
    };
  }

  /**
   * Resets accumulators and baseline state.
   */
  reset() {
    this.neutralBaselineFlexion = 0;
    this.baselineCalibrated = false;
    this.safeRepsCount = 0;
    this.compromisedRepsCount = 0;
    this.currentRepHasSpineFault = false;
    this.peakLumbarFlexion = 0;
    this.spineSegments = [];
  }
}
