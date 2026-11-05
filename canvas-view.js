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

// --- РЕЖИМЫ РЕДАКТИРОВАНИЯ И ВНУТРЕННИЕ ЭЛЕМЕНТЫ ---
let editMode = 'room'; // 'room' | 'inner' | 'drawing_poly'
let innerElements = [];
let selectedInnerIdx = null;
let draggedInnerIdx = null;
let draggedInnerVertex = null; // Индекс перетаскиваемой вершины произвольного короба
let innerDragOffset = { x: 0, y: 0 };
let activeDrawingPoly = [];

let editingWallIdx = null;
let wallHitBoxes = [];

const MAX_CORNERS = 50;

function getPointLabel(index) {
    if (index < 26) {
        return String.fromCharCode(65 + index);
    }
    let first = Math.floor(index / 26) - 1;
    let second = index % 26;
    return String.fromCharCode(65 + first) + String.fromCharCode(65 + second);
}

// --- БАНКОМАТНЫЙ ВВОД РАЗМЕРОВ (СДВИГ СПРАВА НАЛЕВО) ---
function formatLaserShift(rawVal) {
    if (!rawVal) return '';
    let digits = rawVal.toString().replace(/\D/g, '');
    if (!digits) return '';

    if (digits.length > 5) digits = digits.slice(-5);

    let num = parseInt(digits, 10);
    if (isNaN(num) || num === 0) return '0.000';

    return (num / 1000).toFixed(3);
}

// --- АВТОМАТИЧЕСКОЕ СОХРАНЕНИЕ В ПАМЯТЬ ПРИ СВОРАЧИВАНИИ ---
function persistSketchToStorage() {
    try {
        const payload = {
            pts: points.map(p => ({ x: p.x, y: p.y, label: p.label })),
            closed: isClosed,
            scale: cmPerPixel,
            inner: innerElements
        };
        localStorage.setItem('_pz_active_sketch_backup', JSON.stringify(payload));
    } catch (e) {}
}

function restoreSketchFromStorage() {
    try {
        const raw = localStorage.getItem('_pz_active_sketch_backup');
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (data && data.pts && data.pts.length > 0) {
            points = data.pts;
            isClosed = !!data.closed;
            cmPerPixel = data.scale || 2.5;
            innerElements = data.inner || [];
            return true;
        }
    } catch (e) {}
    return false;
}

function saveState() {
    historyState.push({
        pts: points.map(p => ({ x: p.x, y: p.y, label: p.label })),
        closed: isClosed,
        scale: cmPerPixel,
        inner: JSON.parse(JSON.stringify(innerElements)),
        editMode
    });
    if (historyState.length > 40) historyState.shift();
    persistSketchToStorage();
}

function undoPoint() {
    if (isSketchLocked) return;
    if (historyState.length > 0) {
        let st = historyState.pop();
        points = st.pts || [];
        isClosed = !!st.closed;
        cmPerPixel = st.scale || 2.5;
        innerElements = st.inner || [];
        editMode = st.editMode || 'room';
    } else {
        points = [];
        isClosed = false;
        cmPerPixel = 2.5;
        innerElements = [];
        editMode = 'room';
    }
    activeDrawingPoly = [];
    draggedInnerVertex = null;
    const presetCorners = document.getElementById('presetCornersCount');
    if (presetCorners && points.length >= 3) {
        presetCorners.value = points.length;
    }
    rebuildWallInputs();
    renderInnerElementsList();
    updateHint();
    drawSketch();
    persistSketchToStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
}

function resetSketch() {
    if (isSketchLocked) return;
    saveState();
    points = [];
    isClosed = false;
    cmPerPixel = 2.5;
    innerElements = [];
    activeDrawingPoly = [];
    editMode = 'room';
    selectedInnerIdx = null;
    draggedInnerVertex = null;
    localStorage.removeItem('_pz_active_sketch_backup');
    rebuildWallInputs();
    renderInnerElementsList();
    updateHint();
    drawSketch();
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
        showToast('🛡️ Чертёж заблокирован от случайных касаний');
    } else {
        btnWrap?.classList.remove('fab-active');
        if (lockBtn) lockBtn.innerHTML = `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>`;
        showToast('🔓 Чертёж разблокирован');
    }
    updateHint();
}

function toggleEditLayer() {
    if (!isClosed || points.length < 3) {
        showToast('Сначала замкните контур комнаты!', 'error');
        return;
    }
    if (editMode === 'room') {
        editMode = 'inner';
        showToast('Режим: Короба (тяните за углы или тапайте для настроек)', 'success');
    } else {
        editMode = 'room';
        activeDrawingPoly = [];
        draggedInnerVertex = null;
        showToast('Режим: Стены комнаты');
    }
    const layerBtn = document.getElementById('layerSwitchBtn');
    if (layerBtn) {
        layerBtn.classList.toggle('fab-active', editMode !== 'room');
    }
    updateHint();
    drawSketch();
}

function toggleFullscreen() {
    const card = document.getElementById('canvasCard');
    const isFull = card.classList.toggle('fullscreen');
    document.getElementById('bottomFullscreenBtn')?.classList.toggle('fab-active', isFull);
    const topClose = document.getElementById('fsCloseTopBtn');
    if (topClose) topClose.style.display = isFull ? 'block' : 'none';
    setTimeout(() => {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        fitToScreen(false);
    }, 60);
}

function resizeCanvas() {
    canvas.width = canvas.clientWidth || 350;
    canvas.height = canvas.clientHeight || 320;
    fitToScreen(false);
}

window.addEventListener('resize', resizeCanvas);
setTimeout(() => {
    resizeCanvas();
    if (restoreSketchFromStorage()) {
        rebuildWallInputs();
        renderInnerElementsList();
    }
    updateHint();
    drawSketch();
}, 120);

// --- ГЕОМЕТРИЯ ПЕРИМЕТРА ---
function getWallCount() {
    if (points.length < 2) return 0;
    return isClosed ? points.length : points.length - 1;
}

function detectWallDir(p1, p2) {
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx >= 0 ? 'R' : 'L';
    } else {
        return dy >= 0 ? 'D' : 'U';
    }
}

