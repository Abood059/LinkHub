/**
 * هذا الملف يقوم بتجميع كافة الـ Handlers وتصديرهم
 * لسهولة الاستدعاء من ملف الماين الأساسي
 */

const deviceHandler = require('./device.handler');
//const downloadHandler = require('./download.handler');
//const linkSnifferHandler = require('./linkSniffer.handler');

// تصديرهم كمجموعة واحدة
module.exports = {
    deviceHandler,
   // downloadHandler,
   // linkSnifferHandler
};