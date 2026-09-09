/**
 * @fileoverview Layer 1 (UI/Game): rhythmGame.js
 * AR Motion-Target Rhythm Engine & Kinetic Particle System.
 * Spawns floating neon kinetic target orbs at biomechanically calibrated depths,
 * detects joint collisions, computes combo multipliers, and renders 20-particle spark bursts.
 * Pure Canvas 2D vector math locked at 60 FPS.
 */

export class RhythmGame {
  constructor() {
    /** @type {boolean} */
    this.isEnabled = false;

    /** @type {number} Total accumulated game score */
    this.score = 0;

    /** @type {number} Active combo count */
    this.comboStreak = 0;

    /**
     * Active kinetic target orb.
     * @type {{ x: number, y: number, radius: number, type: string, pulsePhase: number, rotation: number }|null}
     */
    this.activeTarget = null;

    /** @type {boolean} True if target in the current rep has already been hit */
    this.isTargetHit = false;

    /**
     * Particle pool for spark explosions.
     * @type {Array<{ x: number, y: number, vx: number, vy: number, alpha: number, color: string, size: number, maxLife: number, life: number }>}
     */
    this.particles = [];

    /** @type {number} Last frame update timestamp */
    this.lastTimestamp = performance.now();
  }

  /**
   * Toggles rhythm game mode.
   * @param {boolean} [forceState]
   * @returns {boolean} New enabled state.
   */
  toggle(forceState) {
    this.isEnabled = typeof forceState === 'boolean' ? forceState : !this.isEnabled;
    if (!this.isEnabled) {
      this.particles = [];
      this.activeTarget = null;
    }
    return this.isEnabled;
  }

  /**
   * Resets game scoring and streaks.
   */
  reset() {
    this.score = 0;
    this.comboStreak = 0;
    this.isTargetHit = false;
    this.particles = [];
    this.activeTarget = null;
  }

  /**
   * Returns current combo multiplier based on streak.
   * @returns {number}
   */
  getMultiplier() {
    if (this.comboStreak >= 20) return 4;
    if (this.comboStreak >= 10) return 3;
    if (this.comboStreak >= 5) return 2;
    return 1;
  }

  /**
   * Returns current combo tier label.
   * @returns {string}
   */
  getComboTierLabel() {
    if (this.comboStreak >= 20) return 'HYPER DRIVE';
    if (this.comboStreak >= 10) return 'CYBER OVERDRIVE';
    if (this.comboStreak >= 5) return 'COMBO SURGE';
    return 'STANDARD';
  }

  /**
   * Spawns or updates the floating neon target orb at the target depth coordinate.
   * 
   * @param {number} x Normalized X coordinate (0.0 to 1.0) or canvas pixel X.
   * @param {number} y Canvas pixel Y coordinate representing inflection depth.
   * @param {string} [targetType='DEPTH']
   */
  spawnTarget(x, y, targetType = 'DEPTH') {
    if (!this.isEnabled || y <= 0) return;

    if (!this.activeTarget) {
      this.activeTarget = {
        x,
        y,
        radius: 30,
        type: targetType,
        pulsePhase: 0,
        rotation: 0
      };
    } else {
      // Smoothly track depth adjustment
      this.activeTarget.x = x;
      this.activeTarget.y = y;
    }
  }

  /**
   * Checks collision between the active tracking joint and the kinetic target orb.
   * 
   * @param {number} jointX
   * @param {number} jointY
   * @param {number} [hitTolerance=24]
   * @returns {{ hit: boolean, score: number, comboStreak: number, multiplier: number }}
   */
  checkCollision(jointX, jointY, hitTolerance = 24) {
    if (!this.isEnabled || !this.activeTarget || this.isTargetHit) {
      return { hit: false, score: this.score, comboStreak: this.comboStreak, multiplier: this.getMultiplier() };
    }

    const dx = jointX - this.activeTarget.x;
    const dy = jointY - this.activeTarget.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Collision detected
    if (dist <= this.activeTarget.radius + hitTolerance) {
      this.isTargetHit = true;
      this.comboStreak++;
      const multiplier = this.getMultiplier();
      const points = 100 * multiplier;
      this.score += points;

      // Emit 20 glowing neon spark particles
      this.explodeTarget(this.activeTarget.x, this.activeTarget.y);

      return {
        hit: true,
        score: this.score,
        comboStreak: this.comboStreak,
        multiplier
      };
    }

    return { hit: false, score: this.score, comboStreak: this.comboStreak, multiplier: this.getMultiplier() };
  }

