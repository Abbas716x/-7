/* ==================================================================
   MEDINEXUS PRO — Robust Real-Time Firebase Persistence Engine
   ================================================================== */

(function () {
    'use strict';

    // The Exact Production Firebase Configuration
    const firebaseConfig = {
        apiKey: "AIzaSyCd6qs1X8nkcU7Vao9F8Q5qUHXNJ9Bqv7k",
        authDomain: "qre7-f3a35.firebaseapp.com",
        projectId: "qre7-f3a35",
        storageBucket: "qre7-f3a35.appspot.com",
        messagingSenderId: "499634279817",
        appId: "1:499634279817:web:2c9d369e6576ece0b8ffd58",
        measurementId: "G-1SFLXN0RCP"
    };

    let fbApp = null;
    let fbDb = null;
    let fbAuth = null;
    let isCloudReady = false;

    // Standardized Collection Names
    const COLL_USERS = 'users';           // { uid, name, role, phone, username, subPassword, isActive }
    const COLL_TREATMENTS = 'treatments'; // { id, name, defaultPrice, createdAt }
    const COLL_SESSIONS = 'sessions';     // { id, doctorId, doctorName, patientName, patientPhone, treatmentName, finalPrice, session1Date, session2Date }
    const COLL_FINANCES = 'finances';     // { dailyTotal, monthlyTotal, lastResetDate }
    const COLL_DEBTS = 'debts';           // { id, patientName, patientPhone, remainingAmount, createdAt }
    const COLL_ACTIVITIES = 'activities'; // { id, type, title, details, user, role, timestamp }

    // Status Indicator
    function updateStatusIndicator(status, text) {
        try {
            const el = document.getElementById('fb-status');
            const txt = document.getElementById('fb-status-text');
            if (el && txt) {
                el.className = `fb-status ${status}`;
                txt.textContent = text;
            }
        } catch (e) {}
    }

    // Initialize Firebase
    try {
        if (typeof firebase !== 'undefined' && firebase.initializeApp) {
            fbApp = firebase.initializeApp(firebaseConfig);
            fbDb = firebase.firestore();
            fbAuth = firebase.auth();

            // Direct Network Connection (No hanging offline locks)
            fbDb.settings({
                cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED,
                merge: true
            });

            isCloudReady = true;
            updateStatusIndicator('online', 'CONNECTED');
            console.log('%c🔥 Firebase Firestore Cloud Engine Engaged Successfully', 'color:#00F0FF;font-weight:bold');
        } else {
            throw new Error('Firebase SDK is not loaded. Check internet or CDN links.');
        }
    } catch (err) {
        console.error('❌ Firebase Init Error:', err);
        isCloudReady = false;
        updateStatusIndicator('offline', 'OFFLINE');
    }

    // Auth Helper (Silent & Non-Blocking)
    async function ensureAuth() {
        if (!isCloudReady || !fbAuth) return false;
        try {
            if (!fbAuth.currentUser) {
                await fbAuth.signInAnonymously();
            }
            return true;
        } catch (e) {
            // Even if anonymous auth fails, we allow operations to proceed if rules allow public access
            console.warn('[Auth] Anonymous sign-in bypassed or disabled in console.');
            return false;
        }
    }

    // Verify System Seed Documents
    async function verifySeed() {
        if (!isCloudReady || !fbDb) return;
        try {
            await ensureAuth();
            const finRef = fbDb.collection(COLL_FINANCES).doc('summary');
            const snap = await finRef.get();
            if (!snap.exists) {
                await finRef.set({
                    dailyTotal: 0,
                    monthlyTotal: 0,
                    lastResetDate: new Date().toISOString()
                });
            }
        } catch (e) {
            console.warn('[Seed] Notice:', e.message);
        }
    }

    // ==================== 1. USERS & DOCTORS CRUD ====================
    function subscribeDoctors(callback) {
        if (!isCloudReady || !fbDb) return () => {};

        return fbDb.collection(COLL_USERS)
            .where('role', '==', 'doctor')
            .onSnapshot(
                snap => {
                    const list = snap.docs.map(doc => ({ id: doc.id, uid: doc.id, ...doc.data() }));
                    callback(list);
                    updateStatusIndicator('online', 'LIVE');
                },
                err => {
                    console.error('❌ subscribeDoctors Error:', err);
                    updateStatusIndicator('offline', 'SYNC_ERR');
                }
            );
    }

    async function addDoctorCloud(name, phone, username, subPassword) {
        if (!isCloudReady || !fbDb) throw new Error('الاتصال بقاعدة البيانات غير متوفر!');
        await ensureAuth();

        const cleanUser = String(username).trim().toLowerCase();

        // 1. Check for Duplicate Username
        const duplicateCheck = await fbDb.collection(COLL_USERS)
            .where('username', '==', cleanUser)
            .get();

        if (!duplicateCheck.empty) {
            throw new Error('اسم المستخدم مسجل مسبقاً لطبيب آخر!');
        }

        // 2. Insert New Doctor Document
        const uid = 'doc_' + Date.now().toString(36);
        const doctorData = {
            uid,
            name: String(name).trim(),
            phone: String(phone).trim(),
            username: cleanUser,
            subPassword: String(subPassword).trim(),
            role: 'doctor',
            isActive: true,
            createdAt: new Date().toISOString()
        };

        await fbDb.collection(COLL_USERS).doc(uid).set(doctorData);

        // 3. Log Activity
        await logActivityCloud({
            type: 'financial',
            title: `إضافة حساب طبيب: ${doctorData.name}`,
            details: `المعرف: @${doctorData.username} | هاتف: ${doctorData.phone}`,
            user: 'المدير العام',
            role: 'admin'
        });

        console.log('✅ Doctor successfully persisted in Firestore:', doctorData);
        return doctorData;
    }

    async function toggleDoctorSessionStatus(doctorId, currentStatus) {
        if (!isCloudReady || !fbDb) throw new Error('الاتصال بقاعدة البيانات غير متوفر!');
        await ensureAuth();

        const newStatus = !currentStatus;
        await fbDb.collection(COLL_USERS).doc(doctorId).update({
            isActive: newStatus
        });

        await logActivityCloud({
            type: 'breach',
            title: newStatus ? 'تفعيل جلسة طبيب' : 'تجميد جلسة طبيب فورياً',
            details: `تم تغيير حالة الطبيب ID (${doctorId}) إلى: ${newStatus ? 'نشط' : 'مجمد'}`,
            user: 'المدير العام',
            role: 'admin'
        });

        return newStatus;
    }

    async function verifyDoctorCredentials(username, password) {
        if (!isCloudReady || !fbDb) throw new Error('الاتصال بقاعدة البيانات غير متوفر!');
        await ensureAuth();

        const cleanUser = String(username).trim().toLowerCase();
        const cleanPass = String(password).trim();

        const snap = await fbDb.collection(COLL_USERS)
            .where('role', '==', 'doctor')
            .where('username', '==', cleanUser)
            .where('subPassword', '==', cleanPass)
            .get();

        if (snap.empty) {
            throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة!');
        }

        const doctorData = snap.docs[0].data();
        if (doctorData.isActive === false) {
            throw new Error('تم تجميد حسابك وجلستك من قبل الإدارة المركزية.');
        }

        return doctorData;
    }

    // ==================== 2. TREATMENTS CATALOG (REAL-TIME SYNC) ====================
    function subscribeTreatments(callback) {
        if (!isCloudReady || !fbDb) return () => {};

        return fbDb.collection(COLL_TREATMENTS)
            .onSnapshot(
                snap => {
                    const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    // Sort in memory by name
                    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                    callback(list);
                    updateStatusIndicator('online', 'LIVE');
                },
                err => {
                    console.error('❌ subscribeTreatments Error:', err);
                }
            );
    }

    async function addTreatmentCloud(name, defaultPrice) {
        if (!isCloudReady || !fbDb) throw new Error('الاتصال بقاعدة البيانات غير متوفر!');
        await ensureAuth();

        const id = 'trt_' + Date.now().toString(36);
        const item = {
            id,
            name: String(name).trim(),
            defaultPrice: Number(defaultPrice) || 0,
            createdAt: new Date().toISOString()
        };

        await fbDb.collection(COLL_TREATMENTS).doc(id).set(item);
        console.log('✅ Treatment successfully persisted in Firestore:', item);
        return item;
    }

    async function deleteTreatmentCloud(id) {
        if (!isCloudReady || !fbDb) throw new Error('الاتصال بقاعدة البيانات غير متوفر!');
        await ensureAuth();

        await fbDb.collection(COLL_TREATMENTS).doc(id).delete();
        return true;
    }

    // ==================== 3. PATIENT SESSIONS (FAST & RELIABLE) ====================
    function subscribeSessions(callback) {
        if (!isCloudReady || !fbDb) return () => {};

        return fbDb.collection(COLL_SESSIONS)
            .onSnapshot(
                snap => {
                    const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    // Sort descending by createdAt
                    list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                    callback(list);
                },
                err => {
                    console.error('❌ subscribeSessions Error:', err);
                }
            );
    }

    async function recordPatientSessionCloud(sessionData) {
        if (!isCloudReady || !fbDb) throw new Error('الاتصال بالسحابة غير متوفر!');
        await ensureAuth();

        const sessionId = 'sess_' + Date.now().toString(36);
        const fullSession = {
            id: sessionId,
            ...sessionData,
            createdAt: new Date().toISOString()
        };

        updateStatusIndicator('sync', 'SAVING');

        // Step 1: Guaranteed Primary Write (Session Document)
        await fbDb.collection(COLL_SESSIONS).doc(sessionId).set(fullSession);
        console.log('✅ Session document successfully written to Firestore:', fullSession);

        // Step 2: Financial Increment (Parallel & Safe)
        const sessionPrice = Number(sessionData.finalPrice) || 0;
        if (sessionPrice > 0) {
            fbDb.collection(COLL_FINANCES).doc('summary').set({
                dailyTotal: firebase.firestore.FieldValue.increment(sessionPrice)
            }, { merge: true }).catch(err => console.warn('Financial increment notice:', err));
        }

        // Step 3: Activity Log Write
        const actId = 'act_' + Date.now().toString(36);
        fbDb.collection(COLL_ACTIVITIES).doc(actId).set({
            id: actId,
            type: 'session',
            title: `جلسة مراجع: ${sessionData.patientName}`,
            details: `العلاج: ${sessionData.treatmentName} | السعر: ${sessionData.finalPrice} IQD`,
            user: sessionData.doctorName,
            role: 'doctor',
            doctorId: sessionData.doctorId,
            timestamp: new Date().toISOString()
        }).catch(err => console.warn('Activity write notice:', err));

        updateStatusIndicator('online', 'LIVE');
        return fullSession;
    }

    // ==================== 4. ACTIVITIES LOG (REAL-TIME) ====================
    function subscribeActivities(callback) {
        if (!isCloudReady || !fbDb) return () => {};

        return fbDb.collection(COLL_ACTIVITIES)
            .onSnapshot(
                snap => {
                    const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
                    callback(list.slice(0, 60));
                },
                err => {
                    console.error('❌ subscribeActivities Error:', err);
                }
            );
    }

    async function logActivityCloud(activityData) {
        if (!isCloudReady || !fbDb) return;
        try {
            await ensureAuth();
            const id = 'act_' + Date.now().toString(36);
            const record = {
                id,
                ...activityData,
                timestamp: activityData.timestamp || new Date().toISOString()
            };
            await fbDb.collection(COLL_ACTIVITIES).doc(id).set(record);
            return record;
        } catch (e) {
            console.warn('Activity log notice:', e);
        }
    }

    // ==================== 5. FINANCES & SETTLEMENT ====================
    function subscribeFinances(callback) {
        if (!isCloudReady || !fbDb) return () => {};

        return fbDb.collection(COLL_FINANCES).doc('summary').onSnapshot(
            doc => {
                if (doc.exists) {
                    callback(doc.data());
                } else {
                    callback({ dailyTotal: 0, monthlyTotal: 0 });
                }
            },
            err => {
                console.error('❌ subscribeFinances Error:', err);
            }
        );
    }

    async function transferDailyRevenueCloud(currentDaily, currentMonthly) {
        if (!isCloudReady || !fbDb) throw new Error('الاتصال بقاعدة البيانات غير متوفر!');
        await ensureAuth();

        const newMonthly = Number(currentMonthly || 0) + Number(currentDaily || 0);

        await fbDb.collection(COLL_FINANCES).doc('summary').set({
            dailyTotal: 0,
            monthlyTotal: newMonthly,
            lastResetDate: new Date().toISOString()
        }, { merge: true });

        await logActivityCloud({
            type: 'financial',
            title: 'الترحيل المالي اليومي',
            details: `تم ترحيل مبلغ ${currentDaily} IQD إلى الإيراد الشهري وتصفير اليوم`,
            user: 'المدير العام',
            role: 'admin'
        });

        return true;
    }

    // ==================== 6. DEBTS REGISTRY ====================
    function subscribeDebts(callback) {
        if (!isCloudReady || !fbDb) return () => {};

        return fbDb.collection(COLL_DEBTS).onSnapshot(
            snap => {
                const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                callback(list);
            },
            err => {
                console.error('❌ subscribeDebts Error:', err);
            }
        );
    }

    async function addDebtCloud(patientName, patientPhone, remainingAmount) {
        if (!isCloudReady || !fbDb) throw new Error('الاتصال بقاعدة البيانات غير متوفر!');
        await ensureAuth();

        const id = 'debt_' + Date.now().toString(36);
        const debtRecord = {
            id,
            patientName: String(patientName).trim(),
            patientPhone: String(patientPhone).trim(),
            remainingAmount: Number(remainingAmount) || 0,
            status: 'unpaid',
            createdAt: new Date().toISOString()
        };

        await fbDb.collection(COLL_DEBTS).doc(id).set(debtRecord);
        return debtRecord;
    }

    async function payDebtCloud(id, amountPaid, currentRemaining) {
        if (!isCloudReady || !fbDb) throw new Error('الاتصال بقاعدة البيانات غير متوفر!');
        await ensureAuth();

        const newRem = Math.max(0, currentRemaining - amountPaid);
        const newStatus = newRem === 0 ? 'paid' : 'partial';

        await fbDb.collection(COLL_DEBTS).doc(id).update({
            remainingAmount: newRem,
            status: newStatus
        });

        // Add collected amount to daily revenue
        await fbDb.collection(COLL_FINANCES).doc('summary').set({
            dailyTotal: firebase.firestore.FieldValue.increment(Number(amountPaid) || 0)
        }, { merge: true });

        return true;
    }

    // Export Firebase API
    window.MedicalFirebase = {
        init: async function () {
            await ensureAuth();
            await verifySeed();
        },
        verifyDoctorCredentials,
        subscribeDoctors,
        addDoctorCloud,
        toggleDoctorSessionStatus,
        subscribeTreatments,
        addTreatmentCloud,
        deleteTreatmentCloud,
        subscribeSessions,
        recordPatientSessionCloud,
        subscribeActivities,
        logActivityCloud,
        subscribeFinances,
        transferDailyRevenueCloud,
        subscribeDebts,
        addDebtCloud,
        payDebtCloud,
        updateStatusIndicator
    };
})();
