/**
 * LinkHub - Renderer Logic
 * إدارة تفاعل الواجهة مع الخدمات الخلفية عبر البري لود
 */

let selectedDeviceId = null;
let selectedPairingTarget = null;
const interactionStates = new Map();
const streamingStates = new Set();
const phaseLabels = {
    connecting: 'جاري الاتصال...',
    retrying: 'إعادة المحاولة...',
    'pairing-search': 'جاري البحث عن الاقتران...',
    pairing: 'جاري الإقران...',
    'needs-pairing': 'يتطلب اقتران',
    done: 'جاهز',
    'network-timeout': 'انتهت مهلة الشبكة'
};

/**
 * بناء عنصر الجهاز HTML مع دعم الحالات الثلاث (Connected, Available, Offline)
 * يتوافق مع التصميم العصري (Rounded Squares)
 */
function createDeviceNode(device, isRegistered) {
    const div = document.createElement('div');
    div.className = 'device-item';
    if (device.status === 'streaming' || streamingStates.has(device.id)) {
        div.classList.add('is-streaming');
    }
    
    // أيقونة مبنية على أول حرف من الموديل
    const iconLetter = device.model ? device.model.charAt(0).toUpperCase() : 'D';
    
    // تحديد الصنف اللوني (Status Class) بناءً على الحالة التقنية
    let statusClass = 'device-circle';
    
    if (device.status === 'connected' || device.status === 'streaming') {
        statusClass += ' online';    // اللون الأخضر
    } else if (device.status === 'available') {
        statusClass += ' available'; // اللون الأزرق مع تأثير النبض (الرادار)
    } else {
        statusClass += ' offline';   // اللون الرمادي
    }

    const uiState = interactionStates.get(device.id);
    const isLoading = uiState && uiState.loading;
    const iconContent = isLoading ? '<span class="spinner"></span>' : iconLetter;
    const streamingBadge = device.status === 'streaming' || streamingStates.has(device.id)
        ? '<span class="stream-badge">LIVE</span>'
        : '';

    div.innerHTML = `
        <div class="${statusClass}" onclick="onDeviceClick('${device.id}', ${isRegistered}, '${device.status}')">
            ${iconContent}
            ${streamingBadge}
        </div>
        <div class="device-name">${device.deviceFriendlyName || device.model || 'جهاز غير معروف'}</div>
        <div class="device-status-text">${uiState?.label || (device.status === 'connected' ? 'متصل وجاهز' : (device.status === 'streaming' ? 'جاري البث' : device.status))}</div>
    `;
    return div;
}

/**
 * معالج النقر على أيقونة الجهاز
 */
window.onDeviceClick = async (id, isRegistered, status) => {
    if (interactionStates.get(id)?.loading) return;

    // الحالة الأولى: الجهاز متصل (USB أو مقترن لاسلكياً ونشط) -> تشغيل البث
    if (status === 'connected') {
        console.log(`[UI] بدء البث للجهاز: ${id}`);
        const response = await window.electronAPI.startStream(id);
        if (!response.success) {
            showToast("⚠️ عذراً، فشل تشغيل البث: " + (response.message || "تأكد من أن خيارات المطور مفعلة"), 'error');
        } else {
            streamingStates.add(id);
            showToast("✅ تم بدء البث بنجاح.", 'success');
            refreshListsIfCached();
        }
    } else if (status === 'streaming') {
        showToast("ℹ️ توجد جلسة بث نشطة بالفعل لهذا الجهاز.", 'info');
    } 
    // الحالة الثانية: الجهاز مكتشف في الشبكة ولكنه يحتاج إقران
    else if (status === 'available' || status === 'offline') {
        const interaction = await window.electronAPI.interactDevice(id);

        if (interaction.status === 'connected') {
            const response = await window.electronAPI.startStream(id);
            if (!response.success) {
                showToast("⚠️ تم الاتصال لكن فشل تشغيل البث: " + (response.message || "تحقق من إعدادات الجهاز"), 'error');
            } else {
                streamingStates.add(id);
                refreshListsIfCached();
            }
            return;
        }

        if (interaction.status === 'needs_pairing' && interaction.pairing) {
            selectedDeviceId = id;
            selectedPairingTarget = interaction.pairing || null;
            document.getElementById('pairing-modal').style.display = 'flex';
            document.getElementById('pairing-code').focus();
            return;
        }

        if (interaction.status === 'needs_pairing' && !interaction.pairing) {
            showToast("يجب تفعيل Wireless Debugging وانتظار ظهور خدمة الاقتران.", 'info');
            return;
        }

        if (interaction.status === 'failed_network') {
            showToast(interaction.message || "تعذر الاتصال بسبب الشبكة. تحقق من نفس شبكة Wi‑Fi.", 'error');
            return;
        }

        showToast(interaction.message || "فشل الاتصال بالجهاز.", 'error');
    }
    // الحالة الثالثة: حالات أخرى
    else {
        showToast("ℹ️ هذا الجهاز غير متصل. يرجى توصيله عبر USB أو التأكد من اتصاله بنفس الشبكة اللاسلكية.", 'info');
    }
};