  /**
   * Arms the target for the next rep once the user returns to setup height.
   */
  armTarget() {
    this.isTargetHit = false;
  }

  /**
   * Breaks combo streak (e.g. on form fault).
   */
  breakCombo() {
    this.comboStreak = 0;
  }

  /**
   * Emits 20 glowing neon spark particles with physics decay (vx, vy, gravity, alpha).
   * 
   * @param {number} x Explosion origin X.
   * @param {number} y Explosion origin Y.
   */
  explodeTarget(x, y) {
    const SPARK_COUNT = 20;
    const COLORS = ['#00f2fe', '#00ff87', '#38bdf8', '#ffffff', '#a855f7'];

    for (let i = 0; i < SPARK_COUNT; i++) {
      const angle = (Math.PI * 2 * i) / SPARK_COUNT + (Math.random() - 0.5) * 0.4;
      const speed = 120 + Math.random() * 220; // pixels per second

      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40, // Slight upward pop
        alpha: 1.0,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        size: 2.5 + Math.random() * 3.5,
        maxLife: 0.65 + Math.random() * 0.35,
        life: 0
      });
    }
  }

  /**
   * Updates particle kinematics and target rotation animation.
   * 
   * @param {number} currentTimestamp
   */
  update(currentTimestamp = performance.now()) {
    const dt = Math.min(0.1, (currentTimestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = currentTimestamp;

    if (!this.isEnabled) return;

    // Update target orb rotation
    if (this.activeTarget) {
      this.activeTarget.rotation += 1.8 * dt;
      this.activeTarget.pulsePhase += 4.0 * dt;
    }

    // Update particles with gravity and velocity decay
    const GRAVITY = 260; // px/s^2
    const DRAG = 0.96;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;

      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }

      p.vx *= DRAG;
      p.vy = (p.vy + GRAVITY * dt) * DRAG;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha = Math.max(0, 1.0 - p.life / p.maxLife);
    }
  }

  /**
   * Renders target orbs, rotating concentric glyphs, and bursting particles onto the HUD canvas.
   * 
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {number} now
   */
  render(ctx, width, height, now) {
    if (!this.isEnabled) return;

    this.update(now);

    ctx.save();

    // 1. Draw Bursting Spark Particles
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 2. Draw Active Target Orb
    if (this.activeTarget && !this.isTargetHit) {
      const t = this.activeTarget;
      const pulse = Math.sin(t.pulsePhase) * 3;
      const r = t.radius + pulse;

      // Outer Ambient Glowing Aura
      const auraGrad = ctx.createRadialGradient(t.x, t.y, 5, t.x, t.y, r * 1.8);
      auraGrad.addColorStop(0, 'rgba(0, 242, 254, 0.45)');
      auraGrad.addColorStop(0.6, 'rgba(0, 255, 135, 0.15)');
      auraGrad.addColorStop(1, 'rgba(0, 242, 254, 0)');

      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r * 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Outer Rotating Concentric Ring
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rotation);

      ctx.strokeStyle = '#00f2fe';
      ctx.lineWidth = 2.0;
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#00f2fe';

      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();

      // Rotating Concentric Tick Glyphs
      const NUM_TICKS = 6;
      for (let i = 0; i < NUM_TICKS; i++) {
        const tickAngle = (Math.PI * 2 * i) / NUM_TICKS;
        const x1 = Math.cos(tickAngle) * (r - 6);
        const y1 = Math.sin(tickAngle) * (r - 6);
        const x2 = Math.cos(tickAngle) * (r + 6);
        const y2 = Math.sin(tickAngle) * (r + 6);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Inner Counter-Rotating Hexagon Ring
      ctx.rotate(-t.rotation * 2.2);
      ctx.strokeStyle = '#00ff87';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#00ff87';

      ctx.beginPath();
      const HEX_SIDES = 6;
      const innerR = r * 0.55;
      for (let i = 0; i < HEX_SIDES; i++) {
        const a = (Math.PI * 2 * i) / HEX_SIDES;
        const hx = Math.cos(a) * innerR;
        const hy = Math.sin(a) * innerR;
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.stroke();

      // Center Core Orb
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 14;
      ctx.shadowColor = '#00f2fe';
      ctx.fill();

      ctx.restore();

      // Depth Target Text Badge
      ctx.save();
      ctx.font = 'bold 8px "Orbitron", -apple-system, sans-serif';
      ctx.fillStyle = '#00ff87';
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#00ff87';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TARGET DEPTH', t.x, t.y - r - 12);
      ctx.restore();
    }

    ctx.restore();
  }
}
