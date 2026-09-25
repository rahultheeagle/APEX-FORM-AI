/**
 * @fileoverview Layer 4: Dynamical Systems Biomechanics & Phase-Space Sticking Point Engine.
 * Maps joint/body kinematics into 2D Phase Space (Position vs. Velocity: (y, yDot)),
 * detects the Biomechanical Sticking Region inflection (yDDot < 0 in disadvantage zone 70°-85°),
 * and computes the instantaneous escape force required (Newtons) to break mechanical stall.
 */

export class PhaseSpaceEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.athleteMassKg=75] Nominal lifter mass for Newtonian force estimation.
   * @param {number} [options.stickingMinAngle=70] Lower bound of biomechanical disadvantage zone (degrees).
   * @param {number} [options.stickingMaxAngle=85] Upper bound of biomechanical disadvantage zone (degrees).
   * @param {number} [options.maxTrajectoryLength=120] Maximum points retained in cyclical phase loop.
   */
  constructor(options = {}) {
    this.athleteMassKg = options.athleteMassKg !== undefined ? options.athleteMassKg : 75;
    this.stickingMinAngle = options.stickingMinAngle !== undefined ? options.stickingMinAngle : 70;
    this.stickingMaxAngle = options.stickingMaxAngle !== undefined ? options.stickingMaxAngle : 85;
    this.maxTrajectoryLength = options.maxTrajectoryLength !== undefined ? options.maxTrajectoryLength : 120;

    /** @type {number} Previous vertical position in screen space */
    this.prevY = null;

    /** @type {number} Previous instantaneous upward velocity */
    this.prevVelocity = 0;

    /** @type {number} Previous timestamp in milliseconds */
    this.prevTimestamp = 0;

    /** @type {Array<{ y: number, yDot: number, isSticking: boolean, timestamp: number }>} Cyclical phase loop */
    this.trajectory = [];

    /** @type {boolean} Current sticking status */
    this.isSticking = false;

    /** @type {number} Instantaneous escape force in Newtons */
    this.escapeForceRequired = 0;

    /** @type {number} Current upward velocity (m/s) */
    this.velocity = 0;

    /** @type {number} Current upward acceleration (m/s^2) */
    this.acceleration = 0;

    /** @type {number} Smoothed velocity for jitter-free phase portraits */
    this.smoothedVelocity = 0;
  }

  /**
   * Computes the instantaneous phase state (y, yDot, yDDot) and detects sticking inflection.
   * 
   * @param {number} currentY Current vertical position (normalized [0, 1]).
   * @param {number} [prevYInput] Optional previous vertical position.
   * @param {number} [deltaTimeSec] Elapsed time in seconds.
   * @param {number} [jointAngle=180] Current joint angle (e.g. knee angle in degrees).
   * @returns {{
   *   velocity: number,
   *   acceleration: number,
   *   isSticking: boolean,
   *   escapeForceRequired: number,
   *   phasePoint: { y: number, yDot: number }
   * }}
   */
  computePhaseState(currentY, prevYInput = null, deltaTimeSec = null, jointAngle = 180) {
    const now = performance.now();
    const effectivePrevY = prevYInput !== null ? prevYInput : (this.prevY !== null ? this.prevY : currentY);
    
    let dt = deltaTimeSec;
    if (dt === null || typeof dt !== 'number' || dt <= 0.001) {
      dt = this.prevTimestamp > 0 ? (now - this.prevTimestamp) / 1000 : (1 / 60);
    }
    // Clamp delta time to realistic 60–15 FPS bounds
    dt = Math.max(0.005, Math.min(0.15, dt));

    // Upward displacement: In screen coordinates, y=0 is top, y=1 is bottom.
    // Upward motion has negative deltaY in screen space, so upward displacement = -(currentY - effectivePrevY).
    // Scale normalized coordinate by approximate human height metric factor (~1.75m)
    const metricFactor = 1.75;
    const dyMetric = -(currentY - effectivePrevY) * metricFactor;

    // Instantaneous velocity (m/s): positive = rising/ascent, negative = sinking/descent
    const rawVelocity = dyMetric / dt;

    // Exponential Moving Average filter on velocity to suppress pose jitter
    if (this.prevY === null) {
      this.smoothedVelocity = rawVelocity;
      this.prevVelocity = rawVelocity;
    } else {
      this.smoothedVelocity = (0.55 * rawVelocity) + (0.45 * this.smoothedVelocity);
    }
    const velocity = this.smoothedVelocity;

    // Instantaneous acceleration (m/s^2): yDDot = d(yDot)/dt
    const acceleration = (velocity - this.prevVelocity) / dt;

    // Update state histories
    this.prevY = currentY;
    this.prevVelocity = velocity;
    this.prevTimestamp = now;
    this.velocity = velocity;
    this.acceleration = acceleration;

    // Phase Space Coordinates: (y_normalized, yDot)
    // Map vertical height to [0, 1] where 1 is top/lockout and 0 is deepest descent
    const phaseY = Math.max(0, Math.min(1, 1.0 - currentY));
    const phaseYDot = velocity;

    // Sticking Region Detection:
    // Inflection where yDDot < 0 while joint angles sit in the biomechanical disadvantage range (70°-85° knee angle)
    const inDisadvantageZone = jointAngle >= this.stickingMinAngle && jointAngle <= this.stickingMaxAngle;
    const isSticking = inDisadvantageZone && (acceleration < -0.05 || (velocity < 0.18 && acceleration <= 0));
    this.isSticking = isSticking;

    // Escape Force Computation (Newtons):
    // Force required to restore target ascent acceleration (atarget = 0.50 m/s^2) plus overcome velocity deficit
    if (isSticking) {
      const targetAcc = 0.50;
      const accDeficit = Math.max(0, targetAcc - acceleration);
      const targetVel = 0.35;
      const velDeficit = Math.max(0, targetVel - Math.max(0, velocity));

      // F_escape = m * accDeficit + damping * velDeficit
      const baseEscape = this.athleteMassKg * accDeficit;
      const velocityRestoration = velDeficit * 180;
      this.escapeForceRequired = Math.round(Math.min(650, Math.max(45, baseEscape + velocityRestoration)));
    } else {
      this.escapeForceRequired = 0;
    }

    // Append to rolling phase trajectory loop
    this.trajectory.push({
      y: phaseY,
      yDot: phaseYDot,
      isSticking,
      timestamp: now
    });

    if (this.trajectory.length > this.maxTrajectoryLength) {
      this.trajectory.shift();
    }

    return {
      velocity,
      acceleration,
      isSticking,
      escapeForceRequired: this.escapeForceRequired,
      phasePoint: { y: phaseY, yDot: phaseYDot }
    };
  }

  /**
   * Returns current trajectory buffer for HUD radar rendering.
   * @returns {Array<{ y: number, yDot: number, isSticking: boolean, timestamp: number }>}
   */
  getTrajectory() {
    return this.trajectory;
  }

  /**
   * Resets trajectory on repetition completion, keeping a short lead-in.
   */
  onRepComplete() {
    if (this.trajectory.length > 20) {
      this.trajectory = this.trajectory.slice(-15);
    }
    this.isSticking = false;
    this.escapeForceRequired = 0;
  }

  /**
   * Full engine state reset.
   */
  reset() {
    this.prevY = null;
    this.prevVelocity = 0;
    this.prevTimestamp = 0;
    this.smoothedVelocity = 0;
    this.velocity = 0;
    this.acceleration = 0;
    this.isSticking = false;
    this.escapeForceRequired = 0;
    this.trajectory = [];
  }
}
