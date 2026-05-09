const path = require('path');
const os = require('os');
const fs = require('fs');
const ProcessManager = require('./process.manager.service');

class ScrcpyService {
    constructor() {
        // نحدد إذا كنا في وضع التطوير أم الإنتاج
        this.isDev = true; // أو process.env.NODE_ENV !== 'production'
        this.initPermissions();
    }

    /**
     * تحديد المسار المطلق للمحرك بشكل آمن
     */
    resolveBinaryPath(platform = os.platform()) {
        const isWin = platform === 'win32';
        const binDir = isWin ? 'win64' : 'linux';
        const exeName = isWin ? 'scrcpy.exe' : 'scrcpy';

        const baseBinPath = this.isDev
            ? path.join(__dirname, '..', '..', '..', 'resources', 'bin')
            : path.join(process.resourcesPath, 'bin');

        return path.join(baseBinPath, binDir, exeName);
    }

    getBinaryPath() {
        return this.resolveBinaryPath(os.platform());
    }

    initPermissions() {
        if (os.platform() === 'linux') {
            const binPath = this.getBinaryPath();
            try {
                if (fs.existsSync(binPath)) fs.chmodSync(binPath, '755');
            } catch (err) {
                console.error("[Scrcpy] فشل تعيين صلاحيات التنفيذ:", err.message);
            }
        }
    }

    /**
     * بدء بث الشاشة
     */
    startMirroring(device, options = {}) {
        const binPath = this.getBinaryPath();
        
        // استخدام معرف فريد للعملية لمنع التعارض مع أوامر ADB الأخرى
        const processId = `scrcpy-${device.id}`;
        const bitrate = options.videoBitRate || '4M';
        const maxFps = String(options.maxFps || 60);
        const isWireless = String(device.connectionType || '').toLowerCase() === 'wireless';
        const adbTarget = isWireless
            ? (device.adbTarget || (device.ip && device.port ? `${device.ip}:${device.port}` : device.id))
            : device.id;

        const args = [
            '-s', adbTarget,
            '--window-title', `LinkHub: ${device.deviceFriendlyName || device.model}`,
            '--video-bit-rate', bitrate,
            '--max-fps', maxFps,
            '--stay-awake',
            '--power-off-on-close', // ميزة جميلة: إطفاء شاشة الهاتف عند إغلاق النافذة
            '--audio-buffer', '50'
        ];

        console.log(`[Scrcpy] بدء البث للجهاز: ${device.id} عبر ${adbTarget}`);

        const maxBufferSize =
            typeof options.processLogBufferSize === 'number' && options.processLogBufferSize > 0
                ? options.processLogBufferSize
                : 100;

        // تمرير كولباك لمراقبة المخرجات في حال حدث خطأ — التخزين في الـ entity يتم داخل ProcessManager
        const processRef = ProcessManager.execute(
            processId,
            binPath,
            args,
            'scrcpy',
            (data, stream) => {
                if (stream === 'stderr') {
                    if (typeof options.onProcessError === 'function') {
                        options.onProcessError(data.toString());
                    }
                    if (data.includes('ERROR')) {
                        console.error(`[Scrcpy Error]: ${data}`);
                    }
                }
            },
            maxBufferSize
        );

        if (processRef && typeof options.onProcessExit === 'function') {
            processRef.once('exit', (code) => {
                options.onProcessExit(code);
            });
        }

        if (processRef && typeof options.onSpawnError === 'function') {
            processRef.once('error', (error) => {
                options.onSpawnError(error);
            });
        }

        return processRef;
    }

    /**
     * إيقاف البث
     */
    stopMirroring(deviceId) {
        return ProcessManager.terminate(`scrcpy-${deviceId}`);
    }

    /**
     * التحقق من حالة البث
     */
    isMirroring(deviceId) {
        const status = ProcessManager.getProcessStatus(`scrcpy-${deviceId}`);
        return status && status.type === 'scrcpy';
    }
}

module.exports = new ScrcpyService();