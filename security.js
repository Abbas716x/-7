/* ==================================================================
   MEDINEXUS PRO — Anti-Inspection & Real-Time Security Enforcer
   ================================================================== */

(function () {
    'use strict';

    let lastBreachLogTime = 0;
    const BREACH_DEBOUNCE_MS = 2500; // Prevent spamming Firestore logs

    // Log Security Breach to Firebase & Alert User
    async function recordSecurityBreach(breachType, details) {
        const now = Date.now();
        if (now - lastBreachLogTime < BREACH_DEBOUNCE_MS) return;
        lastBreachLogTime = now;

        console.warn(`🚨 SECURITY VIOLATION: ${breachType} — ${details}`);

        // Visual alert to the user
        if (window.ClinicEngine && typeof window.ClinicEngine.showSecurityWarning === 'function') {
            window.ClinicEngine.showSecurityWarning(breachType);
        }

        // Get Current User Context
        const currentUser = (window.ClinicEngine && window.ClinicEngine.getCurrentUserContext)
            ? window.ClinicEngine.getCurrentUserContext()
            : { name: 'زائر / غير مسجل', role: 'guest', username: 'guest' };

        const breachPayload = {
            type: 'breach',
            title: `محاولة اختراق أو فحص: ${breachType}`,
            details: `${details} (بواسطة: ${currentUser.name})`,
            user: currentUser.name,
            role: currentUser.role,
            username: currentUser.username,
            timestamp: new Date().toISOString()
        };

        // Write directly to Firebase Cloud Activities
        try {
            if (window.MedicalFirebase && typeof window.MedicalFirebase.logActivityCloud === 'function') {
                await window.MedicalFirebase.logActivityCloud(breachPayload);
            }
        } catch (e) {
            console.error('Failed to log breach to cloud:', e);
        }
    }

    // ==================== 1. BLOCK CONTEXT MENU (RIGHT-CLICK) ====================
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        recordSecurityBreach('الزر الأيمن (Right-Click)', 'تم النقر بزر الفأرة الأيمن ومحاولة استدعاء قائمة الفحص');
        return false;
    }, { capture: true });

    // ==================== 2. BLOCK DEVTOOLS SHORTCUTS ====================
    document.addEventListener('keydown', function (e) {
        const isCtrlOrCmd = e.ctrlKey || e.metaKey;
        const key = e.key ? e.key.toUpperCase() : '';
        const keyCode = e.keyCode || e.which;

        // F12 Key
        if (keyCode === 123 || key === 'F12') {
            e.preventDefault();
            e.stopPropagation();
            recordSecurityBreach('مفتاح F12', 'محاولة فتح أدوات المطورين بواسطة مفتاح F12');
            return false;
        }

        // Ctrl + Shift + I (Inspect Element)
        if (isCtrlOrCmd && e.shiftKey && (key === 'I' || keyCode === 73)) {
            e.preventDefault();
            e.stopPropagation();
            recordSecurityBreach('اختصار Ctrl+Shift+I', 'محاولة فتح نافذة Inspect Element');
            return false;
        }

        // Ctrl + Shift + J (Developer Console)
        if (isCtrlOrCmd && e.shiftKey && (key === 'J' || keyCode === 74)) {
            e.preventDefault();
            e.stopPropagation();
            recordSecurityBreach('اختصار Ctrl+Shift+J', 'محاولة فتح كونسول المطورين Developer Console');
            return false;
        }

        // Ctrl + Shift + C (Element Inspector Tool)
        if (isCtrlOrCmd && e.shiftKey && (key === 'C' || keyCode === 67)) {
            e.preventDefault();
            e.stopPropagation();
            recordSecurityBreach('اختصار Ctrl+Shift+C', 'محاولة تشغيل أداة تحديد وفحص العناصر');
            return false;
        }

        // Ctrl + U (View Page Source)
        if (isCtrlOrCmd && (key === 'U' || keyCode === 85)) {
            e.preventDefault();
            e.stopPropagation();
            recordSecurityBreach('اختصار Ctrl+U', 'محاولة عرض الكود المصدري للصفحة View Source');
            return false;
        }

        // Ctrl + S (Save Webpage)
        if (isCtrlOrCmd && (key === 'S' || keyCode === 83)) {
            e.preventDefault();
            e.stopPropagation();
            recordSecurityBreach('اختصار Ctrl+S', 'محاولة حفظ ملفات الصفحة محلياً');
            return false;
        }
    }, { capture: true });

    // ==================== 3. DEVTOOLS WINDOW DISPARITY DETECTION ====================
    function checkDevToolsDimensions() {
        const threshold = 180;
        const widthDiff = window.outerWidth - window.innerWidth > threshold;
        const heightDiff = window.outerHeight - window.innerHeight > threshold;

        if (widthDiff || heightDiff) {
            recordSecurityBreach('أبعاد النافذة / DevTools Docked', 'رصد فتح أدوات المطورين عبر تباعد أبعاد الشاشة');
        }
    }

    window.addEventListener('resize', checkDevToolsDimensions);

    console.log('%c🛡️ MEDINEXUS PRO Anti-Inspection Engine Armed', 'color:#00F0FF;font-weight:bold');
})();
