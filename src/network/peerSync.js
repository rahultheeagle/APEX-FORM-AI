/**
 * @fileoverview Layer 0: Low-Bandwidth Co-Op Pose Serializer & P2P WebRTC Telemetry.
 * Serializes 33 3D skeletal landmarks and session metrics into compact flat Float32Arrays.
 * Minimizes network bandwidth to < 0.6 KB per frame (~36 KB/sec at 60 FPS).
 *
 * Designed with zero-allocation buffers to avoid garbage collection pauses during live training.
 */

// Total landmarks tracked by MediaPipe Pose
const TOTAL_LANDMARKS = 33;
// Coordinates per landmark: x, y, z, visibility
const FLOATS_PER_LANDMARK = 4;
// Header float count: [magic, sequence, timestamp, exerciseId, repCount, bpm, hrZone]
const HEADER_FLOATS = 7;
// Total Float32 elements in serialized frame
const TOTAL_FLOATS = HEADER_FLOATS + (TOTAL_LANDMARKS * FLOATS_PER_LANDMARK); // 7 + 132 = 139 floats = 556 bytes!
const MAGIC_HEADER = 0x415058; // 'APX'

const EXERCISE_MAP = {
  'SQUAT': 1,
  'BICEP_CURL': 2,
  'PUSHUP': 3
};

const REVERSE_EXERCISE_MAP = {
  1: 'SQUAT',
  2: 'BICEP_CURL',
  3: 'PUSHUP'
};