function updateHint() {
    const hint = document.getElementById('actionHint');
    const closeBtn = document.getElementById('closeContourBtn');
    const lockSvg = document.getElementById('lockIconSvg');
    if (!hint) return;

    if (isSketchLocked) {
        hint.innerText = '🛡️ Чертёж заблокирован. Нажмите щит для разблокировки';
        return;
    }

    if (editMode === 'drawing_poly') {
        hint.innerText = `✏️ Ставьте точки короба (${activeDrawingPoly.length}). Тапните на 1-ю точку для завершения`;
        return;
    }

    if (editMode === 'inner') {
        hint.innerText = '📦 Тяните короб или его углы; тапните по фигуре для точных миллиметров';
        return;
    }

    if (points.length === 0) {
        hint.innerText = 'Тапните на холст для точки А или создайте шаблон';
        closeBtn?.classList.remove('fab-active');
    } else if (!isClosed) {
        let nextLabel = getPointLabel(points.length);
        hint.innerText = points.length < 3
            ? `Ставьте по очереди точку ${nextLabel}`
            : `Ставьте точку ${nextLabel} или нажмите замочек 🔒`;
        closeBtn?.classList.remove('fab-active');
        if (lockSvg) lockSvg.innerHTML = `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>`;
    } else {
        hint.innerText = `Тяните углы; нажмите 📦 для работы с коробами`;
        closeBtn?.classList.add('fab-active');
        if (lockSvg) lockSvg.innerHTML = `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`;
    }
}

function closePolygon() {
    if (isSketchLocked) return;
    if (points.length < 3) {
        showToast('Поставьте минимум 3 точки (A, B, C)!', 'error');
        return;
    }
    saveState();
    isClosed = !isClosed;
    rebuildWallInputs();
    updateHint();
    drawSketch();
    persistSketchToStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    if (isClosed) showToast('Контур замкнут!', 'success');
}

function snapOrthogonal() {
    if (isSketchLocked || points.length < 2) return;
    saveState();
    for (let i = 1; i < points.length; i++) {
        let prev = points[i - 1];
        let curr = points[i];
        let dx = Math.abs(curr.x - prev.x);
        let dy = Math.abs(curr.y - prev.y);
        if (dx > dy) {
            curr.y = prev.y;
        } else {
            curr.x = prev.x;
        }
    }
    if (isClosed && points.length >= 4) {
        let first = points[0];
        let last = points[points.length - 1];
        if (Math.abs(last.x - first.x) < Math.abs(last.y - first.y)) {
            last.x = first.x;
        } else {
            last.y = first.y;
        }
    }
    fitToScreen(false);
    syncInputsValuesOnly();
    drawSketch();
    persistSketchToStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Углы выровнены под 90°');
}

function rotateSketch() {
    if (isSketchLocked || points.length < 2) return;
    saveState();
    let cx = canvas.width / 2;
    let cy = canvas.height / 2;
    points.forEach(p => {
        let dx = p.x - cx;
        let dy = p.y - cy;
        p.x = cx - dy;
        p.y = cy + dx;
    });

    innerElements.forEach(el => {
        let edx = el.x - cx;
        let edy = el.y - cy;
        el.x = cx - edy;
        el.y = cy + edx;
        if (el.type === 'rect') {
            let tmpW = el.w;
            el.w = el.h;
            el.h = tmpW;
            let tmpCm = el.lenCm;
            el.lenCm = el.widCm;
            el.widCm = tmpCm;
        } else if (el.type === 'poly' && el.pts) {
            el.pts.forEach(pt => {
                let pdx = pt.x - cx;
                let pdy = pt.y - cy;
                pt.x = cx - pdy;
                pt.y = cy + pdx;
            });
        }
    });

    fitToScreen(true);
    rebuildWallInputs();
    renderInnerElementsList();
    drawSketch();
    persistSketchToStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
}

function fitToScreen(forceFit = false) {
    if (points.length < 2) {
        drawSketch();
        return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });

    let polyW = Math.max(maxX - minX, 20);
    let polyH = Math.max(maxY - minY, 20);
    let pad = 52;

    let availW = Math.max(canvas.width - pad * 2, 60);
    let availH = Math.max(canvas.height - pad * 2, 60);
    let factor = Math.min(availW / polyW, availH / polyH);

    if (factor < 1 || factor > 1.35 || forceFit) {
        let centerX = (minX + maxX) / 2;
        let centerY = (minY + maxY) / 2;
        let canvasCX = canvas.width / 2;
        let canvasCY = (canvas.height - 16) / 2;

        points.forEach(p => {
            p.x = canvasCX + (p.x - centerX) * factor;
            p.y = canvasCY + (p.y - centerY) * factor;
        });

        innerElements.forEach(el => {
            el.x = canvasCX + (el.x - centerX) * factor;
            el.y = canvasCY + (el.y - centerY) * factor;
            if (el.type === 'rect') {
                el.w *= factor;
                el.h *= factor;
            } else if (el.type === 'circle') {
                el.radius *= factor;
            } else if (el.type === 'poly' && el.pts) {
                el.pts.forEach(pt => {
                    pt.x = canvasCX + (pt.x - centerX) * factor;
                    pt.y = canvasCY + (pt.y - centerY) * factor;
                });
            }
        });

        cmPerPixel = cmPerPixel / factor;
    }
    drawSketch();
}

function isPointInsidePoly(px, py) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        let xi = points[i].x, yi = points[i].y;
        let xj = points[j].x, yj = points[j].y;
        if (yi === yj) continue;
        let intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function segmentsStrictlyIntersect(a, b, c, d) {
    const ccw = (p1, p2, p3) => (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
    return (ccw(a, c, d) !== ccw(b, c, d)) && (ccw(a, b, c) !== ccw(a, b, d));
}

function getCleanDiagonals() {
    let diags = [];
    if (!isClosed || points.length < 4) return diags;

    let n = points.length;
    let needed = n - 3;

    for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            let p1 = points[i];
            let p2 = points[j];

            let mx = (p1.x + p2.x) / 2;
            let my = (p1.y + p2.y) / 2;
            if (!isPointInsidePoly(mx, my)) continue;

            let crosses = false;
            for (let w = 0; w < n; w++) {
                if (w === i || (w + 1) % n === i || w === j || (w + 1) % n === j) continue;
                if (segmentsStrictlyIntersect(p1, p2, points[w], points[(w + 1) % n])) {
                    crosses = true;
                    break;
                }
            }
            if (crosses) continue;

            for (let d of diags) {
                if (d.from === p1 || d.from === p2 || d.to === p1 || d.to === p2) continue;
                if (segmentsStrictlyIntersect(p1, p2, d.from, d.to)) {
                    crosses = true;
                    break;
                }
            }
            if (crosses) continue;

            let len = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel);
            diags.push({ from: p1, to: p2, name: `${p1.label}-${p2.label}`, len });
            if (diags.length >= needed) return diags;
        }
    }
    return diags;
}

// --- МАТЕМАТИКА ПРИВЯЗОК СТРОГО ОТ НАРУЖНОЙ КРОМКИ ---
function getClosestPointOnSegment(p, a, b) {
    let abx = b.x - a.x;
    let aby = b.y - a.y;
    let apx = p.x - a.x;
    let apy = p.y - a.y;
    let lenSq = abx * abx + aby * aby;
    let t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
    return {
        x: a.x + t * abx,
        y: a.y + t * aby
    };
}

