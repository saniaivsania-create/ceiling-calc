// --- ИНИЦИАЛИЗАЦИЯ ХОЛСТА И СОСТОЯНИЯ ЧЕРТЕЖА ---
const canvas = document.getElementById('sketchCanvas');
const ctx = canvas.getContext('2d');

let points = [];
let isClosed = false;
let isSketchLocked = false;
let historyState = [];
let draggedPointIndex = null;
let isDragging = false;
let cmPerPixel = 2.5;

let zoomLevel = 1.0;
let panOffset = { x: 0, y: 0 };
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 15.0; // ИСПРАВЛЕНИЕ: Зум увеличен до 15x для Умного Микроскопа
let activePointers = new Map();
let pinchStartDistance = null;
let pinchStartZoom = 1.0;
let pinchStartPan = { x: 0, y: 0 };
let pinchCenter = { x: 0, y: 0 };

let isPanningCanvas = false;
let panStartPoint = { x: 0, y: 0 };

function getCanvasPointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    return {
        screenX: rawX,
        screenY: rawY,
        x: (rawX - panOffset.x) / zoomLevel,
        y: (rawY - panOffset.y) / zoomLevel
    };
}

let editMode = 'room'; 
let innerElements = [];
let selectedInnerIdx = null;
let draggedInnerIdx = null;
let draggedInnerVertex = null;
let innerDragOffset = { x: 0, y: 0 };
let activeDrawingPoly = [];

let activeBindSource = null;
let bindHitBoxes = [];

let customDiagonals = [];
let editingWallIdx = null;
let editingDiagObj = null;
let wallHitBoxes = [];
let diagHitBoxes = [];
let showDiagonalsList = false;
let diagStartPointIdx = null; 

const MAX_CORNERS = 50;

function getPointLabel(index) {
    if (index < 26) return String.fromCharCode(65 + index);
    let first = Math.floor(index / 26) - 1;
    let second = index % 26;
    return String.fromCharCode(65 + first) + String.fromCharCode(65 + second);
}

function getCornerLetterOptionsHtml(selectedIdx = 0) {
    let html = '';
    points.forEach((p, idx) => {
        let isSel = (idx === selectedIdx) ? 'selected' : '';
        html += `<option value="${idx}" ${isSel}>Угол ${p.label}</option>`;
    });
    return html;
}

function formatLaserShift(rawVal) {
    if (!rawVal) return '';
    return rawVal.toString().replace(/\D/g, ''); 
}

// ИСПРАВЛЕНИЕ: Теперь данные клиента тоже сохраняются в черновик
function saveProjectToLocalStorage() {
    let nameInput = document.getElementById('clientName');
    let addrInput = document.getElementById('clientAddress');
    let phoneInput = document.getElementById('clientPhone');
    let dateInput = document.getElementById('clientDate');

    const projectData = {
        points: points,
        isClosed: isClosed,
        innerElements: innerElements,
        customDiagonals: customDiagonals,
        cmPerPixel: cmPerPixel,
        rooms: typeof rooms !== 'undefined' ? rooms : [],
        name: nameInput ? nameInput.value : '',
        address: addrInput ? addrInput.value : '',
        phone: phoneInput ? phoneInput.value : '',
        dateVal: dateInput ? dateInput.value : ''
    };
    
    try {
        localStorage.setItem('ceiling_calc_active_project', JSON.stringify(projectData));
    } catch (e) {}
}

function loadProjectFromLocalStorage() {
    const saved = localStorage.getItem('ceiling_calc_active_project');
    if (!saved) return false;
    try {
        const data = JSON.parse(saved);
        if (data.rooms && typeof rooms !== 'undefined') rooms = data.rooms;
        if (typeof renderRoomsBar === 'function') renderRoomsBar();
        if (typeof activeRoomIdx !== 'undefined' && typeof loadRoomIntoUI === 'function') {
             let idxToLoad = (rooms && rooms[activeRoomIdx]) ? activeRoomIdx : 0;
             if (rooms && rooms.length > 0) loadRoomIntoUI(idxToLoad);
        } else {
            points = data.points || [];
            isClosed = !!data.isClosed;
            innerElements = data.innerElements || [];
            customDiagonals = data.customDiagonals || [];
            cmPerPixel = data.scale || data.cmPerPixel || 2.5;
            rebuildWallInputs();
            rebuildDiagonalInputs();
            renderInnerElementsList();
            drawSketch();
        }
        
        // ИСПРАВЛЕНИЕ: Восстанавливаем имя, адрес, телефон и дату клиента (ранее данные пропадали при автосохранении)
        let nameInput = document.getElementById('clientName');
        if (nameInput && data.name) nameInput.value = data.name;
        let addrInput = document.getElementById('clientAddress');
        if (addrInput && data.address) addrInput.value = data.address;
        let phoneInput = document.getElementById('clientPhone');
        if (phoneInput && data.phone) phoneInput.value = data.phone;
        let dateInput = document.getElementById('clientDate');
        if (dateInput && data.dateVal) dateInput.value = data.dateVal;

        return true;
    } catch (e) {
        return false;
    }
}

// ИСПРАВЛЕНИЕ: Оставлена только одна версия loadRoomIntoUI, удален дубликат
function loadRoomIntoUI(idx) {
    if (typeof activeRoomIdx !== 'undefined') activeRoomIdx = idx;
    let r = typeof rooms !== 'undefined' ? rooms[idx] : null;
    if (!r) return;
    isSketchLocked = false;
    editMode = 'room';
    if (typeof points !== 'undefined') points = (r.points || []).map(p => ({ x: p.x, y: p.y, label: p.label || '' }));
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
    if (subCheckbox) subCheckbox.checked = r.hatchSubtractArea !== undefined ? !!r.hatchSubtractArea : true;
    const hatchAnglesCheckbox = document.getElementById('useHatchAnglesCheckbox');
    if (hatchAnglesCheckbox) hatchAnglesCheckbox.checked = !!r.useHatchAngles;
    const hatchAnglesCountEl = document.getElementById('countHatchAngles');
    if (hatchAnglesCountEl && typeof calculateHatchAngles === 'function') hatchAnglesCountEl.value = calculateHatchAngles(r.innerElements);
    const priceHatchAngleEl = document.getElementById('priceHatchAngle');
    if (priceHatchAngleEl) priceHatchAngleEl.value = r.priceHatchAngle !== undefined ? r.priceHatchAngle : 150;
    
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
    if (presetCorners && points && points.length >= 3) presetCorners.value = points.length;
    if (typeof rebuildWallInputs === 'function') rebuildWallInputs();
    if (typeof rebuildDiagonalInputs === 'function') rebuildDiagonalInputs();
    if (r.walls && r.walls.length > 0) {
        let wallInputs = document.querySelectorAll('.wall-len');
        r.walls.forEach((val, i) => { if (wallInputs[i]) wallInputs[i].value = val; });
    }
    if (typeof renderRoomsBar === 'function') renderRoomsBar();
    if (typeof updateHint === 'function') updateHint();
    if (typeof fitToScreen === 'function') fitToScreen(false);
}

function saveState() {
    historyState.push({
        pts: points.map(p => ({ x: p.x, y: p.y, label: p.label })),
        closed: isClosed,
        scale: cmPerPixel,
        inner: typeof structuredClone === 'function' ? structuredClone(innerElements) : JSON.parse(JSON.stringify(innerElements)),
        customDiags: typeof structuredClone === 'function' ? structuredClone(customDiagonals) : JSON.parse(JSON.stringify(customDiagonals)),
        editMode
    });
    if (historyState.length > 40) historyState.shift();
    if (typeof saveProjectToLocalStorage === 'function') saveProjectToLocalStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
}

function undoPoint() {
    if (isSketchLocked) return;
    activeBindSource = null;
    diagStartPointIdx = null;
    if (editMode === 'drawing_poly' && activeDrawingPoly.length > 0) {
        activeDrawingPoly.pop();
        if (activeDrawingPoly.length === 0) editMode = 'room';
        updateHint(); drawSketch();
        return;
    }
    if (historyState.length > 0) {
        let st = historyState.pop();
        points = st.pts || []; isClosed = !!st.closed; cmPerPixel = st.scale || 2.5;
        innerElements = st.inner || []; customDiagonals = st.customDiags || []; editMode = st.editMode || 'room';
    } else {
        points = []; isClosed = false; cmPerPixel = 2.5; innerElements = []; customDiagonals = []; editMode = 'room';
    }
    activeDrawingPoly = []; draggedInnerVertex = null;
    const presetCorners = document.getElementById('presetCornersCount');
    if (presetCorners && points.length >= 3) presetCorners.value = points.length;
    rebuildWallInputs(); rebuildDiagonalInputs(); renderInnerElementsList(); updateHint(); drawSketch();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    if (typeof saveProjectToLocalStorage === 'function') saveProjectToLocalStorage();
}

function resetSketch() {
    if (isSketchLocked) return;
    saveState();
    points = []; isClosed = false; cmPerPixel = 2.5; innerElements = []; customDiagonals = []; activeDrawingPoly = [];
    editMode = 'room'; selectedInnerIdx = null; draggedInnerVertex = null; activeBindSource = null; diagStartPointIdx = null;
    zoomLevel = 1.0; panOffset = { x: 0, y: 0 };
    rebuildWallInputs(); rebuildDiagonalInputs(); renderInnerElementsList(); updateHint(); drawSketch();
    if (typeof saveProjectToLocalStorage === 'function') saveProjectToLocalStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Чертёж очищен');
}

function toggleSketchLock() {
    isSketchLocked = !isSketchLocked;
    const lockBtn = document.getElementById('sketchLockSvg');
    const btnWrap = document.getElementById('lockSketchBtn');
    if (isSketchLocked) {
        btnWrap?.classList.add('fab-active');
        if (lockBtn) lockBtn.innerHTML = `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`;
        showToast('🛡️ Чертёж заблокирован');
    } else {
        btnWrap?.classList.remove('fab-active');
        if (lockBtn) lockBtn.innerHTML = `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>`;
        showToast('🔓 Чертёж разблокирован');
    }
    updateHint();
}

function toggleEditLayer() {
    if (!isClosed || points.length < 3) { showToast('Сначала замкните контур комнаты!', 'error'); return; }
    activeBindSource = null; diagStartPointIdx = null;
    if (editMode === 'room' || editMode === 'aim_diag') {
        editMode = 'inner'; showToast('📦 Режим коробов', 'success');
    } else {
        editMode = 'room'; activeDrawingPoly = []; draggedInnerVertex = null; showToast('Режим: Стены комнаты');
    }
    const layerBtn = document.getElementById('layerSwitchBtn');
    if (layerBtn) layerBtn.classList.toggle('fab-active', editMode === 'inner');
    updateHint(); drawSketch();
}

function toggleFullscreen() {
    const card = document.getElementById('canvasCard');
    if (!card) return;
    const isFull = card.classList.toggle('fullscreen');
    document.getElementById('bottomFullscreenBtn')?.classList.toggle('fab-active', isFull);
    const topClose = document.getElementById('fsCloseTopBtn');
    if (topClose) topClose.style.display = isFull ? 'block' : 'none';
    if (!isFull) { zoomLevel = 1.0; panOffset = { x: 0, y: 0 }; }
    setTimeout(() => {
        canvas.width = canvas.clientWidth || window.innerWidth;
        canvas.height = canvas.clientHeight || (window.innerHeight - 80);
        fitToScreen(false);
    }, 80);
}

function resizeCanvas() {
    canvas.width = canvas.clientWidth || 350;
    canvas.height = canvas.clientHeight || 320;
    fitToScreen(false);
}
window.addEventListener('resize', resizeCanvas);
setTimeout(() => { resizeCanvas(); updateHint(); drawSketch(); }, 120);

