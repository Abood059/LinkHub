const path = require('path');
const fs = require('fs');
const ProcessManager = require('./process.manager.service');
const errorService = require('./error.central.service');

class ScrcpyService {
    constructor() {
        // Auto-detect development mode using Electron's app.isPackaged
        let electronApp;
        try { 
            electronApp = require('electron').app; 
        } catch {}
        this._isDev = electronApp ? !electronApp.isPackaged : true;
        
        this.binPath = null;
        this.scrcpyPath = null;
        this._permissionsEnsured = false;
        this._activeSessions = new Set(); // Track active scrcpy sessions
    }

    /**
     * Initialize service with configuration options
     * Can override auto-detected development mode and paths
     */
    init(options = {}) {
        this._isDev = options.isDev !== undefined ? Boolean(options.isDev) : this._isDev;
        this.binPath = options.binPath || null;
        this.scrcpyPath = options.scrcpyPath || null;
    }

    /**
     * Get the resolved binary path for scrcpy executable
     */
    getBinaryPath() {
        if (this.scrcpyPath) {
            return this.scrcpyPath;
        }

        const platform = process.platform;
        const isWin = platform === 'win32';
        const binDir = isWin ? 'win64' : 'linux';
        const exeName = isWin ? 'scrcpy.exe' : 'scrcpy';

        const baseBinPath = this.binPath || (
            this._isDev
                ? path.join(__dirname, '..', '..', 'resources', 'bin')
                : path.join(process.resourcesPath, 'bin')
        );

        return path.join(baseBinPath, binDir, exeName);
    }

    /**
     * Sanitize argument value using regex pattern
     * Returns cleaned string or null if completely empty after sanitization
     */
    _sanitizeArg(value, regex) {
        if (typeof value !== 'string') return null;
        const cleaned = value.replace(regex, '');
        return cleaned.length > 0 ? cleaned : null;
    }

    /**
     * Ensure Linux executable permissions
     * Called only once on first execution
     */
    _ensurePermissions(binPath) {
        if (this._permissionsEnsured || process.platform !== 'linux') {
            return true;
        }

        try {
            if (fs.existsSync(binPath)) {
                fs.chmodSync(binPath, '755');
                this._permissionsEnsured = true;
                return true;
            } else {
                errorService.report({
                    type: 'SCRCPY',
                    severity: 'CRITICAL',
                    message: `Scrcpy executable not found at path: ${binPath}`,
                    id: 'system'
                });
                return false;
            }
        } catch (err) {
            errorService.report({
                type: 'SCRCPY',
                severity: 'HIGH',
                message: `Failed to set execute permissions on scrcpy binary: ${err.message}`,
                id: 'system'
            });
            return false;
        }
    }

    /**
     * Validate device object and connection parameters
     */
    _validateDevice(device) {
        if (!device || typeof device !== 'object') {
            errorService.report({
                type: 'SCRCPY',
                severity: 'HIGH',
                message: 'Invalid device object: must be an object',
                id: 'unknown'
            });
            return false;
        }

        if (!device.id || typeof device.id !== 'string' || device.id.trim().length === 0) {
            errorService.report({
                type: 'SCRCPY',
                severity: 'HIGH',
                message: 'Invalid device: missing or empty device.id',
                id: 'unknown'
            });
            return false;
        }

        const connectionType = String(device.connectionType || '').toLowerCase();
        if (connectionType === 'wireless') {
            const hasWirelessTarget = device.adbTarget || (device.ip && device.port);
            if (!hasWirelessTarget) {
                errorService.report({
                    type: 'SCRCPY',
                    severity: 'HIGH',
                    message: 'Wireless device missing IP:Port or adbTarget configuration',
                    id: device.id
                });
                return false;
            }
        }

        return true;
    }