/**
 * تنفيذ عملية الإقران اللاسلكي
 */
window.submitPairing = async () => {
    const codeInput = document.getElementById('pairing-code');
    const code = codeInput.value.trim();
    
    if (code && selectedDeviceId) {
        // إظهار حالة "جاري التحميل" بسيطة (يمكنك تحسينها لاحقاً)
        const btn = document.querySelector('.btn-primary');
        const originalText = btn.innerText;
        btn.innerText = "جاري الإقران...";
        btn.disabled = true;

        try {
            const result = await window.electronAPI.pairDevice({ 
                id: selectedDeviceId, 
                ip: selectedPairingTarget?.ip,
                port: selectedPairingTarget?.port,
                code: code 
            });

            if (result.success) {
                showToast("✅ تم الإقران بنجاح! سيظهر الجهاز الآن كمتصل.", 'success');
                closeModal();
            } else {
                showToast("❌ فشل الإقران: " + (result.message || "تأكد من صحة الرمز المحقق"), 'error');
            }
        } catch (error) {
            showToast("❌ حدث خطأ غير متوقع أثناء الاتصال.", 'error');
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
            codeInput.value = '';
        }
    } else {
        showToast("يرجى إدخال رمز الإقران المكون من 6 أرقام.", 'info');
    }
};

/**
 * إغلاق نافذة الإقران المنبثقة
 */
window.closeModal = () => {
    document.getElementById('pairing-modal').style.display = 'none';
    selectedDeviceId = null;
    selectedPairingTarget = null;
};

/**
 * تحديث القوائم والعدادات في الصفحة
 */
function updateUILists(registered, discovered) {
    window.__latestLists = { registered, discovered };
    const regList = document.getElementById('registered-list');
    const discList = document.getElementById('unregistered-list');
    
    const regCount = document.getElementById('reg-count');
    const discCount = document.getElementById('disc-count');

    // تحديث القائمة المسجلة
    if (regList) {
        regList.innerHTML = '';
        if (registered.length === 0) {
            regList.innerHTML = '<p class="empty-state">لا توجد أجهزة مسجلة حالياً</p>';
        } else {
            registered.forEach(d => regList.appendChild(createDeviceNode(d, true)));
        }
        if (regCount) regCount.innerText = registered.length;
    }

    // تحديث قائمة الرادار (المكتشفة)
    if (discList) {
        discList.innerHTML = '';
        if (discovered.length === 0) {
            discList.innerHTML = '<p class="empty-state">لا توجد أجهزة لاسلكية قريبة</p>';
        } else {
            discovered.forEach(d => discList.appendChild(createDeviceNode(d, false)));
        }
        if (discCount) discCount.innerText = discovered.length;
    }
}

function refreshListsIfCached() {
    if (!window.__latestLists) return;
    updateUILists(window.__latestLists.registered || [], window.__latestLists.discovered || []);
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 30);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 220);
    }, 3200);
}

// --- الاستماع للتحديثات التلقائية القادمة من الخلفية عبر البري لود ---
window.electronAPI.onUpdateList(({ registered, discovered }) => {
    console.log("[UI] تحديث قائمة الأجهزة المستلمة...");
    registered.forEach((d) => {
        if (d.status !== 'streaming') {
            streamingStates.delete(d.id);
        } else {
            streamingStates.add(d.id);
        }
    });
    updateUILists(registered || [], discovered || []);
});

window.electronAPI.onInteractionState(({ deviceId, state, phase }) => {
    if (!deviceId) return;
    if (state === 'loading') {
        interactionStates.set(deviceId, {
            loading: true,
            phase,
            label: phaseLabels[phase] || 'جاري المعالجة...'
        });
    } else {
        if (phase === 'needs-pairing') {
            interactionStates.set(deviceId, {
                loading: false,
                phase,
                label: phaseLabels[phase]
            });
        } else {
            interactionStates.delete(deviceId);
        }
    }
    refreshListsIfCached();
});

// طلب البيانات الأولية فور تحميل محتوى الصفحة
window.addEventListener('DOMContentLoaded', async () => {
    console.log("[UI] الصفحة جاهزة، طلب القائمة الأولية...");
    const initialData = await window.electronAPI.getAllDevices();
    if (initialData) {
        updateUILists(initialData.registered || [], initialData.discovered || []);
    }
});