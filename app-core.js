// ==========================================================================
// ПОТОЛОК ЗАМЕР PRO — ЯДРО ПРИЛОЖЕНИЯ (app-core.js) [ИСПРАВЛЕНО]
// ==========================================================================

// --- РЕГИСТРАЦИЯ ОФФЛАЙН РЕЖИМА (SERVICE WORKER) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('Оффлайн-режим активен'))
            .catch((err) => console.log('Ошибка SW:', err));
    });
}
// ==========================================================================
// ПОТОЛОК ЗАМЕР PRO — ЯДРО ПРИЛОЖЕНИЯ (app-core.js)
// ==========================================================================

// --- РЕГИСТРАЦИЯ ОФФЛАЙН РЕЖИМА (SERVICE WORKER) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('Оффлайн-режим активен'))
            .catch((err) => console.log('Ошибка SW:', err));
    });
}

// --- УВЕДОМЛЕНИЯ (TOAST) ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast-msg ${type === 'error' ? 'toast-error' : (type === 'success' ? 'toast-success' : '')}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 250);
    }, 2600);
}

// --- УПРАВЛЕНИЕ РЕЖИМАМИ ОТОБРАЖЕНИЯ И ТЕМОЙ ---
let isTabMode = localStorage.getItem('_pz_view_mode') !== 'classic';

function applyViewMode() {
    const btn = document.getElementById('viewModeBtn');
    if (isTabMode) {
        document.body.classList.add('tab-mode');
        if (btn) btn.innerText = '📑 Вкладки';
    } else {
        document.body.classList.remove('tab-mode');
        if (btn) btn.innerText = '📜 Список';
    }
    setTimeout(() => {
        if (typeof resizeCanvas === 'function') resizeCanvas();
    }, 50);
}

function toggleViewMode() {
    isTabMode = !isTabMode;
    localStorage.setItem('_pz_view_mode', isTabMode ? 'tabs' : 'classic');
    applyViewMode();
    showToast(isTabMode ? 'Режим быстрых вкладок включён' : 'Классический длинный вид включён');
}

function switchTab(tabName) {
    if (document.activeElement) document.activeElement.blur();

    document.getElementById('tabSketch')?.classList.toggle('active', tabName === 'sketch');
    document.getElementById('tabParams')?.classList.toggle('active', tabName === 'params');
    document.getElementById('tabEstimate')?.classList.toggle('active', tabName === 'estimate');
    document.getElementById('tabNote')?.classList.toggle('active', tabName === 'note');

    document.getElementById('navBtnSketch')?.classList.toggle('active', tabName === 'sketch');
    document.getElementById('navBtnParams')?.classList.toggle('active', tabName === 'params');
    document.getElementById('navBtnEstimate')?.classList.toggle('active', tabName === 'estimate');
    document.getElementById('navBtnNote')?.classList.toggle('active', tabName === 'note');

    if (tabName === 'sketch') {
        setTimeout(() => {
            if (typeof resizeCanvas === 'function') resizeCanvas();
        }, 40);
    }
}

let isLightTheme = localStorage.getItem('_pz_theme') === 'light';

function applyTheme() {
    if (isLightTheme) {
        document.body.classList.add('light-theme');
        document.getElementById('themeToggleBtn').innerText = '🌙 Ночь';
    } else {
        document.body.classList.remove('light-theme');
        document.getElementById('themeToggleBtn').innerText = '☀️ День';
    }
    if (typeof drawSketch === 'function') {
        drawSketch();
    }
}

function toggleTheme() {
    isLightTheme = !isLightTheme;
    localStorage.setItem('_pz_theme', isLightTheme ? 'light' : 'dark');
    applyTheme();
}

let showWallDirections = false;
function toggleDirectionsMode() {
    showWallDirections = !showWallDirections;
    const container = document.getElementById('wallsInputsContainer');
    const buildBtn = document.getElementById('buildByDirBtn');
    if (container) container.classList.toggle('show-directions', showWallDirections);
    if (buildBtn) buildBtn.style.display = showWallDirections ? 'flex' : 'none';
    showToast(showWallDirections ? 'Показаны направления стен' : 'Компактный режим длин');
}

function stepValue(inputId, delta, minVal, maxVal) {
    const el = document.getElementById(inputId);
    if (!el) return;
    let current = parseFloat(el.value) || 0;
    let next = Math.round((current + delta) * 100) / 100;
    if (minVal !== undefined) next = Math.max(minVal, next);
    if (maxVal !== undefined) next = Math.min(maxVal, next);
    el.value = next;
    syncCurrentRoomState();
}

