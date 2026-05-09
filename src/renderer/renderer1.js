const downloadBtn = document.getElementById('downloadBtn');

const urlInput = document.getElementById('urlInput');

const downloadsList = document.getElementById('downloadsList');

const emptyState = document.getElementById('emptyState');



/**

* القسم 1: مستمعات الأحداث العامة (Global Listeners)

* تعمل هذه المستمعات مرة واحدة وتراقب كافة التحميلات الجارية

*/



// استقبال تحديثات التقدم من Axios لجميع الملفات

window.electronAPI.onProgress((data) => {

// توليد الـ ID الفريد بناءً على رابط الملف القادم في البيانات

const id = btoa(data.url).replace(/[^a-z0-9]/gi, '').substring(0, 10);


const progressBar = document.getElementById(`progress-${id}`);

const speedText = document.getElementById(`speed-${id}`);

const percentText = document.getElementById(`percent-${id}`);



if (progressBar) {

progressBar.style.width = `${data.progress}%`;

percentText.innerText = `${data.progress}%`;


if (speedText) {

speedText.innerText = data.speed;

}

}

});



// مستمع اكتمال التحميل لجميع الملفات

window.electronAPI.onFinished((data) => {

const id = btoa(data.url).replace(/[^a-z0-9]/gi, '').substring(0, 10);


const progressBar = document.getElementById(`progress-${id}`);

const speedText = document.getElementById(`speed-${id}`);

const percentText = document.getElementById(`percent-${id}`);



if (progressBar) {

progressBar.style.width = '100%';

progressBar.classList.remove('bg-blue-600');

progressBar.classList.add('bg-green-500');


if (percentText) percentText.innerText = '100%';

if (speedText) {

speedText.innerText = 'مكتمل ✅';

speedText.style.color = '#4ade80';

}

}

console.log(`✅ اكتمل تحميل الملف ذو المعرف: ${id}`);

});



/**

* القسم 2: منطق واجهة المستخدم وبدء التحميل

*/



downloadBtn.addEventListener('click', async () => {

const url = urlInput.value.trim();

if (!url) return;



downloadBtn.disabled = true;

downloadBtn.innerText = 'جاري الفحص...';



const inspectResult = await window.electronAPI.inspectUrl(url);



if (inspectResult.success) {

const info = inspectResult.data;

const sizeInMB = info.sizeBytes > 0 ? (info.sizeBytes / 1048576).toFixed(2) : "غير معروف";



const confirm = await Swal.fire({

title: 'تأكيد التحميل',

html: `<b>الملف:</b> ${info.suggestedName}<br><b>الحجم:</b> ${sizeInMB} MB`,

icon: 'info',

showCancelButton: true,

confirmButtonText: 'ابدأ الآن',

cancelButtonText: 'إلغاء',

background: '#1f2937',

color: '#fff'

});



if (confirm.isConfirmed) {

addDownloadUI(url, info.suggestedName);

window.electronAPI.startDownload({ url, fileInfo: info });

urlInput.value = '';

}

} else {

Swal.fire('خطأ', 'تعذر جلب معلومات الملف. الرابط قد يكون تالفاً أو يحتاج لصلاحيات.', 'error');

}


downloadBtn.disabled = false;

downloadBtn.innerText = 'تحميل';

});



/**

* القسم 3: دالة إضافة عنصر التحميل للقائمة

*/

function addDownloadUI(url, name) {

if (emptyState) emptyState.style.display = 'none';



const id = btoa(url).replace(/[^a-z0-9]/gi, '').substring(0, 10);


const itemHtml = `

<div id="item-${id}" class="p-4 bg-gray-800 border-b border-gray-700 mb-2 rounded-lg shadow-sm">

<div class="flex justify-between mb-2">

<span class="font-medium truncate w-64 text-blue-300" title="${name}">${name}</span>

<span id="speed-${id}" class="text-sm text-green-400 font-mono">جاري الاتصال...</span>

</div>

<div class="w-full bg-gray-700 rounded-full h-2.5">

<div id="progress-${id}" class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style="width: 0%"></div>

</div>

<div class="flex justify-between mt-2 text-xs text-gray-400 font-mono">

<span id="percent-${id}">0%</span>

<span class="text-gray-500">عبر Axios Stream</span>

</div>

</div>

`;

downloadsList.insertAdjacentHTML('afterbegin', itemHtml);

}

