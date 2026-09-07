/**
 * @fileoverview Layer 1 (UI): robotTrainer.js
 * Procedural AI Robotic Practice Trainer & Kinematic Hologram.
 * Demonstrates real-time exercise form, guides cadence along a 4.5-second loop,
 * and calculates synchronization accuracy against user movements.
 * Zero external GLTF/OBJ assets: Pure 60 FPS procedural Canvas 2D kinematics.
 */

/**
 * 4.5-Second Loop Timings in Milliseconds.
 */
const CYCLE_DURATION_MS = 4500;
const ECCENTRIC_END_MS = 2500;
const ISOMETRIC_END_MS = 3200;
const CONCENTRIC_END_MS = 4200;

export class RobotTrainer {
  /**
   * @param {string} [initialExercise='SQUAT']
   */
  constructor(initialExercise = 'SQUAT') {
    /** @type {string} */
    this.activeExercise = initialExercise;
    /** @type {number} */
    this.startTime = performance.now();
    /** @type {boolean} */
    this.isActive = false;
  }

  /**
   * Sets target exercise for the robot trainer.
   * @param {string} exerciseKey 'SQUAT' | 'PUSHUP' | 'BICEP_CURL'
   */
  setExercise(exerciseKey) {
    this.activeExercise = exerciseKey;
  }

  /**
   * Starts or resumes the trainer cycle.
   */
  start() {
    this.isActive = true;
    this.startTime = performance.now();
  }

  /**
   * Halts the trainer.
   */
  stop() {
    this.isActive = false;
  }

  /**
   * Computes the normalized cycle progress (0.0 to 1.0) and phase at the given timestamp.
   * 
   * @param {number} [timestamp]
   * @returns {{ cycleTime: number, progress: number, phase: 'DESCENT'|'HOLD'|'ASCENT'|'LOCKOUT', phaseProgress: number }}
   */
  getCycleState(timestamp = performance.now()) {
    const elapsed = (timestamp - this.startTime) % CYCLE_DURATION_MS;
    const progress = elapsed / CYCLE_DURATION_MS;

    if (elapsed < ECCENTRIC_END_MS) {
      // 0.0s - 2.5s: Controlled eccentric descent
      const phaseProgress = elapsed / ECCENTRIC_END_MS;
      return { cycleTime: elapsed, progress, phase: 'DESCENT', phaseProgress };
    } else if (elapsed < ISOMETRIC_END_MS) {
      // 2.5s - 3.2s: Isometric bottom hold
      const phaseProgress = (elapsed - ECCENTRIC_END_MS) / (ISOMETRIC_END_MS - ECCENTRIC_END_MS);
      return { cycleTime: elapsed, progress, phase: 'HOLD', phaseProgress };
    } else if (elapsed < CONCENTRIC_END_MS) {
      // 3.2s - 4.2s: Powerful concentric ascent
      const phaseProgress = (elapsed - ISOMETRIC_END_MS) / (CONCENTRIC_END_MS - ISOMETRIC_END_MS);
      return { cycleTime: elapsed, progress, phase: 'ASCENT', phaseProgress };
    } else {
      // 4.2s - 4.5s: Lockout and reset
      const phaseProgress = (elapsed - CONCENTRIC_END_MS) / (CYCLE_DURATION_MS - CONCENTRIC_END_MS);
      return { cycleTime: elapsed, progress, phase: 'LOCKOUT', phaseProgress };
    }
  }

