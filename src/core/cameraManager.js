/**
 * @fileoverview Layer 5: Hardware & WebRTC Video Pipeline.
 * Manages the camera MediaStream, constraints, track life cycles, and permission rejections.
 */

/** @type {number} */
const TARGET_RESOLUTION_WIDTH = 1280;

/** @type {number} */
const TARGET_RESOLUTION_HEIGHT = 720;

/** @type {number} */
const FALLBACK_RESOLUTION_WIDTH = 640;

/** @type {number} */
const FALLBACK_RESOLUTION_HEIGHT = 480;

/**
 * Camera facing mode directions.
 * @enum {string}
 */
export const FacingMode = {
  USER: 'user',
  ENVIRONMENT: 'environment',
};

/**
 * Custom error wrapper for CameraManager operations.
 */
export class CameraManagerError extends Error {
  /**
   * @param {string} message The detailed error message.
   * @param {string} category The string code describing the error category.
   */
  constructor(message, category) {
    super(message);
    this.name = 'CameraManagerError';
    /**
     * @type {string}
     * @public
     */
    this.category = category;
  }
}

/**
 * Manages local webcam stream lifecycle and handles WebRTC constraints defensively.
 */
export class CameraManager {
  constructor() {
    /**
     * Active MediaStream capture.
     * @type {MediaStream|null}
     * @private
     */
    this.currentStream = null;

    /**
     * Connected video player.
     * @type {HTMLVideoElement|null}
     * @private
     */
    this.videoElement = null;

    /**
     * Current webcam selection direction.
     * @type {string}
     * @private
     */
    this.currentFacingMode = FacingMode.USER;
  }

  /**
   * Starts capture stream from camera devices.
   * Gracefully degrades resolution if preferred specifications fail.
   * 
   * @param {HTMLVideoElement} videoElement The target HTML video tag element.
   * @param {string} [facingMode='user'] Target camera facing mode ('user' | 'environment').
   * @returns {Promise<MediaStream>} Promise resolving to active stream.
   * @throws {CameraManagerError} When hardware acquisition fails.
   */
  async startStream(videoElement, facingMode = FacingMode.USER) {
    if (!videoElement) {
      throw new CameraManagerError('HTMLVideoElement is required.', 'INVALID_ARGUMENT');
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new CameraManagerError('getUserMedia is not supported by this browser.', 'UNSUPPORTED');
    }

    this.videoElement = videoElement;
    this.currentFacingMode = facingMode;

    this.stopStream();

    /** @type {MediaStreamConstraints} */
    const idealConstraints = {
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: TARGET_RESOLUTION_WIDTH },
        height: { ideal: TARGET_RESOLUTION_HEIGHT }
      },
      audio: false
    };

    try {
      this.currentStream = await navigator.mediaDevices.getUserMedia(idealConstraints);
      this.videoElement.srcObject = this.currentStream;
      return this.currentStream;
    } catch (error) {
      console.warn('CameraManager: High-res constraints failed. Attempting fallback.', error);
      
      /** @type {MediaStreamConstraints} */
      const fallbackConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: FALLBACK_RESOLUTION_WIDTH },
          height: { ideal: FALLBACK_RESOLUTION_HEIGHT }
        },
        audio: false
      };

      try {
        this.currentStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        this.videoElement.srcObject = this.currentStream;
        return this.currentStream;
      } catch (fallbackError) {
        const errorDetails = this.categorizeError(/** @type {Error} */ (fallbackError));
        throw new CameraManagerError(errorDetails.message, errorDetails.category);
      }
    }
  }

  /**
   * Toggles facing mode between front (user) and back (environment) cameras.
   * Restarts the stream with the new configuration.
   * 
   * @returns {Promise<MediaStream>} Resolves to the restarted MediaStream.
   * @throws {CameraManagerError} If stream hasn't been initialized.
   */
  async toggleCamera() {
    if (!this.videoElement) {
      throw new CameraManagerError('Stream not initialized. Call startStream first.', 'INVALID_STATE');
    }
    const nextFacingMode = this.currentFacingMode === FacingMode.USER 
      ? FacingMode.ENVIRONMENT 
      : FacingMode.USER;
    
    return this.startStream(this.videoElement, nextFacingMode);
  }

  /**
   * Stops the stream, stops all tracks explicitly, and releases hardware lock.
   */
  stopStream() {
    if (this.currentStream) {
      const tracks = this.currentStream.getTracks();
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].stop();
      }
      this.currentStream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }

  /**
   * Returns current active facing mode.
   * @returns {string}
   */
  getFacingMode() {
    return this.currentFacingMode;
  }

  /**
   * Categorizes native getUserMedia errors.
   * 
   * @param {Error} error Native DOM exception.
   * @returns {{message: string, category: string}} Formatted categorization.
   * @private
   */
  categorizeError(error) {
    if (error.name === 'NotAllowedError') {
      return {
        message: 'Camera permission denied by user.',
        category: 'PERMISSION_DENIED'
      };
    }
    if (error.name === 'NotFoundError') {
      return {
        message: 'No camera hardware found.',
        category: 'DEVICE_NOT_FOUND'
      };
    }
    if (error.name === 'NotReadableError') {
      return {
        message: 'Camera is locked or busy in another tab/app.',
        category: 'HARDWARE_BUSY'
      };
    }
    if (error.name === 'OverconstrainedError') {
      return {
        message: 'Requested constraints cannot be satisfied.',
        category: 'CONSTRAINT_UNSATISFIABLE'
      };
    }
    return {
      message: error.message || 'Unknown media capture error.',
      category: 'UNKNOWN'
    };
  }
}