    /**
     * Build sanitized command arguments for scrcpy
     */
    _buildArgs(device, options) {
        // Sanitize serial/IP:Port target
        const isWireless = String(device.connectionType || '').toLowerCase() === 'wireless';
        const rawAdbTarget = isWireless
            ? (device.adbTarget || (device.ip && device.port ? `${device.ip}:${device.port}` : device.id))
            : device.id;
        
        const adbTarget = this._sanitizeArg(rawAdbTarget, /[^a-zA-Z0-9\.\:\-\_]/g);
        if (!adbTarget) {
            errorService.report({
                type: 'SCRCPY',
                severity: 'HIGH',
                message: 'Invalid device target: contains disallowed characters',
                id: device.id
            });
            return null;
        }

        // Sanitize window title
        const rawTitle = device.deviceFriendlyName || device.model || 'LinkHub Device';
        const windowTitle = this._sanitizeArg(rawTitle, /[^\u0621-\u064A\u0660-\u0669a-zA-Z0-9\s\-_\.\(\)]/g);
        if (!windowTitle) {
            errorService.report({
                type: 'SCRCPY',
                severity: 'HIGH',
                message: 'Invalid window title: contains disallowed characters',
                id: device.id
            });
            return null;
        }

        // Validate and sanitize max FPS with bounds (1-240)
        const rawMaxFps = String(options.maxFps || '60');
        const maxFpsValid = rawMaxFps.match(/^\d+$/);
        let maxFps = maxFpsValid ? rawMaxFps : '60';
        
        // Apply bounds validation
        const maxFpsNum = parseInt(maxFps);
        if (maxFpsNum < 1 || maxFpsNum > 240) {
            errorService.report({
                type: 'SCRCPY',
                severity: 'LOW',
                message: `Invalid maxFps value: ${maxFpsNum}, using default 60`,
                id: device.id
            });
            maxFps = '60';
        }

        // Validate and sanitize bitrate with proper unit conversion
        const rawBitrate = options.videoBitRate || '4M';
        const bitrateMatch = rawBitrate.match(/^(\d+)([KM]?)$/i);
        let bitrate;
        if (!bitrateMatch) {
            bitrate = '4M';
            errorService.report({
                type: 'SCRCPY',
                severity: 'LOW',
                message: `Invalid bitrate format: ${rawBitrate}, using default 4M`,
                id: device.id
            });
        } else {
            const num = parseInt(bitrateMatch[1]);
            const unit = bitrateMatch[2].toUpperCase();
            let mbps;
            if (unit === 'M') mbps = num;
            else if (unit === 'K') mbps = num / 1000;
            else mbps = num / 1000000;

            if (mbps < 0.1 || mbps > 100) {
                bitrate = '4M';
                errorService.report({
                    type: 'SCRCPY',
                    severity: 'LOW',
                    message: `Bitrate ${rawBitrate} (${mbps.toFixed(1)} Mbps) out of range, using default 4M`,
                    id: device.id
                });
            } else {
                bitrate = rawBitrate;
            }
        }

        return [
            '-s', adbTarget,
            '--window-title', `LinkHub: ${windowTitle}`,
            '--video-bit-rate', bitrate,
            '--max-fps', maxFps,
            '-w', // stay-awake
            '--power-off-on-close',
            '--audio-buffer', '50'
        ];
    }

