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

// Переменные для перемещения и поворота люка
let isDraggingHatch = false;
let hatchDragOffset = { x: 0, y: 0 };
let hatchPos = null; // { x, y } в координатах экрана
let isHatchRotated = false;

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

function relabelPoints() {
    points.forEach((p, idx) => {
        p.label = getPointLabel(idx);
    });
}

function saveState() {
    historyState.push({
        pts: points.map(p => ({ x: p.x, y: p.y, label: p.label })),
        closed: isClosed,
        scale: cmPerPixel,
        hatchPos: hatchPos ? { ...hatchPos } : null,
        isHatchRotated
    });
    if (historyState.length > 40) historyState.shift();
}

function undoPoint() {
    if (isSketchLocked) return;
    if (historyState.length > 0) {
        let st = historyState.pop();
        points = st.pts;
        isClosed = st.closed;
        cmPerPixel = st.scale;
        hatchPos = st.hatchPos ? { ...st.hatchPos } : null;
        isHatchRotated = !!st.isHatchRotated;
    } else {
        points = [];
        isClosed = false;
        cmPerPixel = 2.5;
        hatchPos = null;
        isHatchRotated = false;
    }
    const presetCorners = document.getElementById('presetCornersCount');
    if (presetCorners && points.length >= 3) {
        presetCorners.value = points.length;
    }
    rebuildWallInputs();
    updateHint();
    drawSketch();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
}

function resetSketch() {
    if (isSketchLocked) return;
    saveState();
    points = [];
    isClosed = false;
    cmPerPixel = 2.5;
    hatchPos = null;
    isHatchRotated = false;
    rebuildWallInputs();
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
        btnWrap.classList.add('fab-active');
        lockBtn.innerHTML = `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`;
        showToast('🛡️ Чертёж заблокирован от касаний');
    } else {
        btnWrap.classList.remove('fab-active');
        lockBtn.innerHTML = `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>`;
        showToast('🔓 Чертёж разблокирован');
    }
    updateHint();
}

function toggleFullscreen() {
    const card = document.getElementById('canvasCard');
    const isFull = card.classList.toggle('fullscreen');
    document.getElementById('bottomFullscreenBtn').classList.toggle('fab-active', isFull);
    document.getElementById('fsCloseTopBtn').style.display = isFull ? 'block' : 'none';
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
    updateHint();
    drawSketch();
}, 120);

// --- ГЕОМЕТРИЯ ---
function untanglePolygon() {
    if (!isClosed || points.length < 4) return;
    let cx = 0, cy = 0;
    points.forEach(p => { cx += p.x; cy += p.y; });
    cx /= points.length;
    cy /= points.length;

    points.sort((a, b) => {
        let angA = Math.atan2(a.y - cy, a.x - cx);
        let angB = Math.atan2(b.y - cy, b.x - cx);
        return angA - angB;
    });
    relabelPoints();
}

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

    if (isSketchLocked) {
        hint.innerText = '🛡️ Чертёж заблокирован. Нажмите щит для разблокировки';
        return;
    }

    if (points.length === 0) {
        hint.innerText = 'Тапните на холст для точки А или создайте шаблон';
        closeBtn.classList.remove('fab-active');
    } else if (!isClosed) {
        let nextLabel = getPointLabel(points.length);
        hint.innerText = points.length < 3
            ? `Ставьте по очереди точку ${nextLabel}`
            : `Ставьте точку ${nextLabel} или нажмите замочек 🔒`;
        closeBtn.classList.remove('fab-active');
        if (lockSvg) lockSvg.innerHTML = `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>`;
    } else {
        hint.innerText = `Тяните углы или люк; тапните на стену для ввода длины`;
        closeBtn.classList.add('fab-active');
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
    if (isClosed) untanglePolygon();
    rebuildWallInputs();
    updateHint();
    drawSketch();
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
        untanglePolygon();
    }
    fitToScreen(false);
    syncInputsValuesOnly();
    drawSketch();
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
    if (hatchPos) {
        let hdx = hatchPos.x - cx;
        let hdy = hatchPos.y - cy;
        hatchPos.x = cx - hdy;
        hatchPos.y = cy + hdx;
        isHatchRotated = !isHatchRotated;
    }
    if (isClosed) untanglePolygon();
    fitToScreen(true);
    rebuildWallInputs();
    drawSketch();
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

        if (hatchPos) {
            hatchPos.x = canvasCX + (hatchPos.x - centerX) * factor;
            hatchPos.y = canvasCY + (hatchPos.y - centerY) * factor;
        }

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

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ЛЮКА ---
function getHatchBounds() {
    const countHatch = parseFloat(document.getElementById('countHatch')?.value) || 0;
    if (countHatch <= 0 || !isClosed || points.length < 3) return null;

    let hLen = parseFloat(document.getElementById('hatchLength')?.value) || 120;
    let hWid = parseFloat(document.getElementById('hatchWidth')?.value) || 60;

    let w = (isHatchRotated ? hWid : hLen) / cmPerPixel;
    let h = (isHatchRotated ? hLen : hWid) / cmPerPixel;

    if (!hatchPos) {
        let cx = 0, cy = 0;
        points.forEach(p => { cx += p.x; cy += p.y; });
        hatchPos = { x: cx / points.length, y: cy / points.length };
    }

    return {
        x: hatchPos.x - w / 2,
        y: hatchPos.y - h / 2,
        w,
        h,
        cx: hatchPos.x,
        cy: hatchPos.y,
        lenCm: hLen,
        widCm: hWid
    };
}

