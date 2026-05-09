const path = require('path');
const { VideoFile, AudioFile } = require('../models');

/**
 * YtDlpService
 * Singleton service for managing yt-dlp tool operations
 */
class YtDlpService {
    constructor() {
        // Resolve yt-dlp path based on platform
        this.ytDlpPath = process.platform === 'win32'
            ? path.join(__dirname, '../../resources/bin/win/yt-dlp.exe')
            : path.join(__dirname, '../../resources/bin/linux/yt-dlp_linux');
        
        // Map to store active download files
        this._activeFiles = new Map();
        
        // Import required services
        this.processManager = require('./process.manager.service');
        this.errorCentralService = require('./error.central.service');
    }

    /**
     * Inspect a URL to get available video and audio formats
     * @param {string} url - The URL to inspect
     * @returns {Promise<{ videos: VideoFile[], audios: AudioFile[] }>}
     */
    async inspectLink(url) {
        const command = `"${this.ytDlpPath}" -J "${url}"`;
        const options = { timeout: 30000 };
        
        try {
            const stdout = await this.processManager.executeQuickTask(command, options);
            const data = JSON.parse(stdout);
            
            const videos = [];
            const audios = [];
            
            if (data.formats && Array.isArray(data.formats)) {
                for (const format of data.formats) {
                    const baseInfo = {
                        formatId: format.format_id,
                        sourceUrl: url,
                        name: data.title ? `${data.title}.${format.ext}` : `video.${format.ext}`,
                        extension: format.ext || 'unknown',
                        codec: format.vcodec || format.acodec || 'unknown',
                        fileSizeApprox: format.filesize ? parseInt(format.filesize) : null
                    };
                    
                    // Determine if this is a video format (contains video)
                    if (format.vcodec && format.vcodec !== 'none') {
                        videos.push(new VideoFile({
                            ...baseInfo,
                            resolution: format.resolution || `${format.width || 'unknown'}x${format.height || 'unknown'}`,
                            fps: format.fps ? parseFloat(format.fps) : null,
                            width: format.width ? parseInt(format.width) : null,
                            height: format.height ? parseInt(format.height) : null
                        }));
                    }
                    // Pure audio format
                    else if (format.acodec && format.acodec !== 'none') {
                        audios.push(new AudioFile({
                            ...baseInfo,
                            abr: format.abr ? parseFloat(format.abr) : null
                        }));
                    }
                }
            }
            
            return { videos, audios };
            
        } catch (err) {
            this.errorCentralService.report({
                type: 'YT-DLP',
                severity: 'HIGH',
                message: `inspectLink failed: ${err.message}`,
                id: url
            });
            throw new Error(`فشل فحص الرابط: ${err.message}`);
        }
    }

    /**
     * Start downloading a file (with optional secondary file for merging)
     * @param {VideoFile|AudioFile} file - The primary file to download
     * @param {VideoFile|AudioFile|null} secondaryFile - Optional secondary file for merging
     */
    startDownload(file, secondaryFile = null) {
        if (!file || !file.storagePath) {
            throw new Error('File and storagePath are required');
        }
        
        if (secondaryFile && file.type === secondaryFile.type) {
            throw new Error('يجب أن يكون أحد الملفين فيديو والآخر صوت للدمج.');
        }
        
        // Build format argument
        let formatArg;
        if (secondaryFile) {
            formatArg = `-f ${file.formatId}+${secondaryFile.formatId}`;
        } else {
            formatArg = `-f ${file.formatId}`;
        }
        
        const args = [
            formatArg,
            '--newline',
            '--progress',
            '--progress-template',
            '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.total_bytes)d|%(progress.downloaded_bytes)d',
            '-o',
            file.storagePath,
            file.sourceUrl
        ];
        
        // Store files in active files map
        this._activeFiles.set(file.id, { primary: file, secondary: secondaryFile });
        
        // Execute via ProcessManager
        this.processManager.execute(
            file.id,
            this.ytDlpPath,
            args,
            'yt-dlp',
            (line, streamType) => {
                this._handleProgressLine(file.id, line, streamType);
            },
            200
        );
    }

    /**
     * Handle progress output from yt-dlp process
     * @param {string} fileId - The file ID
     * @param {string} line - The output line
     * @param {string} streamType - The stream type ('stdout' or 'stderr')
     */
    _handleProgressLine(fileId, line, streamType) {
        const entry = this._activeFiles.get(fileId);
        if (!entry) return;
        
        const { primary: file, secondary: secondaryFile } = entry;
        
        if (streamType === 'stderr') {
            this.errorCentralService.report({
                type: 'YT-DLP',
                severity: 'LOW',
                message: line.trim(),
                id: fileId
            });
            return;
        }
        
        const parts = line.split('|');
        if (parts.length === 5) {
            const percentStr = parts[0].replace('%', '');
            const speed = parts[1];
            const eta = parts[2];
            const totalBytes = parseInt(parts[3], 10);
            const downloadedBytes = parseInt(parts[4], 10);
            
            // Update primary file status
            file.fileStatus.percentage = parseFloat(percentStr) || 0;
            file.fileStatus.speed = speed;
            file.fileStatus.eta = eta;
            file.fileStatus.downloadedBytes = downloadedBytes || 0;
            file.fileStatus.totalBytes = totalBytes || null;
            
            // Update secondary file status if exists
            if (secondaryFile) {
                Object.assign(secondaryFile.fileStatus, file.fileStatus);
            }
        }
    }

    /**
     * Stop an active download
     * @param {string} fileId - The file ID to stop
     */
    stopDownload(fileId) {
        const success = this.processManager.terminate(fileId);
        if (success) {
            this._activeFiles.delete(fileId);
        }
        return success;
    }

    /**
     * Get progress for an active download
     * @param {string} fileId - The file ID
     * @returns {FileStatus|null} The file status or null if not found
     */
    getProgress(fileId) {
        const entry = this._activeFiles.get(fileId);
        return entry?.primary.fileStatus ?? null;
    }

    /**
     * Get logs for an active download
     * @param {string} fileId - The file ID
     * @returns {string|null} Formatted logs or null if not found
     */
    getLogs(fileId) {
        return this.processManager.getFormattedLogs(fileId);
    }
}

module.exports = new YtDlpService();
