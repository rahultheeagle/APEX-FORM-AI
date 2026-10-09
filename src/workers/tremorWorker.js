/**
 * @fileoverview Dedicated Off-Thread Web Worker for Neuromuscular CNS Micro-Tremor FFT Analysis.
 * Computes Radix-2 Cooley-Tukey Fast Fourier Transform (FFT) over 128-sample sliding coordinate windows
 * and calculates Power Spectral Density (PSD) within the physiological tremor band (8 Hz - 12 Hz).
 */

const N = 128;
const LOG2_N = 7;

// Pre-computed Bit-Reversal Table for N=128
const BIT_REV = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  let rev = 0;
  for (let bit = 0; bit < LOG2_N; bit++) {
    if ((i >> bit) & 1) {
      rev |= (1 << (LOG2_N - 1 - bit));
    }
  }
  BIT_REV[i] = rev;
}

// Pre-computed Sine/Cosine Twiddle Factor Tables for N=128
const COS_TABLE = new Float32Array(N);
const SIN_TABLE = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const angle = (-2.0 * Math.PI * i) / N;
  COS_TABLE[i] = Math.cos(angle);
  SIN_TABLE[i] = Math.sin(angle);
}

// Pre-allocated static buffers to avoid GC allocations
const realBuffer = new Float32Array(N);
const imagBuffer = new Float32Array(N);

/**
 * Computes in-place Radix-2 Cooley-Tukey Decimation-in-Time FFT.
 *
 * @param {Float32Array} real Real component buffer (must be bit-reversed before call).
 * @param {Float32Array} imag Imaginary component buffer (zeros).
 */
function radix2FFT(real, imag) {
  for (let s = 2; s <= N; s <<= 1) {
    const m = s >> 1;
    const step = N / s;

    for (let j = 0; j < m; j++) {
      const twiddleIdx = j * step;
      const wr = COS_TABLE[twiddleIdx];
      const wi = SIN_TABLE[twiddleIdx];

      for (let k = j; k < N; k += s) {
        const match = k + m;
        const tr = real[match] * wr - imag[match] * wi;
        const ti = real[match] * wi + imag[match] * wr;

        real[match] = real[k] - tr;
        imag[match] = imag[k] - ti;
        real[k] += tr;
        imag[k] += ti;
      }
    }
  }
}

/**
 * Evaluates CNS Tremor Ratio from 128-sample sliding window.
 *
 * @param {Float32Array} input 128-sample displacement delta series.
 * @returns {{ tremorRatio: number, isFatigued: boolean }}
 */
function analyzeTremor(input) {
  if (!input || input.length < N) {
    return { tremorRatio: 1.0, isFatigued: false };
  }

  // 1. Mean-centering (DC offset elimination)
  let sum = 0.0;
  for (let i = 0; i < N; i++) {
    sum += input[i];
  }
  const mean = sum / N;

  // 2. Load into bit-reversed position
  for (let i = 0; i < N; i++) {
    realBuffer[BIT_REV[i]] = input[i] - mean;
    imagBuffer[i] = 0.0;
  }

  // 3. Compute Radix-2 FFT
  radix2FFT(realBuffer, imagBuffer);

  // 4. Power Spectral Density (PSD) calculation
  // Sampling rate Fs = 60 Hz, N = 128 => Bin resolution delta_f = 60 / 128 = 0.46875 Hz
  // Physiological tremor band: 8 Hz - 12 Hz
  // k_8Hz = round(8 / 0.46875) = 17 (7.97 Hz)
  // k_12Hz = round(12 / 0.46875) = 26 (12.19 Hz)
  let tremorPowerSum = 0.0;
  for (let k = 17; k <= 26; k++) {
    const p = realBuffer[k] * realBuffer[k] + imagBuffer[k] * imagBuffer[k];
    tremorPowerSum += p;
  }
  const tremorPowerMean = tremorPowerSum / 10.0;

  // Reference baseline noise band (13.1 Hz - 28.1 Hz, bins 28 to 60)
  let baselinePowerSum = 0.0;
  for (let k = 28; k <= 60; k++) {
    const p = realBuffer[k] * realBuffer[k] + imagBuffer[k] * imagBuffer[k];
    baselinePowerSum += p;
  }
  const baselinePowerMean = (baselinePowerSum / 33.0) + 1e-7;

  // Compute normalized Tremor Ratio
  let ratio = tremorPowerMean / baselinePowerMean;
  if (!Number.isFinite(ratio) || ratio < 0.1) {
    ratio = 1.0;
  }

  const roundedRatio = Number(ratio.toFixed(2));
  const isFatigued = roundedRatio > 3.5;

  return {
    tremorRatio: roundedRatio,
    isFatigued
  };
}

// Handle incoming messages from CnsMonitor
self.onmessage = function (e) {
  if (!e.data || !e.data.buffer) {
    return;
  }

  const inputBuffer = e.data.buffer;
  const result = analyzeTremor(inputBuffer);

  // Transfer array buffer back to parent thread to maintain zero GC overhead
  self.postMessage({
    tremorRatio: result.tremorRatio,
    isFatigued: result.isFatigued,
    buffer: inputBuffer
  }, [inputBuffer.buffer]);
};