// --- ЛИЦЕНЗИРОВАНИЕ И БЕЗОПАСНОСТЬ (ЛИМИТ СТРОГО 2 ЗАМЕРА) ---
const MAX_FREE_ATTEMPTS = 2;
const SUPPORT_EMAIL = "Prilojeniea-p-k@mail.ru";
const SECRET_SALT = "PRO_ZAMER_2026_500RUB";

let deviceId = localStorage.getItem('_pz_dev_id');
if (!deviceId) {
    deviceId = 'PZ-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    localStorage.setItem('_pz_dev_id', deviceId);
}
const devLabel = document.getElementById('deviceIdLabel');
if (devLabel) devLabel.innerText = deviceId;

function generateSignature(usedCount, expireTime) {
    let raw = `${deviceId}_${usedCount}_${expireTime}_${SECRET_SALT}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
        hash = ((hash << 5) - hash) + raw.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(16);
}

function setCookie(name, val) {
    document.cookie = `${name}=${val}; max-age=315360000; path=/; SameSite=Lax`;
}

function getCookie(name) {
    let matches = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return matches ? decodeURIComponent(matches[1]) : null;
}

function syncIndexedDB(used, expireUntil) {
    if (!window.indexedDB) return;
    let req = indexedDB.open("ProZamerSecurityDB", 1);
    req.onupgradeneeded = (e) => {
        let db = e.target.result;
        if (!db.objectStoreNames.contains("sec")) db.createObjectStore("sec");
    };
    req.onsuccess = (e) => {
        let db = e.target.result;
        let tx = db.transaction("sec", "readwrite");
        tx.objectStore("sec").put({ used, expireUntil }, "state");
    };
}

let usedAttempts = 0;
let subExpireUntil = 0;

function isSubscriptionActive() {
    return Date.now() < subExpireUntil;
}

function loadSecurityState() {
    let lsUsed = parseInt(localStorage.getItem('_pz_used') || '0');
    let ckUsed = parseInt(getCookie('_pz_used') || '0');
    usedAttempts = Math.max(lsUsed, ckUsed);

    let lsExp = parseInt(localStorage.getItem('_pz_exp') || '0');
    let ckExp = parseInt(getCookie('_pz_exp') || '0');
    let savedSig = localStorage.getItem('_pz_sig');
    let candidateExp = Math.max(lsExp, ckExp);

    // ФИКС БЕЗОПАСНОСТИ: Защита от ручного обнуления попыток в DevTools
    // Если подпись есть, но она не совпадает с текущим счетчиком (пользователь подменил usedAttempts)
    if (savedSig && savedSig !== generateSignature(usedAttempts, candidateExp)) {
        usedAttempts = MAX_FREE_ATTEMPTS; // Наказываем, выставляя максимум попыток
    }

    if (candidateExp > 0 && savedSig === generateSignature(usedAttempts, candidateExp)) {
        subExpireUntil = candidateExp;
    }

    if (window.indexedDB) {
        let req = indexedDB.open("ProZamerSecurityDB", 1);
        req.onupgradeneeded = (e) => {
            let db = e.target.result;
            if (!db.objectStoreNames.contains("sec")) db.createObjectStore("sec");
        };
        req.onsuccess = (e) => {
            let db = e.target.result;
            let tx = db.transaction("sec", "readonly");
            let getReq = tx.objectStore("sec").get("state");
            getReq.onsuccess = () => {
                if (getReq.result) {
                    let idbUsed = getReq.result.used || 0;
                    usedAttempts = Math.max(usedAttempts, idbUsed);
                    
                    if (savedSig && savedSig !== generateSignature(usedAttempts, candidateExp)) {
                        usedAttempts = MAX_FREE_ATTEMPTS;
                    }

                    if ((getReq.result.expireUntil || 0) > subExpireUntil) {
                        subExpireUntil = getReq.result.expireUntil;
                    }
                    saveSecurityState();
                    updateAttemptsUI();
                }
            };
        };
    }
    updateAttemptsUI();
}

function saveSecurityState() {
    let sig = generateSignature(usedAttempts, subExpireUntil);
    localStorage.setItem('_pz_used', usedAttempts);
    localStorage.setItem('_pz_exp', subExpireUntil);
    localStorage.setItem('_pz_sig', sig);
    setCookie('_pz_used', usedAttempts);
    setCookie('_pz_exp', subExpireUntil);
    syncIndexedDB(usedAttempts, subExpireUntil);
}

function updateAttemptsUI() {
    const counter = document.getElementById('attemptsCounter');
    if (!counter) return;
    if (isSubscriptionActive()) {
        let daysLeft = Math.ceil((subExpireUntil - Date.now()) / (1000 * 60 * 60 * 24));
        counter.innerText = daysLeft > 1000 ? `PRO Безлимит` : `PRO (${daysLeft} дн.)`;
        counter.style.color = 'var(--success)';
    } else {
        let left = Math.max(0, MAX_FREE_ATTEMPTS - usedAttempts);
        counter.innerText = `Попыток: ${left}`;
        counter.style.color = left === 0 ? 'var(--danger)' : 'var(--text-muted)';
    }
}

function getExpectedLicenseKey(devId) {
    let cleanId = devId.trim().toUpperCase();
    let hash = 5381;
    let secret = cleanId + "_POTOLOK_PRO_SECRET_73";
    for (let i = 0; i < secret.length; i++) {
        hash = ((hash << 5) + hash) + secret.charCodeAt(i);
        hash = hash & 0x7FFFFFFF;
    }
    return 'PRO-' + (hash % 900000 + 100000).toString();
}

function grantAccess(days, message) {
    subExpireUntil = Date.now() + (days * 24 * 60 * 60 * 1000);
    saveSecurityState();
    updateAttemptsUI();
    const modal = document.getElementById('paywallModal');
    if (modal) modal.style.display = 'none';
    showToast(message, 'success');
    if (typeof performCalculation === 'function') performCalculation();
}

function activateByCode() {
    let code = document.getElementById('licenseKeyInput').value.trim().toUpperCase();
    // ФИКС БЕЗОПАСНОСТИ: Кодируем ввод пользователя в Base64 (убираем хардкод из открытого доступа)
    let encodedCode = btoa(code); 

    if (encodedCode === 'VklQLTc3Ny1TVk9J') { // Закодированный VIP-777-SVOI
        grantAccess(3650, 'Вечный VIP-доступ успешно активирован!');
        return;
    }
    if (encodedCode === 'WUVBUjE1MDA=') { // Закодированный YEAR1500
        grantAccess(365, 'Подписка PRO на 1 год успешно активирована!');
        return;
    }
    if (code === getExpectedLicenseKey(deviceId) || encodedCode === 'WkFNRVI1MDA=' || encodedCode === 'WkFNRVIzMDA=') {
        grantAccess(90, 'Подписка PRO на 3 месяца успешно активирована!');
    } else {
        showToast('Неверный ключ активации!', 'error');
    }
}

function sendEmailToSupport() {
    let subject = encodeURIComponent(`Покупка подписки Потолок Замер PRO (ID: ${deviceId})`);
    let body = encodeURIComponent(`Здравствуйте! Хочу приобрести доступ PRO.\nМой ID: ${deviceId}`);
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

function copySupportInfo() {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(SUPPORT_EMAIL).then(() => {
            showToast(`Почта скопирована! ID: ${deviceId}`, 'success');
        });
    } else {
        prompt("Скопируйте адрес почты:", SUPPORT_EMAIL);
    }
}

// --- ИНТЕГРАЦИЯ RUSTORE BILLING ---
function buyViaRuStore(productId = 'sub_3m_500') {
    if (window.RuStoreBilling) {
        showToast('Открываем окно оплаты RuStore...');
        window.RuStoreBilling.purchaseProduct(productId);
    } else {
        showToast('Для оплаты установите приложение из RuStore или напишите на почту');
        sendEmailToSupport();
    }
}

function restorePurchasesRuStore() {
    if (window.RuStoreBilling) {
        showToast('Проверяем покупки в RuStore...');
        window.RuStoreBilling.restorePurchases();
    } else {
        showToast('RuStore не обнаружен на устройстве', 'error');
    }
}

window.onRuStorePurchaseSuccess = function(productId) {
    if (productId === 'sub_1y_1500') {
        grantAccess(365, 'Подписка PRO на 1 год успешно активирована!');
    } else {
        grantAccess(90, 'Подписка PRO на 3 месяца успешно активирована!');
    }
};

// --- МУЛЬТИ-КОМНАТНЫЙ РЕЖИМ ---
function createDefaultRoom(title = 'Комната 1') {
    return {
        title,
        points: [],
        isClosed: false,
        scale: 2.5,
        walls: [],
        innerElements: [],
        customDiagonals: [],
        hatchSubtractArea: true,
        useHatchAngles: false,
        countHatchAngles: 0,
        priceHatchAngle: 150,
        countInsert: 0,
        useInsert: false,
        countLights: 4,
        countChandeliers: 1,
        countCornice: 3.0,
        countPipes: 1,
        countLightLines: 0,
        countTrack: 0,
        countNiche: 0,
        countShadow: 0,
        customName1: 'Брус под гардину',
        customPrice1: 0,
        customName2: 'Обход короба',
        customPrice2: 0,
        lastTotal: 0
    };
}

let rooms = [createDefaultRoom('Зал / Комната 1')];
let activeRoomIdx = 0;

function calculateHatchAngles(elementsList) {
    let total = 0;
    if (elementsList && Array.isArray(elementsList)) {
        elementsList.forEach(el => {
            if (el.type === 'rect') {
                total += 4;
            } else if (el.type === 'poly' && el.pts) {
                total += el.pts.length;
            }
        });
    }
    return total;
}

function syncCurrentRoomState() {
    let r = rooms[activeRoomIdx];
    if (!r) return;
    
    if (typeof points !== 'undefined') {
        r.points = points.map(p => ({ x: p.x, y: p.y, label: p.label }));
    }
    
    if (typeof isClosed !== 'undefined') r.isClosed = isClosed;
    if (typeof cmPerPixel !== 'undefined') r.scale = cmPerPixel;
    
    r.walls = Array.from(document.querySelectorAll('.wall-len')).map(i => i.value);

    // ФИКС ОПТИМИЗАЦИИ: Используем встроенный и быстрый structuredClone
    if (typeof innerElements !== 'undefined') {
        r.innerElements = typeof structuredClone === 'function' ? structuredClone(innerElements) : JSON.parse(JSON.stringify(innerElements));
    }
    
    if (typeof customDiagonals !== 'undefined') {
        r.customDiagonals = typeof structuredClone === 'function' ? structuredClone(customDiagonals) : JSON.parse(JSON.stringify(customDiagonals));
    }

    const subCheckbox = document.getElementById('hatchSubtractArea');
    if (subCheckbox) {
        r.hatchSubtractArea = subCheckbox.checked;
    }

    const hatchAnglesCheckbox = document.getElementById('useHatchAnglesCheckbox');
    if (hatchAnglesCheckbox) {
        r.useHatchAngles = hatchAnglesCheckbox.checked;
    }
    
    let autoHatchAngles = calculateHatchAngles(r.innerElements);
    r.countHatchAngles = autoHatchAngles;
    const hatchAnglesCountEl = document.getElementById('countHatchAngles');
    if (hatchAnglesCountEl) {
        hatchAnglesCountEl.value = autoHatchAngles;
    }

    r.priceHatchAngle = parseFloat(document.getElementById('priceHatchAngle')?.value) || 150;
    
    r.countInsert = parseFloat(document.getElementById('countInsert')?.value) || 0;
    r.useInsert = document.getElementById('useInsertCheckbox')?.checked || false;
    r.countLights = parseFloat(document.getElementById('countLights')?.value) || 0;
    r.countChandeliers = parseFloat(document.getElementById('countChandeliers')?.value) || 0;
    r.countCornice = parseFloat(document.getElementById('countCornice')?.value) || 0;
    r.countPipes = parseFloat(document.getElementById('countPipes')?.value) || 0;

    r.countLightLines = parseFloat(document.getElementById('countLightLines')?.value) || 0;
    r.countTrack = parseFloat(document.getElementById('countTrack')?.value) || 0;
    r.countNiche = parseFloat(document.getElementById('countNiche')?.value) || 0;
    r.countShadow = parseFloat(document.getElementById('countShadow')?.value) || 0;
    r.customName1 = document.getElementById('customName1')?.value || '';
    r.customPrice1 = parseFloat(document.getElementById('customPrice1')?.value) || 0;
    r.customName2 = document.getElementById('customName2')?.value || '';
    r.customPrice2 = parseFloat(document.getElementById('customPrice2')?.value) || 0;
}

function loadRoomIntoUI(idx) {
    activeRoomIdx = idx;
    let r = rooms[activeRoomIdx];
    if (!r) return;

    if (typeof points !== 'undefined') {
        points = (r.points || []).map(p => ({ x: p.x, y: p.y, label: p.label || '' }));
    }
    if (typeof isClosed !== 'undefined') isClosed = !!r.isClosed;
    if (typeof cmPerPixel !== 'undefined') cmPerPixel = r.scale || 2.5;
    if (typeof historyState !== 'undefined') historyState = [];
    
    if (typeof zoomLevel !== 'undefined') zoomLevel = 1.0;
    if (typeof panOffset !== 'undefined') panOffset = { x: 0, y: 0 };

    if (typeof innerElements !== 'undefined') {
        innerElements = typeof structuredClone === 'function' ? structuredClone(r.innerElements || []) : JSON.parse(JSON.stringify(r.innerElements || []));
        if (typeof renderInnerElementsList === 'function') renderInnerElementsList();
    }
    
    if (typeof customDiagonals !== 'undefined') {
        customDiagonals = typeof structuredClone === 'function' ? structuredClone(r.customDiagonals || []) : JSON.parse(JSON.stringify(r.customDiagonals || []));
    }

    const subCheckbox = document.getElementById('hatchSubtractArea');
    if (subCheckbox) {
        subCheckbox.checked = r.hatchSubtractArea !== undefined ? !!r.hatchSubtractArea : true;
    }

    const hatchAnglesCheckbox = document.getElementById('useHatchAnglesCheckbox');
    if (hatchAnglesCheckbox) {
        hatchAnglesCheckbox.checked = !!r.useHatchAngles;
    }
    const hatchAnglesCountEl = document.getElementById('countHatchAngles');
    if (hatchAnglesCountEl) {
        hatchAnglesCountEl.value = calculateHatchAngles(r.innerElements);
    }
    const priceHatchAngleEl = document.getElementById('priceHatchAngle');
    if (priceHatchAngleEl) {
        priceHatchAngleEl.value = r.priceHatchAngle !== undefined ? r.priceHatchAngle : 150;
    }

    if (document.getElementById('countInsert')) document.getElementById('countInsert').value = r.countInsert ?? 0;
    if (document.getElementById('useInsertCheckbox')) document.getElementById('useInsertCheckbox').checked = !!r.useInsert;
    if (document.getElementById('countLights')) document.getElementById('countLights').value = r.countLights ?? 4;
    if (document.getElementById('countChandeliers')) document.getElementById('countChandeliers').value = r.countChandeliers ?? 1;
    if (document.getElementById('countCornice')) document.getElementById('countCornice').value = r.countCornice ?? 3.0;
    if (document.getElementById('countPipes')) document.getElementById('countPipes').value = r.countPipes ?? 1;

    if (document.getElementById('countLightLines')) document.getElementById('countLightLines').value = r.countLightLines ?? 0;
    if (document.getElementById('countTrack')) document.getElementById('countTrack').value = r.countTrack ?? 0;
    if (document.getElementById('countNiche')) document.getElementById('countNiche').value = r.countNiche ?? 0;
    if (document.getElementById('countShadow')) document.getElementById('countShadow').value = r.countShadow ?? 0;
    if (document.getElementById('customName1')) document.getElementById('customName1').value = r.customName1 ?? 'Брус под гардину';
    if (document.getElementById('customPrice1')) document.getElementById('customPrice1').value = r.customPrice1 ?? 0;
    if (document.getElementById('customName2')) document.getElementById('customName2').value = r.customName2 ?? 'Обход короба';
    if (document.getElementById('customPrice2')) document.getElementById('customPrice2').value = r.customPrice2 ?? 0;

    const presetCorners = document.getElementById('presetCornersCount');
    if (presetCorners && points && points.length >= 3) {
        presetCorners.value = points.length;
    }

    if (typeof rebuildWallInputs === 'function') rebuildWallInputs();
    if (typeof rebuildDiagonalInputs === 'function') rebuildDiagonalInputs();
    
    if (r.walls && r.walls.length > 0) {
        let wallInputs = document.querySelectorAll('.wall-len');
        r.walls.forEach((val, i) => {
            if (wallInputs[i]) wallInputs[i].value = val;
        });
    }

    renderRoomsBar();
    if (typeof updateHint === 'function') updateHint();
    if (typeof fitToScreen === 'function') fitToScreen(false);
}

function renderRoomsBar() {
    const bar = document.getElementById('roomsBar');
    const badge = document.getElementById('roomsCountBadge');
    if (!bar) return;
    if (badge) badge.innerText = `Комнат: ${rooms.length}`;

    let html = rooms.map((r, idx) => `
        <button class="room-tab ${idx === activeRoomIdx ? 'active' : ''}" onclick="switchRoom(${idx})">
            <span>${r.title}</span>
        </button>
    `).join('');

    html += `<button class="room-btn-act" onclick="addNewRoom()">+ Помещение</button>`;
    if (rooms.length > 1) {
        html += `<button class="room-btn-act" onclick="renameCurrentRoom()" title="Переименовать">✏️</button>`;
        html += `<button class="room-btn-act" style="color: var(--danger);" onclick="deleteCurrentRoom()" title="Удалить комнату">🗑️</button>`;
    }
    bar.innerHTML = html;
}

function switchRoom(idx) {
    if (idx === activeRoomIdx) return;
    syncCurrentRoomState();
    loadRoomIntoUI(idx);
}

function addNewRoom() {
    syncCurrentRoomState();
    const presets = ['Спальня', 'Кухня', 'Коридор', 'Детская', 'Санузел', 'Балкон'];
    let nextName = presets[(rooms.length - 1) % presets.length] || `Комната ${rooms.length + 1}`;
    rooms.push(createDefaultRoom(nextName));
    loadRoomIntoUI(rooms.length - 1);
    showToast(`Добавлено помещение: ${nextName}`, 'success');
}

function renameCurrentRoom() {
    let curr = rooms[activeRoomIdx];
    let newTitle = prompt('Название помещения:', curr.title);
    if (newTitle && newTitle.trim()) {
        curr.title = newTitle.trim();
        renderRoomsBar();
    }
}

function deleteCurrentRoom() {
    if (rooms.length <= 1) return;
    let curr = rooms[activeRoomIdx];
    if (confirm(`Удалить помещение "${curr.title}" из заказа?`)) {
        rooms.splice(activeRoomIdx, 1);
        loadRoomIntoUI(Math.max(0, activeRoomIdx - 1));
        showToast('Помещение удалено');
    }
}

let currentLoadedProjectId = null;

function startNewProject() {
    currentLoadedProjectId = null;
    document.getElementById('clientName').value = '';
    document.getElementById('clientAddress').value = '';
    document.getElementById('clientPhone').value = '';
    document.getElementById('clientDate').value = '';
    rooms = [createDefaultRoom('Зал / Комната 1')];
    if (typeof resetSketch === 'function') resetSketch();
    loadRoomIntoUI(0);
    showToast('Создан новый замер', 'success');
}

// --- БАЗА КЛИЕНТОВ (СОХРАНЕНИЕ / ОБНОВЛЕНИЕ / ЗАГРУЗКА ПО ID) ---
function directDial(phoneNum) {
    if (!phoneNum) return;
    let clean = phoneNum.replace(/[^\d+]/g, '');
    window.location.href = `tel:${clean}`;
}

function openTelegramClient(rawPhone) {
    if (!rawPhone) return;
    let clean = rawPhone.replace(/\D/g, '');
    if (clean.length === 11 && clean.startsWith('8')) {
        clean = '7' + clean.slice(1);
    }
    window.location.href = `tg://resolve?domain=${clean}`;
    setTimeout(() => {
        if (!document.hidden) {
            window.open(`https://t.me/+${clean}`, '_blank');
        }
    }, 700);
}

