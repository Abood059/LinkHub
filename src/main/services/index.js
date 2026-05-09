/**
 * LinkHub Services Central Gateway
 * البوابة المركزية لجميع الخدمات - تشمل نظام إدارة الأخطاء والعمليات
 */

// خدمات النظام الأساسية
const processManager = require('./process.manager.service');
const errorCentralService = require('./error.central.service');
const databaseManager = require('./database.manager.service');

// خدمات إدارة الأجهزة والاتصال
const connectionService = require('./connection.service');
const deviceManager = require('./device.manager.service');
const scrcpyService = require('./scrcpy.service');

// خدمات الواجهة والتحميل
const windowManager = require('./window.manager.service');
const downloadService = require('./download.service');
const ytdlpService = require('./ytdlp.service');

module.exports = {
    // الإدارة والرقابة
    processManager,
    errorCentralService,
    databaseManager,
    
    // الأجهزة والبث
    connectionService,
    deviceManager,
    scrcpyService,
    
    // أدوات إضافية
    windowManager,
    downloadService,
    ytdlpService
};