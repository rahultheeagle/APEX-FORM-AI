/**
 * @fileoverview WebGL Low-Light Normalization Shader Pass.
 * Applies local adaptive gamma, dynamic range normalization, and contrast enhancement
 * onto an OffscreenCanvas texture to remove harsh gym lighting shadows before MediaPipe inference.
 *
 * Equation:
 *   I_out = clamp(pow((I_in - min) / (max - min), gamma) * alpha, 0.0, 1.0)
 */

export class ContrastPass {
  /**
   * @param {Object} [options]
   * @param {number} [options.gamma=0.82] Adaptive gamma exponent (< 1.0 boosts shadows/midtones).
   * @param {number} [options.min=0.04] Black-level floor cutoff.
   * @param {number} [options.max=0.96] Specular ceiling cutoff.
   * @param {number} [options.alpha=1.18] Linear contrast multiplier.
   * @param {number} [options.width=640] Initial offscreen buffer width.
   * @param {number} [options.height=480] Initial offscreen buffer height.
   */
  constructor(options = {}) {
    this.gamma = options.gamma !== undefined ? options.gamma : 0.82;
    this.min = options.min !== undefined ? options.min : 0.04;
    this.max = options.max !== undefined ? options.max : 0.96;
    this.alpha = options.alpha !== undefined ? options.alpha : 1.18;

    this.width = options.width || 640;
    this.height = options.height || 480;

    /** @type {boolean} Indicates whether GPU shader pipeline is fully active */
    this.isGpuActive = false;

    /** @type {HTMLCanvasElement|OffscreenCanvas|null} */
    this.canvas = null;

    /** @type {WebGLRenderingContext|null} */
    this.gl = null;

    /** @type {WebGLProgram|null} */
    this.program = null;

    /** @type {WebGLTexture|null} */
    this.texture = null;

    /** @type {WebGLBuffer|null} */
    this.quadBuffer = null;

    // Uniform locations
    this.uImageLoc = null;
    this.uGammaLoc = null;
    this.uMinLoc = null;
    this.uMaxLoc = null;
    this.uAlphaLoc = null;

    this._initWebGL();
  }

