const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // --- 1. طلبات من الواجهة إلى الخلفية (Invoke) ---
    
    // جلب قائمة الأجهزة (المسجلة والمكتشفة)
    getAllDevices: () => ipcRenderer.invoke('devices:get-all'),
    
    // طلب إقران جهاز لاسلكي جديد
    pairDevice: (data) => ipcRenderer.invoke('devices:pair', data),

    // تنفيذ سيناريو الاتصال الذكي بالجهاز
    interactDevice: (deviceId) => ipcRenderer.invoke('devices:interact', deviceId),
    
    // بدء بث الشاشة
    startStream: (deviceId) => ipcRenderer.invoke('devices:stream', deviceId),
    
    // إيقاف بث الشاشة
    stopStream: (deviceId) => ipcRenderer.invoke('devices:stop-stream', deviceId),

    /** جلب سجل مخرجات البث المخزّن (أثناء الجلسة النشطة) */
    getStreamLogs: (deviceId) => ipcRenderer.invoke('devices:get-stream-logs', deviceId),

    // --- 2. استقبال الأحداث من الخلفية (On) ---

    // استقبال تحديثات القائمة (عند توصيل أو فصل جهاز)
    onUpdateList: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('devices:update-list', subscription);
        
        // إرجاع دالة لإزالة المستمع عند الحاجة (لتحسين الأداء)
        return () => {
            ipcRenderer.removeListener('devices:update-list', subscription);
        };
    },

    // استقبال سجلات البث (Logs) لتصحيح الأخطاء في الواجهة
    onStreamLog: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('devices:stream-log', subscription);
        
        return () => {
            ipcRenderer.removeListener('devices:stream-log', subscription);
        };
    },

    onInteractionState: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('devices:interaction-state', subscription);

        return () => {
            ipcRenderer.removeListener('devices:interaction-state', subscription);
        };
    }
});