function getClosestPointOnElementToSegment(el, p1, p2) {
    let isHorizontalWall = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y);

    if (el.type === 'circle') {
        let center = { x: el.x, y: el.y };
        let proj = getClosestPointOnSegment(center, p1, p2);
        let distCenter = Math.hypot(proj.x - center.x, proj.y - center.y);
        let rad = el.radius || ((el.diamCm ? el.diamCm / 2 : 20) / cmPerPixel);
        let effectiveDist = Math.max(0, distCenter - rad);

        let edgePoint = { x: center.x, y: center.y };
        if (distCenter > 0.001) {
            edgePoint.x = center.x + ((proj.x - center.x) / distCenter) * rad;
            edgePoint.y = center.y + ((proj.y - center.y) / distCenter) * rad;
        }
        return { edgePoint, proj, distPx: effectiveDist };
    }

    if (el.type === 'rect') {
        let rw = el.w || (el.lenCm / cmPerPixel);
        let rh = el.h || (el.widCm / cmPerPixel);
        let hw = rw / 2;
        let hh = rh / 2;

        let edgePoint = { x: el.x, y: el.y };
        let proj = { x: el.x, y: el.y };

        if (isHorizontalWall) {
            let wallY = (p1.y + p2.y) / 2;
            edgePoint = wallY < el.y ? { x: el.x, y: el.y - hh } : { x: el.x, y: el.y + hh };
            proj = getClosestPointOnSegment(edgePoint, p1, p2);
        } else {
            let wallX = (p1.x + p2.x) / 2;
            edgePoint = wallX < el.x ? { x: el.x - hw, y: el.y } : { x: el.x + hw, y: el.y };
            proj = getClosestPointOnSegment(edgePoint, p1, p2);
        }

        let distPx = Math.hypot(proj.x - edgePoint.x, proj.y - edgePoint.y);
        return { edgePoint, proj, distPx };
    }

    let bestDist = Infinity;
    let bestEdgePt = el.pts ? el.pts[0] : { x: el.x, y: el.y };
    let bestProj = getClosestPointOnSegment(bestEdgePt, p1, p2);

    if (el.pts && el.pts.length >= 3) {
        for (let pt of el.pts) {
            let pr = getClosestPointOnSegment(pt, p1, p2);
            let d = Math.hypot(pr.x - pt.x, pr.y - pt.y);
            if (d < bestDist) {
                bestDist = d;
                bestEdgePt = pt;
                bestProj = pr;
            }
        }
    }

    return { edgePoint: bestEdgePt, proj: bestProj, distPx: bestDist };
}

function getElementWallDistances(el) {
    if (!el || points.length < 3) return [];
    let count = getWallCount();
    let wallDists = [];

    for (let i = 0; i < count; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];

        let { edgePoint, proj, distPx } = getClosestPointOnElementToSegment(el, p1, p2);
        let distCm = Math.round(distPx * cmPerPixel);
        let isHorizontal = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y);

        wallDists.push({
            wallIdx: i,
            wallName: `${p1.label}–${p2.label}`,
            distCm,
            edgeX: edgePoint.x,
            edgeY: edgePoint.y,
            projX: proj.x,
            projY: proj.y,
            distPx,
            isHorizontal
        });
    }

    let horizWalls = wallDists.filter(w => w.isHorizontal).sort((a, b) => a.distPx - b.distPx);
    let vertWalls = wallDists.filter(w => !w.isHorizontal).sort((a, b) => a.distPx - b.distPx);

    let result = [];
    if (horizWalls.length > 0) result.push(horizWalls[0]);
    if (vertWalls.length > 0) result.push(vertWalls[0]);

    if (result.length < 2) {
        wallDists.sort((a, b) => a.distPx - b.distPx);
        return wallDists.slice(0, 2);
    }

    return result;
}

// --- УПРАВЛЕНИЕ И ВСПЛЫВАЮЩАЯ ШТОРКА ЭЛЕМЕНТА ---
function addQuickRectHatch() {
    if (!isClosed || points.length < 3) {
        showToast('Сначала замкните комнату!', 'error');
        return;
    }
    saveState();
    let cx = 0, cy = 0;
    points.forEach(p => { cx += p.x; cy += p.y; });
    cx /= points.length;
    cy /= points.length;

    let lenCm = 120, widCm = 60;
    innerElements.push({
        id: 'inner_' + Date.now(),
        type: 'rect',
        title: `Люк ${lenCm}×${widCm}`,
        x: cx,
        y: cy,
        w: (lenCm / cmPerPixel),
        h: (widCm / cmPerPixel),
        lenCm,
        widCm
    });

    editMode = 'inner';
    document.getElementById('layerSwitchBtn')?.classList.add('fab-active');
    renderInnerElementsList();
    drawSketch();
    persistSketchToStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Добавлен люк 120×60 см');
}

function addQuickCircleColumn() {
    if (!isClosed || points.length < 3) {
        showToast('Сначала замкните комнату!', 'error');
        return;
    }
    saveState();
    let cx = 0, cy = 0;
    points.forEach(p => { cx += p.x; cy += p.y; });
    cx /= points.length;
    cy /= points.length;

    let dCm = 40;
    let radPx = (dCm / 2) / cmPerPixel;

    innerElements.push({
        id: 'inner_' + Date.now(),
        type: 'circle',
        title: `Колонна ⌀${dCm} см`,
        x: cx,
        y: cy,
        diamCm: dCm,
        radius: radPx
    });

    editMode = 'inner';
    document.getElementById('layerSwitchBtn')?.classList.add('fab-active');
    renderInnerElementsList();
    drawSketch();
    persistSketchToStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast(`Добавлена колонна ⌀${dCm} см`);
}

function startCustomBoxDrawing() {
    if (!isClosed || points.length < 3) {
        showToast('Сначала замкните комнату!', 'error');
        return;
    }
    editMode = 'drawing_poly';
    activeDrawingPoly = [];
    document.getElementById('layerSwitchBtn')?.classList.add('fab-active');
    updateHint();
    showToast('Тапайте по холсту для углов короба');
}

