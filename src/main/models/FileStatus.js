/**
 * FileStatus
 * Represents the dynamic status of a download operation
 */
class FileStatus {
    constructor({
        percentage = 0,
        speed = null,
        eta = null,
        downloadedBytes = 0,
        totalBytes = null,
        isPaused = false
    } = {}) {
        this.percentage = percentage;
        this.speed = speed;
        this.eta = eta;
        this.downloadedBytes = downloadedBytes;
        this.totalBytes = totalBytes;
        this.isPaused = isPaused;
    }
}

module.exports = FileStatus;
