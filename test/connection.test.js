const connectionService = require('../services/connection.service');

console.log("------------------------------------------");
console.log("🚀 بدء اختبار نظام الاتصال (Connection Test)");
console.log("------------------------------------------");

// 1. مراقبة أجهزة الـ USB
connectionService.on('usb-device-connected', (device) => {
    console.log("\n✅ [USB] جهاز جديد متصل بالكابل:");
    console.table(device); 
});

connectionService.on('usb-device-disconnected', (data) => {
    console.log(`\n❌ [USB] تم فصل الجهاز صاحب المعرف: ${data.id}`);
});

// 2. مراقبة الأجهزة اللاسلكية
connectionService.on('wireless-service-up', (service) => {
    console.log("\n🌐 [WiFi] تم اكتشاف جهاز متاح للربط:");
    console.log(`📡 IP: ${service.ip}:${service.port} | الموديل: ${service.model}`);
});

// 3. مراقبة طلبات الإقران (Pairing)
connectionService.on('wireless-pairing-request', (pairing) => {
    console.log("\n🔑 [Pairing] تم العثور على طلب إقران جديد:");
    console.log(`📍 العنوان: ${pairing.ip}:${pairing.port}`);
    console.log(`💡 ملاحظة: يمكنك الآن إدخال الكود باستخدام دالة pairDevice`);
});

// تشغيل الخدمات
try {
    console.log("🔍 جاري تفعيل الرادارات...");
    
    connectionService.startAdbWatcher(2000); // فحص كل ثانيتين
    connectionService.startWirelessScanner();
    connectionService.startPairingScanner();

    console.log("⌛ بانتظار حركة الأجهزة... (قم بتوصيل هاتفك الآن)");
} catch (error) {
    console.error("💥 خطأ أثناء تشغيل الخدمات:", error);
}