function openInnerEditSheet(idx) {
    selectedInnerIdx = idx;
    let el = innerElements[idx];
    if (!el) return;

    document.getElementById('innerSheetTitle').innerText = `📦 ${el.title || 'Элемент'}`;

    const dimBlock = document.getElementById('innerDimensionsBlock');
    if (el.type === 'circle') {
        let dMm = Math.round((el.diamCm || 40) * 10);
        dimBlock.innerHTML = `
            <div style="flex: 1;">
                <label style="font-size:11px; color:var(--text-muted);">Диаметр ⌀ (мм):</label>
                <input type="number" id="sheetInnerDiam" class="input-field" value="${dMm}" style="font-weight:700;">
            </div>
        `;
    } else if (el.type === 'rect') {
        let lMm = Math.round((el.lenCm || 120) * 10);
        let wMm = Math.round((el.widCm || 60) * 10);
        dimBlock.innerHTML = `
            <div style="flex: 1;">
                <label style="font-size:11px; color:var(--text-muted);">Длина (мм):</label>
                <input type="number" id="sheetInnerLen" class="input-field" value="${lMm}" style="font-weight:700;">
            </div>
            <div style="flex: 1;">
                <label style="font-size:11px; color:var(--text-muted);">Ширина (мм):</label>
                <input type="number" id="sheetInnerWid" class="input-field" value="${wMm}" style="font-weight:700;">
            </div>
        `;
    } else if (el.type === 'poly' && el.pts) {
        // ДИНАМИЧЕСКИЙ ВВОД СТОРОН ПРОИЗВОЛЬНОГО КОРОБА
        let rowsHtml = '';
        for (let i = 0; i < el.pts.length; i++) {
            let p1 = el.pts[i];
            let p2 = el.pts[(i + 1) % el.pts.length];
            let curLenMm = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel * 10);
            let nextIdx = (i + 1) % el.pts.length;
            rowsHtml += `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <span style="font-size: 11px; font-weight: 600; color: var(--text-main); white-space: nowrap;">Сторона ${i + 1}–${nextIdx + 1}:</span>
                    <input type="number" class="input-field poly-side-input" data-side-idx="${i}" value="${curLenMm}" style="font-weight: 700; width: 110px; text-align: center;">
                </div>
            `;
        }
        dimBlock.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">
                ${rowsHtml}
            </div>
        `;
    } else {
        dimBlock.innerHTML = `<span style="font-size:12px; color:var(--text-muted);">Произвольный короб (${el.pts ? el.pts.length : 0} углов)</span>`;
    }

    let count = getWallCount();
    let wallOptions = '';
    for (let i = 0; i < count; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];
        wallOptions += `<option value="${i}">Стена ${p1.label}–${p2.label}</option>`;
    }

    const sel1 = document.getElementById('innerWallSelect1');
    const sel2 = document.getElementById('innerWallSelect2');
    sel1.innerHTML = wallOptions;
    sel2.innerHTML = wallOptions;

    let nearest = getElementWallDistances(el);
    if (nearest.length > 0) {
        sel1.value = nearest[0].wallIdx;
        document.getElementById('innerWallDist1').value = Math.round(nearest[0].distCm * 10);
    }
    if (nearest.length > 1) {
        sel2.value = nearest[1].wallIdx;
        document.getElementById('innerWallDist2').value = Math.round(nearest[1].distCm * 10);
    }

    document.getElementById('innerEditSheetOverlay').classList.add('open');
}

function closeInnerEditSheet() {
    document.getElementById('innerEditSheetOverlay').classList.remove('open');
    selectedInnerIdx = null;
}

function applyInnerSheetSettings() {
    if (selectedInnerIdx === null || !innerElements[selectedInnerIdx]) return;
    saveState();
    let el = innerElements[selectedInnerIdx];

    if (el.type === 'circle') {
        let dMm = parseFloat(document.getElementById('sheetInnerDiam')?.value);
        if (dMm && dMm > 0) {
            el.diamCm = dMm / 10;
            el.radius = (el.diamCm / 2) / cmPerPixel;
            el.title = `Колонна ⌀${Math.round(el.diamCm)} см`;
        }
    } else if (el.type === 'rect') {
        let lMm = parseFloat(document.getElementById('sheetInnerLen')?.value);
        let wMm = parseFloat(document.getElementById('sheetInnerWid')?.value);
        if (lMm && wMm && lMm > 0 && wMm > 0) {
            el.lenCm = lMm / 10;
            el.widCm = wMm / 10;
            el.w = el.lenCm / cmPerPixel;
            el.h = el.widCm / cmPerPixel;
            el.title = `Люк ${Math.round(el.lenCm)}×${Math.round(el.widCm)}`;
        }
    } else if (el.type === 'poly' && el.pts) {
        // Применяем введенные длины сторон к контуру многоугольника
        const sideInputs = document.querySelectorAll('.poly-side-input');
        sideInputs.forEach(inp => {
            let sideIdx = parseInt(inp.getAttribute('data-side-idx'));
            let targetMm = parseFloat(inp.value);
            if (!isNaN(sideIdx) && targetMm && targetMm > 0 && el.pts[sideIdx]) {
                let p1 = el.pts[sideIdx];
                let nextI = (sideIdx + 1) % el.pts.length;
                let p2 = el.pts[nextI];
                let curLenPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                let targetLenPx = (targetMm / 10) / cmPerPixel;

                if (curLenPx > 0.001) {
                    let dirX = (p2.x - p1.x) / curLenPx;
                    let dirY = (p2.y - p1.y) / curLenPx;
                    let diffX = (p1.x + dirX * targetLenPx) - p2.x;
                    let diffY = (p1.y + dirY * targetLenPx) - p2.y;

                    // Смещаем последующие вершины, чтобы сторона встала в точный размер
                    for (let k = nextI; k < el.pts.length; k++) {
                        el.pts[k].x += diffX;
                        el.pts[k].y += diffY;
                    }
                }
            }
        });

        // Пересчитываем центральную опорную точку
        let sx = 0, sy = 0;
        el.pts.forEach(p => { sx += p.x; sy += p.y; });
        el.x = sx / el.pts.length;
        el.y = sy / el.pts.length;
    }

    let wIdx1 = parseInt(document.getElementById('innerWallSelect1').value);
    let d1Mm = parseFloat(document.getElementById('innerWallDist1').value);

    let wIdx2 = parseInt(document.getElementById('innerWallSelect2').value);
    let d2Mm = parseFloat(document.getElementById('innerWallDist2').value);

    let targetD1Px = (d1Mm / 10) / cmPerPixel;
    let targetD2Px = (d2Mm / 10) / cmPerPixel;

    let pA1 = points[wIdx1];
    let pB1 = points[(wIdx1 + 1) % points.length];
    let pA2 = points[wIdx2];
    let pB2 = points[(wIdx2 + 1) % points.length];

    if (pA1 && pB1 && pA2 && pB2 && !isNaN(targetD1Px) && !isNaN(targetD2Px)) {
        let { edgePoint: edge1, proj: pr1, distPx: cur1 } = getClosestPointOnElementToSegment(el, pA1, pB1);
        let shift1 = cur1 - targetD1Px;
        let dx1 = pr1.x - edge1.x;
        let dy1 = pr1.y - edge1.y;
        let len1 = Math.hypot(dx1, dy1) || 1;

        let { edgePoint: edge2, proj: pr2, distPx: cur2 } = getClosestPointOnElementToSegment(el, pA2, pB2);
        let shift2 = cur2 - targetD2Px;
        let dx2 = pr2.x - edge2.x;
        let dy2 = pr2.y - edge2.y;
        let len2 = Math.hypot(dx2, dy2) || 1;

        let moveX = (dx1 / len1) * shift1 + (dx2 / len2) * shift2;
        let moveY = (dy1 / len1) * shift1 + (dy2 / len2) * shift2;

        el.x += moveX;
        el.y += moveY;

        if (el.type === 'poly' && el.pts) {
            el.pts.forEach(pt => {
                pt.x += moveX;
                pt.y += moveY;
            });
        }
    }

    closeInnerEditSheet();
    renderInnerElementsList();
    drawSketch();
    persistSketchToStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Параметры и отступы применены!', 'success');
}

function deleteCurrentInnerFromSheet() {
    if (selectedInnerIdx === null) return;
    deleteInnerElement(selectedInnerIdx);
    closeInnerEditSheet();
}

function deleteInnerElement(idx) {
    if (!innerElements[idx]) return;
    saveState();
    innerElements.splice(idx, 1);
    renderInnerElementsList();
    drawSketch();
    persistSketchToStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Элемент удалён');
}

function renderInnerElementsList() {
    const container = document.getElementById('innerElementsContainer');
    const badge = document.getElementById('innerCountBadge');
    if (badge) badge.innerText = `${innerElements.length} шт.`;
    if (!container) return;

    if (innerElements.length === 0) {
        container.innerHTML = `<div style="font-size:11px; color:var(--text-muted); text-align:center; padding: 4px 0;">Нет коробов или колонн</div>`;
        return;
    }

    container.innerHTML = innerElements.map((el, idx) => {
        let nearest = getElementWallDistances(el);
        let distText = nearest.map(n => `${n.wallName}: ${Math.round(n.distCm * 10)} мм`).join(' | ');
        let sizeText = '';

        if (el.type === 'rect') sizeText = `${Math.round(el.lenCm * 10)}×${Math.round(el.widCm * 10)} мм`;
        else if (el.type === 'circle') sizeText = `⌀${Math.round(el.diamCm * 10)} мм`;
        else if (el.type === 'poly') sizeText = `${el.pts.length} угл.`;

        return `
            <div style="display:flex; justify-content:space-between; align-items:center; background:var(--sub-block-bg); border:1px solid var(--border); border-radius:8px; padding:6px 10px; font-size:11px;">
                <div style="display:flex; flex-direction:column; gap:2px; overflow:hidden; cursor:pointer;" onclick="openInnerEditSheet(${idx})">
                    <span style="font-weight:600; color:var(--text-main);">${idx + 1}. ${el.title || 'Короб'} (${sizeText})</span>
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

// --- ОТРИСОВКА ХОЛСТА ---
function drawSketch() {
    if (!canvas.width || !canvas.height) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    wallHitBoxes = [];

    const isLight = document.body.classList.contains('light-theme');
    const gridColor = isLight ? '#f1f5f9' : '#1e293b';
    const mainStrokeColor = isLight ? '#0f172a' : '#e2e8f0';
    const polyFillColor = isLight ? 'rgba(15, 23, 42, 0.04)' : 'rgba(79, 70, 229, 0.08)';
    const diagLineColor = isLight ? 'rgba(15, 23, 42, 0.3)' : 'rgba(255, 255, 255, 0.25)';
    const badgeBgColor = isLight ? 'rgba(255, 255, 255, 0.94)' : 'rgba(15, 23, 42, 0.9)';
    const wallTextColor = isLight ? '#0f172a' : '#f8fafc';
    const diagTextColor = isLight ? '#475569' : '#94a3b8';
    const pointLabelColor = isLight ? '#0f172a' : '#ffffff';
    const strictFont = '600 11px "Inter", "Roboto", sans-serif';

    // 1. Сетка
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 20) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 20) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    if (points.length === 0) return;

    let centerX = 0, centerY = 0;
    points.forEach(p => { centerX += p.x; centerY += p.y; });
    centerX /= points.length;
    centerY /= points.length;

    // 2. Диагонали раскроя
    let diags = getCleanDiagonals();
    if (diags.length > 0) {
        ctx.save();
        ctx.strokeStyle = diagLineColor;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);

        diags.forEach((d, idx) => {
            ctx.beginPath();
            ctx.moveTo(d.from.x, d.from.y);
            ctx.lineTo(d.to.x, d.to.y);
            ctx.stroke();

            let ratio = 0.4 + (idx % 3) * 0.12;
            let mx = d.from.x + (d.to.x - d.from.x) * ratio;
            let my = d.from.y + (d.to.y - d.from.y) * ratio;

            ctx.fillStyle = badgeBgColor;
            ctx.fillRect(mx - 18, my - 9, 36, 13);
            ctx.fillStyle = diagTextColor;
            ctx.font = '500 10px "Inter", "Roboto", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${(d.len / 100).toFixed(2)} м`, mx, my + 1);
        });
        ctx.restore();
    }

    // 3. Контур стен помещения
    if (points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        if (isClosed && points.length >= 3) {
            ctx.closePath();
            ctx.fillStyle = polyFillColor;
            ctx.fill();
        }
        ctx.strokeStyle = mainStrokeColor;
        ctx.lineWidth = 2.2;
        ctx.stroke();

        if (!isClosed && points.length >= 3) {
            ctx.save();
            ctx.strokeStyle = 'rgba(5, 150, 105, 0.55)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y);
            ctx.lineTo(points[0].x, points[0].y);
            ctx.stroke();
            ctx.restore();
        }
    }

    // 4. Отрисовка внутренних элементов
    innerElements.forEach((el, elIdx) => {
        let nearest = getElementWallDistances(el);

        ctx.save();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);

        nearest.forEach(w => {
            ctx.beginPath();
            ctx.moveTo(w.edgeX, w.edgeY);
            ctx.lineTo(w.projX, w.projY);
            ctx.stroke();

            let midX = (w.edgeX + w.projX) / 2;
            let midY = (w.edgeY + w.projY) / 2;
            ctx.fillStyle = badgeBgColor;
            ctx.fillRect(midX - 26, midY - 8, 52, 16);
            ctx.fillStyle = '#ef4444';
            ctx.font = '700 10px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.round(w.distCm * 10)} мм`, midX, midY + 4);
        });
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.fillStyle = isLight ? 'rgba(37, 99, 235, 0.12)' : 'rgba(37, 99, 235, 0.22)';

        if (el.type === 'rect') {
            let rw = el.w || (el.lenCm / cmPerPixel);
            let rh = el.h || (el.widCm / cmPerPixel);
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(el.x - rw / 2, el.y - rh / 2, rw, rh);
            ctx.fillRect(el.x - rw / 2, el.y - rh / 2, rw, rh);

            ctx.fillStyle = badgeBgColor;
            ctx.font = '600 10px "Inter", sans-serif';
            ctx.textAlign = 'center';

            ctx.fillRect(el.x - 24, el.y - rh / 2 - 8, 48, 15);
            ctx.fillStyle = '#2563eb';
            ctx.fillText(`${Math.round(el.lenCm * 10)}`, el.x, el.y - rh / 2 + 3);

            ctx.fillStyle = badgeBgColor;
            ctx.fillRect(el.x + rw / 2 - 20, el.y + 12, 40, 15);
            ctx.fillStyle = '#2563eb';
            ctx.fillText(`${Math.round(el.widCm * 10)}`, el.x + rw / 2, el.y + 23);

        } else if (el.type === 'circle') {
            let rad = el.radius || ((el.diamCm / 2) / cmPerPixel);
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.arc(el.x, el.y, rad, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fill();

            ctx.fillStyle = badgeBgColor;
            ctx.fillRect(el.x - 30, el.y - 9, 60, 18);
            ctx.fillStyle = '#2563eb';
            ctx.font = '700 10px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`⌀${Math.round(el.diamCm * 10)}`, el.x, el.y + 4);

        } else if (el.type === 'poly' && el.pts && el.pts.length >= 3) {
            ctx.setLineDash([5, 3]);
            ctx.beginPath();
            ctx.moveTo(el.pts[0].x, el.pts[0].y);
            for (let i = 1; i < el.pts.length; i++) ctx.lineTo(el.pts[i].x, el.pts[i].y);
            ctx.closePath();
            ctx.stroke();
            ctx.fill();

            // Отрисовка длин граней многоугольника
            ctx.font = '600 10px "Inter", sans-serif';
            ctx.textAlign = 'center';
            for (let i = 0; i < el.pts.length; i++) {
                let p1 = el.pts[i];
                let p2 = el.pts[(i + 1) % el.pts.length];
                let sideMm = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel * 10);
                let midX = (p1.x + p2.x) / 2;
                let midY = (p1.y + p2.y) / 2;

                ctx.fillStyle = badgeBgColor;
                ctx.fillRect(midX - 18, midY - 7, 36, 14);
                ctx.fillStyle = '#2563eb';
                ctx.fillText(`${sideMm}`, midX, midY + 4);
            }

            // Маркеры вершин в режиме работы с коробами
            if (editMode === 'inner') {
                ctx.setLineDash([]);
                el.pts.forEach((pt, vIdx) => {
                    ctx.fillStyle = '#2563eb';
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#ffffff';
                    ctx.font = '700 9px "Inter", sans-serif';
                    ctx.fillText(`${vIdx + 1}`, pt.x, pt.y + 3);
                });
            }
        }
        ctx.restore();
    });

    if (activeDrawingPoly.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(activeDrawingPoly[0].x, activeDrawingPoly[0].y);
        for (let i = 1; i < activeDrawingPoly.length; i++) {
            ctx.lineTo(activeDrawingPoly[i].x, activeDrawingPoly[i].y);
        }
        ctx.stroke();

        activeDrawingPoly.forEach((pt, i) => {
            ctx.fillStyle = i === 0 ? '#10b981' : '#f59e0b';
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }

    // 5. Размеры внешних стен помещения
    let wallCount = getWallCount();
    ctx.textAlign = 'center';
    for (let i = 0; i < wallCount; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];
        let inputEl = document.getElementById(`wall-input-${i}`);
        let lenVal = inputEl ? inputEl.value : (Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel / 100).toFixed(3);

        let midX = (p1.x + p2.x) / 2;
        let midY = (p1.y + p2.y) / 2;

        let outX = midX - centerX;
        let outY = midY - centerY;
        let outLen = Math.hypot(outX, outY) || 1;
        let labelX = midX + (outX / outLen) * 18;
        let labelY = midY + (outY / outLen) * 18;

        labelX = Math.max(28, Math.min(canvas.width - 28, labelX));
        labelY = Math.max(16, Math.min(canvas.height - 54, labelY));

        wallHitBoxes.push({ wallIdx: i, x: labelX, y: labelY });

        ctx.fillStyle = badgeBgColor;
        ctx.fillRect(labelX - 28, labelY - 11, 56, 16);

        ctx.fillStyle = wallTextColor;
        ctx.font = strictFont;
        ctx.fillText(`${lenVal} м`, labelX, labelY);
    }

    // 6. Углы (вершины) комнаты
    points.forEach((p, idx) => {
        ctx.fillStyle = (!isClosed && idx === 0 && points.length >= 3) ? '#059669' : mainStrokeColor;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();

        let vx = p.x - centerX;
        let vy = p.y - centerY;
        let vLen = Math.hypot(vx, vy) || 1;
        let lx = p.x + (vx / vLen) * 16;
        let ly = p.y + (vy / vLen) * 16 + 4;

        lx = Math.min(canvas.width - 14, Math.max(14, lx));
        ly = Math.min(canvas.height - 52, Math.max(14, ly));

        ctx.fillStyle = pointLabelColor;
        ctx.font = '700 12px "Inter", "Roboto", sans-serif';
        ctx.fillText(p.label, lx, ly);
    });
    ctx.textAlign = 'start';
}