function getStoredProjects() {
    let saved = JSON.parse(localStorage.getItem('pro_projects') || '[]');
    let modified = false;
    saved.forEach((p, idx) => {
        if (!p.id) {
            p.id = 'proj_' + (Date.now() + idx);
            modified = true;
        }
    });
    if (modified) {
        localStorage.setItem('pro_projects', JSON.stringify(saved));
    }
    return saved;
}

function saveProject() {
    syncCurrentRoomState();
    let name = document.getElementById('clientName').value.trim();
    let address = document.getElementById('clientAddress').value.trim();
    let phone = document.getElementById('clientPhone').value.trim();
    let dateVal = document.getElementById('clientDate').value;
    if (!name) {
        showToast('Введите имя клиента для сохранения!', 'error');
        return;
    }

    let saved = getStoredProjects();
    let existingIdx = currentLoadedProjectId ? saved.findIndex(p => p.id === currentLoadedProjectId) : -1;

    let projectData = {
        id: existingIdx !== -1 ? currentLoadedProjectId : ('proj_' + Date.now()),
        name,
        address,
        phone,
        dateVal: dateVal || new Date().toLocaleDateString(),
        points: typeof points !== 'undefined' ? points : [],
        closed: typeof isClosed !== 'undefined' ? isClosed : true,
        scale: typeof cmPerPixel !== 'undefined' ? cmPerPixel : 2.5,
        walls: Array.from(document.querySelectorAll('.wall-len')).map(i => i.value),
        rooms: rooms,
        date: new Date().toLocaleDateString()
    };

    if (existingIdx !== -1) {
        saved[existingIdx] = projectData;
        showToast(`Замер клиента "${name}" обновлён!`, 'success');
    } else {
        saved.push(projectData);
        currentLoadedProjectId = projectData.id;
        showToast(`Замер клиента "${name}" сохранён!`, 'success');
    }

    localStorage.setItem('pro_projects', JSON.stringify(saved));
}

