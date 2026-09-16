/**
 * @fileoverview Layer 4 (Storage): historyDb.js
 * Native client-side IndexedDB persistence engine for ApexForm AI.
 * Manages workout session logging, personal record (PR) milestone indexing,
 * JSON export data serialization, and database lifecycle management.
 */

const DB_NAME = 'ApexFormAI_DB';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';

export class HistoryDB {
  constructor() {
    /** @type {IDBDatabase|null} @private */
    this.db = null;
    /** @type {Promise<IDBDatabase>|null} @private */
    this.dbPromise = null;
  }

  /**
   * Initializes or returns the cached IndexedDB connection.
   * 
   * @returns {Promise<IDBDatabase>}
   */
  async open() {
    if (this.db) {
      return this.db;
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB is not supported in this environment.'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          const store = db.createObjectStore(STORE_SESSIONS, {
            keyPath: 'id',
            autoIncrement: true
          });

          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('exerciseType', 'exerciseType', { unique: false });
          store.createIndex('repCount', 'totalReps', { unique: false });
          store.createIndex('formAccuracy', 'formAccuracy', { unique: false });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
          this.dbPromise = null;
        };
        resolve(this.db);
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to open ApexFormAI IndexedDB database.'));
      };
    });

    return this.dbPromise;
  }

  /**
   * Persists a completed workout session record with rep telemetry details.
   * 
   * @param {Object} sessionData
   * @param {number} [sessionData.timestamp]
   * @param {string} sessionData.exerciseType 'SQUAT' | 'BICEP_CURL' | 'PUSHUP'
   * @param {number} sessionData.totalReps
   * @param {number} [sessionData.avgDepthAngle]
   * @param {number} [sessionData.formAccuracy]
   * @param {number} [sessionData.durationSeconds]
   * @param {string} [sessionData.barPathGrade]
   * @param {number} [sessionData.avgSymmetry]
   * @param {{ joules: number, kcal: number }} [sessionData.mechanicalWork]
   * @param {Array<{ repNum: number, peakAngle: number, hadFault: boolean, velocity: number }>} [sessionData.repDetails]
   * @returns {Promise<number>} Auto-incremented primary key ID.
   */
  async saveSession(sessionData) {
    const db = await this.open();

    const record = {
      timestamp: sessionData.timestamp || Date.now(),
      exerciseType: sessionData.exerciseType || 'SQUAT',
      totalReps: Number(sessionData.totalReps) || 0,
      avgDepthAngle: Number(sessionData.avgDepthAngle) || 0,
      formAccuracy: Number(sessionData.formAccuracy) || 100,
      durationSeconds: Number(sessionData.durationSeconds) || 0,
      barPathGrade: sessionData.barPathGrade || 'A',
      avgSymmetry: Number(sessionData.avgSymmetry) || 100,
      mechanicalWork: sessionData.mechanicalWork || { joules: 0, kcal: 0 },
      repDetails: Array.isArray(sessionData.repDetails) ? sessionData.repDetails : []
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_SESSIONS], 'readwrite');
      const store = transaction.objectStore(STORE_SESSIONS);
      const request = store.add(record);

      request.onsuccess = () => {
        resolve(/** @type {number} */ (request.result));
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to save workout session in IndexedDB.'));
      };
    });
  }

  /**
   * Retrieves all workout sessions sorted newest first.
   * 
   * @returns {Promise<Array<Object>>}
   */
  async getAllSessions() {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_SESSIONS], 'readonly');
      const store = transaction.objectStore(STORE_SESSIONS);
      const request = store.getAll();

      request.onsuccess = () => {
        const sessions = request.result || [];
        // Sort descending by timestamp
        sessions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(sessions);
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to retrieve workout sessions from IndexedDB.'));
      };
    });
  }

  /**
   * Computes personal records (PRs) across lifetime sessions.
   * 
   * @param {string|null} [exerciseType=null] Optional filter ('SQUAT', 'BICEP_CURL', 'PUSHUP').
   * @returns {Promise<{ maxReps: number, bestAccuracy: number, deepestAngle: number, totalSets: number, totalLifetimeReps: number }>}
   */
  async getPersonalRecords(exerciseType = null) {
    const allSessions = await this.getAllSessions();
    const sessions = exerciseType
      ? allSessions.filter(s => s.exerciseType === exerciseType)
      : allSessions;

    if (sessions.length === 0) {
      return {
        maxReps: 0,
        bestAccuracy: 0,
        deepestAngle: 0,
        totalSets: 0,
        totalLifetimeReps: 0
      };
    }

    let maxReps = 0;
    let bestAccuracy = 0;
    let deepestAngle = 999;
    let totalLifetimeReps = 0;

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const reps = Number(s.totalReps) || 0;
      totalLifetimeReps += reps;

      if (reps > maxReps) {
        maxReps = reps;
      }

      const acc = Number(s.formAccuracy) || 0;
      if (reps > 0 && acc > bestAccuracy) {
        bestAccuracy = acc;
      }

      const angle = Number(s.avgDepthAngle) || 0;
      if (reps > 0 && angle > 0 && angle < deepestAngle) {
        deepestAngle = angle;
      }
    }

    if (deepestAngle === 999) {
      deepestAngle = 0;
    }

    return {
      maxReps,
      bestAccuracy,
      deepestAngle,
      totalSets: sessions.length,
      totalLifetimeReps
    };
  }

  /**
   * Exports full session history as a formatted JSON string.
   * 
   * @returns {Promise<string>}
   */
  async exportDataJSON() {
    const sessions = await this.getAllSessions();
    return JSON.stringify({
      schemaVersion: DB_VERSION,
      exportedAt: new Date().toISOString(),
      sessionCount: sessions.length,
      sessions
    }, null, 2);
  }

  /**
   * Deletes all stored session records.
   * 
   * @returns {Promise<void>}
   */
  async clearHistory() {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_SESSIONS], 'readwrite');
      const store = transaction.objectStore(STORE_SESSIONS);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to clear IndexedDB history.'));
      };
    });
  }
}