// --- ТАЧ-СОБЫТИЯ И ОТКРЫТИЕ НАСТРОЕК ПО ТАПУ ---
canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (isSketchLocked) return;

    if (document.activeElement) document.activeElement.blur();

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (editMode === 'drawing_poly') {
        if (activeDrawingPoly.length >= 3 && Math.hypot(activeDrawingPoly[0].x - x, activeDrawingPoly[0].y - y) < 25) {
            saveState();
            let sx = 0, sy = 0;
            activeDrawingPoly.forEach(p => { sx += p.x; sy += p.y; });
            innerElements.push({
                id: 'inner_' + Date.now(),
                type: 'poly',
                title: `Короб (${activeDrawingPoly.length} угл.)`,
                x: sx / activeDrawingPoly.length,
                y: sy / activeDrawingPoly.length,
                pts: [...activeDrawingPoly]
            });
            activeDrawingPoly = [];
            editMode = 'inner';
            renderInnerElementsList();
            updateHint();
            drawSketch();
            persistSketchToStorage();
            if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
            showToast('Произвольный короб создан!', 'success');
            return;
        }
        activeDrawingPoly.push({ x, y });
        updateHint();
        drawSketch();
        return;
    }

    // Проверка захвата вершин произвольного короба для перетаскивания углов
    if (editMode === 'inner') {
        for (let i = innerElements.length - 1; i >= 0; i--) {
            let el = innerElements[i];
            if (el.type === 'poly' && el.pts) {
                for (let v = 0; v < el.pts.length; v++) {
                    if (Math.hypot(el.pts[v].x - x, el.pts[v].y - y) < 22) {
                        saveState();
                        draggedInnerIdx = i;
                        draggedInnerVertex = v;
                        canvas.setPointerCapture(e.pointerId);
                        return;
                    }
                }
            }
        }
    }

    // Проверка клика по коробам
    for (let i = innerElements.length - 1; i >= 0; i--) {
        let el = innerElements[i];
        let hit = false;
        let rw = el.w || (el.lenCm / cmPerPixel);
        let rh = el.h || (el.widCm / cmPerPixel);
        let rad = el.radius || ((el.diamCm / 2) / cmPerPixel);

        if (el.type === 'rect') {
            hit = (x >= el.x - rw / 2 && x <= el.x + rw / 2 && y >= el.y - rh / 2 && y <= el.y + rh / 2);
        } else if (el.type === 'circle') {
            hit = Math.hypot(el.x - x, el.y - y) <= rad;
        } else if (el.type === 'poly') {
            hit = Math.hypot(el.x - x, el.y - y) <= 45;
        }

        if (hit) {
            if (editMode === 'inner') {
                openInnerEditSheet(i);
                return;
            }
            saveState();
            draggedInnerIdx = i;
            draggedInnerVertex = null;
            innerDragOffset = { x: x - el.x, y: y - el.y };
            canvas.setPointerCapture(e.pointerId);
            return;
        }
    }

    if (!isClosed && points.length >= 3 && Math.hypot(points[0].x - x, points[0].y - y) < 30) {
        closePolygon();
        return;
    }

    if (editMode === 'room') {
        for (let i = 0; i < points.length; i++) {
            if (Math.hypot(points[i].x - x, points[i].y - y) < 25) {
                saveState();
                draggedPointIndex = i;
                isDragging = true;
                canvas.setPointerCapture(e.pointerId);
                return;
            }
        }
    }

    for (let box of wallHitBoxes) {
        if (x >= box.x - 28 && x <= box.x + 28 && y >= box.y - 14 && y <= box.y + 14) {
            openWallEditSheet(box.wallIdx);
            return;
        }
    }

    if (points.length >= MAX_CORNERS) {
        showToast('Максимум 50 углов!', 'error');
        return;
    }

    if (editMode === 'room') {
        if (!isClosed) {
            saveState();
            let label = getPointLabel(points.length);
            points.push({ x, y, label });
            const presetCorners = document.getElementById('presetCornersCount');
            if (presetCorners) presetCorners.value = points.length;
            rebuildWallInputs();
            updateHint();
            drawSketch();
            persistSketchToStorage();
            if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
        } else {
            saveState();
            let bestWallIdx = points.length - 1;
            let minDist = Infinity;
            for (let i = 0; i < points.length; i++) {
                let p1 = points[i];
                let p2 = points[(i + 1) % points.length];
                let mx = (p1.x + p2.x) / 2;
                let my = (p1.y + p2.y) / 2;
                let d = Math.hypot(mx - x, my - y);
                if (d < minDist) {
                    minDist = d;
                    bestWallIdx = i;
                }
            }
            points.splice(bestWallIdx + 1, 0, { x, y, label: getPointLabel(points.length) });
            const presetCorners = document.getElementById('presetCornersCount');
            if (presetCorners) presetCorners.value = points.length;
            rebuildWallInputs();
            updateHint();
            drawSketch();
            persistSketchToStorage();
            if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
        }
    }
});