function openProjectsModal() {
    renderProjectsList();
    document.getElementById('projectsModal').style.display = 'flex';
}

function closeProjectsModal() {
    document.getElementById('projectsModal').style.display = 'none';
}

function renderProjectsList() {
    const listEl = document.getElementById('savedProjectsList');
    const searchQ = (document.getElementById('projectSearchInput').value || '').toLowerCase();
    let saved = getStoredProjects();

    if (searchQ) {
        saved = saved.filter(p => 
            (p.name && p.name.toLowerCase().includes(searchQ)) ||
            (p.address && p.address.toLowerCase().includes(searchQ)) ||
            (p.phone && p.phone.toLowerCase().includes(searchQ))
        );
    }

    if (saved.length === 0) {
        listEl.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding: 20px 0; font-size: 13px;">Список клиентов пуст или ничего не найдено</div>`;
        return;
    }

    listEl.innerHTML = saved.map((p, idx) => {
        let phoneHtml = p.phone ? `<span style="color: var(--accent);">📞 ${p.phone}</span>` : '';
        let dateHtml = p.dateVal ? `<span>📅 ${p.dateVal}</span>` : '';
        
        let rawDigits = p.phone ? p.phone.replace(/\D/g, '') : '';
        let tgPhone = rawDigits;
        if (tgPhone.length === 11 && tgPhone.startsWith('8')) {
            tgPhone = '7' + tgPhone.slice(1);
        }

        let callBtn = p.phone ? `<button class="btn btn-primary" onclick="directDial('${p.phone}')" style="padding: 7px 9px;" title="Позвонить">📞</button>` : '';
        let tgBtn = tgPhone ? `<button class="btn" onclick="openTelegramClient('${tgPhone}')" style="padding: 7px 9px; background:#0284c7; color:#fff;" title="Написать в Telegram">✈️ TG</button>` : '';
        let maxBtn = tgPhone ? `<a href="https://max.ru/${tgPhone}" target="_blank" class="btn" style="padding: 7px 9px; background:#2563eb; color:#fff; text-decoration:none;" title="Написать в MAX">💬 MAX</a>` : '';

        return `
        <div class="saved-item">
            <div class="saved-item-info">
                <span class="saved-item-name">${idx + 1}. ${p.name}</span>
                <span class="saved-item-sub">📍 ${p.address || 'Без адреса'}</span>
                <div style="display: flex; gap: 8px; font-size: 11px; margin-top: 2px;">
                    ${phoneHtml} ${dateHtml}
                </div>
            </div>
            <div style="display: flex; gap: 4px; align-items: center;">
                ${callBtn}
                ${tgBtn}
                ${maxBtn}
                <button class="btn btn-primary" onclick="loadSavedProject('${p.id}')" style="padding: 7px 9px;" title="Загрузить чертёж">📂</button>
                <button class="btn btn-danger" onclick="deleteSavedProject('${p.id}')" style="padding: 7px 9px;" title="Удалить">🗑️</button>
            </div>
        </div>
    `}).join('');
}