function rotateHatch() {
    isHatchRotated = !isHatchRotated;
    drawSketch();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast(isHatchRotated ? 'Люк повернут вертикально' : 'Люк повернут горизонтально');
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
            ctx.fillText(`${d.len}`, mx, my + 1);
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

    // 4. Отрисовка перемещаемого люка
    let hb = getHatchBounds();
    if (hb) {
        ctx.save();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);

        ctx.fillStyle = isLight ? 'rgba(37, 99, 235, 0.12)' : 'rgba(37, 99, 235, 0.22)';
        ctx.fillRect(hb.x, hb.y, hb.w, hb.h);

        // Плашка с размерами
        ctx.fillStyle = badgeBgColor;
        ctx.fillRect(hb.cx - 40, hb.cy - 9, 80, 18);
        ctx.fillStyle = '#2563eb';
        ctx.font = '700 10px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Люк ${Math.round(hb.lenCm)}×${Math.round(hb.widCm)}`, hb.cx, hb.cy + 4);
        ctx.restore();
    }

    // 5. Размеры стен
    let wallCount = getWallCount();
    ctx.textAlign = 'center';
    for (let i = 0; i < wallCount; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];
        let inputEl = document.getElementById(`wall-input-${i}`);
        let lenCm = inputEl ? inputEl.value : Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel);

        let midX = (p1.x + p2.x) / 2;
        let midY = (p1.y + p2.y) / 2;

        let outX = midX - centerX;
        let outY = midY - centerY;
        let outLen = Math.hypot(outX, outY) || 1;
        let labelX = midX + (outX / outLen) * 14;
        let labelY = midY + (outY / outLen) * 14;

        labelX = Math.max(28, Math.min(canvas.width - 28, labelX));
        labelY = Math.max(16, Math.min(canvas.height - 54, labelY));

        wallHitBoxes.push({ wallIdx: i, x: labelX, y: labelY });

        ctx.fillStyle = badgeBgColor;
        ctx.fillRect(labelX - 24, labelY - 11, 48, 16);

        ctx.fillStyle = wallTextColor;
        ctx.font = strictFont;
        ctx.fillText(`${lenCm} см`, labelX, labelY);
    }

    // 6. Углы (вершины)
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

// --- ТАЧ-СОБЫТИЯ И ПЕРЕТАСКИВАНИЕ ---
canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (isSketchLocked) return;

    if (document.activeElement) document.activeElement.blur();

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 1. Проверка замыкания контура в первую точку
    if (!isClosed && points.length >= 3 && Math.hypot(points[0].x - x, points[0].y - y) < 30) {
        saveState();
        isClosed = true;
        untanglePolygon();
        rebuildWallInputs();
        updateHint();
        drawSketch();
        if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
        showToast('Контур замкнут!', 'success');
        return;
    }

    // 2. Проверка нажатия на вершину комнаты
    for (let i = 0; i < points.length; i++) {
        if (Math.hypot(points[i].x - x, points[i].y - y) < 25) {
            saveState();
            draggedPointIndex = i;
            isDragging = true;
            canvas.setPointerCapture(e.pointerId);
            return;
        }
    }

    // 3. Проверка нажатия на люк для его перемещения
    let hb = getHatchBounds();
    if (hb && x >= hb.x && x <= hb.x + hb.w && y >= hb.y && y <= hb.y + hb.h) {
        saveState();
        isDraggingHatch = true;
        hatchDragOffset = { x: x - hb.cx, y: y - hb.cy };
        canvas.setPointerCapture(e.pointerId);
        return;
    }

    // 4. Проверка клика по плашке стены (вызов шторки ввода длины)
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

    // 5. Добавление новой точки
    if (!isClosed) {
        saveState();
        let label = getPointLabel(points.length);
        points.push({ x, y, label });
        const presetCorners = document.getElementById('presetCornersCount');
        if (presetCorners) presetCorners.value = points.length;
        rebuildWallInputs();
        updateHint();
        drawSketch();
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
        points.splice(bestWallIdx + 1, 0, { x, y, label: '' });
        untanglePolygon();
        const presetCorners = document.getElementById('presetCornersCount');
        if (presetCorners) presetCorners.value = points.length;
        rebuildWallInputs();
        updateHint();
        drawSketch();
        if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    }
});

