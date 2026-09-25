/**
 * @fileoverview Layer 4: Computer Vision Multi-Person Gym Anchor & Primary Athlete Isolation Filter.
 * Locks onto the primary foreground athlete and filters out background bystanders, passersby,
 * and casual gym-goers using spatial centroid proximity, bounding box scale, and confidence weighting.
 */

/**
 * Normalized 2D/3D Landmark definition.
 * @typedef {Object} Landmark
 * @property {number} x Normalized X coordinate [0.0, 1.0].
 * @property {number} y Normalized Y coordinate [0.0, 1.0].
 * @property {number} [z] Metric or normalized depth coordinate.
 * @property {number} [visibility] Confidence score [0.0, 1.0].
 */

/**
 * Bounding Box representation.
 * @typedef {Object} BoundingBox
 * @property {number} minX
 * @property {number} maxX
 * @property {number} minY
 * @property {number} maxY
 * @property {number} width
 * @property {number} height
 * @property {number} area
 * @property {number} scale
 * @property {{ x: number, y: number }} centroid
 * @property {number} avgConfidence
 * @property {number} validJointCount
 */

export class PersonTracker {
  /**
   * @param {Object} [options]
   * @param {number} [options.alpha=0.20] EMA centroid smoothing coefficient.
   * @param {number} [options.maxCentroidDistance=0.38] Maximum normalized distance to consider a match.
   * @param {number} [options.minConfidence=0.30] Minimum joint confidence threshold.
   * @param {number} [options.lostFramesThreshold=45] Frames before breaking lock when athlete disappears.
   */
  constructor(options = {}) {
    this.alpha = options.alpha !== undefined ? options.alpha : 0.20;
    this.maxCentroidDistance = options.maxCentroidDistance !== undefined ? options.maxCentroidDistance : 0.38;
    this.minConfidence = options.minConfidence !== undefined ? options.minConfidence : 0.30;
    this.lostFramesThreshold = options.lostFramesThreshold !== undefined ? options.lostFramesThreshold : 45;

    /** @type {{ x: number, y: number }|null} Locked primary spatial centroid */
    this.lockedCentroid = null;

    /** @type {number} Locked bounding box scale / diagonal */
    this.lockedScale = 0;

    /** @type {number} Locked bounding box area (width * height) */
    this.lockedArea = 0;

    /** @type {boolean} True if an athlete is currently locked */
    this.isLocked = false;

    /** @type {number} Frames since athlete was last matched */
    this.framesSinceLastMatch = 0;

    /** @type {BoundingBox|null} Last accepted bounding box */
    this.lastBoundingBox = null;

    /** @type {Object|null} Cached ground perimeter geometry for HUD isolation glow */
    this.lastPerimeter = null;

    /** @type {number} Performance timestamp of initial lock */
    this.lockTimestamp = 0;
  }

  /**
   * Computes the bounding box, area, centroid, and average confidence of a landmark set.
   * 
   * @param {Array<Landmark>} landmarks
   * @returns {BoundingBox|null}
   */
  computeBoundingBox(landmarks) {
    if (!landmarks || landmarks.length === 0) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let confSum = 0;
    let validJoints = 0;

    // Prioritize major torso, hip, and limb joints for bodily centroid stability
    const keyJoints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    let keyXSum = 0;
    let keyYSum = 0;
    let keyCount = 0;

    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (!lm) continue;

      const vis = lm.visibility !== undefined ? lm.visibility : 1.0;
      if (vis < this.minConfidence) continue;

      if (lm.x < minX) minX = lm.x;
      if (lm.x > maxX) maxX = lm.x;
      if (lm.y < minY) minY = lm.y;
      if (lm.y > maxY) maxY = lm.y;

      confSum += vis;
      validJoints++;

      if (keyJoints.includes(i)) {
        keyXSum += lm.x;
        keyYSum += lm.y;
        keyCount++;
      }
    }

    if (validJoints < 4 || minX >= maxX || minY >= maxY) {
      return null;
    }

    const width = Math.max(0.01, maxX - minX);
    const height = Math.max(0.01, maxY - minY);
    const area = width * height;
    const scale = Math.hypot(width, height);
    const avgConfidence = confSum / validJoints;

    // Use torso/hip anchor centroid if available, otherwise bounding box center
    const centroidX = keyCount > 0 ? (keyXSum / keyCount) : ((minX + maxX) / 2);
    const centroidY = keyCount > 0 ? (keyYSum / keyCount) : ((minY + maxY) / 2);