canvas.addEventListener('pointermove', (e) => {
    if (isSketchLocked) return;
    const rect = canvas.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;

    if (isDragging && draggedPointIndex !== null) {
        e.preventDefault();
        let p = points[draggedPointIndex];
        p.x = Math.max(20, Math.min(canvas.width - 20, curX));
        p.y = Math.max(20, Math.min(canvas.height - 20, curY));

        syncInputsValuesOnly();
        drawSketch();
        return;
    }

    // Перемещение конкретного угла произвольного короба
    if (draggedInnerIdx !== null && draggedInnerVertex !== null && innerElements[draggedInnerIdx]) {
        e.preventDefault();
        let el = innerElements[draggedInnerIdx];
        if (el.pts && el.pts[draggedInnerVertex]) {
            el.pts[draggedInnerVertex].x = Math.max(20, Math.min(canvas.width - 20, curX));
            el.pts[draggedInnerVertex].y = Math.max(20, Math.min(canvas.height - 20, curY));

            let sx = 0, sy = 0;
            el.pts.forEach(p => { sx += p.x; sy += p.y; });
            el.x = sx / el.pts.length;
            el.y = sy / el.pts.length;

            renderInnerElementsList();
            drawSketch();
            return;
        }
    }

    // Перемещение короба целиком
    if (draggedInnerIdx !== null && innerElements[draggedInnerIdx]) {
        e.preventDefault();
        let el = innerElements[draggedInnerIdx];
        let newX = Math.max(20, Math.min(canvas.width - 20, curX - innerDragOffset.x));
        let newY = Math.max(20, Math.min(canvas.height - 20, curY - innerDragOffset.y));
        let dx = newX - el.x;
        let dy = newY - el.y;
        el.x = newX;
        el.y = newY;
        if (el.type === 'poly' && el.pts) {
            el.pts.forEach(pt => {
                pt.x += dx;
                pt.y += dy;
            });
        }
        renderInnerElementsList();
        drawSketch();
    }
});

