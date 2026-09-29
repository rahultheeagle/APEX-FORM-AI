/**
 * @fileoverview Layer 4: Neuromuscular Kinetic Chain Sequencing Engine.
 * Analyzes triple-extension proximal-to-distal sequencing during explosive concentric drive phases,
 * tracking instantaneous angular velocities and accelerations for Hip, Knee, and Ankle,
 * verifying that peak velocities propagate in correct anatomical order (Hip -> Knee -> Ankle),
 * and quantifying kinetic sequence efficiency percentage.
 */

/**
 * @typedef {'OPTIMAL_CHAIN' | 'ENERGY_LEAK'} SequenceStatus
 */

/**
 * @typedef {Object} KineticSequenceResult
 * @property {number} sequenceEfficiencyPercent Neuromuscular sequencing match [0 - 100]%.
 * @property {SequenceStatus} sequenceStatus Status flag ('OPTIMAL_CHAIN' or 'ENERGY_LEAK').
 * @property {number} tPeakHip Timestamp of peak hip angular drive (ms).
 * @property {number} tPeakKnee Timestamp of peak knee angular drive (ms).
 * @property {number} tPeakAnkle Timestamp of peak ankle angular drive (ms).
 * @property {{ hip: number, knee: number, ankle: number }} peakVelocities Peak angular velocities (deg/s).
 * @property {{ hip: number, knee: number, ankle: number }} currentVelocities Current smoothed angular velocities (deg/s).
 * @property {Array<{ joint: string, progress: number, isPeak: boolean, peakTime: number }>} waterfallData Waterfall bars for UI rendering.
 * @property {boolean} isTripleExtensionActive True if athlete is actively driving in concentric ascent.
 * @property {string|null} faultReason Diagnostic description if an energy leak occurred.
 */

