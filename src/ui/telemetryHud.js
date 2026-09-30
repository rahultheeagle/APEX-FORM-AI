/**
 * @fileoverview Layer 1 (UI): Glassmorphic Sports-Science Telemetry HUD.
 * Renders sub-pixel collinear barbell vector radar, aircraft artificial horizon gauge,
 * 90-frame trailing luminous bar path ribbon, and top-right kinetic metrics card.
 */

export class TelemetryHud {
  /**
   * @param {Object} [options]
   * @param {number} [options.tiltThreshold=2.0] Threshold in degrees for level status.
   */
  constructor(options = {}) {
    this.tiltThreshold = options.tiltThreshold !== undefined ? options.tiltThreshold : 2.0;
  }

  /**
   * Renders the illuminated neon barbell laser line, aircraft-style artificial horizon circle,
   * tilt degrees readout, and 90-frame trailing luminous path ribbon.
   * 
   * @param {CanvasRenderingContext2D} ctx Primary canvas drawing context.
   * @param {import('../core/barbellRadar.js').BarbellRadarResult} barData Output from BarbellRadar.
   * @param {number} canvasWidth Logical canvas width in pixels.
   * @param {number} canvasHeight Logical canvas height in pixels.
   * @param {number} [now=performance.now()] High-resolution timestamp.
   */
  drawBarbellRadar(ctx, barData, canvasWidth, canvasHeight, now = performance.now()) {
    if (!ctx || !barData || !barData.isVisible || !barData.leftWrist || !barData.rightWrist) {
      return;
    }

    const w = canvasWidth || (ctx.canvas ? (ctx.canvas.width / (window.devicePixelRatio || 1)) : 640);
    const h = canvasHeight || (ctx.canvas ? (ctx.canvas.height / (window.devicePixelRatio || 1)) : 480);

    const x1 = barData.leftWrist.x * w;
    const y1 = barData.leftWrist.y * h;
    const x2 = barData.rightWrist.x * w;
    const y2 = barData.rightWrist.y * h;
    const mx = barData.barMidpoint.x * w;
    const my = barData.barMidpoint.y * h;

    const tiltDeg = barData.tiltDeg;
    const isLevel = Math.abs(tiltDeg) <= this.tiltThreshold;

    const color = isLevel ? '#10b981' : '#ff0055';
    const glowColor = isLevel ? '#00ff87' : '#ff0055';
    const strobe = isLevel ? 1.0 : (0.70 + 0.30 * Math.sin(now / 70));

    ctx.save();

    // 1. 90-Frame Trailing Luminous Bar Path Ribbon with Alpha Decay
    const path = barData.pathHistory;
    if (path && path.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 1; i < path.length; i++) {
        const pPrev = path[i - 1];
        const pCurr = path[i];
        const progress = i / (path.length - 1);
        const alpha = Math.max(0.04, progress * 0.75);

        ctx.beginPath();
        ctx.moveTo(pPrev.x * w, pPrev.y * h);
        ctx.lineTo(pCurr.x * w, pCurr.y * h);

        ctx.strokeStyle = `rgba(0, 242, 254, ${alpha.toFixed(2)})`;
        ctx.lineWidth = 1.0 + (progress * 2.2);
        ctx.shadowBlur = 6 * progress;
        ctx.shadowColor = '#00f2fe';
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2. Collinear Neon Barbell Laser Line (bridging wrists)
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = isLevel ? color : `rgba(255, 0, 85, ${strobe.toFixed(2)})`;
    ctx.lineWidth = isLevel ? 2.6 : 3.5;
    ctx.shadowBlur = isLevel ? 10 : 16;
    ctx.shadowColor = glowColor;
    ctx.stroke();

    // White core laser beam
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Dual wrist collar nodes
    [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach((collar) => {
      ctx.beginPath();
      ctx.arc(collar.x, collar.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8, 14, 28, 0.88)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.shadowBlur = 8;
      ctx.shadowColor = glowColor;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(collar.x, collar.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    });

    // 3. Aircraft-Style Artificial Horizon Circle over Bar Midpoint
    const gaugeCY = my - 34;
    const gaugeR = 20;

    // Dark instrument bezel backing
    ctx.beginPath();
    ctx.arc(mx, gaugeCY, gaugeR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(7, 13, 26, 0.90)';
    ctx.strokeStyle = isLevel ? color : `rgba(255, 0, 85, ${strobe.toFixed(2)})`;
    ctx.lineWidth = isLevel ? 1.4 : 2.0;
    ctx.shadowBlur = isLevel ? 8 : 16;
    ctx.shadowColor = glowColor;
    ctx.fill();
    ctx.stroke();

    // Fixed aircraft reference symbol (center dot + horizontal wings)
    ctx.beginPath();
    ctx.arc(mx, gaugeCY, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(mx - 8, gaugeCY);
    ctx.lineTo(mx - 3, gaugeCY);
    ctx.moveTo(mx + 3, gaugeCY);
    ctx.lineTo(mx + 8, gaugeCY);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Rotating Artificial Horizon Bar
    ctx.save();
    ctx.translate(mx, gaugeCY);
    ctx.rotate((tiltDeg * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(-gaugeR + 3, 0);
    ctx.lineTo(gaugeR - 3, 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.0;
    ctx.shadowBlur = 8;
    ctx.shadowColor = glowColor;
    ctx.stroke();
    ctx.restore();

    // 4. Digital Tilt Readout Pill
    const pillW = 104;
    const pillH = 16;
    const pillX = mx - (pillW / 2);
    const pillY = gaugeCY - gaugeR - pillH - 4;

    ctx.fillStyle = 'rgba(7, 13, 26, 0.92)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = isLevel ? 6 : 12;
    ctx.shadowColor = glowColor;

    this._drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 4);
    ctx.fill();
    ctx.stroke();

    // Format readout text: e.g. TILT: +3.2° R or LEVEL: 0.4°
    const side = tiltDeg > 0 ? 'R' : 'L';
    const sign = tiltDeg > 0 ? '+' : '';
    const readoutText = isLevel
      ? `LEVEL: ${Math.abs(tiltDeg).toFixed(1)}°`
      : `TILT: ${sign}${tiltDeg.toFixed(1)}° ${side}`;

    this._drawUnmirroredText(
      ctx,
      readoutText,
      mx,
      pillY + (pillH / 2),
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      color,
      'center'
    );

    ctx.restore();
  }

  /**
   * Renders the top-right glassmorphic sports-science metrics card:
   * - VELOCITY: [0.68 m/s]
   * - RIR: 2 [SUSTAINED]
   * - POWER: 490 W
   * 
   * @param {CanvasRenderingContext2D} ctx Primary canvas drawing context.
   * @param {import('../core/kineticTelemetry.js').KineticTelemetryResult} telemetryData
   * @param {number} canvasWidth Logical canvas width in pixels.
   * @param {number} canvasHeight Logical canvas height in pixels.
   * @param {number} [now=performance.now()] High-resolution timestamp.
   */
  drawMetricsCard(ctx, telemetryData, canvasWidth, canvasHeight, now = performance.now()) {
    if (!ctx || !telemetryData) return;

    // Placed in top-right of mirrored user view (x = 20 in mirrored coordinate space)
    const cardW = 196;
    const cardH = 78;
    const x = 20;
    const y = 64; // Below session bar

    const vel = typeof telemetryData.mcv === 'number' ? telemetryData.mcv : (telemetryData.currentVelocity || 0.68);
    const rir = telemetryData.rir || '3+';
    const watts = typeof telemetryData.instantWatts === 'number' ? telemetryData.instantWatts : 490;
    const decay = telemetryData.velocityDecay || 0;

    let rirStatus = 'SUSTAINED';
    let themeColor = '#00f2fe';

    if (decay > 25 || rir.includes('0')) {
      rirStatus = 'FAILURE IMMINENT';
      themeColor = '#ff0055';
    } else if (decay > 10 || rir === '1-2') {
      rirStatus = 'FATIGUE';
      themeColor = '#f59e0b';
    }

    ctx.save();

    // 1. Glassmorphic Card Background
    ctx.fillStyle = 'rgba(7, 13, 26, 0.90)';
    ctx.strokeStyle = `rgba(0, 242, 254, 0.45)`;
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00f2fe';

    this._drawRoundedRect(ctx, x, y, cardW, cardH, 6);
    ctx.fill();
    ctx.stroke();

    // 2. Card Header
    this._drawUnmirroredText(
      ctx,
      '⚡ KINETIC TELEMETRY',
      x + (cardW / 2),
      y + 11,
      'bold 7.5px "Orbitron", -apple-system, sans-serif',
      '#00f2fe',
      'center'
    );

    // Decorative divider line
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 21);
    ctx.lineTo(x + cardW - 10, y + 21);
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.25)';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // 3. Telemetry Rows
    // Line 1: VELOCITY: [0.68 m/s]
    const velText = `VELOCITY: [${vel.toFixed(2)} m/s]`;
    this._drawUnmirroredText(
      ctx,
      velText,
      x + 12,
      y + 32,
      'bold 7.5px "Orbitron", monospace',
      '#ffffff',
      'left'
    );

    // Line 2: RIR: 2 [SUSTAINED]
    const rirLabel = rir.includes('Failure') ? '0' : rir;
    const rirText = `RIR: ${rirLabel} [${rirStatus}]`;
    this._drawUnmirroredText(
      ctx,
      rirText,
      x + 12,
      y + 48,
      'bold 7.5px "Orbitron", monospace',
      themeColor,
      'left'
    );

    // Line 3: POWER: 490 W
    const powerText = `POWER: ${Math.round(watts)} W`;
    this._drawUnmirroredText(
      ctx,
      powerText,
      x + 12,
      y + 64,
      'bold 7.5px "Orbitron", monospace',
      '#fbbf24',
      'left'
    );

    ctx.restore();
  }

  /**
   * Helper to draw text that appears unmirrored (left-to-right) on a mirrored canvas.
   * @private
   */
  _drawUnmirroredText(ctx, text, x, y, font, color, align = 'left') {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  /**
   * Helper to trace rounded rectangle path.
   * @private
   */
  _drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
