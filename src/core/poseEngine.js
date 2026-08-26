/**
 * @fileoverview Layer 4: Computer Vision & Pose Landmark Extraction.
 * Interfaces with Google MediaPipe Pose and provides real-time Exponential Moving Average (EMA) smoothing.
 */

/**
 * Smoothing factor for Exponential Moving Average (EMA) filter.
 * Lower value means more smoothing but introduces more temporal lag.
 * Value must be between 0 (exclusive) and 1 (inclusive).
 * @type {number}
 */
const EMA_ALPHA = 0.35;

/**
 * JSDoc definitions for MediaPipe results structure.
 * @typedef {Object} NormalizedLandmark
 * @property {number} x X coordinate normalized to [0, 1].
 * @property {number} y Y coordinate normalized to [0, 1].
 * @property {number} z Z coordinate representing depth.
 * @property {number} visibility Probability of the landmark being visible.
 */

/**
 * @typedef {Object} PoseResults
 * @property {Array<NormalizedLandmark>} [poseLandmarks] Normalized coordinates of body joints.
 * @property {Array<NormalizedLandmark>} [poseWorldLandmarks] Coordinates in 3D metric space.
 * @property {HTMLCanvasElement|HTMLImageElement|HTMLVideoElement} image Input image/frame container.
 */

/**
 * Handles WebAssembly-based MediaPipe Pose pipeline initialization, configuration,
 * frame dispatching, and landmark coordinate smoothing.
 */
export class PoseEngine {
  /**
   * @param {function(PoseResults): void} onPoseDetected Callback function invoked on successful landmark extraction.
   */
  constructor(onPoseDetected) {
    if (typeof onPoseDetected !== 'function') {
      throw new TypeError('PoseEngine: Constructor requires a valid callback function.');
    }

    /**
     * Callback for detected frames.
     * @type {function(PoseResults): void}
     * @private
     */
    this.onPoseDetected = onPoseDetected;

    /**
     * Native MediaPipe Pose instance.
     * @type {any|null}
     * @private
     */
    this.pose = null;

    /**
     * History stack for tracking EMA coordinate smoothing.
     * @type {Array<NormalizedLandmark>|null}
     * @private
     */
    this.smoothedLandmarks = null;

    /**
     * Flags if the engine has been initialized successfully.
     * @type {boolean}
     * @private
     */
    this.isInitialized = false;
  }

  /**
   * Initialises the MediaPipe Pose stack and loads required WASM modules from CDN.
   * @returns {Promise<void>} Resolves when setup is complete and model is loaded.
   * @throws {Error} If CDN script window.Pose global is missing or initialization fails.
   */
  async init() {
    if (this.isInitialized) {
      return;
    }

    // @ts-ignore - Pose is loaded globally from the script tag
    const PoseConstructor = window.Pose;

    if (!PoseConstructor) {
      throw new Error(
        'PoseEngine: window.Pose is undefined. Verify that MediaPipe CDN scripts are loaded.'
      );
    }

    try {
      this.pose = new PoseConstructor({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        },
      });

      this.pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });

      this.pose.onResults((results) => {
        this.processResults(results);
      });

      this.isInitialized = true;
      console.log('PoseEngine: MediaPipe Pose initialized successfully.');
    } catch (error) {
      console.error('PoseEngine: Failed to initialize MediaPipe Pose.', error);
      throw error;
    }
  }

  /**
   * Dispatches a video/image frame to the MediaPipe Pose detector asynchronously.
   * 
   * @param {HTMLVideoElement|HTMLCanvasElement} frameElement Image/video source container.
   * @returns {Promise<void>} Resolves once the frame has been accepted into processing.
   * @throws {Error} If engine is not initialized.
   */
  async sendFrame(frameElement) {
    if (!this.isInitialized || !this.pose) {
      throw new Error('PoseEngine: Cannot process frame. Engine is not initialized.');
    }
    await this.pose.send({ image: frameElement });
  }

  /**
   * Applies Exponential Moving Average (EMA) smoothing to reduce high-frequency jitter.
   * 
   * @param {Array<NormalizedLandmark>} currentLandmarks Raw coordinates from the engine.
   * @returns {Array<NormalizedLandmark>} Filtered coordinate array.
   * @private
   */
  applyEMASmoothing(currentLandmarks) {
    if (!currentLandmarks) {
      this.smoothedLandmarks = null;
      return [];
    }

    // If no previous values or size changes, initialize the smoother with raw values.
    if (!this.smoothedLandmarks || this.smoothedLandmarks.length !== currentLandmarks.length) {
      this.smoothedLandmarks = currentLandmarks.map((l) => ({ ...l }));
      return this.smoothedLandmarks;
    }

    // Apply S_t = alpha * Y_t + (1 - alpha) * S_{t-1} to each coordinate dimension
    const alpha = EMA_ALPHA;
    const beta = 1.0 - alpha;

    const smoothed = [];
    for (let i = 0; i < currentLandmarks.length; i++) {
      const cur = currentLandmarks[i];
      const prev = this.smoothedLandmarks[i];

      smoothed.push({
        x: alpha * cur.x + beta * prev.x,
        y: alpha * cur.y + beta * prev.y,
        z: alpha * cur.z + beta * prev.z,
        visibility: alpha * cur.visibility + beta * prev.visibility,
      });
    }

    this.smoothedLandmarks = smoothed;
    return smoothed;
  }

  /**
   * Processes the MediaPipe results, runs coordinate smoothing filter, and triggers consumer callback.
   * 
   * @param {any} results Raw outputs from MediaPipe.
   * @private
   */
  processResults(results) {
    /** @type {PoseResults} */
    const processedResults = {
      image: results.image,
    };

    if (results.poseLandmarks) {
      // Smooth the normalized coordinates to reduce tracking jitter.
      processedResults.poseLandmarks = this.applyEMASmoothing(results.poseLandmarks);
      
      // Keep native metric space world coordinates if available.
      if (results.poseWorldLandmarks) {
        processedResults.poseWorldLandmarks = results.poseWorldLandmarks;
      }
    } else {
      // Clear smoother state if tracking is lost.
      this.resetSmoothing();
    }

    this.onPoseDetected(processedResults);
  }

  /**
   * Resets temporal coordinate filters. Must be called when tracking state restarts.
   */
  resetSmoothing() {
    this.smoothedLandmarks = null;
  }
}