function getWallCount() { return isClosed ? points.length : Math.max(0, points.length - 1); }

function detectWallDir(p1, p2) {
    let dx = p2.x - p1.x, dy = p2.y - p1.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'R' : 'L';
    return dy >= 0 ? 'D' : 'U';
}

function updateHint() {
    const hint = document.getElementById('actionHint'), closeBtn = document.getElementById('closeContourBtn'), lockSvg = document.getElementById('lockIconSvg');
    if (!hint) return;
    if (isSketchLocked) { hint.innerText = '🛡️ Чертёж заблокирован'; return; }
    if (activeBindSource !== null) { hint.innerText = `🎯 Угол ${activeBindSource.vertexIdx + 1} выбран! Тапните по стене или углу комнаты`; return; }
    if (editMode === 'aim_diag') {
        if (diagStartPointIdx === null) hint.innerText = `🎯 ТАПНИТЕ В ПЕРВЫЙ УГОЛ ДЛЯ ДИАГОНАЛИ`;
        else hint.innerText = `🎯 Угол ${points[diagStartPointIdx].label} выбран. ТАПНИТЕ ВО ВТОРОЙ УГОЛ`;
        return;
    }
    if (editMode === 'drawing_poly') { hint.innerText = `✏️ Ставьте точки (${activeDrawingPoly.length}). Тап на 1-ю точку замкнёт короб`; return; }
    if (editMode === 'inner') { hint.innerText = '📦 Перетаскивайте короб или тапните угол для лазерной привязки'; return; }
    if (points.length === 0) {
        hint.innerText = 'Тапните на холст для точки А или создайте шаблон'; closeBtn?.classList.remove('fab-active');
    } else if (!isClosed) {
        let nextLabel = getPointLabel(points.length);
        hint.innerText = points.length < 3 ? `Ставьте по очереди точку ${nextLabel}` : `Ставьте точку ${nextLabel} или нажмите замочек 🔒`;
        closeBtn?.classList.remove('fab-active');
        if (lockSvg) lockSvg.innerHTML = `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>`;
    } else {
        hint.innerText = `Тапайте по стенам или кнопке «📐 Диагонали»`; closeBtn?.classList.add('fab-active');
        if (lockSvg) lockSvg.innerHTML = `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`;
    }
}

function closePolygon() {
    if (isSketchLocked) return;
    if (points.length < 3) { showToast('Поставьте минимум 3 точки (A, B, C)!', 'error'); return; }
    saveState(); isClosed = !isClosed;
    rebuildWallInputs(); rebuildDiagonalInputs(); updateHint(); drawSketch();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    if (isClosed) showToast('Контур замкнут!', 'success');
}

// ИСПРАВЛЕНИЕ: Оставлена только одна версия snapOrthogonal
function snapOrthogonal() {
    saveState();
    
    // Блокировка, чтобы 90 градусов не ломало ручные диагонали
    if (customDiagonals.length > 0) {
        showToast('Отключено: Ручные диагонали задают жесткую форму, 90° её сломает!', 'error');
        return;
    }

    if (editMode === 'inner' && innerElements.length > 0) {
        let el = (selectedInnerIdx !== null && innerElements[selectedInnerIdx]) ? innerElements[selectedInnerIdx] : innerElements[innerElements.length - 1];
        if (el && el.type === 'poly' && el.pts && el.pts.length >= 3) {
            let n = el.pts.length;
            if (n === 4) {
                let p0 = el.pts[0], p1 = el.pts[1], p2 = el.pts[2], p3 = el.pts[3];
                let h = Math.hypot(p1.x - p0.x, p1.y - p0.y), w = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                let cx = (p0.x + p1.x + p2.x + p3.x) / 4, cy = (p0.y + p1.y + p2.y + p3.y) / 4;
                el.pts[0] = { x: cx - w/2, y: cy + h/2 }; el.pts[1] = { x: cx - w/2, y: cy - h/2 };
                el.pts[2] = { x: cx + w/2, y: cy - h/2 }; el.pts[3] = { x: cx + w/2, y: cy + h/2 };
            } else {
                for (let iter = 0; iter < 2; iter++) {
                    for (let i = 0; i < n; i++) {
                        let curr = el.pts[i], next = el.pts[(i + 1) % n];
                        if (Math.abs(next.x - curr.x) >= Math.abs(next.y - curr.y)) { curr.y = next.y = (curr.y + next.y) / 2; }
                        else { curr.x = next.x = (curr.x + next.x) / 2; }
                    }
                }
            }
            let sx = 0, sy = 0; el.pts.forEach(p => { sx += p.x; sy += p.y; }); el.x = sx / el.pts.length; el.y = sy / el.pts.length;
            renderInnerElementsList(); drawSketch();
            if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
            showToast('Углы короба выровнены под 90°', 'success'); return;
        }
    }

    if (isSketchLocked || points.length < 3) return;

    let nPts = points.length;
    if (nPts === 4 && isClosed) {
        let pA = points[0], pB = points[1], pC = points[2], pD = points[3];
        let inpAB = document.getElementById('wall-input-0'), valAB = inpAB ? parseInt(inpAB.value, 10) : 0;
        let hPx = valAB > 0 ? valAB / cmPerPixel : Math.hypot(pB.x - pA.x, pB.y - pA.y);
        let inpBC = document.getElementById('wall-input-1'), valBC = inpBC ? parseInt(inpBC.value, 10) : 0;
        let wPx = valBC > 0 ? valBC / cmPerPixel : Math.hypot(pC.x - pB.x, pC.y - pB.y);
        let cx = (pA.x + pB.x + pC.x + pD.x) / 4, cy = (pA.y + pB.y + pC.y + pD.y) / 4;
        points[0] = { x: cx - wPx/2, y: cy + hPx/2, label: 'A' }; points[1] = { x: cx - wPx/2, y: cy - hPx/2, label: 'B' };
        points[2] = { x: cx + wPx/2, y: cy - hPx/2, label: 'C' }; points[3] = { x: cx + wPx/2, y: cy + hPx/2, label: 'D' };
        fitToScreen(false); syncInputsValuesOnly(); rebuildWallInputs(); rebuildDiagonalInputs(); drawSketch();
        if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
        showToast('Прямоугольник построен строго по стенам A-B и B-C', 'success'); return;
    }
    for (let iter = 0; iter < 2; iter++) {
        for (let i = 0; i < nPts; i++) {
            if (!isClosed && i === nPts - 1) continue;
            let curr = points[i], next = points[(i + 1) % nPts];
            if (Math.abs(next.x - curr.x) >= Math.abs(next.y - curr.y)) { curr.y = next.y = (curr.y + next.y) / 2; }
            else { curr.x = next.x = (curr.x + next.x) / 2; }
        }
    }
    fitToScreen(false); syncInputsValuesOnly(); drawSketch();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Углы выровнены под 90°', 'success');
}

function rotateSketch() {
    if (isSketchLocked) return;
    if (editMode === 'inner' && selectedInnerIdx !== null && innerElements[selectedInnerIdx]) {
        saveState(); let el = innerElements[selectedInnerIdx], cx = el.x, cy = el.y;
        if (el.type === 'rect') { let tmpW = el.w; el.w = el.h; el.h = tmpW; let tmpCm = el.lenCm; el.lenCm = el.widCm; el.widCm = tmpCm; }
        else if (el.type === 'poly' && el.pts) { el.pts.forEach(pt => { let pdx = pt.x - cx, pdy = pt.y - cy; pt.x = cx - pdy; pt.y = cy + pdx; }); }
        renderInnerElementsList(); drawSketch();
        if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
        showToast('Короб / люк повернут на 90°', 'success'); return;
    }
    if (points.length < 2) return;
    saveState(); let canvasCX = canvas.width / 2, canvasCY = canvas.height / 2;
    points.forEach(p => { let dx = p.x - canvasCX, dy = p.y - canvasCY; p.x = canvasCX - dy; p.y = canvasCY + dx; });
    innerElements.forEach(el => {
        let edx = el.x - canvasCX, edy = el.y - canvasCY; el.x = canvasCX - edy; el.y = canvasCY + edx;
        if (el.type === 'rect') { let tmpW = el.w; el.w = el.h; el.h = tmpW; let tmpCm = el.lenCm; el.lenCm = el.widCm; el.widCm = tmpCm; }
        else if (el.type === 'poly' && el.pts) { el.pts.forEach(pt => { let pdx = pt.x - canvasCX, pdy = pt.y - canvasCY; pt.x = canvasCX - pdy; pt.y = canvasCY + pdx; }); }
    });
    fitToScreen(true); rebuildWallInputs(); rebuildDiagonalInputs(); renderInnerElementsList(); drawSketch();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Чертеж комнаты повернут', 'success');
}

function fitToScreen(forceFit = false) {
    if (points.length < 2) { drawSketch(); return; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(p => {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    });
    let polyW = Math.max(maxX - minX, 20), polyH = Math.max(maxY - minY, 20);
    let padX = 52, padTop = 38, padBottom = 76;
    let availW = Math.max(canvas.width - padX * 2, 60), availH = Math.max(canvas.height - padTop - padBottom, 60);
    let factor = Math.min(availW / polyW, availH / polyH);
    if (factor < 1 || factor > 1.35 || forceFit) {
        let centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
        let canvasCX = canvas.width / 2, canvasCY = padTop + availH / 2;
        points.forEach(p => { p.x = canvasCX + (p.x - centerX) * factor; p.y = canvasCY + (p.y - centerY) * factor; });
        innerElements.forEach(el => {
            el.x = canvasCX + (el.x - centerX) * factor; el.y = canvasCY + (el.y - centerY) * factor;
            if (el.type === 'rect') { el.w *= factor; el.h *= factor; }
            else if (el.type === 'circle') { el.radius *= factor; }
            else if (el.type === 'poly' && el.pts) { el.pts.forEach(pt => { pt.x = canvasCX + (pt.x - centerX) * factor; pt.y = canvasCY + (pt.y - centerY) * factor; }); }
        });
        cmPerPixel = cmPerPixel / factor;
    }
    drawSketch();
}

function getCleanDiagonals() {
    let diags = [];
    if (!isClosed || points.length < 4) return diags;
    customDiagonals.forEach(cd => {
        let p1 = points[cd.fromIdx], p2 = points[cd.toIdx];
        if (p1 && p2) {
            let lenCm = cd.lenCm ? Math.round(cd.lenCm) : Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel);
            diags.push({ from: p1, to: p2, idxFrom: cd.fromIdx, idxTo: cd.toIdx, name: `${p1.label}-${p2.label}`, len: lenCm, isCustom: true });
        }
    });
    return diags; 
}

