/**
 * @fileoverview Layer 0: Web Bluetooth IoT Biometric Manager.
 * Connects to external Bluetooth Low Energy (BLE) Heart Rate monitors
 * using standard Bluetooth SIG GATT Heart Rate Service (0x180D) and
 * Heart Rate Measurement Characteristic (0x2A37).
 *
 * Implements byte-level flag parsing for:
 * - 8-bit vs 16-bit instantaneous BPM format
 * - Sensor contact status detection
 * - Energy expended field offsets
 * - Sub-millisecond RR-intervals for Heart Rate Variability (HRV) analysis
 * - 5-tier physiological intensity zone classification
 */

/**
 * Standard Bluetooth SIG GATT UUIDs for Heart Rate profile.
 */
export const BLE_UUIDS = {
  HEART_RATE_SERVICE: 'heart_rate', // 0x180D
  HEART_RATE_MEASUREMENT: 'heart_rate_measurement', // 0x2A37
  BATTERY_SERVICE: 'battery_service' // 0x180F
};

/**
 * Physiological Heart Rate Zones and their neon holographic theme tokens.
 */
export const HR_ZONES = {
  ZONE_0: { id: 0, label: 'REST', minPct: 0, maxPct: 50, color: '#94a3b8', bgAlpha: 'rgba(148, 163, 184, 0.2)' },
  ZONE_1: { id: 1, label: 'RECOVERY', minPct: 50, maxPct: 60, color: '#38bdf8', bgAlpha: 'rgba(56, 189, 248, 0.25)' },
  ZONE_2: { id: 2, label: 'AEROBIC', minPct: 60, maxPct: 70, color: '#00ff87', bgAlpha: 'rgba(0, 255, 135, 0.25)' },
  ZONE_3: { id: 3, label: 'TEMPO', minPct: 70, maxPct: 80, color: '#f59e0b', bgAlpha: 'rgba(245, 158, 11, 0.25)' },
  ZONE_4: { id: 4, label: 'THRESHOLD', minPct: 80, maxPct: 90, color: '#f97316', bgAlpha: 'rgba(249, 115, 22, 0.25)' },
  ZONE_5: { id: 5, label: 'REDLINE', minPct: 90, maxPct: 100, color: '#ff0055', bgAlpha: 'rgba(255, 0, 85, 0.3)' }
};

export class BluetoothManager {
  /**
   * @param {number} [maxHeartRate=190] Estimated athlete peak max HR for zone calculations.
   */
  constructor(maxHeartRate = 190) {
    this.maxHeartRate = maxHeartRate;
    this.device = null;
    this.server = null;
    this.hrCharacteristic = null;

    this.isConnected = false;
    this.isSimulated = false;
    this.deviceName = 'Disconnected';

    // Instantaneous biometric cache
    this.currentBpm = 0;
    this.currentZone = HR_ZONES.ZONE_0;
    this.sensorContact = false;
    this.energyExpendedJoules = 0;
    this.lastRRIntervals = [];
    this.lastTimestamp = 0;

    // Simulation timer
    this._simulationInterval = null;

    /** @type {Array<(data: any) => void>} */
    this._listeners = [];

    // Bound handlers
    this._onCharacteristicValueChanged = this._onCharacteristicValueChanged.bind(this);
    this._onGattDisconnected = this._onGattDisconnected.bind(this);
  }