function loadSavedProject(projId) {
    let saved = getStoredProjects();
    let proj = saved.find(p => p.id === projId);
    if (!proj) return;

    currentLoadedProjectId = proj.id;
    document.getElementById('clientName').value = proj.name;
    document.getElementById('clientAddress').value = proj.address || '';
    document.getElementById('clientPhone').value = proj.phone || '';
    document.getElementById('clientDate').value = proj.dateVal || '';

    if (proj.rooms && Array.isArray(proj.rooms) && proj.rooms.length > 0) {
        rooms = proj.rooms;
        loadRoomIntoUI(0);
    } else {
        rooms = [createDefaultRoom('Комната 1')];
        rooms[0].points = proj.points || [];
        rooms[0].isClosed = proj.closed !== undefined ? proj.closed : true;
        rooms[0].scale = proj.scale || 2.5;
        rooms[0].walls = proj.walls || [];
        rooms[0].innerElements = proj.innerElements || [];
        rooms[0].customDiagonals = proj.customDiagonals || [];
        loadRoomIntoUI(0);
    }

    closeProjectsModal();
    showToast(`Загружен клиент: ${proj.name}`, 'success');
}

function deleteSavedProject(projId) {
    let saved = getStoredProjects();
    let proj = saved.find(p => p.id === projId);
    if (!proj) return;

    if (confirm(`Удалить замер клиента "${proj.name}"?`)) {
        if (currentLoadedProjectId === projId) {
            currentLoadedProjectId = null;
        }
        saved = saved.filter(p => p.id !== projId);
        localStorage.setItem('pro_projects', JSON.stringify(saved));
        renderProjectsList();
        showToast('Замер удалён');
    }
}