function applyDiagonalLength(fromIdx, toIdx, targetCm) {
    if (!targetCm || targetCm <= 0) return;
    saveState();
    let i1 = Math.min(fromIdx, toIdx), i2 = Math.max(fromIdx, toIdx);
    let existing = customDiagonals.find(d => (d.fromIdx === i1 && d.toIdx === i2) || (d.fromIdx === i2 && d.toIdx === i1));
    if (existing) existing.lenCm = targetCm;
    else { let pA = points[i1], pB = points[i2]; customDiagonals.push({ fromIdx: i1, toIdx: i2, name: `${pA.label}-${pB.label}`, lenCm: targetCm }); }
    let midIdx = -1;
    if (i2 - i1 === 2) midIdx = i1 + 1;
    else if (i1 === 0 && i2 === points.length - 2) midIdx = points.length - 1;
    else if (i1 === 0 && i2 === points.length - 1) midIdx = points.length - 2;

    let pFrom = points[i1], pTo = points[i2];
    if (midIdx !== -1) {
        let pCorner = points[midIdx];
        let a = Math.hypot(pFrom.x - pCorner.x, pFrom.y - pCorner.y), b = Math.hypot(pTo.x - pCorner.x, pTo.y - pCorner.y);
        let targetC = targetCm / cmPerPixel;
        if (targetC >= a + b) targetC = (a + b) * 0.98;
        if (targetC <= Math.abs(a - b)) targetC = Math.abs(a - b) * 1.02;
        let cosVal = Math.max(-1, Math.min(1, (a * a + b * b - targetC * targetC) / (2 * a * b)));
        let targetAngle = Math.acos(cosVal), baseAngle = Math.atan2(pFrom.y - pCorner.y, pFrom.x - pCorner.x);
        let curAngle = Math.atan2(pTo.y - pCorner.y, pTo.x - pCorner.x), diff = curAngle - baseAngle;
        while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
        let sign = diff >= 0 ? 1 : -1, newAngle = baseAngle + sign * targetAngle;
        let oldToX = pTo.x, oldToY = pTo.y;
        pTo.x = pCorner.x + b * Math.cos(newAngle); pTo.y = pCorner.y + b * Math.sin(newAngle);
        let shiftX = pTo.x - oldToX, shiftY = pTo.y - oldToY;
        for (let k = i2 + 1; k < points.length; k++) { points[k].x += shiftX; points[k].y += shiftY; }
    } else {
        let curDist = Math.hypot(pTo.x - pFrom.x, pTo.y - pFrom.y), targetDistPx = targetCm / cmPerPixel;
        if (curDist > 0.001) {
            let dirX = (pTo.x - pFrom.x) / curDist, dirY = (pTo.y - pFrom.y) / curDist;
            let shiftX = (pFrom.x + dirX * targetDistPx) - pTo.x, shiftY = (pFrom.y + dirY * targetDistPx) - pTo.y;
            for (let k = i2; k < points.length; k++) { points[k].x += shiftX; points[k].y += shiftY; }
        }
    }
    fitToScreen(false); syncInputsValuesOnly(); rebuildDiagonalInputs(); drawSketch();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast(`Диагональ выставлена: ${targetCm} см`, 'success');
}

function removeCustomDiagonal(idx) {
    saveState(); customDiagonals.splice(idx, 1); rebuildDiagonalInputs(); drawSketch();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Диагональ удалена');
}

function getClosestPointOnSegment(p, a, b) {
    let abx = b.x - a.x, aby = b.y - a.y, apx = p.x - a.x, apy = p.y - a.y;
    let lenTotal = abx * abx + aby * aby, t = lenTotal === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenTotal));
    return { x: a.x + t * abx, y: a.y + t * aby };
}

function rayCrossesOwnElement(pStart, pEnd, el) {
    if (!el || !el.pts || el.pts.length < 3) return false;
    let n = el.pts.length;
    for (let i = 0; i < n; i++) {
        let pA = el.pts[i], pB = el.pts[(i + 1) % n];
        if (((pA.y > pEnd.y) !== (pB.y > pEnd.y)) && (pEnd.x < (pB.x - pA.x) * (pEnd.y - pA.y) / (pB.y - pA.y) + pA.x)) return true;
    }
    return false;
}

function getClosestPointOnElementToSegment(el, p1, p2) {
    let isHorizontalWall = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y);
    if (el.type === 'circle') {
        let center = { x: el.x, y: el.y }, proj = getClosestPointOnSegment(center, p1, p2);
        let distCenter = Math.hypot(proj.x - center.x, proj.y - center.y);
        let rad = el.radius || (el.diamCm ? (el.diamCm / 2) / cmPerPixel : 20 / cmPerPixel);
        let edgePoint = { x: center.x, y: center.y };
        if (distCenter > 0.001) {
            edgePoint.x = center.x + ((proj.x - center.x) / distCenter) * rad;
            edgePoint.y = center.y + ((proj.y - center.y) / distCenter) * rad;
        }
        return { edgePoint, proj, distPx: Math.max(0, distCenter - rad) };
    }
    if (el.type === 'rect') {
        let rw = el.w || (el.lenCm / cmPerPixel), rh = el.h || (el.widCm / cmPerPixel);
        let hw = rw / 2, hh = rh / 2, edgePoint = { x: el.x, y: el.y };
        if (isHorizontalWall) { let wallY = (p1.y + p2.y) / 2; edgePoint = wallY < el.y ? { x: el.x, y: el.y - hh } : { x: el.x, y: el.y + hh }; }
        else { let wallX = (p1.x + p2.x) / 2; edgePoint = wallX < el.x ? { x: el.x - hw, y: el.y } : { x: el.x + hw, y: el.y }; }
        let proj = getClosestPointOnSegment(edgePoint, p1, p2);
        return { edgePoint, proj, distPx: Math.hypot(proj.x - edgePoint.x, proj.y - edgePoint.y) };
    }
    let bestDist = Infinity, bestEdgePt = el.pts ? el.pts[0] : { x: el.x, y: el.y }, bestProj = getClosestPointOnSegment(bestEdgePt, p1, p2);
    if (el.pts && el.pts.length >= 3) {
        for (let pt of el.pts) {
            let pr = getClosestPointOnSegment(pt, p1, p2), d = Math.hypot(pr.x - pt.x, pr.y - pt.y);
            if (d < bestDist && !rayCrossesOwnElement(pt, pr, el)) { bestDist = d; bestEdgePt = pt; bestProj = pr; }
        }
    }
    return { edgePoint: bestEdgePt, proj: bestProj, distPx: bestDist };
}

function getElementWallDistances(el) {
    if (!el || points.length < 3) return [];
    let count = getWallCount(), wallDists = [];
    for (let i = 0; i < count; i++) {
        let p1 = points[i], p2 = points[(i + 1) % points.length]; if (!p1 || !p2) continue;
        let { edgePoint, proj, distPx } = getClosestPointOnElementToSegment(el, p1, p2);
        let distCm = Math.round(distPx * cmPerPixel), isHorizontal = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y);
        wallDists.push({ wallIdx: i, wallName: `${p1.label}–${p2.label}`, distCm: distCm, edgeX: edgePoint.x, edgeY: edgePoint.y, projX: proj.x, projY: proj.y, distPx, isHorizontal });
    }
    let horizWalls = wallDists.filter(w => w.isHorizontal).sort((a, b) => a.distPx - b.distPx);
    let vertWalls = wallDists.filter(w => !w.isHorizontal).sort((a, b) => a.distPx - b.distPx);
    let result = [];
    if (horizWalls.length > 0) result.push(horizWalls[0]); if (vertWalls.length > 0) result.push(vertWalls[0]);
    if (result.length < 2) { wallDists.sort((a, b) => a.distPx - b.distPx); return wallDists.slice(0, 2); }
    return result;
}

function applySingleBindingShift(el, binding, targetDistCm) {
    let targetDistPx = targetDistCm / cmPerPixel;
    if (binding.targetCornerIdx !== undefined && binding.targetCornerIdx !== null) {
        let pRoom = points[binding.targetCornerIdx], pBox = (el.pts && el.pts[binding.vertexIdx]) ? el.pts[binding.vertexIdx] : { x: el.x, y: el.y };
        if (!pRoom || !pBox) return;
        let dx = pRoom.x - pBox.x, dy = pRoom.y - pBox.y, len = Math.hypot(dx, dy) || 1;
        let shift = Math.hypot(pBox.x - pRoom.x, pBox.y - pRoom.y) - targetDistPx;
        let moveX = (dx / len) * shift, moveY = (dy / len) * shift;
        el.x += moveX; el.y += moveY; if (el.pts) el.pts.forEach(p => { p.x += moveX; p.y += moveY; });
    } else if (binding.targetWallIdx !== undefined && binding.targetWallIdx !== null) {
        let pA = points[binding.targetWallIdx], pB = points[(binding.targetWallIdx + 1) % points.length];
        if (!pA || !pB) return;
        let pBox, proj, curDist;
        if (el.type === 'rect' || el.type === 'circle') {
            let res = getClosestPointOnElementToSegment(el, pA, pB); pBox = res.edgePoint; proj = res.proj; curDist = res.distPx;
        } else {
            pBox = (el.pts && el.pts[binding.vertexIdx]) ? el.pts[binding.vertexIdx] : { x: el.x, y: el.y };
            proj = getClosestPointOnSegment(pBox, pA, pB); curDist = Math.hypot(proj.x - pBox.x, proj.y - pBox.y);
        }
        let dx = proj.x - pBox.x, dy = proj.y - pBox.y, len = Math.hypot(dx, dy) || 1;
        let shift = curDist - targetDistPx;
        let moveX = (dx / len) * shift, moveY = (dy / len) * shift;
        el.x += moveX; el.y += moveY; if (el.pts) el.pts.forEach(p => { p.x += moveX; p.y += moveY; });
    }
}

function addQuickRectHatch() {
    if (!isClosed || points.length < 3) { showToast('Сначала замкните комнату!', 'error'); return; }
    saveState(); let cx = 0, cy = 0; points.forEach(p => { cx += p.x; cy += p.y; }); cx /= points.length; cy /= points.length;
    innerElements.push({ id: 'inner_' + Date.now(), type: 'rect', title: `Люк 120×60 см`, x: cx, y: cy, w: 120 / cmPerPixel, h: 60 / cmPerPixel, lenCm: 120, widCm: 60, customBindings: [] });
    editMode = 'inner'; document.getElementById('layerSwitchBtn')?.classList.add('fab-active');
    renderInnerElementsList(); drawSketch(); if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Добавлен прямоугольный короб');
}

function addQuickCircleColumn() {
    if (!isClosed || points.length < 3) { showToast('Сначала замкните комнату!', 'error'); return; }
    saveState(); let cx = 0, cy = 0; points.forEach(p => { cx += p.x; cy += p.y; }); cx /= points.length; cy /= points.length;
    innerElements.push({ id: 'inner_' + Date.now(), type: 'circle', title: `Колонна ⌀40 см`, x: cx, y: cy, diamCm: 40, radius: 20 / cmPerPixel, customBindings: [] });
    editMode = 'inner'; document.getElementById('layerSwitchBtn')?.classList.add('fab-active');
    renderInnerElementsList(); drawSketch(); if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Добавлена круглая колонна');
}

function startCustomBoxDrawing() {
    if (!isClosed || points.length < 3) { showToast('Сначала замкните комнату!', 'error'); return; }
    editMode = 'drawing_poly'; activeDrawingPoly = []; document.getElementById('layerSwitchBtn')?.classList.add('fab-active');
    updateHint(); drawSketch(); showToast('Ставьте точки короба по холсту', 'success');
}

function getWallOptionsHtml(selectedWallIdx) {
    let count = getWallCount(), html = '';
    for (let i = 0; i < count; i++) {
        let p1 = points[i], p2 = points[(i + 1) % points.length];
        if (p1 && p2) { let isSel = (Number(selectedWallIdx) === i) ? 'selected' : ''; html += `<option value="${i}" ${isSel}>Стена ${p1.label}–${p2.label}</option>`; }
    }
    return html;
}

