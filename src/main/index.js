const { app } = require('electron');
const path = require('path');
const { windowManager, databaseManager, processManager } = require('./services');

// استدعاء الهاندلر لبدء الاستماع لطلبات IPC وأحداث الأجهزة
// قمنا بنقله لمتغير ليتم استدعاؤه في الوقت المناسب
let deviceHandler;

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// إجراء هام جداً: تنظيف العمليات عند إغلاق التطبيق
app.on('before-quit', () => {
  console.log('[Main] جاري تنظيف العمليات والخدمات قبل الخروج...');
  windowManager.destroyAllWindows();
  processManager.terminateAll();
});

app.whenReady().then(async () => {
  console.log('[Main] التطبيق جاهز، جاري بدء التهيئة...');

  try {
    // 1. تهيئة قاعدة البيانات أولاً (الأساس)
    await databaseManager.initDb();
    console.log('[Main] قاعدة البيانات جاهزة.');

    // 2. الآن نقوم بتشغيل الهاندلر (بعد التأكد من وجود القاعدة)
    deviceHandler = require('./handlers/device.handler');

    // 3. فتح النافذة الرئيسية
    windowManager.open('main', {
      width: 1100,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      loadFile: path.join(__dirname, '../renderer/index.html')
    }, true);

  } catch (err) {
    console.error('[Main] فشل ذريع في بدء التطبيق:', err);
    // يمكن هنا إظهار رسالة خطأ للمستخدم قبل الخروج
  }
});

// الحماية ضد الانهيار
process.on('uncaughtException', (error) => {
  console.error('[Main] خطأ غير متوقع:', error);
});