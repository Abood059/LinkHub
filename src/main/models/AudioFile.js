const BaseFile = require('./BaseFile');

/**
 * AudioFile
 * Represents an audio file format from yt-dlp
 */
class AudioFile extends BaseFile {
    constructor({
        id = null,
        name = '',
        extension = '',
        sourceUrl = '',
        storagePath = null,
        formatId = '',
        abr = null,
        codec = '',
        fileSizeApprox = null
    } = {}) {
        super({ id, name, extension, sourceUrl, storagePath, type: 'audio' });
        this.formatId = formatId;
        this.abr = abr;
        this.codec = codec;
        this.fileSizeApprox = fileSizeApprox;
    }
}

module.exports = AudioFile;