    /**
     * Start screen mirroring for specified device
     * Returns ChildProcess or null on failure
     */
    startMirroring(device, options = {}) {
        // Validate device object first
        if (!this._validateDevice(device)) {
            return null;
        }

        // Ensure binary permissions on first execution
        const binPath = this.getBinaryPath();
        if (!this._ensurePermissions(binPath)) {
            return null;
        }

        // Build command arguments with sanitization
        const args = this._buildArgs(device, options);
        if (!args) {
            return null;
        }

        // Generate unique process ID
        const processId = `scrcpy-${device.id}`;

        // Set up process log buffer size
        const maxBufferSize = 
            typeof options.processLogBufferSize === 'number' && options.processLogBufferSize > 0
                ? options.processLogBufferSize
                : 100;

        // Execute process through ProcessManager
        const processRef = ProcessManager.execute(
            processId,
            binPath,
            args,
            'scrcpy',
            (data, stream) => {
                if (stream === 'stderr') {
                    const dataString = data.toString();
                    
                    // Safe callback invocation
                    if (typeof options.onProcessError === 'function') {
                        try {
                            options.onProcessError(dataString);
                        } catch (callbackErr) {
                            errorService.report({
                                type: 'SCRCPY',
                                severity: 'LOW',
                                message: `Error in onProcessError callback: ${callbackErr.message}`,
                                id: device.id
                            });
                        }
                    }

                    // Log scrcpy-specific errors through ErrorCentralService
                    if (dataString.includes('ERROR: Could not find any ADB device')) {
                        errorService.report({
                            type: 'SCRCPY',
                            severity: 'HIGH',
                            message: 'ADB device not found - ensure device is connected and USB debugging enabled',
                            id: device.id
                        });
                    } else if (dataString.includes('ERROR: Device is unauthorized')) {
                        errorService.report({
                            type: 'SCRCPY',
                            severity: 'HIGH',
                            message: 'Device unauthorized - allow USB debugging on device screen',
                            id: device.id
                        });
                    } else if (dataString.includes('ERROR: Could not execute "adb"')) {
                        errorService.report({
                            type: 'SCRCPY',
                            severity: 'HIGH',
                            message: 'ADB executable not found or not in PATH',
                            id: device.id
                        });
                    }
                }
            },
            maxBufferSize
        );

        // Handle ProcessManager returning null (spawn failure)
        if (!processRef) {
            errorService.report({
                type: 'SCRCPY',
                severity: 'HIGH',
                message: 'Failed to spawn scrcpy process - ProcessManager returned null',
                id: device.id
            });
            return null;
        }

        // Add to active sessions tracking
        this._activeSessions.add(processId);

        // Set up exit event handler with safe callback
        if (typeof options.onProcessExit === 'function') {
            processRef.on('exit', (code) => {
                // Remove from active sessions on exit
                this._activeSessions.delete(processId);
                
                try {
                    // Interpret exit codes
                    if (code === 2) {
                        errorService.report({
                            type: 'SCRCPY',
                            severity: 'LOW',
                            message: 'Device disconnected during scrcpy session',
                            id: device.id
                        });
                    }
                    options.onProcessExit(code);
                } catch (callbackErr) {
                    errorService.report({
                        type: 'SCRCPY',
                        severity: 'LOW',
                        message: `Error in onProcessExit callback: ${callbackErr.message}`,
                        id: device.id
                    });
                }
            });
        }

        // Set up error event handler with safe callback
        if (typeof options.onSpawnError === 'function') {
            processRef.on('error', (error) => {
                try {
                    options.onSpawnError(error);
                } catch (callbackErr) {
                    errorService.report({
                        type: 'SCRCPY',
                        severity: 'LOW',
                        message: `Error in onSpawnError callback: ${callbackErr.message}`,
                        id: device.id
                    });
                }
            });
        }

        return processRef;
    }

    /**
     * Stop screen mirroring for specified device
     * Returns boolean indicating success
     */
    stopMirroring(deviceId) {
        const processId = `scrcpy-${deviceId}`;
        const success = ProcessManager.terminate(processId);
        
        // Remove from active sessions regardless of success
        this._activeSessions.delete(processId);
        
        if (!success) {
            errorService.report({
                type: 'SCRCPY',
                severity: 'LOW',
                message: `Failed to terminate scrcpy process for device: ${deviceId}`,
                id: deviceId
            });
        }
        
        return success;
    }

    /**
     * Check if device is currently being mirrored
     * Returns boolean indicating mirroring status
     */
    isMirroring(deviceId) {
        const processId = `scrcpy-${deviceId}`;
        const status = ProcessManager.getProcessStatus(processId);
        return status && status.type === 'scrcpy';
    }

    /**
     * Destroy all active scrcpy sessions on application shutdown
     * Terminates all processes started by this service
     */
    destroy() {
        try {
            // Create a copy of active sessions to avoid modification during iteration
            const sessions = Array.from(this._activeSessions);
            
            for (const sessionId of sessions) {
                ProcessManager.terminate(sessionId);
            }
            
            // Clear all sessions
            this._activeSessions.clear();
            
            errorService.report({
                type: 'SCRCPY',
                severity: 'LOW',
                message: `Terminated ${sessions.length} scrcpy sessions during application shutdown`,
                id: 'system'
            });
        } catch (err) {
            errorService.report({
                type: 'SCRCPY',
                severity: 'LOW',
                message: `Error during scrcpy service cleanup: ${err.message}`,
                id: 'system'
            });
        }
    }
}

module.exports = new ScrcpyService();