    return {
      minX,
      maxX,
      minY,
      maxY,
      width,
      height,
      area,
      scale,
      centroid: { x: centroidX, y: centroidY },
      avgConfidence,
      validJointCount: validJoints
    };
  }

  /**
   * Locks onto the person occupying the largest bounding box area with the highest confidence.
   * Stores the spatial centroid [xc, yc] and scale.
   * 
   * @param {Array<Array<Landmark>>|Array<Landmark>|any} multiPersonLandmarks
   * @returns {Array<Landmark>|null} The selected primary athlete's landmarks.
   */
  selectPrimaryAthlete(multiPersonLandmarks) {
    if (!multiPersonLandmarks) return null;

    const candidates = this._extractCandidates(multiPersonLandmarks);
    if (candidates.length === 0) return null;

    let bestCandidate = null;
    let bestBox = null;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const landmarks = candidates[i];
      const box = this.computeBoundingBox(landmarks);
      if (!box) continue;

      // Ranking score combines area (foreground dominance) and confidence score
      // Score = Area * (Confidence ^ 1.5)
      const rankScore = box.area * Math.pow(box.avgConfidence, 1.5);

      if (rankScore > bestScore) {
        bestScore = rankScore;
        bestCandidate = landmarks;
        bestBox = box;
      }
    }

    if (!bestCandidate || !bestBox) return null;

    // Lock onto primary athlete
    this.lockedCentroid = { x: bestBox.centroid.x, y: bestBox.centroid.y };
    this.lockedArea = bestBox.area;
    this.lockedScale = bestBox.scale;
    this.lastBoundingBox = bestBox;
    this.lastPerimeter = this.getGroundPerimeter(bestCandidate, bestBox);
    this.isLocked = true;
    this.framesSinceLastMatch = 0;
    this.lockTimestamp = performance.now();

    return bestCandidate;
  }

  /**
   * Tracks the locked athlete across frames using Euclidean centroid proximity.
   * Rejects and prunes background bystanders or casual gym-goers entering the frame.
   * 
   * @param {Array<Array<Landmark>>|Array<Landmark>|any} allDetectedPersons
   * @returns {Array<Landmark>|null} Isolated primary athlete landmarks, or null if pruned/lost.
   */
  filterFrame(allDetectedPersons) {
    if (!allDetectedPersons) {
      this._handleMissedFrame();
      return null;
    }

    const candidates = this._extractCandidates(allDetectedPersons);
    if (candidates.length === 0) {
      this._handleMissedFrame();
      return null;
    }

    // If no primary athlete is locked yet, lock onto the dominant candidate
    if (!this.isLocked || !this.lockedCentroid) {
      return this.selectPrimaryAthlete(candidates);
    }

    let bestCandidate = null;
    let bestBox = null;
    let minCost = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const landmarks = candidates[i];
      const box = this.computeBoundingBox(landmarks);
      if (!box) continue;

      // 1. Euclidean centroid distance
      const dx = box.centroid.x - this.lockedCentroid.x;
      const dy = box.centroid.y - this.lockedCentroid.y;
      const dist = Math.hypot(dx, dy);

      // 2. Scale / Area ratio check
      const areaRatio = box.area / Math.max(0.001, this.lockedArea);

      // Prune background bystanders: distance too large or tiny area compared to locked athlete
      if (dist > this.maxCentroidDistance && areaRatio < 0.40) {
        continue;
      }

      // Compute tracking cost: distance penalty + area deviation penalty - confidence bonus
      const areaPenalty = Math.abs(1.0 - areaRatio) * 0.25;
      const confidenceBonus = box.avgConfidence * 0.15;
      const trackingCost = dist + areaPenalty - confidenceBonus;

      if (trackingCost < minCost && dist <= this.maxCentroidDistance * 1.5) {
        minCost = trackingCost;
        bestCandidate = landmarks;
        bestBox = box;
      }
    }

    if (bestCandidate && bestBox) {
      // Smoothly update spatial centroid and scale via Exponential Moving Average (EMA)
      const a = this.alpha;
      const b = 1.0 - a;

      this.lockedCentroid.x = (b * this.lockedCentroid.x) + (a * bestBox.centroid.x);
      this.lockedCentroid.y = (b * this.lockedCentroid.y) + (a * bestBox.centroid.y);
      this.lockedArea = (b * this.lockedArea) + (a * bestBox.area);
      this.lockedScale = (b * this.lockedScale) + (a * bestBox.scale);

      this.lastBoundingBox = bestBox;
      this.lastPerimeter = this.getGroundPerimeter(bestCandidate, bestBox);
      this.framesSinceLastMatch = 0;

      return bestCandidate;
    }

    // No valid match found in this frame (candidate was pruned as background)
    this._handleMissedFrame();
    return null;
  }

  /**
   * Computes ground perimeter geometry around the athlete's feet / base for HUD isolation glow.
   * 
   * @param {Array<Landmark>} landmarks
   * @param {BoundingBox} [boundingBox]
   * @returns {{
   *   center: { x: number, y: number },
   *   radiusX: number,
   *   radiusY: number,
   *   width: number,
   *   points: Array<{ x: number, y: number }>
   * }}
   */
  getGroundPerimeter(landmarks, boundingBox = null) {
    const box = boundingBox || this.computeBoundingBox(landmarks);
    
    // Foot landmark indices: Left Ankle (27), Right Ankle (28), Left Heel (29), Right Heel (30), Left Index (31), Right Index (32)
    const footIndices = [27, 28, 29, 30, 31, 32];
    const visibleFeet = [];

    if (landmarks) {
      for (let i = 0; i < footIndices.length; i++) {
        const idx = footIndices[i];
        const lm = landmarks[idx];
        if (lm && (lm.visibility === undefined || lm.visibility > 0.30)) {
          visibleFeet.push({ x: lm.x, y: lm.y });
        }
      }
    }

    let centerX = 0.5;
    let groundY = 0.9;
    let radiusX = 0.20;
    let radiusY = 0.06;

    if (visibleFeet.length >= 2) {
      let sumX = 0;
      let maxY = -Infinity;
      let minX = Infinity;
      let maxX = -Infinity;

      for (let i = 0; i < visibleFeet.length; i++) {
        const pt = visibleFeet[i];
        sumX += pt.x;
        if (pt.y > maxY) maxY = pt.y;
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
      }

      centerX = sumX / visibleFeet.length;
      groundY = maxY + 0.02; // Just below the lowest heel/toe
      const spreadX = Math.max(0.12, (maxX - minX) * 1.35);
      radiusX = spreadX / 2;
      radiusY = Math.max(0.035, radiusX * 0.32);
    } else if (box) {
      centerX = (box.minX + box.maxX) / 2;
      groundY = box.maxY + 0.02;
      radiusX = Math.max(0.10, box.width * 0.70);
      radiusY = Math.max(0.035, radiusX * 0.30);
    }

    // Generate 12-point elliptical ground polygon
    const points = [];
    const numPoints = 12;
    for (let i = 0; i < numPoints; i++) {
      const theta = (i / numPoints) * Math.PI * 2;
      points.push({
        x: centerX + (Math.cos(theta) * radiusX),
        y: groundY + (Math.sin(theta) * radiusY)
      });
    }

    return {
      center: { x: centerX, y: groundY },
      radiusX,
      radiusY,
      width: radiusX * 2,
      points
    };
  }

  /**
   * Resets locked state so that a new athlete can be selected.
   */
  reset() {
    this.lockedCentroid = null;
    this.lockedScale = 0;
    this.lockedArea = 0;
    this.isLocked = false;
    this.framesSinceLastMatch = 0;
    this.lastBoundingBox = null;
    this.lastPerimeter = null;
    this.lockTimestamp = 0;
  }

  /**
   * Returns current isolation telemetry for HUD and debug overlays.
   * @returns {{
   *   isLocked: boolean,
   *   centroid: { x: number, y: number }|null,
   *   area: number,
   *   scale: number,
   *   boundingBox: BoundingBox|null,
   *   perimeter: Object|null
   * }}
   */
  getIsolationData() {
    return {
      isLocked: this.isLocked,
      centroid: this.lockedCentroid ? { ...this.lockedCentroid } : null,
      area: this.lockedArea,
      scale: this.lockedScale,
      boundingBox: this.lastBoundingBox,
      perimeter: this.lastPerimeter
    };
  }

  /**
   * Normalizes input into an array of landmark sets.
   * Handles single landmark array, array of landmark arrays, and objects containing poseLandmarks.
   * 
   * @param {any} input
   * @returns {Array<Array<Landmark>>}
   * @private
   */
  _extractCandidates(input) {
    if (!input) return [];

    // Array of persons
    if (Array.isArray(input)) {
      if (input.length === 0) return [];
      
      // Case 1: Array of landmark arrays [[{x, y}, ...], [{x, y}, ...]]
      if (Array.isArray(input[0])) {
        return input;
      }

      // Case 2: Array of person objects [{ poseLandmarks: [...] }, ...] or [{ landmarks: [...] }]
      if (input[0] && typeof input[0] === 'object' && !('x' in input[0])) {
        const extracted = [];
        for (let i = 0; i < input.length; i++) {
          const item = input[i];
          if (item.poseLandmarks && Array.isArray(item.poseLandmarks)) {
            extracted.push(item.poseLandmarks);
          } else if (item.landmarks && Array.isArray(item.landmarks)) {
            extracted.push(item.landmarks);
          }
        }
        return extracted;
      }

      // Case 3: Single landmark array [{x, y, z, visibility}, ...]
      if ('x' in input[0] && 'y' in input[0]) {
        return [input];
      }
    }

    // Single object with poseLandmarks
    if (typeof input === 'object' && input.poseLandmarks && Array.isArray(input.poseLandmarks)) {
      return [input.poseLandmarks];
    }

    return [];
  }

  /**
   * Increments missed frames counter and resets lock if threshold is breached.
   * @private
   */
  _handleMissedFrame() {
    this.framesSinceLastMatch++;
    if (this.framesSinceLastMatch > this.lostFramesThreshold) {
      this.reset();
    }
  }
}