function addInnerWallBindingRow(wallIdx = 0, distVal = '', bindData = null) {
    const container = document.getElementById('innerWallBindingsContainer'); if (!container) return;
    let el = innerElements[selectedInnerIdx]; if (!el) return;
    let row = document.createElement('div'); row.className = 'inner-binding-row'; row.style.cssText = 'display: grid; grid-template-columns: 0.9fr 1.2fr 1fr auto; gap: 4px; align-items: center;';
    let vIdx = 0, tCorner = '';
    if (bindData) { vIdx = bindData.vertexIdx !== undefined ? bindData.vertexIdx : 0; tCorner = bindData.targetCornerIdx !== undefined ? bindData.targetCornerIdx : ''; }
    else {
        if (el.type === 'poly' && el.pts) {
            let existingRows = container.querySelectorAll('.inner-binding-row');
            if (existingRows.length > 0) {
                let lastSource = existingRows[existingRows.length - 1].querySelector('.inner-bind-source');
                if (lastSource) vIdx = (parseInt(lastSource.value) + 1) % el.pts.length;
            }
        }
    }
    row.setAttribute('data-target-corner', tCorner);
    let sourceHtml = '';
    if (el.type === 'poly' && el.pts) {
        sourceHtml = `<select class="dir-select inner-bind-source" style="padding: 6px 2px; font-size: 11px;">`;
        for (let i = 0; i < el.pts.length; i++) sourceHtml += `<option value="${i}" ${i === vIdx ? 'selected' : ''}>Угол ${i + 1}</option>`;
        sourceHtml += `</select>`;
    } else { sourceHtml = `<div style="font-size:11px; color:var(--text-muted); text-align:center; background:var(--input-bg); padding:6px 0; border-radius:6px; border:1px solid var(--border);">Край</div><input type="hidden" class="inner-bind-source" value="0">`; }
    let selectHtml = '';
    if (tCorner !== '' && tCorner !== null && !isNaN(tCorner)) selectHtml = `<select class="dir-select inner-bind-wall" style="padding: 6px 2px; font-size: 11px;">${getCornerLetterOptionsHtml(parseInt(tCorner))}</select>`;
    else selectHtml = `<select class="dir-select inner-bind-wall" style="padding: 6px 2px; font-size: 11px;">${getWallOptionsHtml(wallIdx)}</select>`;
    row.innerHTML = `${sourceHtml}${selectHtml}<input type="text" inputmode="numeric" class="input-field inner-bind-dist" placeholder="0" value="${distVal}" oninput="this.value = formatLaserShift(this.value)" style="font-weight: 700; text-align: center; font-size: 12px; padding: 6px 2px;"><button class="checklist-act-btn" type="button" style="color: var(--danger); font-size: 13px; padding: 6px 8px;" onclick="this.parentElement.remove()" title="Удалить">✖</button>`;
    container.appendChild(row);
}

function openInnerEditSheet(idx) {
    selectedInnerIdx = idx; activeBindSource = null; let el = innerElements[idx]; if (!el) return;
    document.getElementById('innerSheetTitle').innerText = `📦 ${el.title || 'Элемент'}`;
    const dimBlock = document.getElementById('innerDimensionsBlock');
    if (el.type === 'circle') {
        let dCm = Math.round(el.diamCm || 40);
        dimBlock.innerHTML = `<div style="flex: 1;"><label style="font-size:11px; color:var(--text-muted);">Диаметр ⌀ (см):</label><input type="text" inputmode="numeric" id="sheetInnerDiam" class="input-field" value="${dCm}" oninput="this.value = formatLaserShift(this.value)" style="font-weight:700;"></div>`;
    } else if (el.type === 'rect') {
        let lCm = Math.round(el.lenCm || 120), wCm = Math.round(el.widCm || 60);
        dimBlock.innerHTML = `<div style="flex: 1;"><label style="font-size:11px; color:var(--text-muted);">Длина (см):</label><input type="text" inputmode="numeric" id="sheetInnerLen" class="input-field" value="${lCm}" oninput="this.value = formatLaserShift(this.value)" style="font-weight:700;"></div><div style="flex: 1;"><label style="font-size:11px; color:var(--text-muted);">Ширина (см):</label><input type="text" inputmode="numeric" id="sheetInnerWid" class="input-field" value="${wCm}" oninput="this.value = formatLaserShift(this.value)" style="font-weight:700;"></div>`;
    } else if (el.type === 'poly' && el.pts) {
        let rowsHtml = '';
        for (let i = 0; i < el.pts.length; i++) {
            let p1 = el.pts[i], p2 = el.pts[(i + 1) % el.pts.length];
            let curLenCm = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel);
            rowsHtml += `<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;"><span style="font-size: 11px; font-weight: 600; color: var(--text-main); white-space: nowrap;">Сторона ${i + 1}–${((i + 1) % el.pts.length) + 1}:</span><input type="text" class="input-field poly-side-input" value="${curLenCm} см" readonly style="font-weight: 700; width: 110px; text-align: center; opacity: 0.6; border: 1px dashed var(--border); background: transparent;"></div>`;
        }
        dimBlock.innerHTML = `<div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">${rowsHtml}</div>`;
    } else {
        dimBlock.innerHTML = `<span style="font-size:12px; color:var(--text-muted);">Произвольный короб (${el.pts ? el.pts.length : 0} углов)</span>`;
    }
    const bindingsContainer = document.getElementById('innerWallBindingsContainer');
    if (bindingsContainer) {
        bindingsContainer.innerHTML = '';
        if (el.customBindings && el.customBindings.length > 0) {
            el.customBindings.forEach(b => {
                if (b.targetCornerIdx !== undefined && b.targetCornerIdx !== null) addInnerWallBindingRow(b.targetCornerIdx, b.distCm, b);
                else { let wIdx = b.targetWallIdx !== undefined ? b.targetWallIdx : (b.wallIdx || 0); addInnerWallBindingRow(wIdx, b.distCm, b); }
            });
        } else {
            let nearest = getElementWallDistances(el);
            if (nearest.length > 0) addInnerWallBindingRow(nearest[0].wallIdx, nearest[0].distCm);
            if (nearest.length > 1) addInnerWallBindingRow(nearest[1].wallIdx, nearest[1].distCm);
        }
    }
    document.getElementById('innerEditSheetOverlay').classList.add('open');
}

function closeInnerEditSheet() { document.getElementById('innerEditSheetOverlay').classList.remove('open'); selectedInnerIdx = null; activeBindSource = null; drawSketch(); }

function applyInnerSheetSettings() {
    if (selectedInnerIdx === null || !innerElements[selectedInnerIdx]) return;
    saveState(); let el = innerElements[selectedInnerIdx];
    if (el.type === 'circle') {
        let dCm = parseInt(document.getElementById('sheetInnerDiam')?.value, 10);
        if (dCm && dCm > 0) { el.diamCm = dCm; el.radius = (el.diamCm / 2) / cmPerPixel; el.title = `Колонна ⌀${dCm} см`; }
    } else if (el.type === 'rect') {
        let lCm = parseInt(document.getElementById('sheetInnerLen')?.value, 10), wCm = parseInt(document.getElementById('sheetInnerWid')?.value, 10);
        if (lCm && wCm && lCm > 0 && wCm > 0) { el.lenCm = lCm; el.widCm = wCm; el.w = el.lenCm / cmPerPixel; el.h = el.widCm / cmPerPixel; el.title = `Люк ${lCm}×${wCm} см`; }
    } else if (el.type === 'poly' && el.pts) {
        let sx = 0, sy = 0; el.pts.forEach(p => { sx += p.x; sy += p.y; }); el.x = sx / el.pts.length; el.y = sy / el.pts.length;
    }
    const bindingRows = document.querySelectorAll('.inner-binding-row');
    el.customBindings = [];
    bindingRows.forEach(row => {
        let sourceSelect = row.querySelector('.inner-bind-source'), wallSelect = row.querySelector('.inner-bind-wall'), distInput = row.querySelector('.inner-bind-dist');
        if (!wallSelect || !distInput) return;
        let selectedVal = parseInt(wallSelect.value, 10), distCm = parseInt(distInput.value, 10);
        let vIdx = sourceSelect ? parseInt(sourceSelect.value, 10) : 0, tCornerStr = row.getAttribute('data-target-corner');
        if (distCm && distCm >= 1 && distCm <= 5000) {
            let bindObj = { vertexIdx: vIdx, distCm: distCm };
            if (tCornerStr !== '' && tCornerStr !== null) bindObj.targetCornerIdx = selectedVal;
            else bindObj.targetWallIdx = selectedVal;
            el.customBindings.push(bindObj);
            applySingleBindingShift(el, bindObj, distCm);
        }
    });
    closeInnerEditSheet(); renderInnerElementsList(); drawSketch();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Параметры и привязки применены!', 'success');
}

function deleteCurrentInnerFromSheet() { if (selectedInnerIdx === null) return; deleteInnerElement(selectedInnerIdx); closeInnerEditSheet(); }

function deleteInnerElement(idx) {
    if (!innerElements[idx]) return; saveState(); innerElements.splice(idx, 1); activeBindSource = null;
    renderInnerElementsList(); drawSketch(); if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Элемент удалён');
}