  /**
   * Returns the robot's expected reference joint angle at current millisecond.
   * 
   * @param {number} [timestamp]
   * @returns {number} Angle in degrees.
   */
  getCurrentTargetAngle(timestamp = performance.now()) {
    const { phase, phaseProgress } = this.getCycleState(timestamp);

    if (this.activeExercise === 'SQUAT') {
      const STANDING_ANGLE = 170;
      const TARGET_DEPTH_ANGLE = 85;

      switch (phase) {
        case 'DESCENT':
          // Smooth sinusoidal ease-in-out descent
          return STANDING_ANGLE - (STANDING_ANGLE - TARGET_DEPTH_ANGLE) * (0.5 - 0.5 * Math.cos(Math.PI * phaseProgress));
        case 'HOLD':
          return TARGET_DEPTH_ANGLE;
        case 'ASCENT':
          // Snappy power ascent
          return TARGET_DEPTH_ANGLE + (STANDING_ANGLE - TARGET_DEPTH_ANGLE) * Math.sin((Math.PI / 2) * phaseProgress);
        case 'LOCKOUT':
        default:
          return STANDING_ANGLE;
      }
    } else if (this.activeExercise === 'BICEP_CURL') {
      const EXTENSION_ANGLE = 160;
      const CONTRACTION_ANGLE = 45;

      switch (phase) {
        case 'DESCENT': // Concentric curl up
          return EXTENSION_ANGLE - (EXTENSION_ANGLE - CONTRACTION_ANGLE) * (0.5 - 0.5 * Math.cos(Math.PI * phaseProgress));
        case 'HOLD':
          return CONTRACTION_ANGLE;
        case 'ASCENT': // Controlled eccentric lowering
          return CONTRACTION_ANGLE + (EXTENSION_ANGLE - CONTRACTION_ANGLE) * (0.5 - 0.5 * Math.cos(Math.PI * phaseProgress));
        case 'LOCKOUT':
        default:
          return EXTENSION_ANGLE;
      }
    } else {
      // Default / Pushup
      return 90;
    }
  }

  /**
   * Calculates synchronization accuracy (0 - 100%) against user real-time angle.
   * 
   * @param {number} userAngle
   * @param {number} [timestamp]
   * @returns {number} Score between 0 and 100.
   */
  calculateSyncScore(userAngle, timestamp = performance.now()) {
    if (!userAngle || userAngle <= 0) return 0;
    const targetAngle = this.getCurrentTargetAngle(timestamp);
    const delta = Math.abs(userAngle - targetAngle);

    // Within 8 degrees is considered 100% sync
    if (delta <= 8) return 100;
    
    // Scale linearly from 100% at 8° delta to 0% at 75° delta
    const score = Math.max(0, Math.min(100, Math.round(100 - ((delta - 8) / 67) * 100)));
    return score;
  }

  /**
   * Returns actionable sync guidance text.
   * 
   * @param {number} userAngle
   * @param {number} [timestamp]
   * @returns {{ status: string, score: number, color: string }}
   */
  getSyncStatus(userAngle, timestamp = performance.now()) {
    const score = this.calculateSyncScore(userAngle, timestamp);
    const targetAngle = this.getCurrentTargetAngle(timestamp);
    const delta = userAngle - targetAngle;

    if (score >= 80) {
      return { status: 'IN CADENCE', score, color: '#00ff87' };
    } else if (delta > 25) {
      // User is higher than robot (needs more depth)
      return { status: 'MATCH DEPTH', score, color: '#f59e0b' };
    } else if (delta < -25) {
      // User is moving faster or lower than robot
      return { status: 'SLOW DOWN', score, color: '#00f2fe' };
    } else {
      return { status: 'ADJUST PACE', score, color: '#ff0055' };
    }
  }

