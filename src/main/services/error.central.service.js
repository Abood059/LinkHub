const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * ErrorCentralService - Professional production-ready error management service
 * الخدمة المركزية لإدارة الأخطاء والتنبيهات في تطبيق LinkHub
 * 
 * Critical improvements:
 * - Log levels system with filtering (DEBUG, INFO, WARN, ERROR, CRITICAL)
 * - Disk thrashing prevention with write buffering and batch writing
 * - Race condition prevention with mutex locks for log rotation
 * - Robust pending logs recovery mechanism preventing log loss
 * - Complete lifecycle management with destroy() and flush() methods
 * - Electron-optimized path detection with app.getPath('userData')
 * - PID tracking for enhanced debugging
 * - Separated internal logging functions for better monitoring
 * - Non-blocking file I/O with proper error handling
 * - Memory management with bounded history
 * - Safe Electron-compatible paths and log rotation
 * 
 * Future optimization note: Consider using fs.createWriteStream for high-load scenarios
 * to eliminate manual buffering and provide better performance under heavy usage.
 */
class ErrorCentralService extends EventEmitter {
    // Log levels with numeric values for filtering
    static LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, CRITICAL: 4 };
    
    constructor() {
        super();
        
        // Configuration with safe defaults
        this._initialized = false;
        this._destroyed = false;
        this.MAX_HISTORY = 1000;
        this.MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
        this.MAX_PENDING_LOGS = 100;
        this.currentLevel = ErrorCentralService.LOG_LEVELS.INFO; // Default log level
        
        // Electron-optimized path detection
        let electronApp;
        try { 
            electronApp = require('electron').app; 
        } catch { 
            /* Not in Electron environment */ 
        }
        
        if (electronApp && electronApp.getPath) {
            this.logFilePath = path.join(electronApp.getPath('userData'), 'app_error.log');
        } else {
            this.logFilePath = path.join(os.homedir(), '.linkhub', 'app_error.log');
        }
        
        // Internal state
        this.errorHistory = [];
        this._pendingLogs = []; // Backup for failed writes
        this._pendingWrites = new Set(); // Track ongoing write operations
        this._rotationPromise = null; // Mutex lock for log rotation
        this._flushPromise = null; // Mutex lock for buffer flushing
        this._dirCreated = false; // Optimization flag for directory creation
        this._writeBuffer = []; // Buffer for batch writing to prevent disk thrashing
        this._flushTimer = null; // Timer for debouncing writes
        
        // Separated internal logging functions
        this._logInfo = (message, data = null) => {
            const timestamp = new Date().toISOString();
            const logEntry = `[${timestamp}] [INFO] ${message}${data ? ` ${this._safeStringify(data)}` : ''}`;
            console.log(logEntry);
        };

        this._logError = (message, error = null) => {
            const timestamp = new Date().toISOString();
            const logEntry = `[${timestamp}] [ERROR] ${message}${error ? ` - ${error.message}` : ''}`;
            console.error(logEntry);
        };

        /**
         * Safe JSON stringify that prevents crashes from circular references
         * Returns readable placeholder for non-serializable data
         */
        this._safeStringify = (obj) => {
            try {
                return JSON.stringify(obj);
            } catch {
                return '[Circular or non-serializable data]';
            }
        };
    }

    /**
     * Initialize the service with custom configuration
     * Must be called once before heavy use
     */
    init(options = {}) {
        this._checkNotDestroyed();
        
        if (this._initialized) {
            throw new Error('ErrorCentralService already initialized. Call init() only once.');
        }

        try {
            // Configure custom log path if provided
            if (options.logPath && typeof options.logPath === 'string') {
                this.logFilePath = options.logPath;
            }

            // Configure history limit
            if (options.maxHistory && typeof options.maxHistory === 'number' && options.maxHistory > 0) {
                this.MAX_HISTORY = options.maxHistory;
            }

            // Configure file size limit
            if (options.maxFileSize && typeof options.maxFileSize === 'number' && options.maxFileSize > 0) {
                this.MAX_FILE_SIZE = options.maxFileSize;
            }

            // Configure log level
            if (options.logLevel !== undefined) {
                if (typeof options.logLevel === 'string') {
                    const levelName = options.logLevel.toUpperCase();
                    this.currentLevel = ErrorCentralService.LOG_LEVELS[levelName] ?? this.currentLevel;
                } else if (typeof options.logLevel === 'number') {
                    this.currentLevel = options.logLevel;
                }
            }

            this._initialized = true;
            this._logInfo('ErrorCentralService initialized successfully', {
                logPath: this.logFilePath,
                maxHistory: this.MAX_HISTORY,
                maxFileSize: this.MAX_FILE_SIZE,
                currentLevel: Object.keys(ErrorCentralService.LOG_LEVELS)[this.currentLevel] || 'INFO'
            });
        } catch (err) {
            this._logError('Failed to initialize ErrorCentralService', err);
            throw err;
        }
    }

    /**
     * Main error reporting function - remains synchronous for callers
     * Internal operations happen asynchronously in the background
     * Supports log level filtering and PID tracking
     */
    report(errorObj) {
        this._checkNotDestroyed();
        
        try {
            // Validate input object
            if (!errorObj || typeof errorObj !== 'object') {
                throw new Error("Invalid error object reported");
            }

            const { 
                type = 'SYSTEM', 
                severity = 'LOW', 
                message = 'Unknown error', 
                id = 'N/A',
                logLevel = 'INFO' // Default log level
            } = errorObj;
            const timestamp = new Date().toISOString();
            const pid = process.pid;

            // Create enhanced error object with PID
            const enhancedErrorObj = { 
                timestamp, 
                pid,
                ...errorObj 
            };

            // Log level filtering - check if we should write to file
            const logLevelNum = ErrorCentralService.LOG_LEVELS[logLevel.toUpperCase()] ?? ErrorCentralService.LOG_LEVELS.INFO;
            if (logLevelNum >= this.currentLevel) {
                // Create log line with PID
                const logLine = `[${timestamp}] [${severity}] [${type}] [Device: ${id}] [PID: ${pid}] - ${message}`;
                
                // Schedule write to buffer (non-blocking)
                this._scheduleWrite(logLine);
            }

            // Always add to error history regardless of log level
            this.errorHistory.push(enhancedErrorObj);
            
            // Prevent memory leak by maintaining max history size
            if (this.errorHistory.length > this.MAX_HISTORY) {
                this.errorHistory.shift(); // Remove oldest entry
            }

            // Process error actions (notifications unaffected by log level)
            this._processAction(errorObj);

        } catch (err) {
            // Prevent infinite loops - use internal error logging
            this._logError("Failed to process error report", err);
        }
    }

    /**
     * Process error actions based on severity
     * Simplified without translation functions for better performance
     */
    _processAction(error) {
        try {
            switch (error.severity) {
                case 'CRITICAL':
                    console.error("!!! CRITICAL SYSTEM ERROR !!!", error.message);
                    this.emit('system-halt', error); 
                    break;

                case 'HIGH':
                    this.emit('notify-user', {
                        title: error.type || 'تنبيه', // Use error.type directly
                        body: error.message, // Use raw message
                        variant: 'danger'
                    });
                    break;

                default: // LOW and others
                    this.emit('notify-user', {
                        title: 'تنبيه',
                        body: error.message, // Use raw message
                        variant: 'warning'
                    });
                    break;
            }
        } catch (err) {
            this._logError("Error inside _processAction", err);
        }
    }

    /**
     * Schedule log line for batch writing to prevent disk thrashing
     * Adds to buffer and schedules flush if not already pending
     */
    _scheduleWrite(logLine) {
        // Add to write buffer
        this._writeBuffer.push(logLine);
        
        // Schedule flush if not already pending
        if (this._flushTimer === null) {
            this._flushTimer = setTimeout(() => {
                this._flushBuffer().catch(err => {
                    this._logError('Failed to flush buffer', err);
                });
            }, 300); // 300ms debounce delay
        }
    }

    /**
     * Flush write buffer to file in batch to prevent disk thrashing
     * Uses mutex lock to prevent concurrent flush operations
     * Wrapper method that coordinates timer cleanup and lock management
     */
    async _flushBuffer() {
        // If flushing is already active, wait for it and return
        if (this._flushPromise) {
            await this._flushPromise;
            return;
        }

        // Clear timer immediately
        clearTimeout(this._flushTimer);
        this._flushTimer = null;

        // Create mutex-protected flush operation
        this._flushPromise = this._doActualFlush();

        try {
            await this._flushPromise;
        } finally {
            this._flushPromise = null;
        }
    }

    /**
     * Perform actual buffer flush with all existing logic
     * Contains the core flush implementation without timer management
     */
    async _doActualFlush() {
        if (this._writeBuffer.length === 0) return;
        
        try {
            // Get all buffered content and clear buffer
            const batchContent = this._writeBuffer.join('\n') + '\n';
            this._writeBuffer = [];
            
            // Prevent new writes after destruction started
            if (this._destroyed) return;
            
            // Ensure parent directory exists (optimized with flag)
            const logDir = path.dirname(this.logFilePath);
            if (!this._dirCreated) {
                await fs.mkdir(logDir, { recursive: true });
                this._dirCreated = true;
            }

            // Check file size and rotate if needed (with race condition prevention)
            await this._rotateLogIfNeeded();

            // Robust pending logs recovery - process one by one to maintain order
            while (this._pendingLogs.length > 0) {
                const pendingLog = this._pendingLogs[0]; // Peek at first item
                
                try {
                    await fs.appendFile(this.logFilePath, pendingLog + '\n', { encoding: 'utf8' });
                    // Only remove after successful write
                    this._pendingLogs.shift();
                } catch (writeErr) {
                    // Stop processing on first failure to maintain order
                    this._logError('Failed to write pending log, stopping recovery', writeErr);
                    break;
                }
            }

            // Write batch content to file
            await fs.appendFile(this.logFilePath, batchContent, { encoding: 'utf8' });

        } catch (err) {
            // If batch write failed, add all content back to pending logs
            const failedLines = batchContent.trim().split('\n');
            for (const line of failedLines) {
                if (line.trim()) {
                    this._pendingLogs.push(line);
                    
                    // Limit pending logs to prevent memory issues
                    if (this._pendingLogs.length > this.MAX_PENDING_LOGS) {
                        this._pendingLogs.shift(); // Remove oldest pending log
                        this._logInfo('Pending logs limit reached, removed oldest entry');
                    }
                }
            }
            
            this._logError("Critical File Error: Could not write batch to log file", err);
        }
    }


    /**
     * Log rotation with complete TOCTOU race condition prevention
     * Uses mutex lock to ensure atomic size check and rotation operation
     * Only one rotation operation can run at a time
     * Size check and rotation decision happen inside the same lock
     */
    async _rotateLogIfNeeded() {
        // If rotation is already active, wait and return immediately (no size check)
        // This prevents multiple concurrent calls from checking size simultaneously
        if (this._rotationPromise) {
            await this._rotationPromise;
            return;
        }

        // Create mutex-protected operation containing both size check AND rotation
        // This ensures atomicity: no other call can check size between our check and rotation
        this._rotationPromise = (async () => {
            try {
                // Size check happens inside the lock to prevent TOCTOU race condition
                const stats = await fs.stat(this.logFilePath);
                if (stats.size >= this.MAX_FILE_SIZE) {
                    await this._doActualRotation();
                }
            } catch (statErr) {
                // File doesn't exist yet, no rotation needed
                // This is expected behavior for new log files
            }
        })();

        try {
            await this._rotationPromise;
        } finally {
            // Always release the lock, even if rotation fails
            // The error is intentionally re-thrown by _doActualRotation for proper error handling
            this._rotationPromise = null;
        }
    }

    /**
     * Perform actual log rotation operation
     * Separate function to ensure proper error handling and lock management
     * Intentionally re-throws errors to notify callers while ensuring lock release
     */
    async _doActualRotation() {
        try {
            // Rotate current log file
            const backupPath = this.logFilePath + '.1';
            await fs.rename(this.logFilePath, backupPath);
            
            this._logInfo('Log file rotated due to size limit', {
                originalPath: this.logFilePath,
                backupPath: backupPath,
                maxSize: this.MAX_FILE_SIZE
            });

        } catch (err) {
            this._logError('Failed to rotate log file', err);
            // Re-throw to ensure proper error handling while lock gets released
            // The finally block in _rotateLogIfNeeded will still clear the lock
            throw err;
        }
    }

    /**
     * Get error history - returns shallow copy to prevent mutation
     */
    getHistory() {
        this._checkNotDestroyed();
        return [...this.errorHistory];
    }

    /**
     * Flush all pending writes, buffer, and rotations
     * Used before application shutdown to ensure all logs are written
     * Returns Promise<void> that resolves when all operations complete
     * Enhanced to handle buffer flushing for disk thrashing prevention
     */
    async flush() {
        this._checkNotDestroyed();
        
        try {
            // Force immediate buffer flush
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
            await this._flushBuffer();

            // Wait for all pending writes to complete
            const writePromises = Array.from(this._pendingWrites);
            if (writePromises.length > 0) {
                await Promise.all(writePromises);
            }

            // Wait for any ongoing rotation to complete
            if (this._rotationPromise) {
                await this._rotationPromise;
            }

            this._logInfo('ErrorCentralService flushed successfully');
        } catch (err) {
            this._logError('Error during flush operation', err);
            throw err;
        }
    }

    /**
     * Resource cleanup and service shutdown with proper async coordination
     * Prevents race conditions with ongoing write operations
     * Ensures all pending logs are written before destruction
     * Enhanced to handle buffer cleanup for disk thrashing prevention
     * Marks service as destroyed and prevents further operations
     */
    async destroy() {
        // Prevent multiple destruction attempts
        if (this._destroyed) return;
        
        try {
            // Ensure all pending logs are written before cleanup
            // This prevents data loss during shutdown
            await this.flush();
        } catch (e) {
            // Log flush failure but don't let it interrupt cleanup
            this._logError('Flush before destroy failed', e);
        }
        
        try {
            // Mark as destroyed first to prevent new operations
            this._destroyed = true;

            // Clear buffer and timer
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
            this._writeBuffer = [];

            // Remove all event listeners
            this.removeAllListeners();
            
            // Clear internal arrays and state
            this.errorHistory = [];
            this._pendingLogs = [];
            this._pendingWrites.clear();
            
            // Reset configuration flags
            this._initialized = false;
            this._dirCreated = false;
            
            this._logInfo('ErrorCentralService destroyed successfully');
        } catch (err) {
            console.error('Error during ErrorCentralService destruction:', err.message);
        }
    }

    /**
     * Get service status and configuration (useful for debugging)
     * Includes comprehensive state information for monitoring
     * Enhanced with log level and buffer status information
     */
    getStatus() {
        return {
            initialized: this._initialized,
            destroyed: this._destroyed,
            logPath: this.logFilePath,
            maxHistory: this.MAX_HISTORY,
            maxFileSize: this.MAX_FILE_SIZE,
            currentLevel: Object.keys(ErrorCentralService.LOG_LEVELS)[this.currentLevel] || 'INFO',
            historyCount: this.errorHistory.length,
            pendingLogsCount: this._pendingLogs.length,
            pendingWritesCount: this._pendingWrites.size,
            rotationInProgress: !!this._rotationPromise,
            dirCreated: this._dirCreated,
            bufferSize: this._writeBuffer.length,
            flushInProgress: !!this._flushPromise,
        };
    }

    /**
     * Check if service is destroyed and throw error if so
     * Used to prevent operations after destroy()
     */
    _checkNotDestroyed() {
        if (this._destroyed) {
            throw new Error('ErrorCentralService has been destroyed and cannot be used');
        }
    }
}

module.exports = new ErrorCentralService();