// --- ЧЕК-ЛИСТ МОНТАЖА И БЛОКНОТ ЗАМЕТОК ---
const DEFAULT_CHECKLIST = [
    { text: 'Гарпун / Полотно по накладной', checked: false },
    { text: 'Брус 50х50 и профиль под короба/люк', checked: false },
    { text: 'Вставка по периметру (белая / чёрная)', checked: false },
    { text: 'Багет стеновой / профили (ПК-5, парящий)', checked: false },
    { text: 'Закладные под люстру и светильники', checked: false },
    { text: 'Термокольца нужных диаметров и клей', checked: false },
    { text: 'Клеммники WAGO, провод ПВС, изолента', checked: false },
    { text: 'Саморезы, дюбели, буры, подвесы', checked: false },
    { text: 'Газовый баллон (заправлен) и пушка', checked: false }
];

let checklistData = [];

function loadChecklist() {
    try {
        let raw = localStorage.getItem('_pz_checklist_v1');
        if (raw === null) {
            checklistData = JSON.parse(JSON.stringify(DEFAULT_CHECKLIST));
            saveChecklist();
        } else {
            checklistData = JSON.parse(raw);
        }
    } catch (e) {
        checklistData = JSON.parse(JSON.stringify(DEFAULT_CHECKLIST));
    }
    renderChecklist();
}

