/**
 * @fileoverview Layer 1 (UI/Graphics): digitalTwin3D.js
 * 3D Spatial Digital Twin Biomechanical Rig rendered in WebGL via Three.js.
 * Maps 33 3D metric landmarks to articulated cybernetic limb tubes and joint nodes.
 * Visualizes instantaneous kinetic muscle strain via dynamic vertex & material color shifts:
 * - Low load (< 0.3): Neon Cyan (#00F2FE)
 * - Moderate load (0.3 - 0.7): Radiant Amber (#F59E0B)
 * - Overload / Peak Torque (> 0.7): Pulsing Magma Red (#FF0055)
 */

// Major skeletal bone pairs mapping MediaPipe Pose landmark indices
const SKELETON_BONES = [
  // Torso / Spine
  { name: 'spine', p1: 11, p2: 23, type: 'torso' },
  { name: 'spineR', p1: 12, p2: 24, type: 'torso' },
  { name: 'clavicle', p1: 11, p2: 12, type: 'torso' },
  { name: 'pelvis', p1: 23, p2: 24, type: 'glutes' },

  // Head / Neck
  { name: 'neckL', p1: 0, p2: 11, type: 'head' },
  { name: 'neckR', p1: 0, p2: 12, type: 'head' },

  // Left Arm
  { name: 'humerusL', p1: 11, p2: 13, type: 'arm' },
  { name: 'radiusL', p1: 13, p2: 15, type: 'arm' },

  // Right Arm
  { name: 'humerusR', p1: 12, p2: 14, type: 'arm' },
  { name: 'radiusR', p1: 14, p2: 16, type: 'arm' },

  // Left Leg
  { name: 'femurL', p1: 23, p2: 25, type: 'quads' },
  { name: 'tibiaL', p1: 25, p2: 27, type: 'leg' },

  // Right Leg
  { name: 'femurR', p1: 24, p2: 26, type: 'quads' },
  { name: 'tibiaR', p1: 26, p2: 28, type: 'leg' },
];