  /**
   * Renders the sleek cybernetic humanoid robot procedural model onto target canvas context.
   * 
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} targetX Center X position.
   * @param {number} targetY Floor/Base Y position.
   * @param {number} scale Scale multiplier (1.0 = ~260px tall).
   * @param {number} [currentTimestamp]
   */
  drawRobot(ctx, targetX, targetY, scale = 1.0, currentTimestamp = performance.now()) {
    const { phase, progress } = this.getCycleState(currentTimestamp);
    const targetAngle = this.getCurrentTargetAngle(currentTimestamp);

    ctx.save();
    ctx.translate(targetX, targetY);
    ctx.scale(scale, scale);

    // Colors
    const COLOR_CARBON = '#1e293b';       // Dark slate steel armor
    const COLOR_CARBON_LIGHT = '#334155'; // Secondary highlight plate
    const COLOR_CYBER_BORDER = '#38bdf8'; // Cyan border
    const COLOR_ARC_CORE = '#00f2fe';     // Neon cyan glow
    const COLOR_ARC_GLOW = 'rgba(0, 242, 254, 0.4)';
    const COLOR_JOINT = '#0f172a';

    // Kinematic Joint Positions calculation based on current target angle
    let hipY = -140;
    let hipX = 0;
    let kneeY = -70;
    let kneeX = 20;
    let ankleY = 0;
    let ankleX = 0;
    let torsoAngle = 0;

    if (this.activeExercise === 'SQUAT') {
      // Normalize squat descent: 170° (standing) -> 85° (bottom)
      const squatNorm = Math.max(0, Math.min(1, (170 - targetAngle) / (170 - 85)));

      // Pelvis drops vertically and tracks back
      hipY = -140 + squatNorm * 52;
      hipX = -squatNorm * 18;

      // Knees push forward and track down
      kneeY = -70 + squatNorm * 26;
      kneeX = 20 + squatNorm * 12;

      // Torso maintains ~20° athletic forward lean at bottom
      torsoAngle = squatNorm * 0.32;
    } else if (this.activeExercise === 'BICEP_CURL') {
      hipY = -140;
      hipX = 0;
      kneeY = -70;
      kneeX = 10;
      ankleY = 0;
      ankleX = 0;
      torsoAngle = 0;
    }

    // --- 1. Ground Holographic Ring Under Feet ---
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, 50, 12, 0, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(0, 0, 30, 8, 0, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(0, 255, 135, 0.4)';
    ctx.lineWidth = 1.0;
    ctx.stroke();
    ctx.restore();

    // --- 2. Legs & Hydraulic Pivots ---
    const drawLeg = (sideOffset) => {
      const hX = hipX + sideOffset * 10;
      const hY = hipY;
      const kX = kneeX + sideOffset * 8;
      const kY = kneeY;
      const aX = ankleX + sideOffset * 12;
      const aY = ankleY;

      // Thigh Segment
      ctx.beginPath();
      ctx.moveTo(hX, hY);
      ctx.lineTo(kX, kY);
      ctx.strokeStyle = COLOR_CARBON;
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.strokeStyle = COLOR_CYBER_BORDER;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Shin Segment
      ctx.beginPath();
      ctx.moveTo(kX, kY);
      ctx.lineTo(aX, aY);
      ctx.strokeStyle = COLOR_CARBON;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.strokeStyle = COLOR_CYBER_BORDER;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Articulated Knee Hydraulic Pivot
      ctx.beginPath();
      ctx.arc(kX, kY, 6, 0, 2 * Math.PI);
      ctx.fillStyle = COLOR_JOINT;
      ctx.fill();
      ctx.strokeStyle = COLOR_CYBER_BORDER;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Center pivot core
      ctx.beginPath();
      ctx.arc(kX, kY, 2, 0, 2 * Math.PI);
      ctx.fillStyle = COLOR_ARC_CORE;
      ctx.fill();

      // Foot Base
      ctx.beginPath();
      ctx.moveTo(aX - 8, aY);
      ctx.lineTo(aX + 16, aY);
      ctx.strokeStyle = COLOR_CARBON_LIGHT;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.stroke();
    };

    drawLeg(-1); // Back Leg
    drawLeg(1);  // Front Leg

    // --- 3. Pelvis / Hip Core ---
    ctx.beginPath();
    ctx.arc(hipX, hipY, 14, 0, 2 * Math.PI);
    ctx.fillStyle = COLOR_CARBON;
    ctx.fill();
    ctx.strokeStyle = COLOR_CYBER_BORDER;
    ctx.lineWidth = 2;
    ctx.stroke();

    // --- 4. Articulated Torso & Armor Plates ---
    ctx.save();
    ctx.translate(hipX, hipY);
    ctx.rotate(torsoAngle);

    // Spine Hydraulic Piston
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -65);
    ctx.strokeStyle = COLOR_CARBON_LIGHT;
    ctx.lineWidth = 8;
    ctx.stroke();

    // Chest Armor Segment
    ctx.beginPath();
    ctx.moveTo(-20, -65);
    ctx.lineTo(20, -65);
    ctx.lineTo(14, -25);
    ctx.lineTo(-14, -25);
    ctx.closePath();
    ctx.fillStyle = COLOR_CARBON;
    ctx.fill();
    ctx.strokeStyle = COLOR_CYBER_BORDER;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Secondary Chest Plate Detail Lines
    ctx.beginPath();
    ctx.moveTo(-16, -55);
    ctx.lineTo(16, -55);
    ctx.strokeStyle = COLOR_CARBON_LIGHT;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // --- 5. Power Core: Chest Arc Reactor ---
    const pulseScale = 1.0 + Math.sin(currentTimestamp / 160) * 0.12;
    ctx.beginPath();
    ctx.arc(0, -45, 6.5 * pulseScale, 0, 2 * Math.PI);
    ctx.fillStyle = COLOR_ARC_CORE;
    ctx.shadowBlur = 14;
    ctx.shadowColor = COLOR_ARC_CORE;
    ctx.fill();
    ctx.shadowBlur = 0; // Reset

    ctx.beginPath();
    ctx.arc(0, -45, 9, 0, 2 * Math.PI);
    ctx.strokeStyle = COLOR_CYBER_BORDER;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // --- 6. Arms & Shoulders ---
    let elbowX = 22;
    let elbowY = -40;
    let wristX = 35;
    let wristY = -25;

    if (this.activeExercise === 'SQUAT') {
      // Counter-balance reach: arms extended forward
      elbowX = 28;
      elbowY = -55;
      wristX = 48;
      wristY = -58;
    } else if (this.activeExercise === 'BICEP_CURL') {
      const curlNorm = Math.max(0, Math.min(1, (160 - targetAngle) / (160 - 45)));
      elbowX = 14;
      elbowY = -35;
      wristX = 14 + (1 - curlNorm) * 12 + curlNorm * 2;
      wristY = -35 + (1 - curlNorm) * 32 - curlNorm * 28;
    }

    // Arm Segment
    ctx.beginPath();
    ctx.moveTo(14, -60);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(wristX, wristY);
    ctx.strokeStyle = COLOR_CARBON;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.strokeStyle = COLOR_CYBER_BORDER;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Articulated Elbow Bearing
    ctx.beginPath();
    ctx.arc(elbowX, elbowY, 4.5, 0, 2 * Math.PI);
    ctx.fillStyle = COLOR_JOINT;
    ctx.fill();
    ctx.strokeStyle = COLOR_CYBER_BORDER;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Shoulder Pivot Bearing
    ctx.beginPath();
    ctx.arc(14, -60, 6, 0, 2 * Math.PI);
    ctx.fillStyle = COLOR_CARBON_LIGHT;
    ctx.fill();
    ctx.strokeStyle = COLOR_CYBER_BORDER;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // --- 7. Cybernetic Head & Horizontal Neon Visor ---
    // Neck
    ctx.beginPath();
    ctx.moveTo(0, -65);
    ctx.lineTo(0, -74);
    ctx.strokeStyle = COLOR_CARBON_LIGHT;
    ctx.lineWidth = 7;
    ctx.stroke();

    // Helmet Armor Shape
    ctx.beginPath();
    ctx.moveTo(-11, -74);
    ctx.lineTo(11, -74);
    ctx.lineTo(13, -92);
    ctx.lineTo(0, -97);
    ctx.lineTo(-13, -92);
    ctx.closePath();
    ctx.fillStyle = COLOR_CARBON;
    ctx.fill();
    ctx.strokeStyle = COLOR_CYBER_BORDER;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Horizontal Neon Eye Beam / Cyber Visor
    ctx.beginPath();
    ctx.moveTo(-8, -85);
    ctx.lineTo(10, -85);
    ctx.strokeStyle = COLOR_ARC_CORE;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 10;
    ctx.shadowColor = COLOR_ARC_CORE;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.restore(); // Restore torso rotation & translation
    ctx.restore(); // Restore global context
  }
}
