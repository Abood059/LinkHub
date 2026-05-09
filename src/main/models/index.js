/**
 * LinkHub Models Gateway
 * البوابة المركزية لنماذج البيانات (Classes)
 */

const AppWindow = require('./AppWindow');
const BaseNode = require('./BaseNode');
const Device = require('./Device');
const HttpFile = require('./HttpFile');
const MediaNode = require('./MediaNode');
const ProcessEntity = require('./ProcessEntity');
const FileStatus = require('./FileStatus');
const BaseFile = require('./BaseFile');
const VideoFile = require('./VideoFile');
const AudioFile = require('./AudioFile');

module.exports = {
    AppWindow,
    BaseNode,
    Device,
    HttpFile,
    MediaNode,
    ProcessEntity,
    FileStatus,
    BaseFile,
    VideoFile,
    AudioFile
};