const KEY_NODES = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export class DigitalTwin3D {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    if (!canvas) {
      throw new Error('DigitalTwin3D: Initializer requires a valid HTMLCanvasElement.');
    }

    this.canvas = canvas;
    this.isActive = true;

    // Three.js instances
    this.scene = null;
    this.camera = null;
    this.renderer = null;

    /** @type {Map<string, any>} */
    this.boneMeshes = new Map();
    /** @type {Map<number, any>} */
    this.jointNodes = new Map();

    this.gridHelper = null;
    this.ambientLight = null;
    this.dirLight = null;

    this.initScene();
  }

  /**
   * Initializes Three.js WebGL rendering context, lighting, camera, and rig meshes.
   */
  initScene() {
    const THREE = window.THREE;
    if (!THREE) {
      console.warn('DigitalTwin3D: Three.js global not detected yet. Retrying on first frame.');
      return;
    }

    const width = this.canvas.clientWidth || this.canvas.width || 300;
    const height = this.canvas.clientHeight || this.canvas.height || 320;

    // 1. Scene
    this.scene = new THREE.Scene();

    // 2. Camera: Framed to capture athlete full body in 3D metric space
    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 50);
    this.camera.position.set(0, 0.25, 2.5);
    this.camera.lookAt(0, 0, 0);

    // 3. Renderer with antialiasing and transparent background
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // 4. Lighting: Cyber Hologram Ambiance
    this.ambientLight = new THREE.AmbientLight(0x0a2540, 2.2);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0x00f2fe, 3.0);
    this.dirLight.position.set(2, 4, 3);
    this.scene.add(this.dirLight);

    const rimLight = new THREE.DirectionalLight(0xff0080, 1.8);
    rimLight.position.set(-2, -2, -2);
    this.scene.add(rimLight);

    // 5. Cyber Floor Grid
    this.gridHelper = new THREE.GridHelper(2.5, 12, 0x00f2fe, 0x1e293b);
    this.gridHelper.position.y = -1.0;
    this.scene.add(this.gridHelper);

    // 6. Build Bone Meshes (Cylinder segments)
    const boneGeom = new THREE.CylinderGeometry(0.024, 0.024, 1.0, 12);
    // Shift geometry anchor so base is at (0, 0, 0) pointing toward +Y
    boneGeom.translate(0, 0.5, 0);
    boneGeom.rotateX(Math.PI / 2);

    SKELETON_BONES.forEach((b) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x00f2fe,
        emissive: 0x00f2fe,
        emissiveIntensity: 0.55,
        roughness: 0.25,
        metalness: 0.85,
        wireframe: false
      });

      const mesh = new THREE.Mesh(boneGeom, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.boneMeshes.set(b.name, { mesh, bone: b, mat });
    });

    // 7. Build Articulated Joint Spheres
    const jointGeom = new THREE.SphereGeometry(0.038, 14, 14);
    KEY_NODES.forEach((nodeIdx) => {
      const jointMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x00f2fe,
        emissiveIntensity: 0.75,
        roughness: 0.15,
        metalness: 0.9
      });

      const jointMesh = new THREE.Mesh(jointGeom, jointMat);
      jointMesh.visible = false;
      this.scene.add(jointMesh);
      this.jointNodes.set(nodeIdx, { mesh: jointMesh, mat: jointMat });
    });
  }

  /**
   * Resizes the WebGL viewport buffer.
   * 
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    if (!this.renderer || !this.camera) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /**
   * Interpolates hex color based on normalized strain load.
   * 
   * @param {number} load 0.0 to 1.0
   * @returns {{ color: number, emissive: number, intensity: number }}
   * @private
   */
  _getStrainColor(load) {
    if (load > 0.72) {
      // Pulsing Magma Red / Crimson Overload
      return { color: 0xff0055, emissive: 0xff0040, intensity: 0.95 };
    } else if (load > 0.38) {
      // Radiant Amber / Warning Load
      return { color: 0xf59e0b, emissive: 0xd97706, intensity: 0.75 };
    } else {
      // Rest / Safe Neon Cyan
      return { color: 0x00f2fe, emissive: 0x00b4d8, intensity: 0.55 };
    }
  }

  /**
   * Updates 3D digital twin pose from 3D metric world landmarks and applies strain color shifts.
   * 
   * @param {Array<{ x: number, y: number, z: number, visibility?: number }>} worldLandmarks 33 3D joints.
   * @param {{ quadsLoad: number, lowerBackLoad: number, gluteLoad: number }} strainData
   */
  updatePose(worldLandmarks, strainData) {
    const THREE = window.THREE;
    if (!THREE) {
      this.initScene();
      return;
    }

    if (!this.scene || !this.renderer || !this.camera) {
      this.initScene();
      return;
    }

    if (!worldLandmarks || worldLandmarks.length < 29) {
      this._setRigVisibility(false);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Centering offset (shift hips toward (0, 0, 0))
    const hipL = worldLandmarks[23];
    const hipR = worldLandmarks[24];
    const midX = (hipL.x + hipR.x) / 2;
    const midY = (hipL.y + hipR.y) / 2;
    const midZ = ((hipL.z || 0) + (hipR.z || 0)) / 2;

    // Metric coordinate conversion: In Three.js: +X Right, +Y Up, +Z Forward
    // In MediaPipe Pose: +Y is down, so invert Y to -Y
    const pVectors = new Map();
    for (let i = 0; i < worldLandmarks.length; i++) {
      const lm = worldLandmarks[i];
      if (!lm) continue;

      // Scale and center around the hips
      const x = (lm.x - midX) * 1.15;
      const y = -(lm.y - midY) * 1.15;
      const z = -((lm.z || 0) - midZ) * 1.15;

      pVectors.set(i, new THREE.Vector3(x, y, z));
    }

    // Dynamic strain color presets
    const quadsTheme = this._getStrainColor(strainData ? strainData.quadsLoad : 0);
    const lumbarTheme = this._getStrainColor(strainData ? strainData.lowerBackLoad : 0);
    const gluteTheme = this._getStrainColor(strainData ? strainData.gluteLoad : 0);
    const baseCyanTheme = { color: 0x00f2fe, emissive: 0x00b4d8, intensity: 0.55 };

    // 1. Update Skeletal Bone Meshes
    SKELETON_BONES.forEach((b) => {
      const entry = this.boneMeshes.get(b.name);
      if (!entry) return;

      const v1 = pVectors.get(b.p1);
      const v2 = pVectors.get(b.p2);

      if (!v1 || !v2) {
        entry.mesh.visible = false;
        return;
      }

      entry.mesh.visible = true;

      // Position at start joint and orient toward end joint
      entry.mesh.position.copy(v1);
      entry.mesh.lookAt(v2);

      // Scale height along target distance
      const distance = v1.distanceTo(v2);
      entry.mesh.scale.set(1, 1, Math.max(0.001, distance));

      // Dynamic strain color mapping
      let theme = baseCyanTheme;
      if (b.type === 'quads') theme = quadsTheme;
      else if (b.type === 'torso') theme = lumbarTheme;
      else if (b.type === 'glutes') theme = gluteTheme;

      entry.mat.color.setHex(theme.color);
      entry.mat.emissive.setHex(theme.emissive);
      entry.mat.emissiveIntensity = theme.intensity;
    });

    // 2. Update Joint Spheres
    KEY_NODES.forEach((nodeIdx) => {
      const entry = this.jointNodes.get(nodeIdx);
      if (!entry) return;

      const v = pVectors.get(nodeIdx);
      if (!v) {
        entry.mesh.visible = false;
        return;
      }

      entry.mesh.visible = true;
      entry.mesh.position.copy(v);

      // Color highlight knee & hip joints if heavily strained
      let jColor = 0xffffff;
      let jEmissive = 0x00f2fe;

      if ((nodeIdx === 25 || nodeIdx === 26) && strainData && strainData.quadsLoad > 0.72) {
        jColor = 0xff0055;
        jEmissive = 0xff0055;
      } else if ((nodeIdx === 23 || nodeIdx === 24) && strainData && strainData.lowerBackLoad > 0.72) {
        jColor = 0xff0055;
        jEmissive = 0xff0055;
      }

      entry.mat.color.setHex(jColor);
      entry.mat.emissive.setHex(jEmissive);
    });

    // Subtle gentle camera orbit based on athlete movement depth
    if (this.camera) {
      this.camera.lookAt(0, 0, 0);
    }

    // Render WebGL frame
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Sets visibility on all rig components.
   * @param {boolean} visible
   * @private
   */
  _setRigVisibility(visible) {
    this.boneMeshes.forEach(entry => entry.mesh.visible = visible);
    this.jointNodes.forEach(entry => entry.mesh.visible = visible);
  }

  /**
   * Clears active skeleton rig display.
   */
  resetPose() {
    this._setRigVisibility(false);
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Cleans up WebGL resources and event listeners.
   */
  dispose() {
    this.isActive = false;
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}
