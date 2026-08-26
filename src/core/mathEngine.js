/**
 * @fileoverview Layer 3: Biomechanical 3D Vector Math.
 * Contains pure, stateless geometry calculation algorithms.
 */

/**
 * JSDoc definitions for 3D points.
 * @typedef {Object} Point3D
 * @property {number} x X coordinate.
 * @property {number} y Y coordinate.
 * @property {number} z Z coordinate.
 * @property {number} [visibility] Optional confidence score of the landmark detection.
 */

/**
 * Calculates the interior angle in degrees at vertex pointB formed by vectors BA and BC.
 * Handles 3D Euclidean coordinates and prevents NaN values due to floating-point drift.
 * 
 * @param {Point3D} pointA Start point A.
 * @param {Point3D} pointB Vertex point B.
 * @param {Point3D} pointC End point C.
 * @returns {number} The interior angle in degrees [0, 180].
 */
export function calculate3DAngle(pointA, pointB, pointC) {
  // Vector BA (from B to A)
  const baX = pointA.x - pointB.x;
  const baY = pointA.y - pointB.y;
  const baZ = pointA.z - pointB.z;

  // Vector BC (from B to C)
  const bcX = pointC.x - pointB.x;
  const bcY = pointC.y - pointB.y;
  const bcZ = pointC.z - pointB.z;

  // Dot product BA . BC
  const dotProduct = baX * bcX + baY * bcY + baZ * bcZ;

  // Vector Magnitudes |BA| and |BC|
  const magBA = Math.sqrt(baX * baX + baY * baY + baZ * baZ);
  const magBC = Math.sqrt(bcX * bcX + bcY * bcY + bcZ * bcZ);

  // Avoid division by zero
  if (magBA === 0 || magBC === 0) {
    return 0;
  }

  // Calculate cosine, clamp to [-1.0, 1.0] to handle floating-point precision drifts
  const cosTheta = dotProduct / (magBA * magBC);
  const clampedCos = Math.max(-1.0, Math.min(1.0, cosTheta));

  // Convert interior angle from radians to degrees
  return Math.acos(clampedCos) * (180.0 / Math.PI);
}

/**
 * Calculates the vertical deviation angle of a segment (e.g., torso) relative to the vertical Y-axis.
 * 
 * @param {Point3D} pointA Start point (e.g., Shoulder).
 * @param {Point3D} pointB End point (e.g., Hip).
 * @returns {number} Incline angle relative to the Y-axis in degrees [0, 90].
 */
export function calculateIncline(pointA, pointB) {
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const dz = pointB.z - pointA.z;

  const magnitude = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (magnitude === 0) {
    return 0;
  }

  // Calculate deviation from vertical axis [0, 1, 0] or [0, -1, 0]
  // cos(theta) = |dy| / magnitude
  const cosTheta = Math.abs(dy) / magnitude;
  const clampedCos = Math.max(-1.0, Math.min(1.0, cosTheta));

  // Deviation from the vertical: theta = acos(cosTheta)
  return Math.acos(clampedCos) * (180.0 / Math.PI);
}

/**
 * Returns the lowest visibility score from a collection of participating joints.
 * This represents the confidence score of the biomechanical measurements.
 * 
 * @param {...Point3D} landmarks Set of landmarks.
 * @returns {number} Minimum visibility value [0, 1].
 */
export function getConfidenceScore(...landmarks) {
  let minVisibility = 1.0;
  
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    if (lm && typeof lm.visibility === 'number') {
      if (lm.visibility < minVisibility) {
        minVisibility = lm.visibility;
      }
    }
  }

  return minVisibility;
}
