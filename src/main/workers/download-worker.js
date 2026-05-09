#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// تحليل معاملات سطر الأوامر
function parseArgs() {
    const args = process.argv.slice(2);
    const params = {};
    
    for (let i = 0; i < args.length; i += 2) {
        if (args[i].startsWith('--')) {
            const key = args[i].substring(2);
            const value = args[i + 1];
            params[key] = value;
        }
    }
    
    return params;
}

// تنسيق البايتات إلى نص مقروء
function formatBytes(bytes) {
    if (bytes === 0) return '0 B/s';
    
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
}

// تنسيق الوقت المتبقي
function formatEta(seconds) {
    if (seconds === Infinity || isNaN(seconds)) return '--:--';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// الدالة الرئيسية للتحميل
function downloadFile(url, storagePath, fileId = null) {
    return new Promise(async (resolve, reject) => {
        let progressInterval = null;
        let startTime = Date.now();
        let lastBytes = 0;
        let totalBytes = 0;
        let downloadedBytes = 0;
        let fileStream = null;
        
        try {
            // التأكد من وجود المجلد
            const dir = path.dirname(storagePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // التحقق من وجود ملف جزئي للاستئناف
            let startByte = 0;
            if (fs.existsSync(storagePath)) {
                const stats = fs.statSync(storagePath);
                startByte = stats.size;
                downloadedBytes = startByte;
            }
            
            // إعداد headers
            const headers = {
                'User-Agent': 'LinkHub-Downloader/1.0'
            };
            
            if (startByte > 0) {
                headers['Range'] = `bytes=${startByte}-`;
            }
            
            // بدء التحميل
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream',
                headers: headers,
                timeout: 30000
            });
            
            // التحقق من دعم الاستئناف
            if (startByte > 0 && response.status !== 206) {
                // الخادم لا يدعم الاستئناف، نبدأ من جديد
                startByte = 0;
                downloadedBytes = 0;
                if (fs.existsSync(storagePath)) {
                    fs.unlinkSync(storagePath);
                }
            }
            
            totalBytes = parseInt(response.headers['content-length']) || 0;
            if (startByte > 0 && response.status === 206) {
                totalBytes += startByte;
            }
            
            // فتح الملف للكتابة
            const fileFlags = startByte > 0 ? 'r+' : 'w';
            fileStream = fs.createWriteStream(storagePath, { flags: fileFlags, start: startByte });
            
            // إعداد تحديث التقدم
            progressInterval = setInterval(() => {
                const currentTime = Date.now();
                const timeElapsed = (currentTime - startTime) / 1000;
                const bytesSinceLastUpdate = downloadedBytes - lastBytes;
                const speed = bytesSinceLastUpdate / 0.3; // 300ms = 0.3s
                const eta = speed > 0 ? (totalBytes - downloadedBytes) / speed : Infinity;
                
                const progress = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
                
                console.log(JSON.stringify({
                    type: 'progress',
                    progress: Math.round(progress * 10) / 10,
                    downloadedBytes,
                    totalBytes,
                    speed: formatBytes(speed),
                    eta: formatEta(eta)
                }));
                
                lastBytes = downloadedBytes;
            }, 300);
            
            // معالجة تدفق البيانات
            response.data.on('data', (chunk) => {
                downloadedBytes += chunk.length;
            });
            
            // توجيه البيانات إلى الملف
            response.data.pipe(fileStream);
            
            // انتظار اكتمال التحميل
            fileStream.on('finish', () => {
                clearInterval(progressInterval);
                
                // إرسال رسالة الاكتمال النهائية
                console.log(JSON.stringify({
                    type: 'complete',
                    filePath: storagePath
                }));
                
                resolve();
            });
            
            fileStream.on('error', (error) => {
                clearInterval(progressInterval);
                reject(error);
            });
            
            response.data.on('error', (error) => {
                clearInterval(progressInterval);
                reject(error);
            });
            
        } catch (error) {
            if (progressInterval) {
                clearInterval(progressInterval);
            }
            
            // إرسال رسالة الخطأ
            console.log(JSON.stringify({
                type: 'error',
                message: error.message || 'Download failed'
            }));
            
            // محاولة حذف الملف الجزئي
            try {
                if (fs.existsSync(storagePath)) {
                    fs.unlinkSync(storagePath);
                }
            } catch (deleteError) {
                console.error(`Failed to delete partial file: ${deleteError.message}`);
            }
            
            reject(error);
        }
    });
}

// معالجة إشارة الإنهاء
function setupSignalHandlers() {
    const handleTermination = () => {
        console.log(JSON.stringify({
            type: 'error',
            message: 'Download cancelled by user'
        }));
        process.exit(1);
    };
    
    process.on('SIGTERM', handleTermination);
    process.on('SIGINT', handleTermination);
}

// الدالة الرئيسية
async function main() {
    const args = parseArgs();
    
    const { url, storagePath, id } = args;
    
    if (!url || !storagePath) {
        console.error('Usage: node download-worker.js --url <URL> --storagePath <path> [--id <id>]');
        process.exit(1);
    }
    
    setupSignalHandlers();
    
    try {
        await downloadFile(url, storagePath, id);
        process.exit(0);
    } catch (error) {
        console.error(`Download error: ${error.message}`);
        process.exit(1);
    }
}

// تشغيل البرنامج
if (require.main === module) {
    main().catch(error => {
        console.error(`Fatal error: ${error.message}`);
        process.exit(1);
    });
}