function renderInnerElementsList() {
    const container = document.getElementById('innerElementsContainer'); const badge = document.getElementById('innerCountBadge');
    if (badge) badge.innerText = `${innerElements.length} шт.`; if (!container) return;
    if (innerElements.length === 0) { container.innerHTML = `<div style="font-size:11px; color:var(--text-muted); text-align:center; padding: 4px 0;">Нет коробов или колонн</div>`; return; }
    container.innerHTML = innerElements.map((el, idx) => {
        let distText = '';
        if (el.customBindings && el.customBindings.length > 0) {
            distText = el.customBindings.map(b => {
                let vLabel = (el.type === 'poly' && b.vertexIdx !== undefined) ? `Уг.${b.vertexIdx + 1}➔` : '';
                if (b.targetCornerIdx !== undefined && b.targetCornerIdx !== null) {
                    let pC = points[b.targetCornerIdx]; return `${vLabel}Угол ${pC ? pC.label : (b.targetCornerIdx + 1)}: ${b.distCm} см`;
                } else {
                    let wIdx = b.targetWallIdx !== undefined ? b.targetWallIdx : (b.wallIdx || 0); let p1 = points[wIdx], p2 = points[(wIdx + 1) % points.length];
                    return `${vLabel}${(p1 && p2) ? `${p1.label}–${p2.label}` : `Стена ${wIdx + 1}`}: ${b.distCm} см`;
                }
            }).join(' | ');
        } else {
            let nearest = getElementWallDistances(el); distText = nearest.map(n => `${n.wallName}: ${n.distCm} см`).join(' | ');
        }
        let sizeText = '';
        if (el.type === 'rect') sizeText = `${Math.round(el.lenCm)}×${Math.round(el.widCm)} см`;
        else if (el.type === 'circle') sizeText = `⌀${Math.round(el.diamCm)} см`;
        else if (el.type === 'poly') sizeText = `${el.pts.length} угл.`;
        let baseName = el.title || `Короб ${idx + 1}`; if (baseName.includes('(')) baseName = baseName.split('(')[0].trim();
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; background:var(--sub-block-bg); border:1px solid var(--border); border-radius:8px; padding:6px 10px; font-size:11px;">
                <div style="display:flex; flex-direction:column; gap:2px; overflow:hidden; cursor:pointer;" onclick="openInnerEditSheet(${idx})">
                    <span style="font-weight:600; color:var(--text-main);">${idx + 1}. ${baseName} (${sizeText})</span>
                    <span style="color:var(--text-muted); font-size:10px;">📍 От края: ${distText || '—'}</span>
                </div>
                <div style="display:flex; gap:4px; align-items:center;">
                    <button class="checklist-act-btn" onclick="openInnerEditSheet(${idx})" title="Настройки">⚙️</button>
                    <button class="checklist-act-btn" style="color:var(--danger);" onclick="deleteInnerElement(${idx})" title="Удалить">✖</button>
                </div>
            </div>
        `;
    }).join('');
}

// --- УМНЫЙ МИКРОСКОП (ОТРИСОВКА С ИНВЕРСИЕЙ МАСШТАБА) ---
function drawSketch() {
    if (!canvas.width || !canvas.height) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    wallHitBoxes = []; diagHitBoxes = []; bindHitBoxes = [];
    
    ctx.save(); 
    ctx.translate(panOffset.x, panOffset.y); 
    ctx.scale(zoomLevel, zoomLevel);

    // Этот коэффициент не дает точкам и тексту "раздуваться" при увеличении
    const iZ = 1 / zoomLevel; 

    const isLight = document.body.classList.contains('light-theme');
    const gridColor = isLight ? '#f1f5f9' : '#1e293b'; 
    const mainStrokeColor = isLight ? '#0f172a' : '#e2e8f0';
    const polyFillColor = isLight ? 'rgba(15, 23, 42, 0.04)' : 'rgba(79, 70, 229, 0.08)';
    const diagLineColor = isLight ? 'rgba(15, 23, 42, 0.3)' : 'rgba(255, 255, 255, 0.25)';
    const badgeBgColor = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(15, 23, 42, 0.92)';
    const wallTextColor = isLight ? '#0f172a' : '#f8fafc'; 
    const diagTextColor = isLight ? '#475569' : '#94a3b8';
    const pointLabelColor = isLight ? '#0f172a' : '#ffffff'; 

    ctx.strokeStyle = gridColor; 
    ctx.lineWidth = 1 * iZ;
    let gridLimitX = Math.max(canvas.width, 2000), gridLimitY = Math.max(canvas.height, 2000);
    for (let x = -1000; x < gridLimitX; x += 20) { ctx.beginPath(); ctx.moveTo(x, -1000); ctx.lineTo(x, gridLimitY); ctx.stroke(); }
    for (let y = -1000; y < gridLimitY; y += 20) { ctx.beginPath(); ctx.moveTo(-1000, y); ctx.lineTo(gridLimitX, y); ctx.stroke(); }

    if (points.length === 0) { ctx.restore(); return; }

    let centerX = 0, centerY = 0; points.forEach(p => { centerX += p.x; centerY += p.y; }); centerX /= points.length; centerY /= points.length;
    let diags = getCleanDiagonals();
    if (diags.length > 0) {
        ctx.save(); 
        ctx.lineWidth = 1.2 * iZ; 
        ctx.setLineDash([4 * iZ, 4 * iZ]);
        diags.forEach((d, idx) => {
            ctx.strokeStyle = d.isCustom ? '#0284c7' : diagLineColor;
            ctx.beginPath(); ctx.moveTo(d.from.x, d.from.y); ctx.lineTo(d.to.x, d.to.y); ctx.stroke();
            let ratio = 0.4 + (idx % 3) * 0.12, mx = d.from.x + (d.to.x - d.from.x) * ratio, my = d.from.y + (d.to.y - d.from.y) * ratio;
            diagHitBoxes.push({ fromIdx: d.idxFrom, toIdx: d.idxTo, name: d.name, lenCm: d.len, x: mx, y: my });
            
            ctx.fillStyle = badgeBgColor; 
            ctx.fillRect(mx - 24 * iZ, my - 9 * iZ, 48 * iZ, 18 * iZ);
            ctx.strokeStyle = d.isCustom ? '#0284c7' : (isLight ? '#cbd5e1' : '#334155'); 
            ctx.strokeRect(mx - 24 * iZ, my - 9 * iZ, 48 * iZ, 18 * iZ);
            
            ctx.fillStyle = d.isCustom ? '#0284c7' : diagTextColor; 
            ctx.font = '500 ' + (10 * iZ) + 'px "Inter", "Roboto", sans-serif'; 
            ctx.textAlign = 'center'; 
            ctx.fillText(`${d.len} см`, mx, my + 3 * iZ);
        });
        ctx.restore();
    }

    if (points.length >= 2) {
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        if (isClosed && points.length >= 3) { ctx.closePath(); ctx.fillStyle = polyFillColor; ctx.fill(); }
        ctx.strokeStyle = mainStrokeColor; 
        ctx.lineWidth = 2.2 * iZ; 
        ctx.stroke();
        
        if (!isClosed && points.length >= 3) {
            ctx.save(); ctx.strokeStyle = 'rgba(5, 150, 105, 0.55)'; ctx.lineWidth = 1.5 * iZ; ctx.setLineDash([5 * iZ, 5 * iZ]);
            ctx.beginPath(); ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y); ctx.lineTo(points[0].x, points[0].y); ctx.stroke(); ctx.restore();
        }
    }

    let renderedBadgeBoxes = [];
    points.forEach(p => {
        if (!p) return;
        renderedBadgeBoxes.push({ x: p.x, y: p.y, w: 20 * iZ, h: 20 * iZ });
        let vx = p.x - centerX, vy = p.y - centerY, vLen = Math.hypot(vx, vy) || 1;
        renderedBadgeBoxes.push({ x: p.x + (vx / vLen) * 16 * iZ, y: p.y + (vy / vLen) * 16 * iZ, w: 24 * iZ, h: 16 * iZ });
    });

    innerElements.forEach((el, elIdx) => {
        let activeBindsToRender = [];
        if (el.customBindings && el.customBindings.length > 0) {
            el.customBindings.forEach((b, bIdx) => {
                if (b.targetCornerIdx !== undefined && b.targetCornerIdx !== null) {
                    let pBox = (el.pts && el.pts[b.vertexIdx]) ? el.pts[b.vertexIdx] : { x: el.x, y: el.y }, pRoom = points[b.targetCornerIdx];
                    if (pRoom) activeBindsToRender.push({ elIdx, bindIdx: bIdx, edgeX: pBox.x, edgeY: pBox.y, projX: pRoom.x, projY: pRoom.y, distCm: Math.round(Math.hypot(pRoom.x - pBox.x, pRoom.y - pBox.y) * cmPerPixel) });
                } else {
                    let wIdx = b.targetWallIdx !== undefined ? b.targetWallIdx : (b.wallIdx || 0);
                    let pA = points[wIdx], pB = points[(wIdx + 1) % points.length];
                    if (pA && pB) {
                        if (el.type === 'rect' || el.type === 'circle') {
                            let res = getClosestPointOnElementToSegment(el, pA, pB); activeBindsToRender.push({ elIdx, bindIdx: bIdx, edgeX: res.edgePoint.x, edgeY: res.edgePoint.y, projX: res.proj.x, projY: res.proj.y, distCm: Math.round(res.distPx * cmPerPixel) });
                        } else {
                            let pBox = (el.pts && el.pts[b.vertexIdx]) ? el.pts[b.vertexIdx] : { x: el.x, y: el.y }, proj = getClosestPointOnSegment(pBox, pA, pB);
                            activeBindsToRender.push({ elIdx, bindIdx: bIdx, edgeX: pBox.x, edgeY: pBox.y, projX: proj.x, projY: proj.y, distCm: Math.round(Math.hypot(proj.x - pBox.x, proj.y - pBox.y) * cmPerPixel) });
                        }
                    }
                }
            });
        } else {
            let defDists = getElementWallDistances(el);
            defDists.forEach(w => activeBindsToRender.push({ elIdx, bindIdx: null, edgeX: w.edgeX, edgeY: w.edgeY, projX: w.projX, projY: w.projY, distCm: w.distCm }));
        }

        ctx.save(); ctx.font = '700 ' + (9 * iZ) + 'px "Inter", sans-serif';
        activeBindsToRender.forEach(w => {
            ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.2 * iZ; ctx.setLineDash([3 * iZ, 3 * iZ]); ctx.beginPath(); ctx.moveTo(w.edgeX, w.edgeY); ctx.lineTo(w.projX, w.projY); ctx.stroke();
            let text = `${w.distCm} см`, textW = ctx.measureText(text).width, padX = 6 * iZ, boxW = textW + padX * 2, boxH = 14 * iZ;
            let midX = (w.edgeX + w.projX) / 2, midY = (w.edgeY + w.projY) / 2;

            let jumps = 0;
            for (let b of renderedBadgeBoxes) {
                if (Math.abs(b.x - midX) < (boxW / 2 + 10 * iZ) && Math.abs(b.y - midY) < 14 * iZ) {
                    midY += (midY >= b.y) ? 14 * iZ : -14 * iZ;
                    jumps++; if (jumps > 3) break; 
                }
            }
            renderedBadgeBoxes.push({ x: midX, y: midY, w: boxW, h: boxH });
            if (w.bindIdx !== null) bindHitBoxes.push({ elIdx: w.elIdx, bindIdx: w.bindIdx, distCm: w.distCm, x: midX, y: midY, w: boxW, h: boxH });

            ctx.setLineDash([]); ctx.fillStyle = badgeBgColor; ctx.fillRect(midX - boxW / 2, midY - boxH / 2, boxW, boxH);
            ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1 * iZ; ctx.strokeRect(midX - boxW / 2, midY - boxH / 2, boxW, boxH);
            ctx.fillStyle = '#ef4444'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, midX, midY + 0.5 * iZ);
        });
        ctx.restore();

        ctx.save(); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2 * iZ; ctx.fillStyle = isLight ? 'rgba(37, 99, 235, 0.12)' : 'rgba(37, 99, 235, 0.22)';
        if (el.type === 'rect') {
            let rw = el.w || (el.lenCm / cmPerPixel), rh = el.h || (el.widCm / cmPerPixel);
            ctx.setLineDash([5 * iZ, 3 * iZ]); ctx.strokeRect(el.x - rw / 2, el.y - rh / 2, rw, rh); ctx.fillRect(el.x - rw / 2, el.y - rh / 2, rw, rh);
            ctx.font = '600 ' + (10 * iZ) + 'px "Inter", sans-serif'; ctx.textAlign = 'center'; ctx.fillRect(el.x - 30 * iZ, el.y - rh / 2 - 8 * iZ, 60 * iZ, 15 * iZ); ctx.fillStyle = '#2563eb'; ctx.fillText(`${Math.round(el.lenCm)}`, el.x, el.y - rh / 2 + 3 * iZ);
            ctx.fillStyle = badgeBgColor; ctx.fillRect(el.x + rw / 2 - 25 * iZ, el.y + 12 * iZ, 50 * iZ, 15 * iZ); ctx.fillStyle = '#2563eb'; ctx.fillText(`${Math.round(el.widCm)}`, el.x + rw / 2, el.y + 23 * iZ);
        } else if (el.type === 'circle') {
            let rad = el.radius || ((el.diamCm / 2) / cmPerPixel);
            ctx.setLineDash([4 * iZ, 3 * iZ]); ctx.beginPath(); ctx.arc(el.x, el.y, rad, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
            ctx.fillStyle = badgeBgColor; ctx.fillRect(el.x - 32 * iZ, el.y - 9 * iZ, 64 * iZ, 18 * iZ); ctx.fillStyle = '#2563eb'; ctx.font = '700 ' + (10 * iZ) + 'px "Inter", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`⌀${Math.round(el.diamCm)}`, el.x, el.y + 4 * iZ);
        } else if (el.type === 'poly' && el.pts && el.pts.length >= 3) {
            ctx.setLineDash([5 * iZ, 3 * iZ]); ctx.beginPath(); ctx.moveTo(el.pts[0].x, el.pts[0].y);
            for (let i = 1; i < el.pts.length; i++) ctx.lineTo(el.pts[i].x, el.pts[i].y);
            ctx.closePath(); ctx.stroke(); ctx.fill();
            ctx.font = '600 ' + (10 * iZ) + 'px "Inter", sans-serif'; ctx.textAlign = 'center';
            for (let i = 0; i < el.pts.length; i++) {
                let p1 = el.pts[i], p2 = el.pts[(i + 1) % el.pts.length];
                let sideCm = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel);
                let midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
                
                let jumps = 0;
                for (let b of renderedBadgeBoxes) {
                    if (Math.abs(b.x - midX) < 40 * iZ && Math.abs(b.y - midY) < 16 * iZ) {
                        midY += (midY >= b.y) ? 16 * iZ : -16 * iZ;
                        jumps++; if (jumps > 3) break;
                    }
                }
                renderedBadgeBoxes.push({ x: midX, y: midY, w: 44 * iZ, h: 14 * iZ });
                ctx.fillStyle = badgeBgColor; ctx.fillRect(midX - 22 * iZ, midY - 7 * iZ, 44 * iZ, 14 * iZ); ctx.fillStyle = '#2563eb'; ctx.fillText(`${sideCm}`, midX, midY + 4 * iZ);
            }
            if (editMode === 'inner') {
                ctx.setLineDash([]);
                el.pts.forEach((pt, vIdx) => {
                    let isSelectedSource = (activeBindSource && activeBindSource.innerIdx === elIdx && activeBindSource.vertexIdx === vIdx);
                    if (isSelectedSource) { ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(pt.x, pt.y, 11 * iZ, 0, Math.PI * 2); ctx.fill(); }
                    ctx.fillStyle = isSelectedSource ? '#d97706' : '#2563eb'; ctx.beginPath(); ctx.arc(pt.x, pt.y, 7 * iZ, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#ffffff'; ctx.font = '700 ' + (9 * iZ) + 'px "Inter", sans-serif'; ctx.fillText(`${vIdx + 1}`, pt.x, pt.y + 3 * iZ);
                });
            }
        }
        ctx.restore();
    });

    if (activeDrawingPoly.length > 0) {
        ctx.save(); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2 * iZ; ctx.setLineDash([4 * iZ, 3 * iZ]); ctx.beginPath(); ctx.moveTo(activeDrawingPoly[0].x, activeDrawingPoly[0].y);
        for (let i = 1; i < activeDrawingPoly.length; i++) { ctx.lineTo(activeDrawingPoly[i].x, activeDrawingPoly[i].y); } ctx.stroke();
        activeDrawingPoly.forEach((pt, i) => {
            ctx.fillStyle = i === 0 ? '#10b981' : '#f59e0b'; ctx.beginPath(); ctx.arc(pt.x, pt.y, (i === 0 ? 8 : 5) * iZ, 0, Math.PI * 2); ctx.fill();
            if (i === 0 && activeDrawingPoly.length >= 3) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * iZ; ctx.stroke(); }
        });
        ctx.restore();
    }

    let wallCount = getWallCount(); ctx.textAlign = 'center';
    for (let i = 0; i < wallCount; i++) {
        let p1 = points[i], p2 = points[(i + 1) % points.length];
        if (!p1 || !p2) continue;
        let wallPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        let inputEl = document.getElementById(`wall-input-${i}`);
        let lenVal = inputEl ? inputEl.value : Math.round(wallPx * cmPerPixel);
        let midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
        let outX = midX - centerX, outY = midY - centerY, outLen = Math.hypot(outX, outY) || 1;
        
        let pushDist = wallPx < 25 ? 28 * iZ : 18 * iZ; 
        let labelX = midX + (outX / outLen) * pushDist, labelY = midY + (outY / outLen) * pushDist;

        let jumps = 0;
        for (let b of renderedBadgeBoxes) {
            if (Math.abs(b.x - labelX) < 46 * iZ && Math.abs(b.y - labelY) < 16 * iZ) {
                labelY += (labelY >= b.y) ? 16 * iZ : -16 * iZ;
                jumps++; if (jumps > 2) break; 
            }
        }

        if (jumps > 0 || wallPx < 25) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(midX, midY);
            ctx.lineTo(labelX, labelY);
            ctx.strokeStyle = isLight ? '#94a3b8' : '#64748b';
            ctx.lineWidth = 1 * iZ;
            ctx.setLineDash([2 * iZ, 2 * iZ]);
            ctx.stroke();
            ctx.restore();
        }

        renderedBadgeBoxes.push({ x: labelX, y: labelY, w: 56 * iZ, h: 16 * iZ }); wallHitBoxes.push({ wallIdx: i, x: labelX, y: labelY });
        ctx.fillStyle = badgeBgColor; ctx.fillRect(labelX - 28 * iZ, labelY - 11 * iZ, 56 * iZ, 16 * iZ);
        ctx.strokeStyle = isLight ? '#e2e8f0' : '#334155'; ctx.strokeRect(labelX - 28 * iZ, labelY - 11 * iZ, 56 * iZ, 16 * iZ);
        ctx.fillStyle = wallTextColor; ctx.font = '600 ' + (11 * iZ) + 'px "Inter", "Roboto", sans-serif'; 
        ctx.fillText(`${lenVal} см`, labelX, labelY + 3.5 * iZ);
    }

    points.forEach((p, idx) => {
        if (!p) return;
        let isAimTarget = (editMode === 'aim_diag' && diagStartPointIdx === idx);
        if (isAimTarget) { ctx.fillStyle = 'rgba(2, 132, 199, 0.4)'; ctx.beginPath(); ctx.arc(p.x, p.y, 14 * iZ, 0, Math.PI * 2); ctx.fill(); }

        ctx.fillStyle = (!isClosed && idx === 0 && points.length >= 3) ? '#059669' : (isAimTarget ? '#0284c7' : mainStrokeColor);
        ctx.beginPath(); ctx.arc(p.x, p.y, 6 * iZ, 0, Math.PI * 2); ctx.fill();
        let vx = p.x - centerX, vy = p.y - centerY, vLen = Math.hypot(vx, vy) || 1;
        let lx = p.x + (vx / vLen) * 16 * iZ, ly = p.y + (vy / vLen) * 16 * iZ + 4 * iZ;
        ctx.fillStyle = pointLabelColor; ctx.font = '700 ' + (12 * iZ) + 'px "Inter", "Roboto", sans-serif'; ctx.fillText(p.label, lx, ly);
    });
    ctx.textAlign = 'start'; ctx.restore();
}

function createInteractiveBinding(targetType, targetIdx) {
    if (!activeBindSource) return;
    let el = innerElements[activeBindSource.innerIdx];
    if (!el) { activeBindSource = null; return; }
    let pBox = (el.pts && el.pts[activeBindSource.vertexIdx]) ? el.pts[activeBindSource.vertexIdx] : { x: el.x, y: el.y };
    let curDistCm = 50, bindTitle = '';
    if (targetType === 'corner') {
        let pRoom = points[targetIdx]; curDistCm = Math.round(Math.hypot(pRoom.x - pBox.x, pRoom.y - pBox.y) * cmPerPixel);
        bindTitle = `Угол короба ${activeBindSource.vertexIdx + 1} ➔ Угол комнаты ${pRoom.label}`;
    } else {
        let pA = points[targetIdx], pB = points[(targetIdx + 1) % points.length], proj = getClosestPointOnSegment(pBox, pA, pB);
        curDistCm = Math.round(Math.hypot(proj.x - pBox.x, proj.y - pBox.y) * cmPerPixel);
        bindTitle = `Угол короба ${activeBindSource.vertexIdx + 1} ➔ Стена ${pA.label}–${pB.label}`;
    }
    let userVal = prompt(`📏 ${bindTitle}\nВведите расстояние (см):`, curDistCm);
    if (userVal !== null) {
        let targetCm = parseInt(userVal.replace(/\D/g, ''), 10);
        if (targetCm && targetCm >= 1 && targetCm <= 5000) {
            saveState(); if (!el.customBindings) el.customBindings = [];
            let bindObj = { vertexIdx: activeBindSource.vertexIdx, distCm: targetCm };
            if (targetType === 'corner') bindObj.targetCornerIdx = targetIdx; else bindObj.targetWallIdx = targetIdx;
            el.customBindings.push(bindObj); applySingleBindingShift(el, bindObj, targetCm);
            renderInnerElementsList(); drawSketch(); if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
            showToast(`Привязка зафиксирована: ${targetCm} см`, 'success');
        } else { showToast('Некорректное значение расстояния', 'error'); }
    }
    activeBindSource = null; updateHint(); drawSketch();
}

function editCreatedBinding(hit) {
    let el = innerElements[hit.elIdx];
    if (!el || !el.customBindings || !el.customBindings[hit.bindIdx]) return;
    let b = el.customBindings[hit.bindIdx];
    let userVal = prompt(`📏 Изменить размер привязки (см) или введите 0 для удаления:`, b.distCm);
    if (userVal !== null) {
        let targetCm = parseInt(userVal.replace(/\D/g, ''), 10);
        saveState();
        if (targetCm === 0) { el.customBindings.splice(hit.bindIdx, 1); showToast('Привязка удалена'); }
        else if (targetCm && targetCm >= 1 && targetCm <= 5000) { b.distCm = targetCm; applySingleBindingShift(el, b, targetCm); showToast(`Привязка обновлена: ${b.distCm} см`, 'success'); }
        renderInnerElementsList(); drawSketch(); if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    }
}

canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (isSketchLocked) return;
    if (document.activeElement) document.activeElement.blur();
    const isFullscreen = document.getElementById('canvasCard')?.classList.contains('fullscreen');
    activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

    if (isFullscreen && activePointers.size === 2) {
        isDragging = false; isPanningCanvas = false; draggedPointIndex = null; draggedInnerIdx = null; draggedInnerVertex = null;
        const pts = Array.from(activePointers.values());
        pinchStartDistance = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        pinchStartZoom = zoomLevel; pinchStartPan = { x: panOffset.x, y: panOffset.y };
        const rect = canvas.getBoundingClientRect();
        pinchCenter = { x: (pts[0].clientX + pts[1].clientX) / 2 - rect.left, y: (pts[0].clientY + pts[1].clientY) / 2 - rect.top };
        return;
    }
    if (activePointers.size > 1) return;

    const pos = getCanvasPointerPos(e), x = pos.x, y = pos.y;
    const iZ = 1 / zoomLevel;

    if (editMode === 'aim_diag') {
        for (let i = 0; i < points.length; i++) {
            if (Math.hypot(points[i].x - x, points[i].y - y) < 50 * iZ) { 
                if (diagStartPointIdx === null) {
                    diagStartPointIdx = i; showToast(`Первый угол выбран (${points[i].label}). Тапните во второй.`);
                    updateHint(); drawSketch();
                } else {
                    if (diagStartPointIdx === i) { showToast('Выбран тот же самый угол!', 'error'); return; }
                    let diff = Math.abs(diagStartPointIdx - i);
                    if (diff === 1 || diff === points.length - 1) {
                        showToast('Это стена, а не диагональ!', 'error'); diagStartPointIdx = null; updateHint(); drawSketch(); return;
                    }
                    let pA = points[diagStartPointIdx], pB = points[i];
                    let curDistCm = Math.round(Math.hypot(pB.x - pA.x, pB.y - pA.y) * cmPerPixel);
                    let userVal = prompt(`📐 Диагональ ${pA.label}–${pB.label}\nВведите длину с рулетки (см):`, curDistCm);
                    if (userVal !== null) {
                        let cm = parseInt(userVal.replace(/\D/g, ''), 10);
                        if (cm && cm >= 1 && cm <= 5000) applyDiagonalLength(diagStartPointIdx, i, cm);
                        else showToast('Введена некорректная длина!', 'error');
                    }
                    diagStartPointIdx = null; updateHint(); drawSketch();
                }
                return;
            }
        }
        return; 
    }

    for (let bBox of bindHitBoxes) {
        let halfW = (bBox.w || 64*iZ) / 2, halfH = (bBox.h || 16*iZ) / 2;
        if (x >= bBox.x - halfW && x <= bBox.x + halfW && y >= bBox.y - halfH && y <= bBox.y + halfH) { editCreatedBinding(bBox); return; }
    }

    if (activeBindSource !== null) {
        for (let i = 0; i < points.length; i++) { if (Math.hypot(points[i].x - x, points[i].y - y) < 26 * iZ) { createInteractiveBinding('corner', i); return; } }
        let count = getWallCount();
        for (let i = 0; i < count; i++) {
            let proj = getClosestPointOnSegment({ x, y }, points[i], points[(i + 1) % points.length]);
            if (Math.hypot(proj.x - x, proj.y - y) < 22 * iZ) { createInteractiveBinding('wall', i); return; }
        }
    }

    if (editMode === 'drawing_poly') {
        if (activeDrawingPoly.length >= 3 && Math.hypot(activeDrawingPoly[0].x - x, activeDrawingPoly[0].y - y) < 45 * iZ) {
            saveState(); let sx = 0, sy = 0; activeDrawingPoly.forEach(p => { sx += p.x; sy += p.y; });
            innerElements.push({ id: 'inner_' + Date.now(), type: 'poly', title: `Короб (${activeDrawingPoly.length} угл.)`, x: sx / activeDrawingPoly.length, y: sy / activeDrawingPoly.length, pts: [...activeDrawingPoly], customBindings: [] });
            activeDrawingPoly = []; editMode = 'inner'; renderInnerElementsList(); updateHint(); drawSketch(); if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState(); showToast('Произвольный короб создан!', 'success'); return;
        }
        activeDrawingPoly.push({ x, y }); updateHint(); drawSketch(); return;
    }

    if (editMode === 'inner') {
        for (let i = innerElements.length - 1; i >= 0; i--) {
            let el = innerElements[i];
            if (el.type === 'poly' && el.pts) {
                for (let v = 0; v < el.pts.length; v++) {
                    if (Math.hypot(el.pts[v].x - x, el.pts[v].y - y) < 24 * iZ) {
                        if (activeBindSource && activeBindSource.innerIdx === i && activeBindSource.vertexIdx === v) { activeBindSource = null; showToast('Выбор точки отменён'); }
                        else { activeBindSource = { innerIdx: i, vertexIdx: v }; selectedInnerIdx = i; showToast(`🎯 Угол ${v + 1} выбран! Теперь тапайте по стене или углу комнаты`, 'success'); }
                        updateHint(); drawSketch(); return;
                    }
                }
            }
        }
        for (let i = innerElements.length - 1; i >= 0; i--) {
            let el = innerElements[i], hit = false, rw = el.w || (el.lenCm / cmPerPixel), rh = el.h || (el.widCm / cmPerPixel), rad = el.radius || (el.diamCm ? (el.diamCm / 2) / cmPerPixel : 20 / cmPerPixel);
            if (el.type === 'rect') hit = (x >= el.x - rw / 2 && x <= el.x + rw / 2 && y >= el.y - rh / 2 && y <= el.y + rh / 2);
            else if (el.type === 'circle') hit = Math.hypot(el.x - x, el.y - y) <= rad;
            else if (el.type === 'poly') hit = Math.hypot(el.x - x, el.y - y) <= 45 * iZ;
            if (hit) { selectedInnerIdx = i; saveState(); draggedInnerIdx = i; draggedInnerVertex = null; innerDragOffset = { x: x - el.x, y: y - el.y }; canvas.setPointerCapture(e.pointerId); return; }
        }
    }

    if (!isClosed && points.length >= 3 && Math.hypot(points[0].x - x, points[0].y - y) < 30 * iZ) { closePolygon(); return; }
    for (let dBox of diagHitBoxes) { if (x >= dBox.x - 26*iZ && x <= dBox.x + 26*iZ && y >= dBox.y - 12*iZ && y <= dBox.y + 12*iZ) { openDiagonalEditSheet(dBox); return; } }
    for (let box of wallHitBoxes) { if (x >= box.x - 28*iZ && x <= box.x + 28*iZ && y >= box.y - 14*iZ && y <= box.y + 14*iZ) { openWallEditSheet(box.wallIdx); return; } }

    if (editMode === 'room') {
        for (let i = 0; i < points.length; i++) {
            if (Math.hypot(points[i].x - x, points[i].y - y) < 25 * iZ) { saveState(); draggedPointIndex = i; isDragging = true; canvas.setPointerCapture(e.pointerId); return; }
        }
    }

    if (points.length >= MAX_CORNERS) { showToast('Максимум 50 углов!', 'error'); return; }

    if (editMode === 'room') {
        if (!isClosed) {
            saveState(); let label = getPointLabel(points.length); points.push({ x, y, label });
            const presetCorners = document.getElementById('presetCornersCount'); if (presetCorners) presetCorners.value = points.length;
            rebuildWallInputs(); rebuildDiagonalInputs(); updateHint(); drawSketch(); if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState(); return;
        }
    }

    isPanningCanvas = true; panStartPoint = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
    if (isSketchLocked) return;
    if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    const isFullscreen = document.getElementById('canvasCard')?.classList.contains('fullscreen');

    if (isFullscreen && activePointers.size === 2 && pinchStartDistance) {
        e.preventDefault();
        const pts = Array.from(activePointers.values()), currentDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        if (currentDist > 0 && pinchStartDistance > 0) {
            const scaleFactor = currentDist / pinchStartDistance; let targetZoom = pinchStartZoom * scaleFactor;
            targetZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetZoom));
            const zoomRatio = targetZoom / zoomLevel;
            panOffset.x = pinchCenter.x - (pinchCenter.x - panOffset.x) * zoomRatio;
            panOffset.y = pinchCenter.y - (pinchCenter.y - panOffset.y) * zoomRatio;
            zoomLevel = targetZoom; drawSketch();
        }
        return;
    }

    if (activePointers.size > 1) return;

    if (isPanningCanvas) {
        e.preventDefault();
        panOffset.x += (e.clientX - panStartPoint.x); panOffset.y += (e.clientY - panStartPoint.y);
        panStartPoint = { x: e.clientX, y: e.clientY }; drawSketch(); return;
    }

    const pos = getCanvasPointerPos(e), curX = pos.x, curY = pos.y;

    if (isDragging && draggedPointIndex !== null) {
        e.preventDefault(); let p = points[draggedPointIndex]; p.x = curX; p.y = curY;
        syncInputsValuesOnly(); drawSketch(); return;
    }

    if (draggedInnerIdx !== null && draggedInnerVertex !== null && innerElements[draggedInnerIdx]) {
        e.preventDefault(); let el = innerElements[draggedInnerIdx];
        if (el.pts && el.pts[draggedInnerVertex]) {
            el.pts[draggedInnerVertex].x = curX; el.pts[draggedInnerVertex].y = curY;
            let sx = 0, sy = 0; el.pts.forEach(p => { sx += p.x; sy += p.y; }); el.x = sx / el.pts.length; el.y = sy / el.pts.length;
            renderInnerElementsList(); drawSketch(); return;
        }
    }

    if (draggedInnerIdx !== null && innerElements[draggedInnerIdx]) {
        e.preventDefault(); let el = innerElements[draggedInnerIdx], newX = curX - innerDragOffset.x, newY = curY - innerDragOffset.y;
        let dx = newX - el.x, dy = newY - el.y; el.x = newX; el.y = newY;
        if (el.type === 'poly' && el.pts) { el.pts.forEach(pt => { pt.x += dx; pt.y += dy; }); }
        renderInnerElementsList(); drawSketch();
    }
});

function handlePointerEnd(e) {
    if (activePointers.has(e.pointerId)) activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchStartDistance = null;
    if (isDragging) { if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState(); rebuildWallInputs(); rebuildDiagonalInputs(); }
    if (draggedInnerIdx !== null) if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    isDragging = false; isPanningCanvas = false; draggedPointIndex = null; draggedInnerIdx = null; draggedInnerVertex = null;
}

canvas.addEventListener('pointerup', handlePointerEnd);
canvas.addEventListener('pointercancel', handlePointerEnd);

function toggleDiagonalsMode() {
    if (!isClosed || points.length < 4) { showToast('Для диагоналей нужна замкнутая комната (от 4 углов)!', 'error'); return; }
    showDiagonalsList = !showDiagonalsList;
    const diagBtn = document.getElementById('diagToggleBtn'), diagContainer = document.getElementById('diagonalsInputsContainer'), wallsContainer = document.getElementById('wallsInputsContainer');
    if (diagBtn) diagBtn.classList.toggle('fab-active', showDiagonalsList);
    if (showDiagonalsList) {
        if (wallsContainer) wallsContainer.style.display = 'none';
        if (diagContainer) { diagContainer.style.display = 'flex'; rebuildDiagonalInputs(); }
        editMode = 'aim_diag'; diagStartPointIdx = null; showToast('🎯 Режим диагоналей: Тапните в первый угол', 'success'); updateHint(); drawSketch();
    } else {
        if (wallsContainer) wallsContainer.style.display = 'block';
        if (diagContainer) diagContainer.style.display = 'none';
        editMode = 'room'; diagStartPointIdx = null; showToast('Показан список внешних стен'); updateHint(); drawSketch();
    }
}

function rebuildDiagonalInputs() {
    const container = document.getElementById('diagonalsInputsContainer'); if (!container) return; container.innerHTML = '';
    if (!isClosed || points.length < 4) { container.innerHTML = `<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 10px 0;">Для диагоналей требуется замкнутая комната от 4 углов</div>`; return; }
    let addBox = document.createElement('div'); addBox.style.cssText = 'background: var(--sub-block-bg); border: 1px dashed var(--accent); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;';
    addBox.innerHTML = `
        <div style="font-size: 11px; font-weight: 700; color: var(--accent);">➕ СВОЯ ДИАГОНАЛЬ (МЕЖДУ УГЛАМИ):</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1.2fr auto; gap: 6px; align-items: center;">
            <select class="dir-select" id="newDiagFrom">${getCornerLetterOptionsHtml(0)}</select>
            <select class="dir-select" id="newDiagTo">${getCornerLetterOptionsHtml(2)}</select>
            <input type="text" inputmode="numeric" class="input-field" id="newDiagVal" placeholder="0" oninput="this.value = formatLaserShift(this.value)" style="font-weight: 700; text-align: center;">
            <button class="btn btn-primary" onclick="submitNewCustomDiagonal()" style="padding: 9px 12px; font-size: 11px; white-space: nowrap;">➕</button>
        </div>
    `;
    container.appendChild(addBox);

    getCleanDiagonals().forEach((d, i) => {
        let cmVal = Math.round(d.len), delBtn = d.isCustom ? `<button class="checklist-act-btn" style="color:var(--danger); padding:4px 6px;" onclick="removeCustomDiagonal(${i})" title="Удалить">✖</button>` : '';
        let row = document.createElement('div'); row.className = 'wall-row-input';
        row.innerHTML = `
            <span class="wall-row-label" style="color: ${d.isCustom ? '#0284c7' : 'var(--text-main)'};"><b>Диагональ ${d.name}</b></span>
            <input type="text" inputmode="numeric" class="input-field diag-len" id="diag-input-${i}" value="${cmVal}" oninput="handleDiagSmartInput(${d.idxFrom}, ${d.idxTo}, this)" onkeydown="if(event.key==='Enter') this.blur()" style="font-weight: 700; text-align: center;">
            <div style="font-size: 11px; color: var(--text-muted); padding-right: 2px;">см</div>
            ${delBtn}
        `;
        container.appendChild(row);
    });
}

function submitNewCustomDiagonal() {
    const selFrom = document.getElementById('newDiagFrom'), selTo = document.getElementById('newDiagTo'), valInput = document.getElementById('newDiagVal');
    if (!selFrom || !selTo || !valInput) return;
    let fIdx = parseInt(selFrom.value, 10), tIdx = parseInt(selTo.value, 10);
    if (fIdx === tIdx) { showToast('Выберите два РАЗНЫХ угла комнаты!', 'error'); return; }
    let diff = Math.abs(fIdx - tIdx);
    if (diff === 1 || diff === points.length - 1) { showToast('Это стена, а не диагональ!', 'error'); return; }
    let formatted = formatLaserShift(valInput.value), cm = parseInt(formatted, 10);
    if (!cm || cm < 1 || cm > 5000) { showToast('Введите корректную длину диагонали!', 'error'); return; }
    applyDiagonalLength(fIdx, tIdx, cm); valInput.value = ''; rebuildDiagonalInputs();
    showToast(`Диагональ ${points[fIdx].label}–${points[tIdx].label} добавлена!`, 'success');
}

function handleDiagSmartInput(fromIdx, toIdx, inputEl) {
    let formatted = formatLaserShift(inputEl.value); inputEl.value = formatted;
    let cm = parseInt(formatted, 10);
    if (cm && cm >= 1 && cm <= 5000) applyDiagonalLength(fromIdx, toIdx, cm);
}

function rebuildWallInputs() {
    const container = document.getElementById('wallsInputsContainer'), actionBtns = document.getElementById('tableActionButtons');
    if (!container) return; container.innerHTML = '';
    let totalAngles = points.length, extraAngles = totalAngles > 4 ? totalAngles - 4 : 0;
    const countAngles = document.getElementById('countAngles'); if (countAngles) countAngles.value = extraAngles;
    const wallsBadge = document.getElementById('wallsAnglesBadge'); if (wallsBadge) wallsBadge.innerText = `Углов: ${totalAngles} (доп: ${extraAngles})`;
    let wallCount = getWallCount();
    if (wallCount === 0) { if (actionBtns) actionBtns.style.display = 'none'; return; }
    if (actionBtns) actionBtns.style.display = 'flex';
    for (let i = 0; i < wallCount; i++) {
        let p1 = points[i], p2 = points[(i + 1) % points.length]; if (!p1 || !p2) continue;
        let distCm = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel), dir = detectWallDir(p1, p2);
        let row = document.createElement('div'); row.className = 'wall-row-input';
        row.innerHTML = `
            <span class="wall-row-label"><b>${p1.label}–${p2.label}</b></span>
            <input type="text" inputmode="numeric" class="input-field wall-len" id="wall-input-${i}" value="${distCm}" oninput="handleWallSmartInput(${i}, this)" onkeydown="if(event.key==='Enter') this.blur()">
            <div style="font-size: 11px; color: var(--text-muted); padding: 0 4px;">см</div>
            <div class="wall-dir-wrap">
                <select class="dir-select" id="wall-dir-${i}" onchange="onWallDirEdit(${i})">
                    <option value="U" ${dir === 'U' ? 'selected' : ''}>⬆️ Вверх</option>
                    <option value="R" ${dir === 'R' ? 'selected' : ''}>➡️ Вправо</option>
                    <option value="D" ${dir === 'D' ? 'selected' : ''}>⬇️ Вниз</option>
                    <option value="L" ${dir === 'L' ? 'selected' : ''}>⬅️ Влево</option>
                </select>
            </div>
        `;
        container.appendChild(row);
    }
}

function handleWallSmartInput(wallIndex, inputEl) {
    let formatted = formatLaserShift(inputEl.value); inputEl.value = formatted;
    let cm = parseInt(formatted, 10);
    if (cm && cm >= 1 && cm <= 5000) onWallLengthEdit(wallIndex, formatted);
}

function syncInputsValuesOnly() {
    let wallCount = getWallCount();
    for (let i = 0; i < wallCount; i++) {
        let p1 = points[i], p2 = points[(i + 1) % points.length]; if (!p1 || !p2) continue;
        let distCm = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel), input = document.getElementById(`wall-input-${i}`);
        if (input && document.activeElement !== input) input.value = distCm;
        let dirSel = document.getElementById(`wall-dir-${i}`); if (dirSel) dirSel.value = detectWallDir(p1, p2);
    }
    if (showDiagonalsList) {
        getCleanDiagonals().forEach((d, i) => {
            let diagInp = document.getElementById(`diag-input-${i}`);
            if (diagInp && document.activeElement !== diagInp) diagInp.value = Math.round(d.len);
        });
    }
}

