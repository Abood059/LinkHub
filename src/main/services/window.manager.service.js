const { AppWindow } = require('../models');

const { app } = require('electron');



class WindowManager {

    constructor() {

        this.windows = new Map();

        this._isQuitting = false;



        // إعداد المستمعين للتطبيق ككل

        this._setupAppEvents();

    }



    _setupAppEvents() {

        // التأكد من ضبط العلامة عند محاولة الخروج من النظام (macOS/Windows)

        app.on('before-quit', () => {

            this._isQuitting = true;

        });

    }



    open(name, options = {}, isMain = false) {

        // 1. إذا كانت النافذة موجودة، جلبها للمقدمة

        if (this.windows.has(name)) {

            const win = this.windows.get(name);

            if (win.instance && !win.instance.isDestroyed()) {

                win.show();

                win.instance.focus(); // تحسين: جلب النافذة للتركيز

                return win;

            }

            // إذا كانت مدمرة برمجياً، نحذفها لننشئ واحدة جديدة

            this.windows.delete(name);

        }



        // 2. إنشاء كائن نافذة جديد

        const newWin = new AppWindow(name, options, isMain);

        this.windows.set(name, newWin);



        // 3. إدارة دورة حياة الإغلاق

        newWin.instance.on('close', (event) => {

            if (isMain && !this._isQuitting) {

                event.preventDefault();

                newWin.hide();

            }

        });



        // تحسين: التنظيف النهائي عند تدمير النافذة تماماً

        newWin.instance.on('closed', () => {

            this.windows.delete(name);

        });



        return newWin;

    }



    sendTo(name, channel, data) {

        const win = this.windows.get(name);

        // تحسين: التأكد من أن النافذة ليست مدمرة قبل الإرسال لمنع Crash

        if (win && win.instance && !win.instance.isDestroyed()) {

            win.send(channel, data);

            return true;

        }

        return false;

    }



    broadcast(channel, data) {

        this.windows.forEach((win, name) => {

            this.sendTo(name, channel, data);

        });

    }



    // إغلاق نافذة محددة برمجياً

    close(name) {

        const win = this.windows.get(name);

        if (win) {

            win.instance.close();

        }

    }

    get(name) {
        const win = this.windows.get(name);
        if (win && win.instance && !win.instance.isDestroyed()) {
            return win;
        }
        return null;
    }



    quitApp() {

        this._isQuitting = true;

        // إغلاق كل النوافذ وتدميرها

        for (let win of this.windows.values()) {

            if (win.instance && !win.instance.isDestroyed()) {

                win.instance.destroy();

            }

        }

        this.windows.clear();

        app.quit();

    }

    destroyAllWindows() {
        for (const win of this.windows.values()) {
            if (win.instance && !win.instance.isDestroyed()) {
                win.instance.destroy();
            }
        }
        this.windows.clear();
    }

}



module.exports = new WindowManager();