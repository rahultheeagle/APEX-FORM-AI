/**
 * @fileoverview Layer 1: App Glue.
 * Binds UI control panel events to Layer 5 CameraManager commands.
 */

import { CameraManager } from './core/cameraManager.js';

document.addEventListener('DOMContentLoaded', () => {
  const webcam = /** @type {HTMLVideoElement|null} */ (document.getElementById('webcam'));
  const startBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('start-btn'));
  const switchBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('switch-btn'));
  const stopBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('stop-btn'));
  const logContainer = /** @type {HTMLElement|null} */ (document.getElementById('log'));

  if (!webcam || !startBtn || !switchBtn || !stopBtn || !logContainer) {
    console.error('ApexForm AI: Failed to initialize application glue due to missing DOM nodes.');
    return;
  }

  const cameraManager = new CameraManager();

  /**
   * Appends messages to the console container.
   * @param {string} msg Message to write.
   * @param {boolean} [isError=false] Mark as error visually.
   */
  const writeLog = (msg, isError = false) => {
    const time = new Date().toLocaleTimeString();
    const formatted = `[${time}] ${msg}`;
    
    const line = document.createElement('div');
    line.textContent = formatted;
    if (isError) {
      line.classList.add('log-panel__console-line--error');
      console.error(formatted);
    } else {
      console.log(formatted);
    }
    
    logContainer.appendChild(line);
    logContainer.scrollTop = logContainer.scrollHeight;
  };

  /**
   * Updates state of control buttons.
   * @param {boolean} isStreaming True if stream is active.
   */
  const updateUIState = (isStreaming) => {
    startBtn.disabled = isStreaming;
    switchBtn.disabled = !isStreaming;
    stopBtn.disabled = !isStreaming;
  };

  startBtn.addEventListener('click', async () => {
    writeLog('Requesting camera stream...');
    startBtn.disabled = true;

    try {
      const stream = await cameraManager.startStream(webcam);
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        writeLog(`Camera active: ${settings.width}x${settings.height} (${cameraManager.getFacingMode()})`);
      } else {
        writeLog('Camera active, but no video track found.', true);
      }
      updateUIState(true);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorCat = error && typeof error === 'object' && 'category' in error ? error.category : 'ERROR';
      writeLog(`Stream failed: [${errorCat}] ${errorMsg}`, true);
      updateUIState(false);
    }
  });

  switchBtn.addEventListener('click', async () => {
    writeLog('Toggling facing mode...');
    switchBtn.disabled = true;

    try {
      const stream = await cameraManager.toggleCamera();
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        writeLog(`Switched camera: ${settings.width}x${settings.height} (${cameraManager.getFacingMode()})`);
      }
      switchBtn.disabled = false;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorCat = error && typeof error === 'object' && 'category' in error ? error.category : 'ERROR';
      writeLog(`Toggle failed: [${errorCat}] ${errorMsg}`, true);
      switchBtn.disabled = false;
    }
  });

  stopBtn.addEventListener('click', () => {
    writeLog('Releasing video streams...');
    cameraManager.stopStream();
    writeLog('Stream terminated.');
    updateUIState(false);
  });
});
