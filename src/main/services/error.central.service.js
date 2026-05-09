const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

/**
 * ErrorCentralService
 * الخدمة المركزية لإدارة الأخطاء والتنبيهات في تطبيق LinkHub
 */
class ErrorCentralService extends EventEmitter {
    constructor() {
        super();
        try {
            // استخدام مسار آمن في مجلد بيانات المستخدم (يفضل في Electron استخدام app.getPath('userData'))
            this.logFilePath = path.join(process.cwd(), 'app_error.log');
            this.errorHistory = []; 
        } catch (err) {
            console.error("Critical: Failed to initialize ErrorCentralService paths", err);
        }
    }

    /**
     * الوظيفة الأساسية لاستقبال أي خطأ في النظام
     */
    report(errorObj) {
        try {
            // التحقق من صحة الكائن المدخل لتجنب أخطاء undefined
            if (!errorObj || typeof errorObj !== 'object') {
                throw new Error("Invalid error object reported");
            }

            const { type = 'SYSTEM', severity = 'LOW', message = 'Unknown error', id = 'N/A' } = errorObj;
            const timestamp = new Date().toISOString();

            // 1. تسجيل الخطأ في ملف (معالجة الخطأ داخلية في الدالة)
            this._writeToLogFile(`[${timestamp}] [${severity}] [${type}] [Device: ${id}] - ${message}`);

            // 2. الحفظ في السجل المحلي
            this.errorHistory.push({ timestamp, ...errorObj });

            // 3. اتخاذ قرار المعالجة
            this._processAction(errorObj);

        } catch (err) {
            // في حال فشل التقرير نفسه، نكتفي بالطباعة في الكونسول لعدم الدخول في حلقة مفرغة
            console.error("Failed to process error report:", err);
        }
    }

    /**
     * تحديد رد الفعل بناءً على خطورة الخطأ
     */
    _processAction(error) {
        try {
            switch (error.severity) {
                case 'CRITICAL':
                    console.error("!!! CRITICAL SYSTEM ERROR !!!", error.message);
                    this.emit('system-halt', error); 
                    break;

                case 'HIGH':
                    this.emit('notify-user', {
                        title: this._translateType(error.type),
                        body: this._humanizeMessage(error.message),
                        variant: 'danger'
                    });
                    break;

                default: // LOW وما شابهه
                    this.emit('notify-user', {
                        title: 'تنبيه',
                        body: this._humanizeMessage(error.message),
                        variant: 'warning'
                    });
                    break;
            }
        } catch (err) {
            console.error("Error inside _processAction:", err);
        }
    }

    /**
     * تحويل رسائل النظام التقنية (آمنة من الأخطاء)
     */
    _humanizeMessage(rawMsg) {
        try {
            if (!rawMsg) return "حدث خطأ غير معروف.";
            
            const msg = rawMsg.toLowerCase();
            if (msg.includes("device not found")) return "الجهاز غير متصل، يرجى التحقق من كابل الـ USB.";
            if (msg.includes("unauthorized")) return "يرجى السماح بتصحيح أخطاء USB من شاشة هاتفك.";
            if (msg.includes("address already in use")) return "المنفذ محجوز بواسطة برنامج آخر.";
            if (msg.includes("spawn")) return "تعذر العثور على ملفات تشغيل الأداة المطلوبة.";
            
            return `حدث خطأ تقني: ${rawMsg}`;
        } catch (err) {
            return "فشل في تحليل رسالة الخطأ.";
        }
    }

    _translateType(type) {
        try {
            const mapping = {
                'ADB': 'اتصال الجهاز',
                'SCRCPY': 'بث الشاشة',
                'SYSTEM': 'نظام LinkHub'
            };
            return mapping[type] || 'تنبيه';
        } catch (err) {
            return 'تنبيه';
        }
    }

    /**
     * الكتابة للملف مع معالجة أخطاء الصلاحيات أو امتلاء القرص
     */
    _writeToLogFile(logLine) {
        try {
            // التأكد من وجود المجلد (اختياري إذا كان المسار معقداً)
            fs.appendFileSync(this.logFilePath, logLine + '\n', { encoding: 'utf8' });
        } catch (err) {
            // إذا فشل الكتابة للملف (مثلاً الملف للقراءة فقط أو القرص ممتلئ)
            console.error("Critical File Error: Could not write to log file.", err.message);
            // لا نرسل حدثاً هنا لتجنب اللانهائية، فقط نكتفي بالـ console
        }
    }

    getHistory() {
        return this.errorHistory;
    }
}

module.exports = new ErrorCentralService();