canvas.addEventListener('pointerup', () => {
    if (isDragging) {
        persistSketchToStorage();
        if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
        rebuildWallInputs();
    }
    if (draggedInnerIdx !== null) {
        persistSketchToStorage();
        if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    }
    isDragging = false;
    draggedPointIndex = null;
    draggedInnerIdx = null;
    draggedInnerVertex = null;
});

// --- СВЯЗЬ СО СТЕНАМИ И ТАБЛИЦЕЙ РАЗМЕРОВ (БАНКОМАТНЫЙ ВВОД) ---
function rebuildWallInputs() {
    const container = document.getElementById('wallsInputsContainer');
    const actionBtns = document.getElementById('tableActionButtons');
    if (!container) return;
    container.innerHTML = '';

    let totalAngles = points.length;
    let extraAngles = totalAngles > 4 ? totalAngles - 4 : 0;
    const countAngles = document.getElementById('countAngles');
    if (countAngles) countAngles.value = extraAngles;

    const wallsBadge = document.getElementById('wallsAnglesBadge');
    if (wallsBadge) wallsBadge.innerText = `Углов: ${totalAngles} (доп: ${extraAngles})`;

    let wallCount = getWallCount();
    if (wallCount === 0) {
        if (actionBtns) actionBtns.style.display = 'none';
        return;
    }
    if (actionBtns) actionBtns.style.display = 'flex';

    for (let i = 0; i < wallCount; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];
        let distM = (Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel / 100).toFixed(3);
        let dir = detectWallDir(p1, p2);

        let row = document.createElement('div');
        row.className = 'wall-row-input';
        row.innerHTML = `
            <span class="wall-row-label"><b>${p1.label}–${p2.label}</b></span>
            <input type="text" inputmode="numeric" class="input-field wall-len" id="wall-input-${i}" value="${distM}" oninput="handleWallSmartInput(${i}, this)" onkeydown="if(event.key==='Enter') this.blur()">
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
    let formatted = formatLaserShift(inputEl.value);
    inputEl.value = formatted;

    let m = parseFloat(formatted);
    if (m && m >= 0.1 && m <= 50) {
        onWallLengthEdit(wallIndex, formatted);
    }
}

function syncInputsValuesOnly() {
    let wallCount = getWallCount();
    for (let i = 0; i < wallCount; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];
        let distM = (Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel / 100).toFixed(3);
        let input = document.getElementById(`wall-input-${i}`);
        if (input && document.activeElement !== input) input.value = distM;
        let dirSel = document.getElementById(`wall-dir-${i}`);
        if (dirSel) dirSel.value = detectWallDir(p1, p2);
    }
}

function onWallLengthEdit(wallIndex, valStr) {
    let m = parseFloat(valStr);
    if (!m || m <= 0) return;
    let cm = m * 100;

    if (wallIndex >= points.length - 1 && isClosed) {
        drawSketch();
        persistSketchToStorage();
        if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
        return;
    }

    let p1 = points[wallIndex];
    let p2 = points[wallIndex + 1];
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;
    let curPx = Math.hypot(dx, dy);
    let targetPx = cm / cmPerPixel;

    let shiftX = 0, shiftY = 0;
    if (curPx > 0.001) {
        let newX = p1.x + (dx / curPx) * targetPx;
        let newY = p1.y + (dy / curPx) * targetPx;
        shiftX = newX - p2.x;
        shiftY = newY - p2.y;
    } else {
        shiftX = targetPx;
    }

    for (let j = wallIndex + 1; j < points.length; j++) {
        points[j].x += shiftX;
        points[j].y += shiftY;
    }

    fitToScreen(false);
    drawSketch();
    persistSketchToStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
}

function onWallDirEdit(wallIndex) {
    buildSketchFromTable();
}

function buildSketchFromTable() {
    if (points.length < 3) return;
    saveState();

    cmPerPixel = 2.5;
    let newPts = [{ x: 0, y: 0, label: 'A' }];

    for (let i = 0; i < points.length - 1; i++) {
        let lenInput = document.getElementById(`wall-input-${i}`);
        let dirSelect = document.getElementById(`wall-dir-${i}`);
        let m = lenInput ? (parseFloat(lenInput.value) || 2.0) : 2.0;
        let cm = m * 100;
        let dir = dirSelect ? dirSelect.value : 'R';
        let px = cm / cmPerPixel;

        let prev = newPts[i];
        let nx = prev.x;
        let ny = prev.y;

        if (dir === 'U') ny -= px;
        else if (dir === 'D') ny += px;
        else if (dir === 'R') nx += px;
        else if (dir === 'L') nx += px;

        newPts.push({ x: nx, y: ny, label: getPointLabel(i + 1) });
    }

    points = newPts;
    isClosed = true;
    fitToScreen(true);
    rebuildWallInputs();
    updateHint();
    drawSketch();
    persistSketchToStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast('Чертёж перестроен по размерам', 'success');
}

function createFromTablePreset() {
    saveState();
    let rawVal = parseInt(document.getElementById('presetCornersCount').value) || 4;
    let count = Math.max(3, Math.min(MAX_CORNERS, rawVal));
    document.getElementById('presetCornersCount').value = count;

    cmPerPixel = 2.5;
    let cx = (canvas.width || 350) / 2;
    let cy = (canvas.height || 320) / 2;

    if (count === 4) {
        let w = 400 / cmPerPixel, h = 300 / cmPerPixel;
        points = [
            { x: cx - w/2, y: cy + h/2, label: 'A' },
            { x: cx - w/2, y: cy - h/2, label: 'B' },
            { x: cx + w/2, y: cy - h/2, label: 'C' },
            { x: cx + w/2, y: cy + h/2, label: 'D' }
        ];
    } else if (count === 6) {
        let w = 400 / cmPerPixel, h = 350 / cmPerPixel;
        points = [
            { x: cx - w/2, y: cy + h/2, label: 'A' },
            { x: cx - w/2, y: cy, label: 'B' },
            { x: cx, y: cy, label: 'C' },
            { x: cx, y: cy - h/2, label: 'D' },
            { x: cx + w/2, y: cy - h/2, label: 'E' },
            { x: cx + w/2, y: cy + h/2, label: 'F' }
        ];
    } else {
        points = [];
        let r = 115;
        for (let i = 0; i < count; i++) {
            let ang = Math.PI - (i * 2 * Math.PI / count);
            points.push({
                x: cx + r * Math.cos(ang),
                y: cy + r * Math.sin(ang),
                label: getPointLabel(i)
            });
        }
    }

    isClosed = true;
    fitToScreen(true);
    rebuildWallInputs();
    updateHint();
    drawSketch();
    persistSketchToStorage();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast(`Создан шаблон на ${count} угл.`, 'success');
}

// --- ШТОРКА РЕДАКТИРОВАНИЯ СТЕНЫ (БАНКОМАТНЫЙ ВВОД) ---
function openWallEditSheet(wallIdx) {
    editingWallIdx = wallIdx;
    let p1 = points[wallIdx];
    let p2 = points[(wallIdx + 1) % points.length];
    let inp = document.getElementById(`wall-input-${wallIdx}`);
    let curVal = inp ? inp.value : (Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel / 100).toFixed(3);

    document.getElementById('wallEditSheetTitle').innerText = `📏 Длина стены ${p1.label}–${p2.label} (м)`;
    const sheetInput = document.getElementById('wallSheetInput');
    sheetInput.type = "text";
    sheetInput.setAttribute("inputmode", "numeric");
    sheetInput.value = curVal;
    
    sheetInput.oninput = function() {
        this.value = formatLaserShift(this.value);
    };

    document.getElementById('wallEditSheetOverlay').classList.add('open');
    setTimeout(() => {
        sheetInput.focus();
        sheetInput.select();
    }, 120);
}

function closeWallEditSheet() {
    document.getElementById('wallEditSheetOverlay').classList.remove('open');
    editingWallIdx = null;
}

function applyWallSheetValue() {
    if (editingWallIdx === null) return;
    let raw = document.getElementById('wallSheetInput').value;
    let formatted = formatLaserShift(raw);
    let val = parseFloat(formatted);
    if (val && val >= 0.1 && val <= 50) {
        let inp = document.getElementById(`wall-input-${editingWallIdx}`);
        if (inp) inp.value = val.toFixed(3);
        onWallLengthEdit(editingWallIdx, val);
        showToast(`Стена обновлена: ${val.toFixed(3)} м`, 'success');
    }
    closeWallEditSheet();
}
