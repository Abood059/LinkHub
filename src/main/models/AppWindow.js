const { BrowserWindow } = require('electron');
const path = require('path');

class AppWindow {
    constructor(name = 'unknown', options = {}, isMain = false) {
        this._name = name; // الاسم الوظيفي للنافذة
        this._isMain = isMain;

        const defaultOptions = {
            width: 800,
            height: 600,
            show: true, // الحماية من الوميض الأبيض
            webPreferences: {
                preload: path.join(__dirname, '../../preload/preload.js'),
                contextIsolation: true,
                nodeIntegration: false
            }
        };

        // دمج الإعدادات
        const finalOptions = { ...defaultOptions, ...options };
        this._browserWindow = new BrowserWindow(finalOptions);

        // تحميل المحتوى بناءً على النوع
        if (options.loadFile) {
            this._browserWindow.loadFile(options.loadFile);
        } else if (options.url) {
            this._browserWindow.loadURL(options.url);
        }

    }


    display() {
        if (!this._browserWindow.isDestroyed()) {
            // ننتظر الجاهزية قبل الإظهار لضمان عدم وجود وميض
            this._browserWindow.once('ready-to-show', () => {
                this._browserWindow.show();
            });
            
            // إذا كانت جاهزة أصلاً (تحميل سريع)، نظهرها فوراً
            this._browserWindow.show(); 
        }
    }

    /**
     * إظهار النافذة والتركيز عليها
     */
    show() {
        if (!this._browserWindow.isDestroyed()) {
            this._browserWindow.show();
            this._browserWindow.focus();
        }
    }

    /**
     * إخفاء النافذة دون إغلاقها (تبقى تعمل في الخلفية)
     */
    hide() {
        if (!this._browserWindow.isDestroyed()) {
            this._browserWindow.hide();
        }
    }

    /**
     * التبديل بين الظهور والاختفاء (Toggle)
     * مفيدة جداً عند ربطها باختصار لوحة مفاتيح
     */
    toggle() {
        if (this._browserWindow.isVisible()) {
            this.hide();
        } else {
            this.show();
        }
    }

    // --- الدوال المساعدة (Getters & Setters) ---

    get name() {
        return this._name;
    }

    get isMain() {
        return this._isMain;
    }

    // الوصول للنافذة الخام من Electron إذا احتجنا خصائص متقدمة
    get instance() {
        return this._browserWindow;
    }

    // الحصول على الـ ID التلقائي من النظام
    get systemId() {
        return this._browserWindow.id;
    }

    // تحديث العنوان بسهولة
    set title(newTitle) {
        if (!this._browserWindow.isDestroyed()) {
            this._browserWindow.setTitle(newTitle);
        }
    }

    // --- الدوال التشغيلية ---

    /**
     * إرسال بيانات آمن للواجهة
     */
    send(channel, data) {
        if (!this._browserWindow.isDestroyed()) {
            this._browserWindow.webContents.send(channel, data);
        }
    }

    /**
     * إغلاق آمن للنافذة
     */
    close() {
        if (!this._browserWindow.isDestroyed()) {
            this._browserWindow.close();
        }
    }

    /**
     * التركيز على النافذة (جلبها للمقدمة)
     */
    focus() {
        if (!this._browserWindow.isDestroyed()) {
            this._browserWindow.focus();
        }
    }
}

module.exports = AppWindow;