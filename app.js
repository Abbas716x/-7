/* ==================================================================
   MEDINEXUS PRO — Master Clinic Control Engine & Gateway Architecture
   ================================================================== */

(function () {
    'use strict';

    // Core Utilities
    const $ = selector => document.querySelector(selector);
    const $$ = selector => document.querySelectorAll(selector);
    const fmt = n => new Intl.NumberFormat('en-US').format(Math.round(n || 0));

    function pad(n) { return String(n).padStart(2, '0'); }
    function formatDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[m]);
    }

    // Master System State
    const State = {
        currentUser: null,    // { role: 'admin'|'doctor', name, username, phone, uid }
        portalMode: 'admin',  // 'admin' | 'doctor'
        activeAdminView: 'admin-dashboard',
        activityFilter: 'all', // 'all' | 'breach' | 'session'
        finances: { dailyTotal: 0, monthlyTotal: 0 },
        doctors: [],
        treatments: [],
        sessions: [],
        debts: [],
        activities: [],
        generatedMessage: '',
        lastPatientPhone: ''
    };

    // ==================== TOAST NOTIFICATION DISPATCHER ====================
    function toast(msg, type = 'info', duration = 3200) {
        try {
            const wrap = $('#toast-wrap');
            if (!wrap) return;
            const el = document.createElement('div');
            el.className = `toast ${type}`;
            el.textContent = msg;
            wrap.appendChild(el);

            setTimeout(() => {
                el.style.transition = 'all 0.3s cubic-bezier(0.34, 1.5, 0.64, 1)';
                el.style.opacity = '0';
                el.style.transform = 'translateY(-20px) scale(0.9)';
                setTimeout(() => el.remove(), 320);
            }, duration);
        } catch (e) {}
    }

    // ==================== GLASS DIALOG ENGINE ====================
    let alertResolver = null;
    let confirmResolver = null;

    const DialogEngine = {
        alert: function (message, title = 'تنبيه النظام') {
            return new Promise(resolve => {
                alertResolver = resolve;
                $('#sys-alert-title').textContent = title;
                $('#sys-alert-msg').textContent = message;
                openModal('modal-sys-alert');
            });
        },
        resolveAlert: function () {
            closeModal('modal-sys-alert');
            if (alertResolver) {
                const res = alertResolver;
                alertResolver = null;
                res();
            }
        },
        confirm: function (message, title = 'تأكيد الإجراء') {
            return new Promise(resolve => {
                confirmResolver = resolve;
                $('#sys-confirm-title').textContent = title;
                $('#sys-confirm-msg').textContent = message;
                openModal('modal-sys-confirm');
            });
        },
        resolveConfirm: function (val) {
            closeModal('modal-sys-confirm');
            if (confirmResolver) {
                const res = confirmResolver;
                confirmResolver = null;
                res(Boolean(val));
            }
        }
    };
    window.DialogEngine = DialogEngine;

    // Viewport Helpers
    function openModal(id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'flex';
    }
    function closeModal(id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }
    function openDrawer() {
        $('#drawer')?.classList.add('open');
        $('#drawer-overlay')?.classList.add('show');
    }
    function closeDrawer() {
        $('#drawer')?.classList.remove('open');
        $('#drawer-overlay')?.classList.remove('show');
    }

    // Security Context Exporter for security.js
    function getCurrentUserContext() {
        if (State.currentUser) return State.currentUser;
        return { name: 'زائر / شاشة الدخول', role: 'guest', username: 'guest' };
    }

    function showSecurityWarning(type) {
        toast(`⚠️ تنبيه أمني: تم رصد ومنع [${type}] وتسجيل المحاولة في سجل الحركات!`, 'error', 4000);
    }

    // ==================== 1. GLOBAL LOGIN GATEWAY ====================
    async function handleGlobalLogin() {
        const username = $('#login-username').value.trim();
        const password = $('#login-password').value.trim();
        const submitBtn = $('#btn-login-submit');

        if (!username || !password) {
            toast('يرجى ملء جميع الحقول', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'جارِ التحقق والمصادقة...';

        try {
            // A. Check for Master Admin Credentials
            if (username === 'abbbas111' && password === 'QWERT') {
                State.currentUser = {
                    role: 'admin',
                    name: 'المدير العام',
                    username: 'abbbas111'
                };
                localStorage.setItem('medinexus_session', JSON.stringify(State.currentUser));
                enterAppSession('admin');
                toast('مرحباً بك أيها المدير العام (Master Admin) 👋', 'success');
                submitBtn.disabled = false;
                submitBtn.textContent = 'دخول إلى النظام';
                return;
            }

            // B. Check for Doctor Credentials in Firebase
            const doctorData = await window.MedicalFirebase.verifyDoctorCredentials(username, password);

            State.currentUser = {
                role: 'doctor',
                uid: doctorData.uid,
                name: doctorData.name,
                username: doctorData.username,
                phone: doctorData.phone,
                isActive: doctorData.isActive
            };

            localStorage.setItem('medinexus_session', JSON.stringify(State.currentUser));
            enterAppSession('doctor');
            toast(`أهلاً بك دكتور ${doctorData.name} 👋`, 'success');

        } catch (err) {
            toast(err.message || 'بيانات الدخول غير صحيحة!', 'error', 3800);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'دخول إلى النظام';
        }
    }

    function enterAppSession(role) {
        $('#global-login-gate').style.display = 'none';
        $('#app-shell').classList.remove('hidden');

        if (role === 'admin') {
            State.portalMode = 'admin';
            $('#section-admin-portal').classList.add('active');
            $('#section-doctor-portal').classList.remove('active');
            $('#header-role-badge').textContent = 'لوحة الإدارة';
            $('#header-role-badge').className = 'badge badge-cyan text-[10px] py-0.5 px-2';
            $('#btn-header-label').textContent = 'إضافة طبيب';
            $('#btn-hamburger').style.display = 'flex';
            $('#session-user-display').textContent = 'المستخدم: المدير العام';
            switchAdminView(State.activeAdminView || 'admin-dashboard');
        } else {
            State.portalMode = 'doctor';
            $('#section-admin-portal').classList.remove('active');
            $('#section-doctor-portal').classList.add('active');
            $('#header-role-badge').textContent = 'بوابة الطبيب';
            $('#header-role-badge').className = 'badge badge-emerald text-[10px] py-0.5 px-2';
            $('#btn-header-label').textContent = 'إضافة مراجع';
            $('#btn-hamburger').style.display = 'none';
            $('#session-user-display').textContent = `د. ${State.currentUser.name}`;

            $('#doc-active-name').textContent = State.currentUser.name;
            $('#doc-active-phone').textContent = `هاتف: ${State.currentUser.phone} (@${State.currentUser.username})`;
            renderDoctorDashboard();
        }
    }

    function handleGlobalLogout() {
        if (!confirm('هل ترغب بتسجيل الخروج من النظام؟')) return;
        State.currentUser = null;
        localStorage.removeItem('medinexus_session');
        $('#login-username').value = '';
        $('#login-password').value = '';
        $('#app-shell').classList.add('hidden');
        $('#global-login-gate').style.display = 'flex';
        closeDrawer();
        toast('تم تسجيل الخروج بنجاح', 'info');
    }

    function headerQuickAction() {
        if (State.portalMode === 'admin') {
            openAddDoctorModal();
        } else {
            openAddPatientFullScreen();
        }
    }

    function switchAdminView(viewId) {
        State.activeAdminView = viewId;
        $$('.admin-view').forEach(v => v.classList.remove('active'));
        const target = document.getElementById('view-' + viewId);
        if (target) target.classList.add('active');

        $$('#drawer .nav-item').forEach(b => b.classList.remove('active'));
        const btn = $(`#drawer .nav-item[data-view="${viewId}"]`);
        if (btn) btn.classList.add('active');

        closeDrawer();
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    // ==================== 2. ADMIN MODULE: FINANCES ====================
    function renderFinances() {
        const daily = Number(State.finances.dailyTotal) || 0;
        const monthly = Number(State.finances.monthlyTotal) || 0;
        const totalDebts = State.debts.reduce((sum, d) => sum + (Number(d.remainingAmount) || 0), 0);

        $('#stat-daily-rev').textContent = fmt(daily);
        $('#stat-monthly-rev').textContent = fmt(monthly);
        $('#stat-debts-total').textContent = fmt(totalDebts);
    }

    async function transferDailyRevenue() {
        const daily = Number(State.finances.dailyTotal) || 0;
        if (daily <= 0) {
            toast('لا يوجد إيراد يومي لترحيله حالياً (الرصيد 0)', 'warn');
            return;
        }

        const ok = await DialogEngine.confirm(
            `هل تريد بالتأكيد إجراء الترحيل اليومي؟\nسيتم نقل مبلغ (${fmt(daily)} IQD) إلى الإيراد الشهري وتصفير رصيد اليوم ليبدأ يوماً جديداً.`,
            'الترحيل المالي اليومي'
        );
        if (!ok) return;

        try {
            await window.MedicalFirebase.transferDailyRevenueCloud(daily, State.finances.monthlyTotal);
            toast('تم إجراء الترحيل اليومي وتصفير رصيد اليوم بنجاح ✓', 'success');
        } catch (e) {
            toast('حدث خطأ أثناء ترحيل الإيرادات', 'error');
        }
    }

    // ==================== 3. ADMIN MODULE: DOCTORS MANAGEMENT ====================
    function renderDoctors() {
        const grid = $('#doctors-cards-grid');
        if (!grid) return;

        if (State.doctors.length === 0) {
            grid.innerHTML = `
                <div class="glass p-10 text-center col-span-full">
                    <div class="text-5xl mb-3 opacity-40">👨‍⚕️</div>
                    <h3 class="text-xl font-bold text-white mb-2">لا يوجد أطباء مسجلين حتى الآن</h3>
                    <p class="text-gray-400 text-xs mb-4">أضف الطبيب الأول لمنحه صلاحية تسجيل الجلسات</p>
                    <button class="btn btn-primary" onclick="window.ClinicEngine.openAddDoctorModal()">+ إضافة طبيب الآن</button>
                </div>
            `;
            return;
        }

        grid.innerHTML = State.doctors.map(doc => {
            const docSessionsToday = getDoctorTodaySessions(doc.uid);
            const todayRev = docSessionsToday.reduce((sum, s) => sum + (Number(s.finalPrice) || 0), 0);
            const isActive = doc.isActive !== false;

            return `
                <div class="doctor-item-card ${!isActive ? 'frozen' : ''}" id="doc-card-${doc.uid}">
                    <div class="flex items-start justify-between mb-4">
                        <div class="flex items-center gap-3">
                            <div class="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center text-2xl shadow-lg">
                                👨‍⚕️
                            </div>
                            <div>
                                <h4 class="font-bold text-white text-base font-tajawal">${escapeHtml(doc.name)}</h4>
                                <div class="flex items-center gap-2 mt-1">
                                    <span class="text-xs text-cyan-400 font-mono">@${escapeHtml(doc.username)}</span>
                                    <span class="badge ${isActive ? 'badge-emerald' : 'badge-pink'} text-[9px]">
                                        ${isActive ? '● الجلسة نشطة' : '❄️ مجمد / مقفل'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <!-- Session Kill Switch -->
                        <div class="switch-container" title="${isActive ? 'إيقاف / تجميد الجلسة' : 'استئناف وتفعيل الجلسة'}" onclick="window.ClinicEngine.toggleDoctorFreeze('${doc.uid}', ${isActive})">
                            <div class="switch-track ${isActive ? 'active' : ''}">
                                <div class="switch-thumb"></div>
                            </div>
                        </div>
                    </div>

                    <div class="p-3.5 rounded-xl bg-black/40 border border-white/5 mb-4 grid grid-cols-2 gap-2 font-mono text-xs">
                        <div>
                            <span class="text-gray-400 text-[10px] block">إيراد الطبيب اليوم:</span>
                            <span class="font-bold text-emerald-400 text-sm">${fmt(todayRev)} IQD</span>
                        </div>
                        <div>
                            <span class="text-gray-400 text-[10px] block">مرضى اليوم:</span>
                            <span class="font-bold text-cyan-400 text-sm">${docSessionsToday.length} جلسة</span>
                        </div>
                    </div>

                    <div class="flex items-center justify-between pt-2 border-t border-white/10 text-xs">
                        <span class="text-gray-400 font-mono">${escapeHtml(doc.phone || '—')}</span>
                        <button class="btn btn-ghost py-1.5 px-3 text-xs text-cyan-400" onclick="window.ClinicEngine.openDoctorDetailsModal('${doc.uid}')">
                            عرض قائمة المرضى (${docSessionsToday.length}) ←
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function getDoctorTodaySessions(doctorId) {
        const todayStr = new Date().toISOString().slice(0, 10);
        return State.sessions.filter(s => {
            const matchesDoc = s.doctorId === doctorId;
            const matchesDate = s.createdAt && s.createdAt.slice(0, 10) === todayStr;
            return matchesDoc && matchesDate;
        });
    }

    async function toggleDoctorFreeze(doctorId, currentStatus) {
        const targetDoc = State.doctors.find(d => d.uid === doctorId || d.id === doctorId);
        if (!targetDoc) return;

        const actionText = currentStatus ? 'تجميد وإيقاف جلسة' : 'إعادة تفعيل جلسة';
        const ok = await DialogEngine.confirm(
            `هل تؤكد ${actionText} الطبيب "${targetDoc.name}"؟\n${currentStatus ? 'سيتم حظر تسجيل دخوله ومنعه من حفظ الجلسات فوراً.' : 'سيتم السماح له بتسجيل الدخول والعمل مجدداً.'}`,
            'مفتاح إيقاف الجلسة (Session Kill Switch)'
        );
        if (!ok) return;

        try {
            await window.MedicalFirebase.toggleDoctorSessionStatus(doctorId, currentStatus);
            toast(`تم ${currentStatus ? 'تجميد جلسة' : 'تفعيل'} الطبيب بنجاح`, currentStatus ? 'warn' : 'success');
        } catch (e) {
            toast('تعذر تحديث حالة الطبيب', 'error');
        }
    }

    function openDoctorDetailsModal(doctorId) {
        const doc = State.doctors.find(d => d.uid === doctorId || d.id === doctorId);
        if (!doc) return;

        const docSessions = State.sessions.filter(s => s.doctorId === doctorId);
        const todaySessions = getDoctorTodaySessions(doctorId);
        const todayRev = todaySessions.reduce((sum, s) => sum + (Number(s.finalPrice) || 0), 0);

        $('#modal-doc-title-name').textContent = doc.name;
        $('#modal-doc-title-user').textContent = `اسم المستخدم: ${doc.username} • هاتف: ${doc.phone}`;
        $('#modal-doc-today-rev').textContent = `${fmt(todayRev)} IQD`;

        const listEl = $('#modal-doc-patients-list');
        if (docSessions.length === 0) {
            listEl.innerHTML = `<div class="p-6 text-center text-gray-500 text-xs">لم يقم هذا الطبيب بتسجيل أي جلسات بعد.</div>`;
        } else {
            listEl.innerHTML = docSessions.map(s => `
                <div class="p-3.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between text-xs">
                    <div>
                        <div class="font-bold text-white text-sm">${escapeHtml(s.patientName)}</div>
                        <div class="text-[11px] text-gray-400 mt-0.5">العلاج: ${escapeHtml(s.treatmentName)} • هاتف: ${escapeHtml(s.patientPhone)}</div>
                        <div class="text-[10px] text-cyan-400/80 font-mono mt-1">تاريخ الجلسة: ${formatDate(s.createdAt)}</div>
                    </div>
                    <div class="text-left font-mono">
                        <div class="font-black text-emerald-400 text-sm">${fmt(s.finalPrice)} IQD</div>
                        <div class="text-[10px] text-gray-400">الجلسة 2: ${formatDate(s.session2Date)}</div>
                    </div>
                </div>
            `).join('');
        }

        openModal('modal-doctor-details');
    }

    function openAddDoctorModal() {
        $('#new-doc-name').value = '';
        $('#new-doc-phone').value = '';
        $('#new-doc-username').value = '';
        $('#new-doc-password').value = '';
        openModal('modal-add-doctor');
        setTimeout(() => $('#new-doc-name').focus(), 150);
    }

    async function confirmCreateDoctor() {
        const name = $('#new-doc-name').value.trim();
        const phone = $('#new-doc-phone').value.trim();
        const username = $('#new-doc-username').value.trim();
        const password = $('#new-doc-password').value.trim();

        if (!name || !phone || !username || !password) {
            toast('يرجى ملء جميع الحقول', 'error');
            return;
        }

        try {
            await window.MedicalFirebase.addDoctorCloud(name, phone, username, password);
            closeModal('modal-add-doctor');
            toast(`تم إنشاء وتفعيل حساب الطبيب "${name}" بنجاح ✓`, 'success');
        } catch (err) {
            toast(err.message || 'حدث خطأ أثناء إنشاء حساب الطبيب', 'error');
        }
    }

    // ==================== 4. ADMIN MODULE: TREATMENTS CATALOG ====================
    function renderTreatments() {
        const tbody = $('#treatments-table-body');
        const select = $('#pt-treatment-select');

        if (tbody) {
            if (State.treatments.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-500">لا توجد علاجات في الكتالوج المركزي</td></tr>`;
            } else {
                tbody.innerHTML = State.treatments.map(t => `
                    <tr class="hover:bg-cyan-500/5 transition-colors">
                        <td class="p-4 font-bold text-white text-sm">${escapeHtml(t.name)}</td>
                        <td class="p-4 font-mono font-bold text-emerald-400">${fmt(t.defaultPrice)} IQD</td>
                        <td class="p-4 text-gray-400 font-mono text-[11px]">${formatDate(t.createdAt)}</td>
                        <td class="p-4 text-center">
                            <button class="btn btn-ghost py-1 px-2.5 text-xs text-pink-500 border-pink-500/30" onclick="window.ClinicEngine.deleteTreatment('${t.id}')">
                                🗑 حذف
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
        }

        // Real-Time Sync to Doctor Mobile Dropdown
        if (select) {
            const currentSelected = select.value;
            select.innerHTML = '<option value="">-- اختر نوع العلاج من الكتالوج المركزي --</option>' +
                State.treatments.map(t => `
                    <option value="${t.id}" data-price="${t.defaultPrice}" ${t.id === currentSelected ? 'selected' : ''}>
                        ${escapeHtml(t.name)} — (${fmt(t.defaultPrice)} IQD)
                    </option>
                `).join('');
        }
    }

    function openAddTreatmentModal() {
        $('#new-trt-name').value = '';
        $('#new-trt-price').value = '';
        openModal('modal-add-treatment');
        setTimeout(() => $('#new-trt-name').focus(), 150);
    }

    async function confirmCreateTreatment() {
        const name = $('#new-trt-name').value.trim();
        const price = Number($('#new-trt-price').value) || 0;

        if (!name) {
            toast('أدخل اسم العلاج أولاً', 'error');
            return;
        }

        try {
            await window.MedicalFirebase.addTreatmentCloud(name, price);
            closeModal('modal-add-treatment');
            toast(`تمت إضافة علاج "${name}" بنجاح ✓`, 'success');
        } catch (e) {
            toast('تعذر إضافة العلاج', 'error');
        }
    }

    async function deleteTreatment(id) {
        const trt = State.treatments.find(t => t.id === id);
        if (!trt) return;

        const ok = await DialogEngine.confirm(`هل أنت متأكد من حذف علاج "${trt.name}" من الكتالوج المركزي؟`, 'حذف علاج');
        if (!ok) return;

        try {
            await window.MedicalFirebase.deleteTreatmentCloud(id);
            toast('تم حذف العلاج من الكتالوج', 'warn');
        } catch (e) {
            toast('تعذر حذف العلاج', 'error');
        }
    }

    // ==================== 5. ADMIN MODULE: ACTIVITIES & BREACHES ====================
    function renderActivities() {
        const container = $('#activities-log-container');
        if (!container) return;

        let list = State.activities.slice();
        if (State.activityFilter === 'breach') {
            list = list.filter(a => a.type === 'breach');
        } else if (State.activityFilter === 'session') {
            list = list.filter(a => a.type === 'session');
        }

        if (list.length === 0) {
            container.innerHTML = `<div class="p-8 text-center text-gray-500 text-xs font-tajawal">لا توجد حركات أو نشاطات مسجلة في هذا التصنيف ✓</div>`;
            return;
        }

        container.innerHTML = list.map(act => {
            const isBreach = act.type === 'breach';
            const isSession = act.type === 'session';
            const badgeClass = isBreach ? 'badge-rose' : (isSession ? 'badge-cyan' : 'badge-emerald');
            const itemClass = isBreach ? 'activity-breach' : (isSession ? 'activity-session' : 'activity-financial');
            const icon = isBreach ? '🚨' : (isSession ? '🩺' : '💵');

            return `
                <div class="activity-item ${itemClass}">
                    <div class="flex items-start gap-3">
                        <div class="text-2xl mt-0.5">${icon}</div>
                        <div>
                            <div class="flex items-center gap-2">
                                <h5 class="font-bold text-white text-xs">${escapeHtml(act.title)}</h5>
                                <span class="badge ${badgeClass} text-[9px]">${escapeHtml(act.type.toUpperCase())}</span>
                            </div>
                            <p class="text-[11px] text-gray-300 mt-1 leading-relaxed">${escapeHtml(act.details || '')}</p>
                            <span class="text-[10px] text-cyan-400 font-mono mt-1 block">
                                الفاعل: ${escapeHtml(act.user || 'نظام')} (${escapeHtml(act.role || '-')})
                            </span>
                        </div>
                    </div>
                    <div class="text-left font-mono text-[10px] text-gray-400 whitespace-nowrap">
                        ${formatDate(act.timestamp)}
                    </div>
                </div>
            `;
        }).join('');
    }

    function filterActivities(type) {
        State.activityFilter = type;
        renderActivities();
    }

    // ==================== 6. ADMIN MODULE: DEBTS REGISTRY ====================
    function renderDebts(filterQuery = '') {
        const tbody = $('#debts-table-body');
        const fullContainer = $('#full-debts-container');
        if (!tbody) return;

        let list = State.debts.slice();
        if (filterQuery) {
            const q = filterQuery.toLowerCase().trim();
            list = list.filter(d => (d.patientName || '').toLowerCase().includes(q) || (d.patientPhone || '').includes(q));
        }

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-500 font-tajawal">سجل الديون خالي تماماً ✓</td></tr>`;
            if (fullContainer) fullContainer.innerHTML = `<div class="p-8 text-center text-gray-500">لا توجد ديون مسجلة</div>`;
            return;
        }

        const html = list.map(d => {
            const rem = Number(d.remainingAmount) || 0;
            const isPaid = rem <= 0;
            return `
                <tr class="hover:bg-cyan-500/5 transition-colors">
                    <td class="p-3.5 font-bold text-white text-sm">${escapeHtml(d.patientName)}</td>
                    <td class="p-3.5 font-mono text-cyan-300 text-xs">${escapeHtml(d.patientPhone || '—')}</td>
                    <td class="p-3.5 font-mono font-black ${isPaid ? 'text-emerald-400' : 'text-pink-500'} text-sm">${fmt(rem)} IQD</td>
                    <td class="p-3.5 text-gray-400 font-mono text-[11px]">${formatDate(d.createdAt)}</td>
                    <td class="p-3.5">
                        <span class="badge ${isPaid ? 'badge-emerald' : 'badge-pink'} text-[10px]">
                            ${isPaid ? '✓ مسدد بالكامل' : 'مستحق'}
                        </span>
                    </td>
                    <td class="p-3.5 text-center">
                        ${!isPaid ? `
                            <button class="btn btn-success py-1 px-3 text-xs" onclick="window.ClinicEngine.openPayDebtPrompt('${d.id}', ${rem})">
                                💵 تسديد
                            </button>
                        ` : `
                            <span class="text-emerald-400 text-xs font-bold font-tajawal">منتهي</span>
                        `}
                    </td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = html;
        if (fullContainer) {
            fullContainer.innerHTML = `
                <div class="overflow-x-auto no-scrollbar">
                    <table class="w-full text-right text-xs">
                        <thead class="bg-black/40 border-b border-cyan-500/20 text-cyan-400 font-mono">
                            <tr>
                                <th class="p-3.5">اسم المريض</th>
                                <th class="p-3.5">الهاتف</th>
                                <th class="p-3.5">المتبقي</th>
                                <th class="p-3.5">تاريخ القيد</th>
                                <th class="p-3.5">الحالة</th>
                                <th class="p-3.5 text-center">إجراء</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-white/5 font-tajawal">${html}</tbody>
                    </table>
                </div>
            `;
        }
    }

    function filterDebts(q) { renderDebts(q); }

    function openAddDebtModal() {
        $('#new-debt-patient').value = '';
        $('#new-debt-phone').value = '';
        $('#new-debt-amount').value = '';
        openModal('modal-add-debt');
        setTimeout(() => $('#new-debt-patient').focus(), 150);
    }

    async function confirmCreateDebt() {
        const patient = $('#new-debt-patient').value.trim();
        const phone = $('#new-debt-phone').value.trim();
        const amount = Number($('#new-debt-amount').value) || 0;

        if (!patient || amount <= 0) {
            toast('أدخل اسم المريض ومبلغاً صحيحاً', 'error');
            return;
        }

        try {
            await window.MedicalFirebase.addDebtCloud(patient, phone, amount);
            closeModal('modal-add-debt');
            toast(`تم تسجيل دين بقيمة ${fmt(amount)} IQD للمريض "${patient}"`, 'success');
        } catch (e) {
            toast('تعذر تسجيل الدين', 'error');
        }
    }

    async function openPayDebtPrompt(debtId, currentRem) {
        const payStr = prompt(`المبلغ المتبقي: ${fmt(currentRem)} IQD\nأدخل المبلغ المراد تسديده الآن:`, String(currentRem));
        if (!payStr) return;

        const amount = Number(payStr) || 0;
        if (amount <= 0 || amount > currentRem) {
            toast('المبلغ المدخل غير صالح', 'error');
            return;
        }

        try {
            await window.MedicalFirebase.payDebtCloud(debtId, amount, currentRem);
            toast(`تم تسديد ${fmt(amount)} IQD بنجاح ✓`, 'success');
        } catch (e) {
            toast('حدث خطأ أثناء معالجة التسديد', 'error');
        }
    }

    // ==================== 7. ADMIN MODULE: SESSIONS ARCHIVE ====================
    function renderSessions() {
        const tbody = $('#all-sessions-table-body');
        if (!tbody) return;

        if (State.sessions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-gray-500">لا توجد جلسات مسجلة بعد</td></tr>`;
            return;
        }

        tbody.innerHTML = State.sessions.map(s => `
            <tr class="hover:bg-cyan-500/5 transition-colors">
                <td class="p-3.5 font-bold text-white text-sm">${escapeHtml(s.patientName)}</td>
                <td class="p-3.5 font-mono text-cyan-300 text-xs">${escapeHtml(s.patientPhone || '—')}</td>
                <td class="p-3.5 text-white font-tajawal font-bold">${escapeHtml(s.doctorName)}</td>
                <td class="p-3.5 text-gray-300">${escapeHtml(s.treatmentName)}</td>
                <td class="p-3.5 font-mono font-black text-emerald-400">${fmt(s.finalPrice)} IQD</td>
                <td class="p-3.5 text-gray-400 font-mono text-[11px]">${formatDate(s.session1Date || s.createdAt)}</td>
                <td class="p-3.5 text-cyan-400 font-mono text-[11px]">${formatDate(s.session2Date)}</td>
            </tr>
        `).join('');
    }

    function exportSessionsCSV() {
        if (State.sessions.length === 0) {
            toast('لا توجد جلسات لتصديرها', 'warn');
            return;
        }

        const rows = [['Patient Name', 'Phone', 'Doctor', 'Treatment', 'Final Price', 'Session 1', 'Session 2 Follow-Up']];
        State.sessions.forEach(s => {
            rows.push([s.patientName, s.patientPhone, s.doctorName, s.treatmentName, s.finalPrice, s.session1Date || s.createdAt, s.session2Date]);
        });

        const csvContent = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `MediNexus_Sessions_${Date.now()}.csv`;
        link.click();
        toast('تم تصدير سجل الجلسات بنجاح (CSV) ✓', 'success');
    }

    // ==================== 8. DOCTOR PORTAL & WHATSAPP INTEGRATION ====================
    function renderDoctorDashboard() {
        if (!State.currentUser || State.currentUser.role !== 'doctor') return;

        const mySessionsToday = getDoctorTodaySessions(State.currentUser.uid);
        const myRevToday = mySessionsToday.reduce((sum, s) => sum + (Number(s.finalPrice) || 0), 0);

        $('#doc-stat-today-revenue').textContent = fmt(myRevToday);
        $('#doc-stat-today-patients').textContent = mySessionsToday.length;

        const list = $('#doctor-patients-list');
        if (mySessionsToday.length === 0) {
            list.innerHTML = `
                <div class="text-center py-10 border border-dashed border-cyan-500/20 rounded-2xl">
                    <div class="text-4xl mb-2 opacity-40">🩺</div>
                    <p class="text-gray-400 text-xs font-tajawal">لم تسجل أي جلسات اليوم بعد</p>
                    <p class="text-gray-500 text-[11px] mt-1 font-tajawal">اضغط الزر أعلاه لإضافة أول مراجع</p>
                </div>
            `;
        } else {
            list.innerHTML = mySessionsToday.map(s => `
                <div class="p-3.5 rounded-2xl bg-black/40 border border-white/10 hover:border-cyan-400/30 transition-all">
                    <div class="flex items-center justify-between mb-1.5">
                        <span class="font-bold text-white text-sm">${escapeHtml(s.patientName)}</span>
                        <span class="font-mono font-black text-emerald-400 text-sm">${fmt(s.finalPrice)} IQD</span>
                    </div>
                    <div class="text-xs text-gray-300 font-tajawal">العلاج: ${escapeHtml(s.treatmentName)}</div>
                    <div class="flex items-center justify-between mt-2 pt-2 border-t border-white/5 text-[10px] text-gray-400 font-mono">
                        <span>جلسة 2: ${formatDate(s.session2Date)}</span>
                        <span>${formatDate(s.createdAt).slice(11)}</span>
                    </div>
                </div>
            `).join('');
        }
    }

    function openAddPatientFullScreen() {
        if (!State.currentUser || State.currentUser.role !== 'doctor') return;

        $('#pt-name').value = '';
        $('#pt-phone').value = '';
        $('#pt-treatment-select').value = '';
        $('#pt-final-price').value = '';
        $('#pt-base-price-hint').textContent = 'السعر الافتراضي: 0';

        const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        nextWeek.setHours(10, 0, 0, 0);
        const isoLocal = new Date(nextWeek.getTime() - nextWeek.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        $('#pt-session2-date').value = isoLocal;

        $('#doctor-view-add-patient').classList.remove('hidden');
        setTimeout(() => $('#pt-name').focus(), 150);
    }

    function closeAddPatientFullScreen() {
        $('#doctor-view-add-patient').classList.add('hidden');
    }

    function onTreatmentSelectChange(treatmentId) {
        const trt = State.treatments.find(t => t.id === treatmentId);
        if (trt) {
            $('#pt-final-price').value = trt.defaultPrice;
            $('#pt-base-price-hint').textContent = `السعر الافتراضي: ${fmt(trt.defaultPrice)} IQD`;
        } else {
            $('#pt-final-price').value = '';
            $('#pt-base-price-hint').textContent = 'السعر الافتراضي: 0';
        }
    }

    // 🚀 FIXED PATIENT SESSION SUBMISSION & AUTOMATIC WHATSAPP INTEGRATION
    async function submitPatientSession() {
        if (!State.currentUser || State.currentUser.role !== 'doctor') {
            toast('جلسة الطبيب غير صالحة', 'error');
            return;
        }

        const patientName = $('#pt-name').value.trim();
        const patientPhone = $('#pt-phone').value.trim();
        const treatmentSelect = $('#pt-treatment-select');
        const treatmentId = treatmentSelect.value;
        const finalPrice = Number($('#pt-final-price').value) || 0;
        const session2Date = $('#pt-session2-date').value;

        if (!patientName || !patientPhone || !treatmentId || !session2Date) {
            toast('يرجى ملء جميع الحقول المطلوبة', 'error');
            return;
        }

        const selectedOption = treatmentSelect.options[treatmentSelect.selectedIndex];
        const treatmentName = selectedOption ? selectedOption.text.split('—')[0].trim() : 'علاج طبي';

        const nowIso = new Date().toISOString();
        const formattedNow = formatDate(nowIso);
        const formattedSession2 = formatDate(session2Date);

        // Required Exact Message Template (قالب الرسالة المطلوب نصاً)
        const notificationText = 
`مرحباً بك في عيادة الدكتور ${State.currentUser.name}
اسم المريض: ${patientName}
الجلسة الأولى
اسم العلاج: ${treatmentName}
سعره: ${fmt(finalPrice)} IQD
تاريخ الجلسة الأولى: ${formattedNow}
موعد الجلسة الثانية والوقت والتاريخ: ${formattedSession2}`;

        const sessionPayload = {
            doctorId: State.currentUser.uid,
            doctorName: State.currentUser.name,
            doctorPhone: State.currentUser.phone,
            patientName,
            patientPhone,
            treatmentName,
            finalPrice,
            session1Date: nowIso,
            session2Date
        };

        const submitBtn = $('#btn-submit-patient');
        submitBtn.disabled = true;
        submitBtn.textContent = 'جارِ حفظ الجلسة...';

        try {
            // Reliable Fast Async Firestore Write (Won't Hang)
            await window.MedicalFirebase.recordPatientSessionCloud(sessionPayload);

            closeAddPatientFullScreen();
            renderDoctorDashboard();
            toast('تم حفظ الجلسة بنجاح ✓ جارِ فتح تطبيق WhatsApp...', 'success');

            // Trigger Direct WhatsApp Message to Patient Phone
            triggerDirectWhatsApp(patientPhone, notificationText);

        } catch (err) {
            console.error('Session save error:', err);
            toast('حدث خطأ أثناء معالجة الجلسة، حاول ثانية.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '✓ حفظ الجلسة وإرسال إشعار WhatsApp فوراً';
        }
    }

    function triggerDirectWhatsApp(patientPhone, message) {
        let phone = String(patientPhone || '').replace(/\D/g, '');
        // Standardize Iraqi phone format
        if (phone.startsWith('07')) phone = '964' + phone.slice(1);
        if (phone.startsWith('7')) phone = '964' + phone;

        const encodedMsg = encodeURIComponent(message);
        const waUrl = phone ? `https://wa.me/${phone}?text=${encodedMsg}` : `https://wa.me/?text=${encodedMsg}`;

        // Attempt instant window open; fallback to prompt link
        try {
            const win = window.open(waUrl, '_blank');
            if (!win || win.closed || typeof win.closed === 'undefined') {
                window.location.href = waUrl;
            }
        } catch (e) {
            window.location.href = waUrl;
        }
    }

    // ==================== 9. INITIALIZATION PIPELINE ====================
    async function initSystem() {
        // Initialize Firebase
        await window.MedicalFirebase.init();

        // Check if existing session in storage
        const cachedSession = localStorage.getItem('medinexus_session');
        if (cachedSession) {
            try {
                State.currentUser = JSON.parse(cachedSession);
                enterAppSession(State.currentUser.role);
            } catch (e) {
                localStorage.removeItem('medinexus_session');
            }
        }

        // Live Real-Time Subscriptions
        window.MedicalFirebase.subscribeFinances(data => {
            State.finances = data || { dailyTotal: 0, monthlyTotal: 0 };
            renderFinances();
        });

        window.MedicalFirebase.subscribeTreatments(list => {
            State.treatments = list || [];
            renderTreatments();
        });

        window.MedicalFirebase.subscribeDoctors(list => {
            State.doctors = list || [];
            renderDoctors();

            // Real-time security verification for active doctor
            if (State.currentUser && State.currentUser.role === 'doctor') {
                const liveMe = State.doctors.find(d => d.uid === State.currentUser.uid);
                if (liveMe && liveMe.isActive === false) {
                    handleGlobalLogout();
                    DialogEngine.alert('🚨 تم تجميد وإيقاف حسابك من قبل الإدارة المركزية.', 'حساب معلق');
                }
            }
        });

        window.MedicalFirebase.subscribeSessions(list => {
            State.sessions = list || [];
            renderSessions();
            renderDoctors();
            if (State.currentUser && State.currentUser.role === 'doctor') {
                renderDoctorDashboard();
            }
        });

        window.MedicalFirebase.subscribeDebts(list => {
            State.debts = list || [];
            renderDebts();
            renderFinances();
        });

        window.MedicalFirebase.subscribeActivities(list => {
            State.activities = list || [];
            renderActivities();
        });

        // Live Clock
        setInterval(() => {
            const clockEl = $('#live-clock');
            if (clockEl) clockEl.textContent = new Date().toLocaleTimeString('en-GB');
        }, 1000);

        // Escape Key Modal Dismissal
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                ['modal-add-doctor', 'modal-doctor-details', 'modal-add-treatment', 'modal-add-debt', 'modal-sys-alert', 'modal-sys-confirm'].forEach(id => closeModal(id));
                closeDrawer();
                if (!$('#doctor-view-add-patient').classList.contains('hidden')) {
                    closeAddPatientFullScreen();
                }
            }
        });

        console.log('%c🚀 MEDINEXUS PRO Master Enterprise Core Ready', 'color:#00F0FF;font-weight:900');
    }

    // Public Surface Bindings
    window.ClinicEngine = {
        openDrawer, closeDrawer,
        handleGlobalLogin, handleGlobalLogout,
        switchAdminView, headerQuickAction,
        transferDailyRevenue,
        openAddDoctorModal, confirmCreateDoctor, openDoctorDetailsModal, toggleDoctorFreeze,
        openAddTreatmentModal, confirmCreateTreatment, deleteTreatment,
        openAddDebtModal, confirmCreateDebt, filterDebts, openPayDebtPrompt,
        exportSessionsCSV,
        filterActivities,
        openAddPatientFullScreen, closeAddPatientFullScreen, onTreatmentSelectChange, submitPatientSession,
        getCurrentUserContext, showSecurityWarning,
        closeModal
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSystem);
    } else {
        initSystem();
    }
})();