function onWallLengthEdit(wallIndex, valStr) {
    let cm = parseInt(valStr, 10); if (!cm || cm <= 0) return;
    let p1 = points[wallIndex], p2 = points[(wallIndex + 1) % points.length]; if (!p1 || !p2) return;
    let dx = p2.x - p1.x, dy = p2.y - p1.y, curPx = Math.hypot(dx, dy), targetPx = cm / cmPerPixel;
    if (curPx < 0.001) return;
    let dirX = dx / curPx, dirY = dy / curPx, newP2x = p1.x + dirX * targetPx, newP2y = p1.y + dirY * targetPx;
    let shiftX = newP2x - p2.x, shiftY = newP2y - p2.y;
    p2.x = newP2x; p2.y = newP2y;
    for (let j = wallIndex + 2; j < points.length; j++) { points[j].x += shiftX; points[j].y += shiftY; }
    if (isClosed && wallIndex === points.length - 1) { points[0].x += shiftX; points[0].y += shiftY; }
    fitToScreen(false); drawSketch(); if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
}

function onWallDirEdit(wallIndex) { buildSketchFromTable(); }

function buildSketchFromTable() {
    if (points.length < 3) return; saveState(); cmPerPixel = 2.5; let newPts = [{ x: 0, y: 0, label: 'A' }];
    for (let i = 0; i < points.length - 1; i++) {
        let lenInput = document.getElementById(`wall-input-${i}`), dirSelect = document.getElementById(`wall-dir-${i}`);
        let cm = lenInput ? (parseInt(lenInput.value, 10) || 200) : 200, dir = dirSelect ? dirSelect.value : 'R', px = cm / cmPerPixel;
        let prev = newPts[i], nx = prev.x, ny = prev.y;
        if (dir === 'U') ny -= px; else if (dir === 'D') ny += px; else if (dir === 'R') nx += px; else if (dir === 'L') nx -= px;
        newPts.push({ x: nx, y: ny, label: getPointLabel(i + 1) });
    }
    points = newPts; isClosed = true; fitToScreen(true); rebuildWallInputs(); rebuildDiagonalInputs(); updateHint(); drawSketch();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState(); showToast('Чертёж перестроен по размерам', 'success');
}