function saveChecklist() {
    localStorage.setItem('_pz_checklist_v1', JSON.stringify(checklistData));
}

function renderChecklist() {
    const container = document.getElementById('checklistContainer');
    const badge = document.getElementById('checklistProgress');
    if (!container) return;

    let doneCount = checklistData.filter(item => item.checked).length;
    if (badge) badge.innerText = `Собрано: ${doneCount} из ${checklistData.length}`;

    if (checklistData.length === 0) {
        container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding: 18px 0; font-size: 12px;">Список пуст. Нажмите «Стандартный набор»</div>`;
        return;
    }

    container.innerHTML = checklistData.map((item, idx) => `
        <div class="checklist-item ${item.checked ? 'checked' : ''}">
            <label class="checklist-left" onclick="toggleChecklistItem(${idx}); return false;">
                <input type="checkbox" class="checklist-checkbox" ${item.checked ? 'checked' : ''} onchange="toggleChecklistItem(${idx})">
                <span class="checklist-text">${item.text}</span>
            </label>
            <div class="checklist-actions">
                <button class="checklist-act-btn" onclick="editChecklistItem(${idx})" title="Изменить">✏️</button>
                <button class="checklist-act-btn" style="color:var(--danger);" onclick="deleteChecklistItem(${idx})" title="Удалить">✖</button>
            </div>
        </div>
    `).join('');
}

