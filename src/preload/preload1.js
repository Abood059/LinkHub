
const { contextBridge, ipcRenderer } = require('electron');



/**

* الجسر الآمن (Context Bridge)

* يربط بين عملية الواجهة (Renderer) وعملية الخلفية (Main)

*/

contextBridge.exposeInMainWorld('electronAPI', {


// 1. فحص الرابط: يستدعي الهاندلر download:inspect في الخلفية

inspectUrl: (url) => ipcRenderer.invoke('download:inspect', url),



// 2. بدء التحميل: يستدعي الهاندلر download:start الذي يستخدم Axios الآن

startDownload: (data) => ipcRenderer.invoke('download:start', data),



// 3. جلب سجل التحميلات من قاعدة البيانات

getHistory: () => ipcRenderer.invoke('downloads:get-all'),



/**

* الاستماع لتحديثات النسبة والسرعة (onProgress)

* ملاحظة: قمنا بإبقاء اسم القناة 'download:progress-update' كما هو

* لأنه الاسم الذي يرسل عبره ملف download.service البيانات حالياً.

*/

onProgress: (callback) => {

// أزلنا removeAllListeners لكي لا نقتل التنزيلات الأخرى

ipcRenderer.on('download:progress-update', (_event, data) => callback(data));

},



// 4. الاستماع لانتهاء التحميل بنجاح

onFinished: (callback) => {

ipcRenderer.on('download:finished', (_event, data) => callback(data));

},



onDownloadComplete: (callback) => ipcRenderer.on('download:complete', (event, data) => callback(data))

});