  /**
   * Evaluates if current browser runtime environment supports Web Bluetooth API.
   * @returns {boolean}
   */
  static isSupported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  /**
   * Initiates BLE discovery and connects to GATT Heart Rate service.
   * @returns {Promise<{ deviceName: string, connected: boolean }>}
   */
  async connectHeartRateMonitor() {
    if (!BluetoothManager.isSupported()) {
      throw new Error('Web Bluetooth API is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Android Chrome.');
    }

    try {
      // Disconnect previous session if any
      this.disconnect();

      // Request device with Standard Bluetooth SIG Heart Rate Service
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [BLE_UUIDS.HEART_RATE_SERVICE] }
        ],
        optionalServices: [BLE_UUIDS.BATTERY_SERVICE]
      });

      if (!this.device) {
        throw new Error('No Bluetooth device selected.');
      }

      this.deviceName = this.device.name || 'BLE Heart Rate Strap';
      this.device.addEventListener('gattserverdisconnected', this._onGattDisconnected);

      // Connect to GATT Server
      this.server = await this.device.gatt.connect();

      // Get Heart Rate Service
      const service = await this.server.getPrimaryService(BLE_UUIDS.HEART_RATE_SERVICE);

      // Get Heart Rate Measurement Characteristic (0x2A37)
      this.hrCharacteristic = await service.getCharacteristic(BLE_UUIDS.HEART_RATE_MEASUREMENT);

      // Start notifications
      await this.hrCharacteristic.startNotifications();
      this.hrCharacteristic.addEventListener('characteristicvaluechanged', this._onCharacteristicValueChanged);

      this.isConnected = true;
      this.isSimulated = false;

      return {
        deviceName: this.deviceName,
        connected: true
      };
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  /**
   * Parses standard Bluetooth SIG GATT Heart Rate Measurement byte stream.
   * Specification: org.bluetooth.characteristic.heart_rate_measurement
   * 
   * @param {Event} event
   * @private
   */
  _onCharacteristicValueChanged(event) {
    // @ts-ignore
    const value = event.target.value;
    if (!value || value.byteLength === 0) return;

    // Byte 0: Flags bitfield
    const flags = value.getUint8(0);
    const is16BitHR = (flags & 0x01) !== 0;
    const contactSensorBit = (flags & 0x06) >> 1;
    const energyExpendedPresent = (flags & 0x08) !== 0;
    const rrIntervalsPresent = (flags & 0x10) !== 0;

    let offset = 1;

    // Heart Rate Value (BPM)
    let bpm = 0;
    if (is16BitHR) {
      bpm = value.getUint16(offset, /*littleEndian=*/true);
      offset += 2;
    } else {
      bpm = value.getUint8(offset);
      offset += 1;
    }

    // Contact Sensor Status
    this.sensorContact = contactSensorBit === 3; // 3 = Contact detected

    // Energy Expended (kJ)
    if (energyExpendedPresent && offset + 2 <= value.byteLength) {
      this.energyExpendedJoules = value.getUint16(offset, true) * 1000;
      offset += 2;
    }

    // RR-Intervals (1/1024s resolution -> converted to milliseconds)
    const rrIntervals = [];
    if (rrIntervalsPresent) {
      while (offset + 2 <= value.byteLength) {
        const rawRR = value.getUint16(offset, true);
        const rrMs = Math.round((rawRR / 1024) * 1000);
        rrIntervals.push(rrMs);
        offset += 2;
      }
    }

    this.currentBpm = bpm;
    this.currentZone = this.calculateZone(bpm);
    this.lastRRIntervals = rrIntervals;
    this.lastTimestamp = performance.now();

    this._emitUpdate({
      bpm: this.currentBpm,
      hrZone: this.currentZone,
      zoneNumber: this.currentZone.id,
      sensorContact: this.sensorContact,
      rrIntervals: this.lastRRIntervals,
      timestamp: this.lastTimestamp,
      isSimulated: false
    });
  }

  /**
   * Classifies instantaneous BPM into 5 physiological training zones.
   * @param {number} bpm
   * @returns {typeof HR_ZONES.ZONE_0}
   */
  calculateZone(bpm) {
    if (!bpm || bpm <= 0) return HR_ZONES.ZONE_0;
    const pct = (bpm / this.maxHeartRate) * 100;

    if (pct >= HR_ZONES.ZONE_5.minPct) return HR_ZONES.ZONE_5;
    if (pct >= HR_ZONES.ZONE_4.minPct) return HR_ZONES.ZONE_4;
    if (pct >= HR_ZONES.ZONE_3.minPct) return HR_ZONES.ZONE_3;
    if (pct >= HR_ZONES.ZONE_2.minPct) return HR_ZONES.ZONE_2;
    if (pct >= HR_ZONES.ZONE_1.minPct) return HR_ZONES.ZONE_1;
    return HR_ZONES.ZONE_0;
  }

  /**
   * Subscribes a listener callback to heart rate events.
   * @param {(data: any) => void} callback
   */
  onHeartRateUpdate(callback) {
    if (typeof callback === 'function') {
      this._listeners.push(callback);
    }
  }

  /**
   * Dispatches data to all active listeners.
   * @param {any} data
   * @private
   */
  _emitUpdate(data) {
    for (let i = 0; i < this._listeners.length; i++) {
      try {
        this._listeners[i](data);
      } catch (err) {
        console.warn('BluetoothManager: listener error:', err);
      }
    }
  }

  /**
   * Cleanly terminates GATT connection and removes active listeners.
   */
  disconnect() {
    this._stopSimulation();

    if (this.hrCharacteristic) {
      try {
        this.hrCharacteristic.stopNotifications().catch(() => {});
        this.hrCharacteristic.removeEventListener('characteristicvaluechanged', this._onCharacteristicValueChanged);
      } catch (e) {}
      this.hrCharacteristic = null;
    }

    if (this.device && this.device.gatt.connected) {
      try {
        this.device.gatt.disconnect();
      } catch (e) {}
    }

    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this._onGattDisconnected);
      this.device = null;
    }

    this.server = null;
    this.isConnected = false;
    this.isSimulated = false;
    this.deviceName = 'Disconnected';
    this.currentBpm = 0;
    this.currentZone = HR_ZONES.ZONE_0;
    this.sensorContact = false;
  }

  /**
   * Internal disconnect handler.
   * @private
   */
  _onGattDisconnected() {
    console.log('BluetoothManager: GATT server disconnected.');
    this.isConnected = false;
    this.currentBpm = 0;
    this.currentZone = HR_ZONES.ZONE_0;
    this._emitUpdate({
      bpm: 0,
      hrZone: HR_ZONES.ZONE_0,
      zoneNumber: 0,
      connected: false,
      timestamp: performance.now()
    });
  }

  /**
   * Starts a realistic cardiovascular telemetry simulation for testing without physical BLE hardware.
   * Dynamically elevates BPM when reps are active and gradually recovers at rest.
   * 
   * @param {number} [targetBpm=138] Baseline simulated BPM
   */
  startDemoSimulation(targetBpm = 138) {
    this.disconnect();
    this.isConnected = true;
    this.isSimulated = true;
    this.deviceName = 'Simulated BioStrap (GATT)';
    this.currentBpm = targetBpm;
    this.currentZone = this.calculateZone(this.currentBpm);
    this.sensorContact = true;

    let phase = 0;

    this._simulationInterval = setInterval(() => {
      phase += 0.15;
      // Realistic sinus rhythm micro-fluctuation (+/- 4 bpm)
      const fluctuation = Math.sin(phase) * 3.5 + (Math.random() * 2 - 1);
      const simulatedBpm = Math.round(Math.max(65, Math.min(188, targetBpm + fluctuation)));

      // Approximate instantaneous RR interval in ms from BPM
      const rrMs = Math.round((60 / simulatedBpm) * 1000 + (Math.sin(phase * 1.5) * 20));

      this.currentBpm = simulatedBpm;
      this.currentZone = this.calculateZone(simulatedBpm);
      this.lastRRIntervals = [rrMs];
      this.lastTimestamp = performance.now();

      this._emitUpdate({
        bpm: this.currentBpm,
        hrZone: this.currentZone,
        zoneNumber: this.currentZone.id,
        sensorContact: true,
        rrIntervals: [rrMs],
        timestamp: this.lastTimestamp,
        isSimulated: true
      });
    }, 1000);
  }

  /**
   * Stops active simulated stream.
   * @private
   */
  _stopSimulation() {
    if (this._simulationInterval) {
      clearInterval(this._simulationInterval);
      this._simulationInterval = null;
    }
  }

  /**
   * Adjusts the simulated heart rate based on exercise intensity.
   * @param {number} deltaBpm
   */
  adjustSimulatedBpm(deltaBpm) {
    if (!this.isSimulated) return;
    this.currentBpm = Math.max(70, Math.min(195, this.currentBpm + deltaBpm));
  }

  /**
   * Returns instantaneous telemetry state for frame rendering.
   * @returns {{ bpm: number, hrZone: typeof HR_ZONES.ZONE_0, connected: boolean, isSimulated: boolean, deviceName: string }}
   */
  getHeartRateData() {
    return {
      bpm: this.currentBpm,
      hrZone: this.currentZone,
      connected: this.isConnected,
      isSimulated: this.isSimulated,
      deviceName: this.deviceName
    };
  }
}