canvas.addEventListener('pointermove', (e) => {
    if (isSketchLocked) return;
    const rect = canvas.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;

    // Перемещение вершины комнаты
    if (isDragging && draggedPointIndex !== null) {
        e.preventDefault();
        let p = points[draggedPointIndex];
        p.x = Math.max(20, Math.min(canvas.width - 20, curX));
        p.y = Math.max(20, Math.min(canvas.height - 20, curY));

        if (isClosed) untanglePolygon();
        syncInputsValuesOnly();
        drawSketch();
        return;
    }

    // Перемещение люка
    if (isDraggingHatch && hatchPos) {
        e.preventDefault();
        hatchPos.x = Math.max(30, Math.min(canvas.width - 30, curX - hatchDragOffset.x));
        hatchPos.y = Math.max(30, Math.min(canvas.height - 30, curY - hatchDragOffset.y));
        drawSketch();
    }
});

canvas.addEventListener('pointerup', () => {
    if (isDragging) {
        if (isClosed) untanglePolygon();
        if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
        rebuildWallInputs();
    }
    if (isDraggingHatch) {
        if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    }
    isDragging = false;
    draggedPointIndex = null;
    isDraggingHatch = false;
});

// --- СВЯЗЬ СО СТЕНАМИ И ТАБЛИЦЕЙ РАЗМЕРОВ ---
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
        let distCm = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel);
        let dir = detectWallDir(p1, p2);

        let row = document.createElement('div');
        row.className = 'wall-row-input';
        row.innerHTML = `
            <span class="wall-row-label"><b>${p1.label}–${p2.label}</b></span>
            <input type="number" class="input-field wall-len" id="wall-input-${i}" value="${distCm}" step="1" oninput="onWallLengthEdit(${i}, this.value)" onkeydown="if(event.key==='Enter') this.blur()">
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

function syncInputsValuesOnly() {
    let wallCount = getWallCount();
    for (let i = 0; i < wallCount; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];
        let distCm = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel);
        let input = document.getElementById(`wall-input-${i}`);
        if (input) input.value = distCm;
        let dirSel = document.getElementById(`wall-dir-${i}`);
        if (dirSel) dirSel.value = detectWallDir(p1, p2);
    }
}

function onWallLengthEdit(wallIndex, valStr) {
    let cm = parseFloat(valStr);
    if (!cm || cm <= 0) return;

    if (points.length === 4 && isClosed && (wallIndex === 0 || wallIndex === 1)) {
        let wallInputs = document.querySelectorAll('.wall-len');
        if (wallInputs.length === 4) {
            if (wallIndex === 0) wallInputs[2].value = cm;
            else if (wallIndex === 1) wallInputs[3].value = cm;
        }
    }

    if (wallIndex >= points.length - 1 && isClosed) {
        if (isClosed) untanglePolygon();
        drawSketch();
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
    if (curPx > 0.1) {
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
    if (isClosed) untanglePolygon();
    fitToScreen(true);
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
        let cm = lenInput ? (parseFloat(lenInput.value) || 200) : 200;
        let dir = dirSelect ? dirSelect.value : 'R';
        let px = cm / cmPerPixel;

        let prev = newPts[i];
        let nx = prev.x;
        let ny = prev.y;

        if (dir === 'U') ny -= px;
        else if (dir === 'D') ny += px;
        else if (dir === 'R') nx += px;
        else if (dir === 'L') nx -= px;

        newPts.push({ x: nx, y: ny, label: getPointLabel(i + 1) });
    }

    points = newPts;
    isClosed = true;
    untanglePolygon();
    fitToScreen(true);
    rebuildWallInputs();
    updateHint();
    drawSketch();
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
    untanglePolygon();
    fitToScreen(true);
    rebuildWallInputs();
    updateHint();
    drawSketch();
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    showToast(`Создан шаблон на ${count} угл.`, 'success');
}

// --- ШТОРКА РЕДАКТИРОВАНИЯ СТЕНЫ ---
function openWallEditSheet(wallIdx) {
    editingWallIdx = wallIdx;
    let p1 = points[wallIdx];
    let p2 = points[(wallIdx + 1) % points.length];
    let inp = document.getElementById(`wall-input-${wallIdx}`);
    let curVal = inp ? inp.value : Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel);

    document.getElementById('wallEditSheetTitle').innerText = `📏 Длина стены ${p1.label}–${p2.label} (см)`;
    const sheetInput = document.getElementById('wallSheetInput');
    sheetInput.value = curVal;
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
    let val = parseFloat(document.getElementById('wallSheetInput').value);
    if (val && val > 0) {
        let inp = document.getElementById(`wall-input-${editingWallIdx}`);
        if (inp) inp.value = Math.round(val);
        onWallLengthEdit(editingWallIdx, val);
        showToast(`Стена обновлена: ${Math.round(val)} см`, 'success');
    }
    closeWallEditSheet();
}