function createFromTablePreset() {
    saveState();
    let rawVal = parseInt(document.getElementById('presetCornersCount').value) || 4, count = Math.max(3, Math.min(MAX_CORNERS, rawVal));
    document.getElementById('presetCornersCount').value = count; cmPerPixel = 2.5;
    let cx = (canvas.width || 350) / 2, cy = (canvas.height || 320) / 2;
    if (count === 4) {
        let w = 400 / cmPerPixel, h = 300 / cmPerPixel;
        points = [{ x: cx - w/2, y: cy + h/2, label: 'A' }, { x: cx - w/2, y: cy - h/2, label: 'B' }, { x: cx + w/2, y: cy - h/2, label: 'C' }, { x: cx + w/2, y: cy + h/2, label: 'D' }];
    } else if (count === 6) {
        let wFull = 400 / cmPerPixel, hFull = 350 / cmPerPixel, wCut = 180 / cmPerPixel, hCut = 180 / cmPerPixel, left = cx - wFull / 2, top = cy - hFull / 2;
        points = [{ x: left, y: top + hFull, label: 'A' }, { x: left, y: top, label: 'B' }, { x: left + (wFull - wCut), y: top, label: 'C' }, { x: left + (wFull - wCut), y: top + hCut, label: 'D' }, { x: left + wFull, y: top + hCut, label: 'E' }, { x: left + wFull, y: top + hFull, label: 'F' }];
    } else {
        points = []; let r = 115;
        for (let i = 0; i < count; i++) { let ang = Math.PI - (i * 2 * Math.PI / count); points.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang), label: getPointLabel(i) }); }
    }
    isClosed = true; customDiagonals = []; fitToScreen(true); rebuildWallInputs(); rebuildDiagonalInputs(); updateHint(); drawSketch();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState(); showToast(`Создан шаблон на ${count} угл.`, 'success');
}