  /**
   * Initializes OffscreenCanvas and compiles WebGL fragment/vertex shaders.
   * @private
   */
  _initWebGL() {
    try {
      // 1. Instantiate OffscreenCanvas or fallback to standard canvas
      if (typeof OffscreenCanvas !== 'undefined') {
        try {
          this.canvas = new OffscreenCanvas(this.width, this.height);
        } catch (_) {
          if (typeof document !== 'undefined') {
            this.canvas = document.createElement('canvas');
            this.canvas.width = this.width;
            this.canvas.height = this.height;
          }
        }
      } else if (typeof document !== 'undefined') {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
      }

      if (!this.canvas) {
        console.warn('ContrastPass: Canvas context creation unavailable.');
        return;
      }

      const glOptions = {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance'
      };

      this.gl = /** @type {WebGLRenderingContext} */ (
        this.canvas.getContext('webgl', glOptions) ||
        this.canvas.getContext('experimental-webgl', glOptions)
      );

      if (!this.gl) {
        console.warn('ContrastPass: WebGL unsupported in current environment.');
        return;
      }

      const gl = this.gl;

      // 2. Vertex Shader (Full-screen quad mapping)
      const vsSource = `
        attribute vec2 a_position;
        varying vec2 v_texCoord;
        void main() {
          // Map [-1, 1] quad to [0, 1] texture coordinates
          v_texCoord = a_position * 0.5 + 0.5;
          gl_Position = vec4(a_position, 0.0, 1.0);
        }
      `;

      // 3. Fragment Shader: I_out = clamp(((I_in - min) / (max - min))^gamma * alpha, 0.0, 1.0)
      const fsSource = `
        precision mediump float;
        uniform sampler2D u_image;
        uniform float u_gamma;
        uniform float u_min;
        uniform float u_max;
        uniform float u_alpha;
        varying vec2 v_texCoord;

        void main() {
          vec4 color = texture2D(u_image, v_texCoord);
          float range = max(u_max - u_min, 0.0001);
          vec3 normalized = clamp((color.rgb - vec3(u_min)) / range, 0.0, 1.0);
          vec3 enhanced = pow(normalized, vec3(u_gamma)) * u_alpha;
          gl_FragColor = vec4(clamp(enhanced, 0.0, 1.0), color.a);
        }
      `;

      const vs = this._compileShader(gl.VERTEX_SHADER, vsSource);
      const fs = this._compileShader(gl.FRAGMENT_SHADER, fsSource);

      if (!vs || !fs) {
        return;
      }

      this.program = gl.createProgram();
      gl.attachShader(this.program, vs);
      gl.attachShader(this.program, fs);
      gl.linkProgram(this.program);

      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        console.error('ContrastPass: Shader link failed:', gl.getProgramInfoLog(this.program));
        return;
      }

      gl.useProgram(this.program);

      // 4. Set up Quad Geometry
      const positions = new Float32Array([
        -1.0, -1.0,
         1.0, -1.0,
        -1.0,  1.0,
         1.0,  1.0
      ]);

      this.quadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

      const aPosLoc = gl.getAttribLocation(this.program, 'a_position');
      gl.enableVertexAttribArray(aPosLoc);
      gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

      // 5. Cache Uniform Locations
      this.uImageLoc = gl.getUniformLocation(this.program, 'u_image');
      this.uGammaLoc = gl.getUniformLocation(this.program, 'u_gamma');
      this.uMinLoc = gl.getUniformLocation(this.program, 'u_min');
      this.uMaxLoc = gl.getUniformLocation(this.program, 'u_max');
      this.uAlphaLoc = gl.getUniformLocation(this.program, 'u_alpha');

      gl.uniform1i(this.uImageLoc, 0);
      gl.uniform1f(this.uGammaLoc, this.gamma);
      gl.uniform1f(this.uMinLoc, this.min);
      gl.uniform1f(this.uMaxLoc, this.max);
      gl.uniform1f(this.uAlphaLoc, this.alpha);

      // 6. Set up Video Input Texture
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      this.isGpuActive = true;
    } catch (err) {
      console.warn('ContrastPass: WebGL initialization failed. Falling back to CPU pass-through:', err);
      this.isGpuActive = false;
    }
  }

  /**
   * Compiles GLSL shader source.
   * @private
   */
  _compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('ContrastPass: Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  /**
   * Processes the raw video feed onto the WebGL OffscreenCanvas texture and returns
   * the normalized frame buffer for MediaPipe inference.
   *
   * @param {HTMLVideoElement|HTMLCanvasElement} videoElement Source video frame.
   * @returns {HTMLCanvasElement|OffscreenCanvas|HTMLVideoElement} Normalized canvas or original source.
   */
  process(videoElement) {
    if (!this.isGpuActive || !this.gl || !videoElement) {
      return videoElement;
    }

    const gl = this.gl;
    const vWidth = videoElement.videoWidth || videoElement.width || 0;
    const vHeight = videoElement.videoHeight || videoElement.height || 0;

    if (vWidth === 0 || vHeight === 0) {
      return videoElement;
    }

    // Resize viewport dynamically to match camera resolution
    if (this.canvas.width !== vWidth || this.canvas.height !== vHeight) {
      this.canvas.width = vWidth;
      this.canvas.height = vHeight;
      this.width = vWidth;
      this.height = vHeight;
      gl.viewport(0, 0, vWidth, vHeight);
    }

    try {
      gl.useProgram(this.program);

      // Upload current video frame to GPU texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);

      // Bind quad vertex geometry
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);

      // Execute fragment shader draw
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      return this.canvas;
    } catch (renderErr) {
      console.warn('ContrastPass: Frame processing failed, using raw video feed:', renderErr);
      return videoElement;
    }
  }

  /**
   * Updates shader parameters dynamically.
   *
   * @param {Object} params
   * @param {number} [params.gamma]
   * @param {number} [params.min]
   * @param {number} [params.max]
   * @param {number} [params.alpha]
   */
  setParameters({ gamma, min, max, alpha } = {}) {
    if (gamma !== undefined) this.gamma = gamma;
    if (min !== undefined) this.min = min;
    if (max !== undefined) this.max = max;
    if (alpha !== undefined) this.alpha = alpha;

    if (this.isGpuActive && this.gl && this.program) {
      const gl = this.gl;
      gl.useProgram(this.program);
      if (this.uGammaLoc) gl.uniform1f(this.uGammaLoc, this.gamma);
      if (this.uMinLoc) gl.uniform1f(this.uMinLoc, this.min);
      if (this.uMaxLoc) gl.uniform1f(this.uMaxLoc, this.max);
      if (this.uAlphaLoc) gl.uniform1f(this.uAlphaLoc, this.alpha);
    }
  }

  /**
   * Returns current GPU shader telemetry status.
   * @returns {{ isGpuActive: boolean, label: string }}
   */
  getStatus() {
    return {
      isGpuActive: this.isGpuActive,
      label: this.isGpuActive ? 'SHADOW ENHANCEMENT: ON-GPU' : 'SHADOW ENHANCEMENT: BYPASS'
    };
  }

  /**
   * Releases GPU resources.
   */
  destroy() {
    if (this.gl) {
      if (this.texture) this.gl.deleteTexture(this.texture);
      if (this.quadBuffer) this.gl.deleteBuffer(this.quadBuffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.isGpuActive = false;
  }
}