export class KineticChainEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.smoothingAlpha=0.35] EMA smoothing factor for velocity estimation.
   * @param {number} [options.minVelocityThreshold=15] Minimum angular velocity (deg/s) to filter stationary sensor jitter.
   * @param {number} [options.optimalDelayMinMs=25] Minimum physiological delay between joint segment peaks.
   * @param {number} [options.optimalDelayMaxMs=300] Maximum physiological delay between joint segment peaks.
   */
  constructor(options = {}) {
    this.smoothingAlpha = options.smoothingAlpha !== undefined ? options.smoothingAlpha : 0.35;
    this.minVelocityThreshold = options.minVelocityThreshold !== undefined ? options.minVelocityThreshold : 15;
    this.optimalDelayMinMs = options.optimalDelayMinMs !== undefined ? options.optimalDelayMinMs : 25;
    this.optimalDelayMaxMs = options.optimalDelayMaxMs !== undefined ? options.optimalDelayMaxMs : 300;

    /** @type {number|null} Previous timestamp in milliseconds */
    this.prevTimestamp = null;

    /** @type {{ hip: number|null, knee: number|null, ankle: number|null }} Previous joint angles */
    this.prevAngles = { hip: null, knee: null, ankle: null };

    /** @type {{ hip: number, knee: number, ankle: number }} Smoothed angular velocities (deg/s) */
    this.smoothedVelocities = { hip: 0, knee: 0, ankle: 0 };

    /** @type {{ hip: number, knee: number, ankle: number }} Smoothed angular accelerations (deg/s^2) */
    this.smoothedAccelerations = { hip: 0, knee: 0, ankle: 0 };

    /** @type {number} Concentric phase start timestamp */
    this.concentricStartTime = 0;

    /** @type {boolean} True if currently in concentric drive phase */
    this.isConcentricActive = false;

    /** @type {{ hip: number, knee: number, ankle: number }} Peak concentric velocities in active rep */
    this.peakVelocities = { hip: 0, knee: 0, ankle: 0 };

    /** @type {{ hip: number, knee: number, ankle: number }} Peak concentric accelerations in active rep */
    this.peakAccelerations = { hip: 0, knee: 0, ankle: 0 };

    /** @type {{ hip: number, knee: number, ankle: number }} Peak velocity timestamps (ms) */
    this.peakTimestamps = { hip: 0, knee: 0, ankle: 0 };

    /** @type {Array<Object>} Circular buffer of concentric velocity samples */
    this.concentricSamples = [];

    /** @type {number} Evaluated sequence efficiency */
    this.lastEfficiencyPercent = 98;

    /** @type {SequenceStatus} Evaluated status */
    this.lastStatus = 'OPTIMAL_CHAIN';

    /** @type {string|null} */
    this.lastFaultReason = null;

    /** @type {Array<KineticSequenceResult>} Session rep sequence history */
    this.repHistory = [];
  }

  /**
   * Ingests instantaneous joint angles and evaluates time-series angular velocities.
   * 
   * @param {number} timestampMs Current performance.now() or Date.now() timestamp in ms.
   * @param {number} hipAngle Instantaneous hip extension angle in degrees.
   * @param {number} kneeAngle Instantaneous knee extension angle in degrees.
   * @param {number} ankleAngle Instantaneous ankle dorsi/plantar angle in degrees.
   * @param {boolean} isConcentric True during concentric drive (ascent phase).
   * @returns {KineticSequenceResult}
   */
  update(timestampMs, hipAngle, kneeAngle, ankleAngle, isConcentric = false) {
    if (!this.prevTimestamp) {
      this.prevTimestamp = timestampMs;
      this.prevAngles = { hip: hipAngle, knee: kneeAngle, ankle: ankleAngle };
      return this._createResult(100, 'OPTIMAL_CHAIN', null);
    }

    const dt = Math.max(0.005, Math.min(0.2, (timestampMs - this.prevTimestamp) / 1000));
    this.prevTimestamp = timestampMs;

    // 1. Calculate raw angular velocities (deg/s)
    const rawVHip = this.prevAngles.hip !== null ? Math.abs(hipAngle - this.prevAngles.hip) / dt : 0;
    const rawVKnee = this.prevAngles.knee !== null ? Math.abs(kneeAngle - this.prevAngles.knee) / dt : 0;
    const rawVAnkle = this.prevAngles.ankle !== null ? Math.abs(ankleAngle - this.prevAngles.ankle) / dt : 0;

    this.prevAngles = { hip: hipAngle, knee: kneeAngle, ankle: ankleAngle };

    // 2. Exponential Moving Average (EMA) smoothing
    const alpha = this.smoothingAlpha;
    const prevV = { ...this.smoothedVelocities };

    this.smoothedVelocities.hip = (alpha * rawVHip) + ((1 - alpha) * this.smoothedVelocities.hip);
    this.smoothedVelocities.knee = (alpha * rawVKnee) + ((1 - alpha) * this.smoothedVelocities.knee);
    this.smoothedVelocities.ankle = (alpha * rawVAnkle) + ((1 - alpha) * this.smoothedVelocities.ankle);

    // 3. Angular acceleration (deg/s^2)
    this.smoothedAccelerations.hip = (this.smoothedVelocities.hip - prevV.hip) / dt;
    this.smoothedAccelerations.knee = (this.smoothedVelocities.knee - prevV.knee) / dt;
    this.smoothedAccelerations.ankle = (this.smoothedVelocities.ankle - prevV.ankle) / dt;

    // 4. Concentric Drive State Management
    if (isConcentric) {
      if (!this.isConcentricActive) {
        // Entering concentric phase: reset peak accumulators
        this.isConcentricActive = true;
        this.concentricStartTime = timestampMs;
        this.peakVelocities = { hip: 0, knee: 0, ankle: 0 };
        this.peakAccelerations = { hip: 0, knee: 0, ankle: 0 };
        this.peakTimestamps = { hip: 0, knee: 0, ankle: 0 };
        this.concentricSamples = [];
      }

      // Record sample in concentric buffer
      this.concentricSamples.push({
        timestamp: timestampMs,
        vHip: this.smoothedVelocities.hip,
        vKnee: this.smoothedVelocities.knee,
        vAnkle: this.smoothedVelocities.ankle,
        aHip: this.smoothedAccelerations.hip,
        aKnee: this.smoothedAccelerations.knee,
        aAnkle: this.smoothedAccelerations.ankle
      });

      // Track peak velocity and timestamp per joint
      if (this.smoothedVelocities.hip > this.peakVelocities.hip && this.smoothedVelocities.hip > this.minVelocityThreshold) {
        this.peakVelocities.hip = this.smoothedVelocities.hip;
        this.peakTimestamps.hip = timestampMs;
      }
      if (this.smoothedVelocities.knee > this.peakVelocities.knee && this.smoothedVelocities.knee > this.minVelocityThreshold) {
        this.peakVelocities.knee = this.smoothedVelocities.knee;
        this.peakTimestamps.knee = timestampMs;
      }
      if (this.smoothedVelocities.ankle > this.peakVelocities.ankle && this.smoothedVelocities.ankle > this.minVelocityThreshold) {
        this.peakVelocities.ankle = this.smoothedVelocities.ankle;
        this.peakTimestamps.ankle = timestampMs;
      }

      // Track peak acceleration
      if (this.smoothedAccelerations.hip > this.peakAccelerations.hip) {
        this.peakAccelerations.hip = this.smoothedAccelerations.hip;
      }
      if (this.smoothedAccelerations.knee > this.peakAccelerations.knee) {
        this.peakAccelerations.knee = this.smoothedAccelerations.knee;
      }
      if (this.smoothedAccelerations.ankle > this.peakAccelerations.ankle) {
        this.peakAccelerations.ankle = this.smoothedAccelerations.ankle;
      }

      // Continuous evaluation of sequence
      return this.evaluateSequence();
    } else {
      if (this.isConcentricActive) {
        // Exiting concentric phase
        this.isConcentricActive = false;
        return this.evaluateSequence();
      }
      return this._createResult(this.lastEfficiencyPercent, this.lastStatus, this.lastFaultReason);
    }
  }

  /**
   * Evaluates proximal-to-distal sequencing order across peak timestamps.
   * Optimal Order: t_peak,hip < t_peak,knee < t_peak,ankle
   * Energy Leak: Flagged if knee reaches peak acceleration/velocity ahead of hip.
   * 
   * @returns {KineticSequenceResult}
   */
  evaluateSequence() {
    const tHip = this.peakTimestamps.hip;
    const tKnee = this.peakTimestamps.knee;
    const tAnkle = this.peakTimestamps.ankle;

    // If insufficient motion or samples yet
    if (!tHip && !tKnee && !tAnkle) {
      return this._createResult(98, 'OPTIMAL_CHAIN', null);
    }

    let efficiency = 95;
    let status = 'OPTIMAL_CHAIN';
    let faultReason = null;

    // Check for Energy Leak: Knee peaked ahead of hip
    if (tKnee > 0 && tHip > 0 && tKnee < (tHip - 15)) {
      // Knee reached peak velocity significantly before hip:
      // Quad dominance / premature knee extension / hip lag
      const prematureDeltaMs = Math.round(tHip - tKnee);
      status = 'ENERGY_LEAK';
      faultReason = `Knee peaked ${prematureDeltaMs}ms before hip (Premature Knee Extension)`;
      // Penalize efficiency based on how early knee peaked
      const penalty = Math.min(45, Math.max(20, prematureDeltaMs * 0.25));
      efficiency = Math.round(Math.max(40, 85 - penalty));
    } else if (tAnkle > 0 && tHip > 0 && tAnkle < (tHip - 15)) {
      // Ankle reached peak before hip: early push off / ankle drive leak
      status = 'ENERGY_LEAK';
      faultReason = 'Ankle drive fired prematurely before hip extension';
      efficiency = 58;
    } else if (tAnkle > 0 && tKnee > 0 && tAnkle < (tKnee - 15)) {
      // Ankle peaked before knee
      status = 'ENERGY_LEAK';
      faultReason = 'Ankle peak preceded knee extension';
      efficiency = 65;
    } else if (tHip > 0 && tKnee > 0) {
      // Hip then Knee (Correct proximal order!)
      const delayHipToKnee = tKnee - tHip;
      let timingScore = 95;

      if (delayHipToKnee >= this.optimalDelayMinMs && delayHipToKnee <= this.optimalDelayMaxMs) {
        // Ideal biomechanical interval (25ms - 300ms)
        timingScore = 98;
      } else if (delayHipToKnee < this.optimalDelayMinMs) {
        // Almost simultaneous / concurrent
        timingScore = 91;
      }

      if (tAnkle > 0 && tAnkle >= tKnee) {
        // Full Triple Extension (Hip -> Knee -> Ankle)
        const delayKneeToAnkle = tAnkle - tKnee;
        if (delayKneeToAnkle >= this.optimalDelayMinMs && delayKneeToAnkle <= this.optimalDelayMaxMs) {
          timingScore = Math.min(100, timingScore + 2);
        }
      }

      efficiency = timingScore;
      status = 'OPTIMAL_CHAIN';
      faultReason = null;
    }

    this.lastEfficiencyPercent = efficiency;
    this.lastStatus = status;
    this.lastFaultReason = faultReason;

    return this._createResult(efficiency, status, faultReason);
  }

  /**
   * Convenience helper to ingest full landmark array and extract bilateral sagittal angles.
   * 
   * @param {Array<Object>} landmarks MediaPipe Pose 33 landmarks.
   * @param {number} timestampMs Current timestamp.
   * @param {boolean} isConcentric Concentric phase flag.
   * @param {boolean} [useLeft=true] Whether to analyze left or right side.
   * @returns {KineticSequenceResult}
   */
  analyzeLandmarks(landmarks, timestampMs, isConcentric = false, useLeft = true) {
    if (!landmarks || landmarks.length < 33) {
      return this._createResult(this.lastEfficiencyPercent, this.lastStatus, this.lastFaultReason);
    }

    // Joint indices
    const shoulderIdx = useLeft ? 11 : 12;
    const hipIdx = useLeft ? 23 : 24;
    const kneeIdx = useLeft ? 25 : 26;
    const ankleIdx = useLeft ? 27 : 28;
    const toeIdx = useLeft ? 31 : 32;

    const shoulder = landmarks[shoulderIdx];
    const hip = landmarks[hipIdx];
    const knee = landmarks[kneeIdx];
    const ankle = landmarks[ankleIdx];
    const toe = landmarks[toeIdx];

    if (!shoulder || !hip || !knee || !ankle) {
      return this._createResult(this.lastEfficiencyPercent, this.lastStatus, this.lastFaultReason);
    }

    // 1. Hip Angle: Shoulder -> Hip -> Knee
    const hipAngle = this._calculateAngle(shoulder, hip, knee);

    // 2. Knee Angle: Hip -> Knee -> Ankle
    const kneeAngle = this._calculateAngle(hip, knee, ankle);

    // 3. Ankle Angle: Knee -> Ankle -> Toe
    const ankleAngle = toe ? this._calculateAngle(knee, ankle, toe) : 90;

    return this.update(timestampMs, hipAngle, kneeAngle, ankleAngle, isConcentric);
  }

  /**
   * Called when a repetition successfully finishes.
   * Archives rep metrics and resets concentric drive buffers.
   * 
   * @returns {KineticSequenceResult}
   */
  onRepComplete() {
    const finalResult = this.evaluateSequence();
    this.repHistory.push(finalResult);

    // Reset concentric drive state for next repetition
    this.isConcentricActive = false;
    this.concentricStartTime = 0;
    this.peakVelocities = { hip: 0, knee: 0, ankle: 0 };
    this.peakAccelerations = { hip: 0, knee: 0, ankle: 0 };
    this.peakTimestamps = { hip: 0, knee: 0, ankle: 0 };
    this.concentricSamples = [];

    return finalResult;
  }

  /**
   * Resets all internal buffers and state.
   */
  reset() {
    this.prevTimestamp = null;
    this.prevAngles = { hip: null, knee: null, ankle: null };
    this.smoothedVelocities = { hip: 0, knee: 0, ankle: 0 };
    this.smoothedAccelerations = { hip: 0, knee: 0, ankle: 0 };
    this.isConcentricActive = false;
    this.concentricStartTime = 0;
    this.peakVelocities = { hip: 0, knee: 0, ankle: 0 };
    this.peakAccelerations = { hip: 0, knee: 0, ankle: 0 };
    this.peakTimestamps = { hip: 0, knee: 0, ankle: 0 };
    this.concentricSamples = [];
    this.lastEfficiencyPercent = 98;
    this.lastStatus = 'OPTIMAL_CHAIN';
    this.lastFaultReason = null;
    this.repHistory = [];
  }

  /**
   * Returns session average sequencing efficiency and rating summary.
   * @returns {{ avgEfficiencyPercent: number, status: SequenceStatus, optimalReps: number, totalReps: number }}
   */
  getSessionSummary() {
    if (this.repHistory.length === 0) {
      return {
        avgEfficiencyPercent: this.lastEfficiencyPercent,
        status: this.lastStatus,
        optimalReps: 0,
        totalReps: 0
      };
    }

    const sum = this.repHistory.reduce((acc, r) => acc + r.sequenceEfficiencyPercent, 0);
    const avg = Math.round(sum / this.repHistory.length);
    const optimalCount = this.repHistory.filter(r => r.sequenceStatus === 'OPTIMAL_CHAIN').length;

    return {
      avgEfficiencyPercent: avg,
      status: (optimalCount / this.repHistory.length >= 0.7) ? 'OPTIMAL_CHAIN' : 'ENERGY_LEAK',
      optimalReps: optimalCount,
      totalReps: this.repHistory.length
    };
  }

  /**
   * Constructs the structured result payload.
   * @private
   */
  _createResult(efficiency, status, faultReason) {
    const maxV = Math.max(1, this.peakVelocities.hip, this.peakVelocities.knee, this.peakVelocities.ankle);

    // Waterfall sequencing progress bars
    const waterfallData = [
      {
        joint: 'HIP',
        progress: Math.min(1.0, this.peakVelocities.hip / maxV),
        isPeak: this.smoothedVelocities.hip >= (this.peakVelocities.hip * 0.92) && this.peakVelocities.hip > 0,
        peakTime: this.peakTimestamps.hip
      },
      {
        joint: 'KNEE',
        progress: Math.min(1.0, this.peakVelocities.knee / maxV),
        isPeak: this.smoothedVelocities.knee >= (this.peakVelocities.knee * 0.92) && this.peakVelocities.knee > 0,
        peakTime: this.peakTimestamps.knee
      },
      {
        joint: 'ANKLE',
        progress: Math.min(1.0, this.peakVelocities.ankle / maxV),
        isPeak: this.smoothedVelocities.ankle >= (this.peakVelocities.ankle * 0.92) && this.peakVelocities.ankle > 0,
        peakTime: this.peakTimestamps.ankle
      }
    ];

    return {
      sequenceEfficiencyPercent: efficiency,
      sequenceStatus: status,
      tPeakHip: this.peakTimestamps.hip,
      tPeakKnee: this.peakTimestamps.knee,
      tPeakAnkle: this.peakTimestamps.ankle,
      peakVelocities: { ...this.peakVelocities },
      currentVelocities: {
        hip: Math.round(this.smoothedVelocities.hip),
        knee: Math.round(this.smoothedVelocities.knee),
        ankle: Math.round(this.smoothedVelocities.ankle)
      },
      waterfallData,
      isTripleExtensionActive: this.isConcentricActive,
      faultReason
    };
  }

  /**
   * 2D/3D angle computation in degrees.
   * @private
   */
  _calculateAngle(p1, p2, p3) {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: (p1.z || 0) - (p2.z || 0) };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: (p3.z || 0) - (p2.z || 0) };

    const dot = (v1.x * v2.x) + (v1.y * v2.y) + (v1.z * v2.z);
    const m1 = Math.hypot(v1.x, v1.y, v1.z);
    const m2 = Math.hypot(v2.x, v2.y, v2.z);

    if (m1 < 0.001 || m2 < 0.001) return 180;
    const cosAngle = Math.max(-1.0, Math.min(1.0, dot / (m1 * m2)));
    return (Math.acos(cosAngle) * 180) / Math.PI;
  }
}