function openWallEditSheet(wallIdx) {
    editingWallIdx = wallIdx; editingDiagObj = null;
    let p1 = points[wallIdx], p2 = points[(wallIdx + 1) % points.length]; if (!p1 || !p2) return;
    let inp = document.getElementById(`wall-input-${wallIdx}`), curVal = inp ? inp.value : Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel);
    let userVal = prompt(`📏 Длина стены ${p1.label}–${p2.label} (см):`, curVal);
    if (userVal !== null) {
        let val = parseInt(userVal.replace(/\D/g, ''), 10);
        if (val && val >= 1 && val <= 5000) { if (inp) inp.value = val; onWallLengthEdit(wallIdx, val); showToast(`Стена обновлена: ${val} см`, 'success'); }
    }
}

function openDiagonalEditSheet(dBox) {
    editingWallIdx = null; editingDiagObj = dBox;
    let userVal = prompt(`📐 Введите длину диагонали ${dBox.name} (см):`, Math.round(dBox.lenCm));
    if (userVal !== null) {
        let val = parseInt(userVal.replace(/\D/g, ''), 10);
        if (val && val >= 1 && val <= 5000) applyDiagonalLength(dBox.fromIdx, dBox.toIdx, val);
        else showToast('Некорректное значение диагонали', 'error');
    }
}

function closeWallEditSheet() { const el = document.getElementById('wallEditSheetOverlay'); if (el) el.classList.remove('open'); editingWallIdx = null; editingDiagObj = null; }

function applyWallSheetValue() {
    let raw = document.getElementById('wallSheetInput')?.value || '', formatted = formatLaserShift(raw), val = parseInt(formatted, 10);
    if (editingDiagObj !== null) {
        if (val && val >= 1 && val <= 5000) applyDiagonalLength(editingDiagObj.fromIdx, editingDiagObj.toIdx, val);
        closeWallEditSheet(); return;
    }
    if (editingWallIdx !== null) {
        if (val && val >= 1 && val <= 5000) {
            let inp = document.getElementById(`wall-input-${editingWallIdx}`);
            if (inp) inp.value = val;
            onWallLengthEdit(editingWallIdx, val); showToast(`Стена обновлена: ${val} см`, 'success');
        }
        closeWallEditSheet();
    }
}

// --- РЕЖИМ ДЖОЙСТИКА (ПОШАГОВЫЙ ВВОД С РУЛЕТКИ) ---
function joystickDraw(dir) {
    if (isClosed) { showToast('Комната уже замкнута!', 'error'); return; }
    if (dir === 'close') {
        if (points.length < 3) { showToast('Минимум 3 точки для замыкания!', 'error'); return; }
        closePolygon(); if (typeof exitJoystickMode === 'function') exitJoystickMode(); return;
    }
    let inp = document.getElementById('joystickInput'); if (!inp) return;
    let formatted = formatLaserShift(inp.value); inp.value = formatted;
    let distCm = parseInt(formatted, 10);
    if (!distCm || distCm < 1 || distCm > 5000) { showToast('Введите длину от 1 до 5000 см!', 'error'); return; }
    saveState();
    let lastPoint = points[points.length - 1], px = distCm / cmPerPixel, nx = lastPoint.x, ny = lastPoint.y;
    if (dir === 'up') ny -= px; else if (dir === 'down') ny += px; else if (dir === 'left') nx -= px; else if (dir === 'right') nx += px;
    points.push({ x: nx, y: ny, label: getPointLabel(points.length) }); inp.value = '';
    fitToScreen(true); rebuildWallInputs(); updateHint(); drawSketch();
    if (typeof updateJoystickLabel === 'function') updateJoystickLabel(); 
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
}