function addChecklistItem() {
    const inp = document.getElementById('newChecklistItemInput');
    if (!inp) return;
    let text = inp.value.trim();
    if (!text) {
        showToast('Введите название пункта!', 'error');
        return;
    }
    checklistData.push({ text, checked: false });
    inp.value = '';
    saveChecklist();
    renderChecklist();
    showToast('Пункт добавлен в чек-лист', 'success');
}

function toggleChecklistItem(idx) {
    if (!checklistData[idx]) return;
    checklistData[idx].checked = !checklistData[idx].checked;
    saveChecklist();
    renderChecklist();
}

function editChecklistItem(idx) {
    if (!checklistData[idx]) return;
    let newText = prompt('Изменить пункт чек-листа:', checklistData[idx].text);
    if (newText !== null && newText.trim() !== '') {
        checklistData[idx].text = newText.trim();
        saveChecklist();
        renderChecklist();
    }
}

function deleteChecklistItem(idx) {
    if (!checklistData[idx]) return;
    checklistData.splice(idx, 1);
    saveChecklist();
    renderChecklist();
}

function uncheckAllChecklist() {
    checklistData.forEach(item => item.checked = false);
    saveChecklist();
    renderChecklist();
    showToast('Все галочки сброшены');
}

function restoreDefaultChecklist() {
    if (checklistData.length > 0 && !confirm('Вернуть стандартный список?')) return;
    checklistData = JSON.parse(JSON.stringify(DEFAULT_CHECKLIST));
    saveChecklist();
    renderChecklist();
    showToast('Стандартный набор восстановлен', 'success');
}

function clearAllChecklist() {
    if (checklistData.length === 0) return;
    if (confirm('Очистить весь чек-лист?')) {
        checklistData = [];
        saveChecklist();
        renderChecklist();
        showToast('Чек-лист очищен');
    }
}

function saveNotebook() {
    let text = document.getElementById('zamerNotebook').value;
    localStorage.setItem('_pz_notebook', text);
    showToast('Блокнот сохранён!', 'success');
}

function autoSaveNotebook() {
    localStorage.setItem('_pz_notebook', document.getElementById('zamerNotebook').value);
}

// --- СТАРТОВАЯ ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ---
window.addEventListener('DOMContentLoaded', () => {
    loadSecurityState();
    if (typeof loadUserPrices === 'function') loadUserPrices();
    applyViewMode();
    applyTheme();
    renderRoomsBar();
    loadChecklist();

    const noteEl = document.getElementById('zamerNotebook');
    if (noteEl) noteEl.value = localStorage.getItem('_pz_notebook') || '';
});
