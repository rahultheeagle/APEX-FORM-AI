/**
 * @fileoverview Layer 2: Biomechanical Sticking-Point Safety Spotter Engine.
 * Monitors concentric ascent phase dynamics, tracks velocity loss profiles,
 * and detects dangerous mechanical stalls within critical joint sticking ranges
 * (70° - 85°) to trigger emergency dump alerts and audio warnings.
 */

export class SafetySpotter {
  /**
   * @param {Object} [options]
   * @param {number} [options.criticalStickingMin=70] Sticking range lower bound (deg).
   * @param {number} [options.criticalStickingMax=85] Sticking range upper bound (deg).
   * @param {number} [options.stallVelocityThreshold=0.05] Velocity below which movement is considered stalled (m/s).
   * @param {number} [options.stallDurationMs=1200] Continuous duration threshold in ms to declare critical stall.
   * @param {number} [options.velocityLossThreshold=40] Velocity decay percent triggering sticking warning.
   */
  constructor(options = {}) {
    /** @type {number} */
    this.criticalStickingMin = options.criticalStickingMin || 70;
    /** @type {number} */
    this.criticalStickingMax = options.criticalStickingMax || 85;
    /** @type {number} */
    this.stallVelocityThreshold = options.stallVelocityThreshold !== undefined ? options.stallVelocityThreshold : 0.05;
    /** @type {number} */
    this.stallDurationMs = options.stallDurationMs || 1200;
    /** @type {number} */
    this.velocityLossThreshold = options.velocityLossThreshold || 40;

    /** @type {number} Highest upward velocity recorded during current repetition */
    this.peakConcentricVelocity = 0;
    /** @type {boolean} True if lifter is currently in a critical mechanical stall */
    this.isStalled = false;
    /** @type {number|null} Timestamp when potential stall began */
    this.stallDetectedTime = null;
    /** @type {'NORMAL'|'WARNING'|'CRITICAL'} */
    this.lastSeverity = 'NORMAL';
  }

  /**
   * Evaluates concentric ascent biomechanics and detects sticking points or critical stalls.
   * 
   * @param {number} currentAngle Current primary joint flexion angle in degrees.
   * @param {number} verticalVelocity Current upward concentric velocity (m/s).
   * @param {number} timeInPhase Active duration in concentric ascent phase in milliseconds.
   * @returns {{
   *   isStalled: boolean,
   *   severity: 'NORMAL' | 'WARNING' | 'CRITICAL',
   *   cue: string,
   *   velocityLossPercent: number,
   *   inStickingZone: boolean
   * }}
   */
  evaluateAscent(currentAngle, verticalVelocity, timeInPhase) {
    // If not in concentric ascent phase, reset baseline and return normal
    if (timeInPhase <= 0) {
      this.peakConcentricVelocity = 0;
      this.isStalled = false;
      this.stallDetectedTime = null;
      this.lastSeverity = 'NORMAL';
      return {
        isStalled: false,
        severity: 'NORMAL',
        cue: '',
        velocityLossPercent: 0,
        inStickingZone: false
      };
    }

    const safeVelocity = Math.max(0, verticalVelocity || 0);

    // Track peak concentric velocity during this rep
    if (safeVelocity > this.peakConcentricVelocity) {
      this.peakConcentricVelocity = safeVelocity;
    }

    // Check if joint is within the biomechanical sticking point zone (e.g. 70° - 85°)
    const inStickingZone = currentAngle >= this.criticalStickingMin && currentAngle <= this.criticalStickingMax;

    // Calculate velocity loss relative to peak
    let velocityLossPercent = 0;
    if (this.peakConcentricVelocity > 0.08) {
      velocityLossPercent = Math.max(0, Math.min(100, Math.round(((this.peakConcentricVelocity - safeVelocity) / this.peakConcentricVelocity) * 100)));
    }

    // 1. Critical Mechanical Stall Evaluation
    // Joint velocity < 0.05 m/s, phase duration > 1200ms, and within sticking range (70° - 85°)
    const isVelocityStalled = safeVelocity < this.stallVelocityThreshold;
    const isTimeStalled = timeInPhase > this.stallDurationMs;

    if (isVelocityStalled && isTimeStalled && inStickingZone) {
      this.isStalled = true;
      this.lastSeverity = 'CRITICAL';
      return {
        isStalled: true,
        severity: 'CRITICAL',
        cue: '⚠️ EMERGENCY: STALL DETECTED - DUMP SAFELY',
        velocityLossPercent: Math.max(velocityLossPercent, 80),
        inStickingZone: true
      };
    }

    // 2. Sticking Point Warning Evaluation
    // Velocity loss > 40%, or significant slowing in the sticking zone
    if (velocityLossPercent >= this.velocityLossThreshold || (inStickingZone && safeVelocity < 0.15 && timeInPhase > 600)) {
      this.isStalled = false;
      this.lastSeverity = 'WARNING';
      return {
        isStalled: false,
        severity: 'WARNING',
        cue: 'STICKING POINT DETECTED - DRIVE THROUGH',
        velocityLossPercent,
        inStickingZone
      };
    }

    // 3. Normal Concentric Ascent
    this.isStalled = false;
    this.lastSeverity = 'NORMAL';
    return {
      isStalled: false,
      severity: 'NORMAL',
      cue: '',
      velocityLossPercent,
      inStickingZone
    };
  }

  /**
   * Resets peak velocities and state flags for the next repetition or exercise transition.
   */
  reset() {
    this.peakConcentricVelocity = 0;
    this.isStalled = false;
    this.stallDetectedTime = null;
    this.lastSeverity = 'NORMAL';
  }
}
