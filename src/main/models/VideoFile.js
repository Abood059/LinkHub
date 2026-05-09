const BaseFile = require('./BaseFile');

/**
 * VideoFile
 * Represents a video file format from yt-dlp
 */
class VideoFile extends BaseFile {
    constructor({
        id = null,
        name = '',
        extension = '',
        sourceUrl = '',
        storagePath = null,
        formatId = '',
        resolution = '',
        fps = null,
        codec = '',
        width = null,
        height = null,
        fileSizeApprox = null
    } = {}) {
        super({ id, name, extension, sourceUrl, storagePath, type: 'video' });
        this.formatId = formatId;
        this.resolution = resolution;
        this.fps = fps;
        this.codec = codec;
        this.width = width;
        this.height = height;
        this.fileSizeApprox = fileSizeApprox;
    }
}

module.exports = VideoFile;