export class PeerSync {
  constructor() {
    this.sequence = 0;
    this.isPeerConnected = false;
    this.isGhostEnabled = false;

    // Pre-allocated static buffers to avoid GC pauses at 60 FPS
    this.sendBuffer = new ArrayBuffer(TOTAL_FLOATS * 4);
    this.sendFloats = new Float32Array(this.sendBuffer);

    // Pre-allocated cache for deserialized peer landmarks
    /** @type {Array<{ x: number, y: number, z: number, visibility: number }>} */
    this.peerLandmarks = [];
    for (let i = 0; i < TOTAL_LANDMARKS; i++) {
      this.peerLandmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0 });
    }

    this.peerMetadata = {
      timestamp: 0,
      exerciseType: 'SQUAT',
      repCount: 0,
      bpm: 128,
      hrZone: 2,
      peerName: 'Co-Op Ghost (Athlete #2)',
      isGhost: false
    };

    // Ghost athlete simulation phase
    this._ghostPhase = 0;
    this._ghostReps = 0;
    this._ghostMinAngle = 180;
    this._ghostLastRepTime = 0;

    /** @type {Array<(peerPose: any) => void>} */
    this._listeners = [];
  }

  /**
   * Quantizes landmarks into flat Float32Array for ultra-low latency WebRTC streaming.
   * Frame size is strictly 556 bytes (< 0.6 KB), easily fitting MTU packet limits.
   * 
   * @param {Array<{ x: number, y: number, z?: number, visibility?: number }>} landmarks
   * @param {{ timestamp?: number, exerciseType?: string, repCount?: number, bpm?: number, hrZone?: number }} [metadata={}]
   * @returns {Float32Array}
   */
  serializePose(landmarks, metadata = {}) {
    this.sequence = (this.sequence + 1) & 0xFFFFFF;

    const ts = metadata.timestamp || performance.now();
    const exId = EXERCISE_MAP[metadata.exerciseType || 'SQUAT'] || 1;
    const reps = metadata.repCount || 0;
    const bpm = metadata.bpm || 0;
    const zone = metadata.hrZone || 0;

    // 1. Pack Header
    this.sendFloats[0] = MAGIC_HEADER;
    this.sendFloats[1] = this.sequence;
    this.sendFloats[2] = ts;
    this.sendFloats[3] = exId;
    this.sendFloats[4] = reps;
    this.sendFloats[5] = bpm;
    this.sendFloats[6] = zone;

    // 2. Pack 33 articulated landmark vectors
    let offset = HEADER_FLOATS;
    const count = Math.min(TOTAL_LANDMARKS, landmarks ? landmarks.length : 0);

    for (let i = 0; i < count; i++) {
      const lm = landmarks[i];
      if (lm) {
        this.sendFloats[offset] = lm.x;
        this.sendFloats[offset + 1] = lm.y;
        this.sendFloats[offset + 2] = lm.z || 0;
        this.sendFloats[offset + 3] = lm.visibility !== undefined ? lm.visibility : 1.0;
      } else {
        this.sendFloats[offset] = 0;
        this.sendFloats[offset + 1] = 0;
        this.sendFloats[offset + 2] = 0;
        this.sendFloats[offset + 3] = 0;
      }
      offset += FLOATS_PER_LANDMARK;
    }

    return this.sendFloats;
  }

  /**
   * Deserializes binary buffer or Float32Array into peer landmark coordinate array.
   * Updates cached pre-allocated objects without memory allocation.
   * 
   * @param {ArrayBuffer|Float32Array|Uint8Array} input
   * @returns {{ landmarks: Array<{x: number, y: number, z: number, visibility: number}>, metadata: typeof this.peerMetadata }}
   */
  deserializePose(input) {
    let floats;
    if (input instanceof Float32Array) {
      floats = input;
    } else if (input instanceof ArrayBuffer) {
      floats = new Float32Array(input);
    } else if (ArrayBuffer.isView(input)) {
      floats = new Float32Array(input.buffer, input.byteOffset, input.byteLength / 4);
    } else {
      return { landmarks: this.peerLandmarks, metadata: this.peerMetadata };
    }

    if (floats.length < HEADER_FLOATS + 20) {
      return { landmarks: this.peerLandmarks, metadata: this.peerMetadata };
    }

    // Unpack Header
    const magic = floats[0];
    if (magic !== MAGIC_HEADER) {
      // Allow legacy or raw streams
    }

    const seq = floats[1];
    const ts = floats[2];
    const exId = Math.round(floats[3]);
    const reps = Math.round(floats[4]);
    const bpm = Math.round(floats[5]);
    const zone = Math.round(floats[6]);

    this.peerMetadata.timestamp = ts;
    this.peerMetadata.exerciseType = REVERSE_EXERCISE_MAP[exId] || 'SQUAT';
    this.peerMetadata.repCount = reps;
    this.peerMetadata.bpm = bpm;
    this.peerMetadata.hrZone = zone;
    this.peerMetadata.isGhost = false;

    // Unpack Landmarks into cached objects
    let offset = HEADER_FLOATS;
    for (let i = 0; i < TOTAL_LANDMARKS; i++) {
      if (offset + 3 < floats.length) {
        this.peerLandmarks[i].x = floats[offset];
        this.peerLandmarks[i].y = floats[offset + 1];
        this.peerLandmarks[i].z = floats[offset + 2];
        this.peerLandmarks[i].visibility = floats[offset + 3];
      }
      offset += FLOATS_PER_LANDMARK;
    }

    this.isPeerConnected = true;

    // Dispatch update
    const result = { landmarks: this.peerLandmarks, metadata: this.peerMetadata };
    this._emitPeerPose(result);
    return result;
  }

  /**
   * Toggles simulated Co-Op Ghost Partner for local development and dual-athlete demonstration.
   * @param {boolean} [enable]
   * @returns {boolean}
   */
  toggleGhostDemo(enable) {
    this.isGhostEnabled = enable !== undefined ? enable : !this.isGhostEnabled;
    if (this.isGhostEnabled) {
      this.isPeerConnected = true;
      this.peerMetadata.peerName = 'Ghost Partner (AI Sync)';
      this.peerMetadata.isGhost = true;
      this._ghostPhase = 0;
      this._ghostReps = 0;
    } else {
      this.isPeerConnected = false;
    }
    return this.isGhostEnabled;
  }

  /**
   * Generates procedural 3D ghost athlete pose offset laterally from user for co-op comparison.
   * Runs smoothly at 60 FPS without memory allocations.
   * 
   * @param {string} exerciseType Active exercise mode
   * @param {number} timestamp Current performance timestamp
   * @returns {{ landmarks: Array<{x: number, y: number, z: number, visibility: number}>, metadata: typeof this.peerMetadata }|null}
   */
  updateGhostSimulation(exerciseType = 'SQUAT', timestamp = performance.now()) {
    if (!this.isGhostEnabled) return null;

    // Standard 4.2-second rep loop
    const cyclePeriod = 4200;
    const t = (timestamp % cyclePeriod) / cyclePeriod;

    // Calculate simulated joint kinematics
    let depthFactor = 0;
    if (t < 0.55) {
      // Eccentric descent (cosine ease)
      depthFactor = (1 - Math.cos((t / 0.55) * Math.PI)) / 2;
    } else if (t < 0.70) {
      // Bottom isometric pause
      depthFactor = 1.0;
    } else if (t < 0.92) {
      // Concentric ascent
      const prog = (t - 0.70) / 0.22;
      depthFactor = 1.0 - (1 - Math.cos(prog * Math.PI)) / 2;
    } else {
      // Top reset
      depthFactor = 0;
      if (timestamp - this._ghostLastRepTime > cyclePeriod) {
        this._ghostReps++;
        this._ghostLastRepTime = timestamp;
      }
    }

    // Offset ghost to left-center of canvas (offset X: -0.18)
    const baseOffsetX = -0.16;
    const baseOffsetY = 0.04;

    const headY = 0.22 + (depthFactor * 0.16) + baseOffsetY;
    const shoulderY = 0.32 + (depthFactor * 0.16) + baseOffsetY;
    const hipY = 0.52 + (depthFactor * 0.20) + baseOffsetY;
    const kneeY = 0.70 + (depthFactor * 0.10) + baseOffsetY;
    const ankleY = 0.88 + baseOffsetY;

    // Fill peerLandmarks cache
    // Nose / Head
    this.peerLandmarks[0].x = 0.50 + baseOffsetX;
    this.peerLandmarks[0].y = headY;
    this.peerLandmarks[0].z = -0.05;
    this.peerLandmarks[0].visibility = 0.95;

    // Shoulders
    this.peerLandmarks[11].x = 0.43 + baseOffsetX;
    this.peerLandmarks[11].y = shoulderY;
    this.peerLandmarks[11].visibility = 0.95;

    this.peerLandmarks[12].x = 0.57 + baseOffsetX;
    this.peerLandmarks[12].y = shoulderY;
    this.peerLandmarks[12].visibility = 0.95;

    // Elbows & Wrists
    this.peerLandmarks[13].x = 0.40 + baseOffsetX;
    this.peerLandmarks[13].y = shoulderY + 0.12;
    this.peerLandmarks[13].visibility = 0.90;

    this.peerLandmarks[14].x = 0.60 + baseOffsetX;
    this.peerLandmarks[14].y = shoulderY + 0.12;
    this.peerLandmarks[14].visibility = 0.90;

    this.peerLandmarks[15].x = 0.44 + baseOffsetX;
    this.peerLandmarks[15].y = shoulderY + 0.20;
    this.peerLandmarks[15].visibility = 0.90;

    this.peerLandmarks[16].x = 0.56 + baseOffsetX;
    this.peerLandmarks[16].y = shoulderY + 0.20;
    this.peerLandmarks[16].visibility = 0.90;

    // Hips
    this.peerLandmarks[23].x = 0.45 + baseOffsetX;
    this.peerLandmarks[23].y = hipY;
    this.peerLandmarks[23].visibility = 0.95;

    this.peerLandmarks[24].x = 0.55 + baseOffsetX;
    this.peerLandmarks[24].y = hipY;
    this.peerLandmarks[24].visibility = 0.95;

    // Knees
    this.peerLandmarks[25].x = 0.43 + baseOffsetX - (depthFactor * 0.03);
    this.peerLandmarks[25].y = kneeY;
    this.peerLandmarks[25].visibility = 0.95;

    this.peerLandmarks[26].x = 0.57 + baseOffsetX + (depthFactor * 0.03);
    this.peerLandmarks[26].y = kneeY;
    this.peerLandmarks[26].visibility = 0.95;

    // Ankles
    this.peerLandmarks[27].x = 0.44 + baseOffsetX;
    this.peerLandmarks[27].y = ankleY;
    this.peerLandmarks[27].visibility = 0.95;

    this.peerLandmarks[28].x = 0.56 + baseOffsetX;
    this.peerLandmarks[28].y = ankleY;
    this.peerLandmarks[28].visibility = 0.95;

    this.peerMetadata.timestamp = timestamp;
    this.peerMetadata.exerciseType = exerciseType;
    this.peerMetadata.repCount = this._ghostReps;
    this.peerMetadata.bpm = Math.round(135 + (depthFactor * 18));
    this.peerMetadata.hrZone = 3;
    this.peerMetadata.isGhost = true;

    return {
      landmarks: this.peerLandmarks,
      metadata: this.peerMetadata
    };
  }

  /**
   * Registers a callback for received peer pose frames.
   * @param {(peerPose: any) => void} callback
   */
  onPeerPose(callback) {
    if (typeof callback === 'function') {
      this._listeners.push(callback);
    }
  }

  /**
   * @private
   */
  _emitPeerPose(data) {
    for (let i = 0; i < this._listeners.length; i++) {
      try {
        this._listeners[i](data);
      } catch (e) {}
    }
  }

  /**
   * Returns current active peer telemetry payload for frame rendering.
   * @returns {{ landmarks: Array<any>, metadata: typeof this.peerMetadata, isConnected: boolean }}
   */
  getPeerData() {
    return {
      landmarks: this.peerLandmarks,
      metadata: this.peerMetadata,
      isConnected: this.isPeerConnected || this.isGhostEnabled
    };
  }
}
