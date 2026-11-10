// ==========================================================================
// ПОТОЛОК ЗАМЕР PRO — РАСЧЁТ СМЕТЫ И ЭКСПОРТ (calc-export.js)
// ==========================================================================

let lastEstimateText = '';
let lastFactoryText = '';
let lastBreakdownItems = [];
let lastCalcData = null;
let selectedExportFormat = 'png';
let selectedExportTheme = 'dark'; // 'dark' | 'light'

const PRICE_FIELDS = [
    'priceCanvas', 'priceProfile', 'priceInsert', 'priceLight', 'priceChandelier',
    'priceCornice', 'pricePipe', 'priceAngle', 'priceHatch', 'priceHatchAngle',
    'priceLightLines', 'priceTrack', 'priceNiche', 'priceShadow'
];

function saveUserPrices() {
    let prices = {};
    PRICE_FIELDS.forEach(id => {
        let el = document.getElementById(id);
        if (el) prices[id] = el.value;
    });
    localStorage.setItem('_pz_user_prices', JSON.stringify(prices));
}

function loadUserPrices() {
    try {
        let saved = JSON.parse(localStorage.getItem('_pz_user_prices') || '{}');
        PRICE_FIELDS.forEach(id => {
            if (saved[id] !== undefined && document.getElementById(id)) {
                document.getElementById(id).value = saved[id];
            }
        });
    } catch (e) {}
}

function calculatePolygonAreaM2(pts, scale) {
    if (!pts || pts.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
        let p1 = pts[i];
        let p2 = pts[(i + 1) % pts.length];
        sum += (p1.x * p2.y - p2.x * p1.y);
    }
    let pxArea = Math.abs(sum) / 2;
    let cm2Area = pxArea * (scale * scale);
    return cm2Area / 10000;
}

function getInnerElementMetrics(el, scale) {
    let perimM = 0;
    let areaM2 = 0;
    let cornersCount = 0;

    if (el.type === 'rect') {
        let w = parseFloat(el.lenCm) || (parseFloat(el.w) * scale) || 0;
        let h = parseFloat(el.widCm) || (parseFloat(el.h) * scale) || 0;
        perimM = (2 * (w + h)) / 100;
        areaM2 = (w * h) / 10000;
        cornersCount = 4;
    } else if (el.type === 'circle') {
        let d = parseFloat(el.diamCm) || 0;
        let r = d / 2;
        perimM = (Math.PI * d) / 100;
        areaM2 = (Math.PI * r * r) / 10000;
        cornersCount = 0;
    } else if (el.type === 'poly' && el.pts && el.pts.length >= 3) {
        let perimCm = 0;
        let sum = 0;
        for (let i = 0; i < el.pts.length; i++) {
            let p1 = el.pts[i];
            let p2 = el.pts[(i + 1) % el.pts.length];
            perimCm += Math.hypot(p2.x - p1.x, p2.y - p1.y) * scale;
            sum += (p1.x * p2.y - p2.x * p1.y);
        }
        perimM = perimCm / 100;
        let pxArea = Math.abs(sum) / 2;
        areaM2 = (pxArea * scale * scale) / 10000;
        cornersCount = el.pts.length;
    }

    return { perimM, areaM2, cornersCount };
}

function getCurrentRoomPerimeterM() {
    let wallCount = getWallCount();
    if (wallCount < 2) return 0;
    let totalM = 0;

    for (let i = 0; i < wallCount; i++) {
        let inp = document.getElementById(`wall-input-${i}`);
        let val = inp ? parseFloat(inp.value) : 0;
        if (!val || isNaN(val)) {
            let p1 = points[i];
            let p2 = points[(i + 1) % points.length];
            val = (Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel) / 100;
        }
        totalM += val;
    }
    return totalM;
}

function toggleInsertUsage() {
    let chk = document.getElementById('useInsertCheckbox');
    let insertInp = document.getElementById('countInsert');
    if (!chk || !insertInp) return;

    if (chk.checked) {
        let perimM = getCurrentRoomPerimeterM();
        insertInp.value = Math.round(perimM * 10) / 10;
        showToast(`Вставка включена (${insertInp.value} м.п.)`, 'success');
    } else {
        insertInp.value = 0;
        showToast('Вставка отключена');
    }
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
}

// ==========================================
// ОБНОВЛЕННАЯ ЛОГИКА РАСЧЕТА СМЕТЫ
// ==========================================

function performCalculation() {
    if (points.length < 3) {
        showToast('Поставьте минимум 3 точки на чертеже!', 'error');
        if (typeof isTabMode !== 'undefined' && isTabMode) switchTab('sketch');
        return;
    }
    if (!isClosed) {
        isClosed = true;
        rebuildWallInputs();
        if (typeof rebuildDiagonalInputs === 'function') rebuildDiagonalInputs();
        updateHint();
        drawSketch();
    }
    if (typeof isSubscriptionActive === 'function' && !isSubscriptionActive()) {
        if (usedAttempts >= MAX_FREE_ATTEMPTS) {
            document.getElementById('paywallModal').style.display = 'flex';
            return;
        }
        usedAttempts++;
        if (typeof saveSecurityState === 'function') saveSecurityState();
        if (typeof updateAttemptsUI === 'function') updateAttemptsUI();
    }

    // Сохраняем состояние текущей открытой комнаты
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();

    // Запоминаем индекс комнаты, на которой мы находимся
    let originalRoomIdx = activeRoomIdx;
    
    // Переменная для подсчета глобальной суммы всего заказа
    let globalTotal = 0;

    // В ФОНЕ ПРОБЕГАЕМ ПО ВСЕМ КОМНАТАМ И СЧИТАЕМ ИХ
    for (let rIdx = 0; rIdx < rooms.length; rIdx++) {
        let r = rooms[rIdx];
        if (r.points && r.points.length >= 3) {
             let roomCost = calculateRoomCostInBackground(r);
             r.lastTotal = roomCost;
             globalTotal += roomCost;
        } else {
             r.lastTotal = 0;
        }
    }

    // Считаем и выводим детализацию для ТЕКУЩЕЙ комнаты
    calculateActiveRoomDetails(globalTotal);

    if (typeof isTabMode !== 'undefined' && isTabMode) switchTab('estimate');
    showToast('Смета по всему объекту рассчитана!', 'success');
}

// Фоновый калькулятор для одной комнаты (без изменения интерфейса)
function calculateRoomCostInBackground(r) {
    let currentScale = r.scale || 2.5;
    
    // Площадь
    let grossArea = calculatePolygonAreaM2(r.points, currentScale);

    // Периметр
    let perimM = 0;
    for (let i = 0; i < r.points.length; i++) {
        let valM = r.walls && r.walls[i] ? parseFloat(r.walls[i]) : 0;
        if (!valM || isNaN(valM)) {
            let p1 = r.points[i];
            let p2 = r.points[(i + 1) % r.points.length];
            valM = (Math.hypot(p2.x - p1.x, p2.y - p1.y) * currentScale) / 100;
        }
        perimM += valM;
    }

    // Внутренние элементы
    let totalInnerArea = 0;
    let totalInnerPerim = 0;
    let totalInnerCorners = 0;
    (r.innerElements || []).forEach(el => {
        let m = getInnerElementMetrics(el, currentScale); 
        totalInnerArea += m.areaM2;
        totalInnerPerim += m.perimM;
        totalInnerCorners += m.cornersCount;
    });

    let netArea = grossArea;
    if ((r.innerElements || []).length > 0 && r.hatchSubtractArea !== false) {
        netArea = Math.max(0.1, grossArea - totalInnerArea);
    }

    // Цены из общих инпутов
    let pCanvas = parseFloat(document.getElementById('priceCanvas')?.value) || 0;
    let pProfile = parseFloat(document.getElementById('priceProfile')?.value) || 0;
    let pInsert = parseFloat(document.getElementById('priceInsert')?.value) || 0;
    let pHatch = parseFloat(document.getElementById('priceHatch')?.value) || 0;
    let pHatchAngle = r.priceHatchAngle || parseFloat(document.getElementById('priceHatchAngle')?.value) || 150;
    let pAngle = parseFloat(document.getElementById('priceAngle')?.value) || 0;

    let pLight = parseFloat(document.getElementById('priceLight')?.value) || 0;
    let pChandelier = parseFloat(document.getElementById('priceChandelier')?.value) || 0;
    let pCornice = parseFloat(document.getElementById('priceCornice')?.value) || 0;
    let pPipe = parseFloat(document.getElementById('pricePipe')?.value) || 0;

    let pLightLines = parseFloat(document.getElementById('priceLightLines')?.value) || 0;
    let pTrack = parseFloat(document.getElementById('priceTrack')?.value) || 0;
    let pNiche = parseFloat(document.getElementById('priceNiche')?.value) || 0;
    let pShadow = parseFloat(document.getElementById('priceShadow')?.value) || 0;

    // Математика комнаты
    let extraAngles = r.points.length > 4 ? r.points.length - 4 : 0;
    let cInsert = r.useInsert ? (Math.round(perimM * 10) / 10) : (parseFloat(r.countInsert) || 0);

    let tCanvas = Math.round(netArea * pCanvas);
    let tProfile = Math.round(perimM * pProfile);
    let tInsert = Math.round(cInsert * pInsert);
    let tAngles = Math.round(extraAngles * pAngle);
    let tHatchAngles = r.useHatchAngles ? Math.round(totalInnerCorners * pHatchAngle) : 0;
    let tInnerProfile = Math.round(totalInnerPerim * pHatch);
    
    let tLights = Math.round((parseFloat(r.countLights) || 0) * pLight);
    let tChand = Math.round((parseFloat(r.countChandeliers) || 0) * pChandelier);
    let tCornice = Math.round((parseFloat(r.countCornice) || 0) * pCornice);
    let tPipe = Math.round((parseFloat(r.countPipes) || 0) * pPipe);
    
    let tLightLines = Math.round((parseFloat(r.countLightLines) || 0) * pLightLines);
    let tTrack = Math.round((parseFloat(r.countTrack) || 0) * pTrack);
    let tNiche = Math.round((parseFloat(r.countNiche) || 0) * pNiche);
    let tShadow = Math.round((parseFloat(r.countShadow) || 0) * pShadow);

    return tCanvas + tProfile + tInsert + tAngles + tHatchAngles + tInnerProfile + 
           tLights + tChand + tCornice + tPipe + tLightLines + tTrack + tNiche + tShadow + 
           (parseFloat(r.customPrice1) || 0) + (parseFloat(r.customPrice2) || 0);
}

// Отрисовка детализации активной комнаты
function calculateActiveRoomDetails(globalTotal) {
    let wallsData = [];
    let wallCount = getWallCount();
    let roomPerimeterM = 0;

    for (let i = 0; i < wallCount; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];
        let inp = document.getElementById(`wall-input-${i}`);
        let valM = inp ? parseFloat(inp.value) : 0;
        
        if (!valM || isNaN(valM)) {
            valM = (Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel) / 100;
        }

        roomPerimeterM += valM;
        let cmVal = Math.round(valM * 100);
        wallsData.push({ name: `${p1.label}-${p2.label}`, cm: cmVal, m: valM.toFixed(3) });
    }

    let grossArea = calculatePolygonAreaM2(points, cmPerPixel);
    let inElements = (typeof innerElements !== 'undefined') ? innerElements : [];
    let isSubArea = document.getElementById('hatchSubtractArea')?.checked ?? true;
    let pHatch = parseFloat(document.getElementById('priceHatch')?.value) || 0;

    let totalInnerPerimM = 0;
    let totalInnerAreaM2 = 0;
    let totalInnerCorners = 0;
    let innerSummaryList = [];

    inElements.forEach((el, idx) => {
        let m = getInnerElementMetrics(el, cmPerPixel);
        totalInnerPerimM += m.perimM;
        totalInnerAreaM2 += m.areaM2;
        totalInnerCorners += m.cornersCount;

        let bindingsList = [];
        if (el.customBindings && el.customBindings.length > 0) {
            el.customBindings.forEach(b => {
                let vLabel = (b.vertexIdx !== undefined) ? `Уг.${b.vertexIdx + 1}` : 'Край';
                if (b.targetCornerIdx !== undefined && b.targetCornerIdx !== null) {
                    let pC = points[b.targetCornerIdx];
                    let cLabel = pC ? pC.label : (b.targetCornerIdx + 1);
                    bindingsList.push(`${vLabel} ➔ Угол ${cLabel}: ${b.distM} м`);
                } else {
                    let wIdx = b.targetWallIdx !== undefined ? b.targetWallIdx : (b.wallIdx || 0);
                    let p1 = points[wIdx];
                    let p2 = points[(wIdx + 1) % points.length];
                    let wName = (p1 && p2) ? `${p1.label}–${p2.label}` : `Стена ${wIdx + 1}`;
                    bindingsList.push(`${vLabel} ➔ Стена ${wName}: ${b.distM} м`);
                }
            });
        } else if (typeof getElementWallDistances === 'function') {
            let offsets = getElementWallDistances(el);
            offsets.forEach(o => {
                bindingsList.push(`Край ➔ ${o.wallName}: ${o.distM.toFixed(3)} м`);
            });
        }

        let baseName = el.title || `Короб ${idx + 1}`;
        if (baseName.includes('(')) {
            baseName = baseName.split('(')[0].trim();
        }

        let desc = '';
        if (el.type === 'rect') desc = `Люк ${(el.lenCm/100).toFixed(3)}×${(el.widCm/100).toFixed(3)} м`;
        else if (el.type === 'circle') desc = `Колонна ⌀${(el.diamCm/100).toFixed(3)} м`;
        else desc = `${el.pts ? el.pts.length : 0} угл.`;

        innerSummaryList.push({
            name: `${baseName} (${desc})`,
            perimM: m.perimM.toFixed(3),
            areaM2: m.areaM2.toFixed(3),
            bindingsList: bindingsList
        });
    });

    let netArea = grossArea;
    if (inElements.length > 0 && isSubArea) {
        netArea = Math.max(0.1, grossArea - totalInnerAreaM2);
    }

    let pCanvas = parseFloat(document.getElementById('priceCanvas')?.value) || 0;
    let pProfile = parseFloat(document.getElementById('priceProfile')?.value) || 0;
    
    let insertCheckbox = document.getElementById('useInsertCheckbox');
    let insertEl = document.getElementById('countInsert');
    let cInsert = 0;
    if (insertCheckbox && insertCheckbox.checked) {
        cInsert = Math.round(roomPerimeterM * 10) / 10;
        if (insertEl && document.activeElement !== insertEl) insertEl.value = cInsert;
    } else {
        cInsert = parseFloat(insertEl?.value) || 0;
    }

    let pInsert = parseFloat(document.getElementById('priceInsert')?.value) || 0;
    let cLights = parseFloat(document.getElementById('countLights')?.value) || 0;
    let pLight = parseFloat(document.getElementById('priceLight')?.value) || 0;
    let cChandeliers = parseFloat(document.getElementById('countChandeliers')?.value) || 0;
    let pChandelier = parseFloat(document.getElementById('priceChandelier')?.value) || 0;
    let cCornice = parseFloat(document.getElementById('countCornice')?.value) || 0;
    let pCornice = parseFloat(document.getElementById('priceCornice')?.value) || 0;
    let cPipes = parseFloat(document.getElementById('countPipes')?.value) || 0;
    let pPipe = parseFloat(document.getElementById('pricePipe')?.value) || 0;

    let cLightLines = parseFloat(document.getElementById('countLightLines')?.value) || 0;
    let pLightLines = parseFloat(document.getElementById('priceLightLines')?.value) || 0;
    let cTrack = parseFloat(document.getElementById('countTrack')?.value) || 0;
    let pTrack = parseFloat(document.getElementById('priceTrack')?.value) || 0;
    let cNiche = parseFloat(document.getElementById('countNiche')?.value) || 0;
    let pNiche = parseFloat(document.getElementById('priceNiche')?.value) || 0;
    let cShadow = parseFloat(document.getElementById('countShadow')?.value) || 0;
    let pShadow = parseFloat(document.getElementById('priceShadow')?.value) || 0;

    let roomAngles = points.length;
    let extraAngles = roomAngles > 4 ? roomAngles - 4 : 0;
    if (document.getElementById('countAngles')) {
        document.getElementById('countAngles').value = extraAngles;
    }
    let pAngle = parseFloat(document.getElementById('priceAngle')?.value) || 0;

    let useHatchAngles = document.getElementById('useHatchAnglesCheckbox')?.checked ?? false;
    let countHatchAngles = totalInnerCorners;
    if (document.getElementById('countHatchAngles')) {
        document.getElementById('countHatchAngles').value = countHatchAngles;
    }
    let pHatchAngle = parseFloat(document.getElementById('priceHatchAngle')?.value) || 150;

    let name1 = document.getElementById('customName1')?.value.trim() || 'Доп. работа 1';
    let custom1 = parseFloat(document.getElementById('customPrice1')?.value) || 0;
    let name2 = document.getElementById('customName2')?.value.trim() || 'Доп. работа 2';
    let custom2 = parseFloat(document.getElementById('customPrice2')?.value) || 0;

    let costCanvas = Math.round(netArea * pCanvas);
    let costProfile = Math.round(roomPerimeterM * pProfile);
    let costInsert = Math.round(cInsert * pInsert);
    let costAngles = Math.round(extraAngles * pAngle);
    let costHatchAngles = useHatchAngles ? Math.round(countHatchAngles * pHatchAngle) : 0;
    let costLights = Math.round(cLights * pLight);
    let costChandelier = Math.round(cChandeliers * pChandelier);
    let costCornice = Math.round(cCornice * pCornice);
    let costPipes = Math.round(cPipes * pPipe);
    let costInnerProfile = Math.round(totalInnerPerimM * pHatch);

    let costLightLines = Math.round(cLightLines * pLightLines);
    let costTrack = Math.round(cTrack * pTrack);
    let costNiche = Math.round(cNiche * pNiche);
    let costShadow = Math.round(cShadow * pShadow);

    let total = costCanvas + costProfile + costInsert + costAngles + costHatchAngles + costLights + 
                costChandelier + costCornice + costPipes + costInnerProfile + costLightLines + 
                costTrack + costNiche + costShadow + custom1 + custom2;

    let currentRoomTitle = rooms[activeRoomIdx].title;
    if (document.getElementById('activeRoomEstimateTitle')) {
        document.getElementById('activeRoomEstimateTitle').innerText = currentRoomTitle;
    }

    lastBreakdownItems = [
        { 
            title: 'Полотно потолка' + (inElements.length > 0 && isSubArea ? ' (за вычетом коробов)' : ''), 
            sub: `${netArea.toFixed(2)} м² × ${pCanvas} ₽`, 
            val: `${costCanvas.toLocaleString()} ₽` 
        },
        { 
            title: 'Профиль (багет)', 
            sub: `${roomPerimeterM.toFixed(2)} м.п. × ${pProfile} ₽`, 
            val: `${costProfile.toLocaleString()} ₽` 
        }
    ];

    if (cInsert > 0) {
        lastBreakdownItems.push({ 
            title: 'Вставка по периметру', 
            sub: `${cInsert} м.п. × ${pInsert} ₽`, 
            val: `${costInsert.toLocaleString()} ₽` 
        });
    }

    if (inElements.length > 0) {
        lastBreakdownItems.push({ 
            title: `Внутренние короба/люки (${inElements.length} шт.)`, 
            sub: `Брус/профиль: ${totalInnerPerimM.toFixed(2)} м.п. × ${pHatch} ₽`, 
            val: `${costInnerProfile.toLocaleString()} ₽` 
        });
    }

    if (extraAngles > 0 || roomAngles > 0) {
        lastBreakdownItems.push({ 
            title: `Углы комнаты (всего ${roomAngles} шт.)`, 
            sub: `Доп. углы (>4): ${extraAngles} шт. × ${pAngle} ₽`, 
            val: `${costAngles.toLocaleString()} ₽` 
        });
    }

    if (useHatchAngles && countHatchAngles > 0) {
        lastBreakdownItems.push({ 
            title: `Углы коробов и люков (${countHatchAngles} шт.)`, 
            sub: `${countHatchAngles} шт. × ${pHatchAngle} ₽`, 
            val: `${costHatchAngles.toLocaleString()} ₽` 
        });
    }

    if (cLights > 0) lastBreakdownItems.push({ title: 'Светильники', sub: `${cLights} шт. × ${pLight} ₽`, val: `${costLights.toLocaleString()} ₽` });
    if (cChandeliers > 0) lastBreakdownItems.push({ title: 'Люстра', sub: `${cChandeliers} шт. × ${pChandelier} ₽`, val: `${costChandelier.toLocaleString()} ₽` });
    if (cCornice > 0) lastBreakdownItems.push({ title: 'Монтаж карниза', sub: `${cCornice} м.п. × ${pCornice} ₽`, val: `${costCornice.toLocaleString()} ₽` });
    if (cPipes > 0) lastBreakdownItems.push({ title: 'Обход труб', sub: `${cPipes} шт. × ${pPipe} ₽`, val: `${costPipes.toLocaleString()} ₽` });
    if (cLightLines > 0) lastBreakdownItems.push({ title: 'Световые линии', sub: `${cLightLines} м.п. × ${pLightLines} ₽`, val: `${costLightLines.toLocaleString()} ₽` });
    if (cTrack > 0) lastBreakdownItems.push({ title: 'Трековая система', sub: `${cTrack} м.п. × ${pTrack} ₽`, val: `${costTrack.toLocaleString()} ₽` });
    if (cNiche > 0) lastBreakdownItems.push({ title: 'Скрытая ниша ПК-5', sub: `${cNiche} м.п. × ${pNiche} ₽`, val: `${costNiche.toLocaleString()} ₽` });
    if (cShadow > 0) lastBreakdownItems.push({ title: 'Теневой / Парящий профиль', sub: `${cShadow} м.п. × ${pShadow} ₽`, val: `${costShadow.toLocaleString()} ₽` });
    if (custom1 > 0) lastBreakdownItems.push({ title: name1, sub: 'Доп. работа', val: `${custom1.toLocaleString()} ₽` });
    if (custom2 > 0) lastBreakdownItems.push({ title: name2, sub: 'Доп. работа', val: `${custom2.toLocaleString()} ₽` });

    let rowsHtml = lastBreakdownItems.map(item => `
        <div class="breakdown-row">
            <div class="breakdown-label">
                <span>${item.title}</span>
                <span class="breakdown-sub">${item.sub}</span>
            </div>
            <div class="breakdown-val">${item.val}</div>
        </div>
    `).join('');

    document.getElementById('estimateBreakdown').innerHTML = rowsHtml;
    document.getElementById('resTotal').innerText = Math.round(total).toLocaleString() + ' ₽';

    const allRoomsRow = document.getElementById('allRoomsTotalRow');
    if (rooms.length > 1) {
        allRoomsRow.style.display = 'flex';
        document.getElementById('resAllRoomsTotal').innerText = Math.round(globalTotal).toLocaleString() + ' ₽';
    } else {
        allRoomsRow.style.display = 'none';
    }

    let clientName = document.getElementById('clientName')?.value || 'Заказчик';
    let clientAddr = document.getElementById('clientAddress')?.value || 'Не указан';
    let clientPhone = document.getElementById('clientPhone')?.value || '';
    let clientDate = document.getElementById('clientDate')?.value || '';
    let diags = getCleanDiagonals();

    lastCalcData = {
        clientName: `${clientName} (${currentRoomTitle})`,
        clientAddr,
        clientPhone,
        clientDate,
        area: netArea.toFixed(2),
        grossArea: grossArea.toFixed(2),
        perimeter: roomPerimeterM.toFixed(2),
        roomAngles,
        countHatchAngles,
        useHatchAngles,
        totalAngles: roomAngles,
        innerCount: inElements.length,
        innerElements: innerSummaryList,
        totalInnerPerimM: totalInnerPerimM.toFixed(2),
        wallsData,
        diags,
        totalText: Math.round(total).toLocaleString() + ' ₽'
    };

    let innerEstimateText = '';
    if (inElements.length > 0) {
        innerEstimateText = `🔹 Короба/люки (${inElements.length} шт.): ${totalInnerPerimM.toFixed(2)} м.п. (${costInnerProfile} ₽)
`;
    }

    let hatchAnglesText = '';
    if (useHatchAngles && countHatchAngles > 0) {
        hatchAnglesText = `🔹 Углы коробов (${countHatchAngles} шт): ${costHatchAngles} ₽
`;
    }

    lastEstimateText =
        `📋 СМЕТА НА НАТЯЖНОЙ ПОТОЛОК (${currentRoomTitle})
` +
        `👤 Клиент: ${clientName} ${clientPhone ? '('+clientPhone+')' : ''}
` +
        `📍 Адрес: ${clientAddr}
` +
        (clientDate ? `📅 Дата: ${clientDate}
` : '') +
        `──────────────────
` +
        `🔹 Полотно: ${netArea.toFixed(2)} м² (${costCanvas} ₽)
` +
        `🔹 Профиль: ${roomPerimeterM.toFixed(2)} м.п. (${costProfile} ₽)
` +
        (cInsert > 0 ? `🔹 Вставка: ${cInsert} м.п. (${costInsert} ₽)
` : '') +
        innerEstimateText +
        `🔹 Углы комнаты (${roomAngles} шт, доп: ${extraAngles}): ${costAngles} ₽
` +
        hatchAnglesText +
        (cLights > 0 ? `🔹 Светильники (${cLights} шт): ${costLights} ₽
` : '') +
        (cChandeliers > 0 ? `🔹 Люстра (${cChandeliers} шт): ${costChandelier} ₽
` : '') +
        (cCornice > 0 ? `🔹 Карниз (${cCornice} м.п.): ${costCornice} ₽
` : '') +
        (cPipes > 0 ? `🔹 Обход труб (${cPipes} шт): ${costPipes} ₽
` : '') +
        (cLightLines > 0 ? `🔹 Световые линии (${cLightLines} м.п.): ${costLightLines} ₽
` : '') +
        (cTrack > 0 ? `🔹 Трековая система (${cTrack} м.п.): ${costTrack} ₽
` : '') +
        (cNiche > 0 ? `🔹 Ниша ПК-5 (${cNiche} м.п.): ${costNiche} ₽
` : '') +
        (cShadow > 0 ? `🔹 Теневой (${cShadow} м.п.): ${costShadow} ₽
` : '') +
        (custom1 > 0 ? `🔹 ${name1}: ${custom1} ₽
` : '') +
        (custom2 > 0 ? `🔹 ${name2}: ${custom2} ₽
` : '') +
        `──────────────────
` +
        `💰 ИТОГО К ОПЛАТЕ: ${Math.round(total).toLocaleString()} ₽` +
        (rooms.length > 1 ? `
🏢 ВСЕ КОМНАТЫ: ${Math.round(globalTotal).toLocaleString()} ₽` : '');

    let innerFactoryText = '';
    if (innerSummaryList.length > 0) {
        innerFactoryText = `🚪 ВНУТРЕННИЕ ВЫРЕЗЫ И КОРОБА:
` +
            innerSummaryList.map(item => {
                let bindsStr = item.bindingsList.length > 0 
                    ? item.bindingsList.map(b => `    • ${b}`).join('
') 
                    : '    • по центру';
                return `  • ${item.name}: ${item.perimM} м.п.
${bindsStr}`;
            }).join('
') + `
`;
    }

    lastFactoryText =
        `🏭 ЗАКАЗ В ЦЕХ НА РАСКРОЙ ПОЛОТНА
` +
        `📍 Объект: ${clientName} — ${currentRoomTitle} (${clientAddr})
` +
        `⚠️ ВНИМАНИЕ: Размеры указаны БЕЗ УСАДКИ (чистый габарит комнаты)!
` +
        `──────────────────
` +
        `📐 Чистая площадь: ${netArea.toFixed(2)} м² | Периметр: ${roomPerimeterM.toFixed(2)} м.п. | Углов комнаты: ${roomAngles} шт.` +
        (totalInnerCorners > 0 ? ` (углов коробов: ${totalInnerCorners} шт.)` : '') + `
` +
        innerFactoryText +
        `📏 СТЕНЫ (чистые):
` +
        wallsData.map(w => `  • Стена ${w.name}: ${w.m} м (${w.cm} см)`).join('
') + `
` +
        (diags.length > 0 ? `📐 ДИАГОНАЛИ (чистые):
` + diags.map(d => `  • Диагональ ${d.name}${d.isCustom ? ' [ручной замер]' : ''}: ${(d.len / 100).toFixed(2)} м (${d.len} см)`).join('
') : '');
}

// --- УПРАВЛЕНИЕ ВЫГРУЗКОЙ ---
function selectExportFormat(fmt) {
    selectedExportFormat = fmt;
    document.getElementById('fmtTabPng')?.classList.toggle('active', fmt === 'png');
    document.getElementById('fmtTabDoc')?.classList.toggle('active', fmt === 'doc');
}

function selectExportTheme(thm) {
    selectedExportTheme = thm;
    document.getElementById('thmTabDark')?.classList.toggle('active', thm === 'dark');
    document.getElementById('thmTabLight')?.classList.toggle('active', thm === 'light');
    showToast(thm === 'light' ? '☀️ Выбрана Белая тема (печать)' : '🌙 Выбрана Тёмная тема');
}

function openExportSheet() {
    if (!lastCalcData || points.length < 3) {
        showToast('Сначала начертите комнату и нажмите «РАССЧИТАТЬ СМЕТУ»!', 'error');
        return;
    }
    document.getElementById('exportSheetOverlay')?.classList.add('open');
}

function closeExportSheet() {
    document.getElementById('exportSheetOverlay')?.classList.remove('open');
}

function triggerCombinedShare(target) {
    let isClient = (target === 'client');

    if (!lastCalcData) {
        showToast('Сначала нажмите «РАССЧИТАТЬ СМЕТУ»!', 'error');
        return;
    }

    closeExportSheet();

    if (selectedExportFormat === 'png') {
        if (isClient) exportClientImage();
        else exportFactoryImage();
        return;
    }

    if (selectedExportFormat === 'doc') {
        exportWordDoc(target);
        return;
    }
}

function copyTextFallback(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('📋 Текст скопирован! Вставьте в нужный мессенджер', 'success');
        });
    } else {
        showToast('Скопируйте текст вручную');
    }
}

function shareDirectTelegram(target) {
    closeExportSheet();
    let text = target === 'client' ? lastEstimateText : lastFactoryText;
    if (!text) {
        showToast('Сначала рассчитайте смету!', 'error');
        return;
    }
    
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('📋 Текст скопирован! Открываю Telegram...', 'success');
        });
    }
    window.location.href = "tg://";
}

function shareDirectMax(target) {
    closeExportSheet();
    let text = target === 'client' ? lastEstimateText : lastFactoryText;
    if (!text) {
        showToast('Сначала рассчитайте смету!', 'error');
        return;
    }
    let rawPhone = lastCalcData?.clientPhone || document.getElementById('clientPhone')?.value || '';
    let cleanPhone = rawPhone.replace(/\D/g, '');
    let url = cleanPhone ? `https://max.ru/${cleanPhone}` : `https://max.ru/`;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('📋 Текст скопирован! Открываю MAX...', 'success');
        });
    }
    window.open(url, '_blank');
}

// ПОЛНАЯ ОТРИСОВКА ЧЕРТЕЖА СО ВСЕМИ ДИАГОНАЛЯМИ И ЗАЩИТОЙ ОТ НАЛОЖЕНИЯ
function renderCleanSketchForExport(targetCtx, destX, destY, isWhite) {
    if (points.length < 2) return;
    targetCtx.save();
    targetCtx.translate(destX, destY);

    const badgeBg = isWhite ? '#ffffff' : '#0f172a';
    const badgeBorder = isWhite ? '#cbd5e1' : '#334155';
    let renderedBadges = [];

    function avoidCollision(x, y, w = 46, h = 16) {
        let curY = y;
        for (let b of renderedBadges) {
            if (Math.abs(b.x - x) < (b.w / 2 + w / 2 + 2) && Math.abs(b.y - curY) < (b.h / 2 + h / 2 + 2)) {
                curY += (curY >= b.y) ? 16 : -16;
            }
        }
        renderedBadges.push({ x, y: curY, w, h });
        return { x, y: curY };
    }

    // 1. Сетка
    targetCtx.strokeStyle = isWhite ? '#e2e8f0' : '#1e293b';
    targetCtx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 20) {
        targetCtx.beginPath(); targetCtx.moveTo(x, 0); targetCtx.lineTo(x, canvas.height); targetCtx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 20) {
        targetCtx.beginPath(); targetCtx.moveTo(0, y); targetCtx.lineTo(canvas.width, y); targetCtx.stroke();
    }

    // 2. Диагонали раскроя — отображаются абсолютно ВСЕ диагонали из расчета
    let diags = getCleanDiagonals();
    if (diags.length > 0) {
        targetCtx.save();
        targetCtx.lineWidth = 1.3;
        targetCtx.setLineDash([4, 4]);

        diags.forEach((d, idx) => {
            targetCtx.strokeStyle = d.isCustom ? '#0284c7' : (isWhite ? '#64748b' : 'rgba(255, 255, 255, 0.35)');
            targetCtx.beginPath(); 
            targetCtx.moveTo(d.from.x, d.from.y); 
            targetCtx.lineTo(d.to.x, d.to.y); 
            targetCtx.stroke();

            let ratio = 0.38 + ((idx % 3) * 0.14);
            let mx = d.from.x + (d.to.x - d.from.x) * ratio;
            let my = d.from.y + (d.to.y - d.from.y) * ratio;

            let safePos = avoidCollision(mx, my, 50, 16);

            targetCtx.fillStyle = badgeBg;
            targetCtx.fillRect(safePos.x - 25, safePos.y - 8, 50, 15);
            targetCtx.strokeStyle = d.isCustom ? '#0284c7' : badgeBorder;
            targetCtx.strokeRect(safePos.x - 25, safePos.y - 8, 50, 15);

            targetCtx.fillStyle = d.isCustom ? '#0284c7' : (isWhite ? '#475569' : '#94a3b8');
            targetCtx.font = '500 10px sans-serif';
            targetCtx.textAlign = 'center';
            targetCtx.fillText(`${(d.len / 100).toFixed(2)} м`, safePos.x, safePos.y + 3);
        });
        targetCtx.restore();
    }

    // 3. Контур стен помещения
    targetCtx.beginPath();
    targetCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) targetCtx.lineTo(points[i].x, points[i].y);
    if (isClosed) {
        targetCtx.closePath();
        targetCtx.fillStyle = isWhite ? 'rgba(37, 99, 235, 0.04)' : 'rgba(79, 70, 229, 0.1)';
        targetCtx.fill();
    }
    targetCtx.strokeStyle = isWhite ? '#0f172a' : '#e2e8f0';
    targetCtx.lineWidth = 2.5;
    targetCtx.stroke();

    // 4. Внутренние элементы, их размеры, номера углов и привязки
    innerElements.forEach(el => {
        let activeBinds = [];

        if (el.customBindings && el.customBindings.length > 0) {
            el.customBindings.forEach(b => {
                let pBox = (el.pts && el.pts[b.vertexIdx]) ? el.pts[b.vertexIdx] : { x: el.x, y: el.y };

                if (b.targetCornerIdx !== undefined && b.targetCornerIdx !== null) {
                    let pRoom = points[b.targetCornerIdx];
                    if (pRoom) {
                        activeBinds.push({
                            edgeX: pBox.x,
                            edgeY: pBox.y,
                            projX: pRoom.x,
                            projY: pRoom.y,
                            distM: ((Math.hypot(pRoom.x - pBox.x, pRoom.y - pBox.y) * cmPerPixel) / 100)
                        });
                    }
                } else {
                    let wIdx = b.targetWallIdx !== undefined ? b.targetWallIdx : (b.wallIdx || 0);
                    let pA = points[wIdx];
                    let pB = points[(wIdx + 1) % points.length];
                    if (pA && pB) {
                        let proj = getClosestPointOnSegment(pBox, pA, pB);
                        activeBinds.push({
                            edgeX: pBox.x,
                            edgeY: pBox.y,
                            projX: proj.x,
                            projY: proj.y,
                            distM: ((Math.hypot(proj.x - pBox.x, proj.y - pBox.y) * cmPerPixel) / 100)
                        });
                    }
                }
            });
        } else if (typeof getElementWallDistances === 'function') {
            let defDists = getElementWallDistances(el);
            defDists.forEach(w => {
                activeBinds.push({
                    edgeX: w.edgeX,
                    edgeY: w.edgeY,
                    projX: w.projX,
                    projY: w.projY,
                    distM: w.distM
                });
            });
        }

        // Красные пунктирные привязки (к стенам и углам) с защитой от наслоения
        targetCtx.save();
        targetCtx.strokeStyle = '#ef4444';
        targetCtx.lineWidth = 1.3;
        targetCtx.setLineDash([3, 3]);

        activeBinds.forEach(w => {
            targetCtx.beginPath();
            targetCtx.moveTo(w.edgeX, w.edgeY);
            targetCtx.lineTo(w.projX, w.projY);
            targetCtx.stroke();

            let midX = (w.edgeX + w.projX) / 2;
            let midY = (w.edgeY + w.projY) / 2;
            let safePos = avoidCollision(midX, midY, 56, 16);

            targetCtx.setLineDash([]);
            targetCtx.fillStyle = badgeBg;
            targetCtx.fillRect(safePos.x - 28, safePos.y - 8, 56, 15);
            targetCtx.strokeStyle = '#ef4444';
            targetCtx.lineWidth = 1;
            targetCtx.strokeRect(safePos.x - 28, safePos.y - 8, 56, 15);

            targetCtx.fillStyle = '#ef4444';
            targetCtx.font = '700 9.5px sans-serif';
            targetCtx.textAlign = 'center';
            targetCtx.fillText(`${w.distM.toFixed(3)} м`, safePos.x, safePos.y + 3.5);
            targetCtx.setLineDash([3, 3]);
        });
        targetCtx.restore();

        // Тело короба, размеры сторон и номера углов
        targetCtx.save();
        targetCtx.strokeStyle = '#2563eb';
        targetCtx.lineWidth = 2;
        targetCtx.fillStyle = isWhite ? 'rgba(37, 99, 235, 0.12)' : 'rgba(37, 99, 235, 0.25)';

        if (el.type === 'rect') {
            let rw = el.w || (el.lenCm / cmPerPixel);
            let rh = el.h || (el.widCm / cmPerPixel);
            targetCtx.setLineDash([5, 3]);
            targetCtx.strokeRect(el.x - rw / 2, el.y - rh / 2, rw, rh);
            targetCtx.fillRect(el.x - rw / 2, el.y - rh / 2, rw, rh);

            targetCtx.setLineDash([]);
            targetCtx.fillStyle = badgeBg;
            let topBadge = avoidCollision(el.x, el.y - rh / 2 - 8, 50, 15);
            targetCtx.fillRect(topBadge.x - 25, topBadge.y - 7, 50, 14);
            targetCtx.fillStyle = '#2563eb';
            targetCtx.font = '600 10px sans-serif';
            targetCtx.textAlign = 'center';
            targetCtx.fillText(`${(el.lenCm / 100).toFixed(3)}`, topBadge.x, topBadge.y + 3.5);

            let rightBadge = avoidCollision(el.x + rw / 2, el.y + 12, 50, 15);
            targetCtx.fillStyle = badgeBg;
            targetCtx.fillRect(rightBadge.x - 25, rightBadge.y - 7, 50, 14);
            targetCtx.fillStyle = '#2563eb';
            targetCtx.fillText(`${(el.widCm / 100).toFixed(3)}`, rightBadge.x, rightBadge.y + 3.5);

        } else if (el.type === 'circle') {
            let rad = el.radius || ((el.diamCm / 2) / cmPerPixel);
            targetCtx.setLineDash([4, 3]);
            targetCtx.beginPath();
            targetCtx.arc(el.x, el.y, rad, 0, Math.PI * 2);
            targetCtx.stroke();
            targetCtx.fill();

            targetCtx.setLineDash([]);
            targetCtx.fillStyle = badgeBg;
            let cBadge = avoidCollision(el.x, el.y, 56, 16);
            targetCtx.fillRect(cBadge.x - 28, cBadge.y - 8, 56, 16);
            targetCtx.fillStyle = '#2563eb';
            targetCtx.font = '700 10px sans-serif';
            targetCtx.textAlign = 'center';
            targetCtx.fillText(`⌀${(el.diamCm / 100).toFixed(3)}`, cBadge.x, cBadge.y + 4);

        } else if (el.type === 'poly' && el.pts && el.pts.length >= 3) {
            targetCtx.setLineDash([5, 3]);
            targetCtx.beginPath();
            targetCtx.moveTo(el.pts[0].x, el.pts[0].y);
            for (let i = 1; i < el.pts.length; i++) targetCtx.lineTo(el.pts[i].x, el.pts[i].y);
            targetCtx.closePath();
            targetCtx.stroke();
            targetCtx.fill();

            // Длины сторон короба с защитой от наслоения
            targetCtx.setLineDash([]);
            targetCtx.font = '600 9.5px sans-serif';
            targetCtx.textAlign = 'center';
            for (let i = 0; i < el.pts.length; i++) {
                let p1 = el.pts[i];
                let p2 = el.pts[(i + 1) % el.pts.length];
                let sideM = (Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel / 100).toFixed(3);
                let midX = (p1.x + p2.x) / 2;
                let midY = (p1.y + p2.y) / 2;

                let safePos = avoidCollision(midX, midY, 44, 14);

                targetCtx.fillStyle = badgeBg;
                targetCtx.fillRect(safePos.x - 22, safePos.y - 7, 44, 14);
                targetCtx.strokeStyle = badgeBorder;
                targetCtx.strokeRect(safePos.x - 22, safePos.y - 7, 44, 14);
                targetCtx.fillStyle = '#2563eb';
                targetCtx.fillText(`${sideM}`, safePos.x, safePos.y + 3.5);
            }

            // Номера углов короба (1, 2, 3...)
            el.pts.forEach((pt, vIdx) => {
                targetCtx.fillStyle = '#2563eb';
                targetCtx.beginPath();
                targetCtx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
                targetCtx.fill();

                targetCtx.fillStyle = '#ffffff';
                targetCtx.font = '700 9px sans-serif';
                targetCtx.fillText(`${vIdx + 1}`, pt.x, pt.y + 3);
            });
        }
        targetCtx.restore();
    });

    // 5. Размеры внешних стен помещения
    let centerX = 0, centerY = 0;
    points.forEach(p => { centerX += p.x; centerY += p.y; });
    centerX /= points.length;
    centerY /= points.length;

    let wallCount = getWallCount();
    targetCtx.textAlign = 'center';
    for (let i = 0; i < wallCount; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];
        if (!p1 || !p2) continue;
        let inputEl = document.getElementById(`wall-input-${i}`);
        let lenVal = inputEl ? inputEl.value : (Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel / 100).toFixed(3);
        let midX = (p1.x + p2.x) / 2;
        let midY = (p1.y + p2.y) / 2;
        let outX = midX - centerX;
        let outY = midY - centerY;
        let outLen = Math.hypot(outX, outY) || 1;
        let labelX = midX + (outX / outLen) * 18;
        let labelY = midY + (outY / outLen) * 18;

        let safePos = avoidCollision(labelX, labelY, 56, 16);

        targetCtx.fillStyle = badgeBg;
        targetCtx.fillRect(safePos.x - 28, safePos.y - 8, 56, 15);
        targetCtx.strokeStyle = badgeBorder;
        targetCtx.strokeRect(safePos.x - 28, safePos.y - 8, 56, 15);
        targetCtx.fillStyle = isWhite ? '#0f172a' : '#ffffff';
        targetCtx.font = '600 11px sans-serif';
        targetCtx.fillText(`${lenVal} м`, safePos.x, safePos.y + 3.5);
    }

    // 6. Углы комнаты (буквы A, B, C...)
    points.forEach(p => {
        targetCtx.fillStyle = isWhite ? '#0f172a' : '#ffffff';
        targetCtx.beginPath();
        targetCtx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        targetCtx.fill();

        let vx = p.x - centerX;
        let vy = p.y - centerY;
        let vLen = Math.hypot(vx, vy) || 1;
        let lx = p.x + (vx / vLen) * 16;
        let ly = p.y + (vy / vLen) * 16 + 4;
        targetCtx.font = '700 12px sans-serif';
        targetCtx.fillText(p.label, lx, ly);
    });

    targetCtx.restore();
}

// Карточка сметы клиенту
function exportClientImage() {
    if (!lastCalcData || points.length < 3) {
        showToast('Сначала нажмите «РАССЧИТАТЬ СМЕТУ»!', 'error');
        return;
    }

    const tempCanvas = document.createElement('canvas');
    const pad = 20;
    const headerH = 80;
    const rowH = 32;
    const footerH = lastBreakdownItems.length * rowH + 65;

    tempCanvas.width = Math.max(canvas.width, 540);
    tempCanvas.height = headerH + canvas.height + footerH;
    const tCtx = tempCanvas.getContext('2d');

    const isWhite = (selectedExportTheme === 'light');
    tCtx.fillStyle = isWhite ? '#ffffff' : '#0f172a';
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    tCtx.fillStyle = isWhite ? '#0f172a' : '#ffffff';
    tCtx.font = 'bold 16px Inter, Roboto, sans-serif';
    tCtx.fillText(`📋 Смета — ${lastCalcData.clientName}`, pad, 28);

    tCtx.fillStyle = isWhite ? '#475569' : '#94a3b8';
    tCtx.font = '13px Inter, Roboto, sans-serif';
    tCtx.fillText(`📍 ${lastCalcData.clientAddr}`, pad, 50);

    tCtx.fillStyle = isWhite ? '#059669' : '#10b981';
    tCtx.font = 'bold 13px Inter, Roboto, sans-serif';
    tCtx.fillText(`S = ${lastCalcData.area} м²  |  P = ${lastCalcData.perimeter} м.п.  |  Углов комнаты: ${lastCalcData.roomAngles}`, pad, 70);

    let offsetX = (tempCanvas.width - canvas.width) / 2;
    renderCleanSketchForExport(tCtx, offsetX, headerH, isWhite);

    let startY = headerH + canvas.height + 20;
    lastBreakdownItems.forEach((item, idx) => {
        let y = startY + idx * rowH;
        tCtx.fillStyle = isWhite ? '#1e293b' : '#ffffff';
        tCtx.font = '400 13px Inter, Roboto, sans-serif';
        tCtx.fillText(item.title, pad, y);

        tCtx.fillStyle = isWhite ? '#64748b' : '#94a3b8';
        tCtx.font = '400 11px Inter, Roboto, sans-serif';
        tCtx.fillText(item.sub, pad, y + 13);

        tCtx.fillStyle = isWhite ? '#0f172a' : '#ffffff';
        tCtx.font = '600 13px Inter, Roboto, sans-serif';
        let valW = tCtx.measureText(item.val).width;
        tCtx.fillText(item.val, tempCanvas.width - pad - valW, y + 6);
    });

    let totalY = startY + lastBreakdownItems.length * rowH + 14;
    tCtx.fillStyle = isWhite ? '#f1f5f9' : '#1e293b';
    tCtx.fillRect(pad, totalY - 20, tempCanvas.width - pad * 2, 36);

    tCtx.fillStyle = isWhite ? '#0f172a' : '#ffffff';
    tCtx.font = '600 14px Inter, Roboto, sans-serif';
    tCtx.fillText('ИТОГО К ОПЛАТЕ:', pad + 10, totalY + 3);

    tCtx.fillStyle = isWhite ? '#0f172a' : '#ffffff';
    tCtx.font = '700 16px Inter, Roboto, sans-serif';
    let totW = tCtx.measureText(lastCalcData.totalText).width;
    tCtx.fillText(lastCalcData.totalText, tempCanvas.width - pad - totW - 10, totalY + 3);

    let fileName = `Smeta_${lastCalcData.clientName.replace(/[^\wа-яА-ЯёЁ]/gi, '_')}.png`;
    shareOrDownloadCanvas(tempCanvas, fileName, `Смета — ${lastCalcData.clientName}`);
}

// Карточка раскроя в цех со столбиками для привязок (как у основных стен)
function exportFactoryImage() {
    if (!lastCalcData || points.length < 3) {
        showToast('Сначала нажмите «РАССЧИТАТЬ СМЕТУ»!', 'error');
        return;
    }

    const tempCanvas = document.createElement('canvas');
    const pad = 20;
    const headerH = 92;
    const inCount = lastCalcData.innerElements ? lastCalcData.innerElements.length : 0;
    const wallsRows = Math.ceil(lastCalcData.wallsData.length / 2);
    const diagsRows = Math.ceil(lastCalcData.diags.length / 2);
    
    // Подсчет высоты под двухколоночный список привязок
    let innerExtraH = 0;
    if (inCount > 0) {
        lastCalcData.innerElements.forEach(item => {
            let bindRows = Math.ceil(item.bindingsList.length / 2);
            innerExtraH += 22 + (bindRows * 20) + 10;
        });
        innerExtraH += 20;
    }

    const footerH = (wallsRows + diagsRows) * 22 + innerExtraH + 60;

    tempCanvas.width = Math.max(canvas.width, 540);
    tempCanvas.height = headerH + canvas.height + footerH;
    const tCtx = tempCanvas.getContext('2d');

    const isWhite = (selectedExportTheme === 'light');
    tCtx.fillStyle = isWhite ? '#ffffff' : '#0f172a';
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    tCtx.fillStyle = isWhite ? '#0f172a' : '#ffffff';
    tCtx.font = 'bold 16px Inter, Roboto, sans-serif';
    tCtx.fillText(`🏭 ЗАКАЗ В ЦЕХ (ЛИСТ РАСКРОЯ)`, pad, 26);

    tCtx.fillStyle = isWhite ? '#b91c1c' : '#ef4444';
    tCtx.font = 'bold 12px Inter, Roboto, sans-serif';
    tCtx.fillText(`⚠️ РАЗМЕРЫ БЕЗ УСАДКИ (чистый габарит помещения)!`, pad, 48);

    tCtx.fillStyle = isWhite ? '#475569' : '#cbd5e1';
    tCtx.font = '12px Inter, Roboto, sans-serif';
    tCtx.fillText(`Объект: ${lastCalcData.clientName} | ${lastCalcData.clientAddr}`, pad, 68);

    let inInfo = inCount > 0 ? `  |  Вырезов: ${inCount} шт (углов коробов: ${lastCalcData.countHatchAngles})` : '';
    tCtx.fillText(`S = ${lastCalcData.area} м²  |  P = ${lastCalcData.perimeter} м.п.  |  Углов комнаты: ${lastCalcData.roomAngles}${inInfo}`, pad, 86);

    let offsetX = (tempCanvas.width - canvas.width) / 2;
    renderCleanSketchForExport(tCtx, offsetX, headerH, isWhite);

    let y = headerH + canvas.height + 22;
    tCtx.fillStyle = isWhite ? '#0f172a' : '#ffffff';
    tCtx.font = 'bold 13px Inter, Roboto, sans-serif';
    tCtx.fillText('📏 СТЕНЫ (чистые):', pad, y);
    y += 20;

    tCtx.fillStyle = isWhite ? '#1e293b' : '#ffffff';
    tCtx.font = '12px Inter, Roboto, monospace';
    const col2X = pad + 270;

    lastCalcData.wallsData.forEach((w, i) => {
        let isLeft = (i % 2 === 0);
        let curX = isLeft ? pad : col2X;
        tCtx.fillText(`Стена ${w.name}: ${w.m} м (${w.cm} см)`, curX, y);
        if (!isLeft || i === lastCalcData.wallsData.length - 1) y += 20;
    });

    // Отрисовка привязок в 2 столбика
    if (lastCalcData.innerElements && lastCalcData.innerElements.length > 0) {
        y += 8;
        tCtx.fillStyle = isWhite ? '#0f172a' : '#ffffff';
        tCtx.font = 'bold 13px Inter, Roboto, sans-serif';
        tCtx.fillText('🚪 ВНУТРЕННИЕ ВЫРЕЗЫ И ПРИВЯЗКИ:', pad, y);
        y += 18;

        lastCalcData.innerElements.forEach(item => {
            tCtx.fillStyle = isWhite ? '#0f172a' : '#ffffff';
            tCtx.font = 'bold 12px Inter, Roboto, monospace';
            tCtx.fillText(`• ${item.name} — ${item.perimM} м.п.`, pad, y);
            y += 18;

            tCtx.font = '11.5px Inter, Roboto, monospace';
            tCtx.fillStyle = isWhite ? '#475569' : '#cbd5e1';

            if (item.bindingsList.length === 0) {
                tCtx.fillText(`Привязка: по центру`, pad, y);
                y += 18;
            } else {
                item.bindingsList.forEach((bStr, bIdx) => {
                    let isLeft = (bIdx % 2 === 0);
                    let curX = isLeft ? pad : col2X;
                    tCtx.fillText(`📍 ${bStr}`, curX, y);
                    if (!isLeft || bIdx === item.bindingsList.length - 1) y += 18;
                });
            }
            y += 6;
        });
    }

    if (lastCalcData.diags.length > 0) {
        y += 6;
        tCtx.fillStyle = isWhite ? '#0f172a' : '#ffffff';
        tCtx.font = 'bold 13px Inter, Roboto, sans-serif';
        tCtx.fillText('📐 ДИАГОНАЛИ РАСКРОЯ:', pad, y);
        y += 20;

        tCtx.fillStyle = isWhite ? '#475569' : '#cbd5e1';
        tCtx.font = '12px Inter, Roboto, monospace';
        lastCalcData.diags.forEach((d, i) => {
            let isLeft = (i % 2 === 0);
            let curX = isLeft ? pad : col2X;
            let mark = d.isCustom ? ' *' : '';
            tCtx.fillText(`Диагональ ${d.name}${mark}: ${(d.len / 100).toFixed(2)} м (${d.len} см)`, curX, y);
            if (!isLeft || i === lastCalcData.diags.length - 1) y += 20;
        });
    }

    let fileName = `Raskroy_Ceh_${lastCalcData.clientName.replace(/[^\wа-яА-ЯёЁ]/gi, '_')}.png`;
    shareOrDownloadCanvas(tempCanvas, fileName, `Раскрой в цех — ${lastCalcData.clientName}`);
}

function shareOrDownloadCanvas(cnv, fileName, shareTitle) {
    cnv.toBlob((blob) => {
        if (!blob) {
            showToast('Ошибка создания изображения', 'error');
            return;
        }

        const file = new File([blob], fileName, { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({
                files: [file],
                title: shareTitle,
                text: shareTitle
            }).catch((err) => {
                if (err.name !== 'AbortError') {
                    downloadBlobFile(blob, fileName);
                }
            });
        } else {
            downloadBlobFile(blob, fileName);
        }
    }, 'image/png');
}

function downloadBlobFile(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 1000);
    showToast('Файл сохранён в Загрузки!', 'success');
}

function exportWordDoc(target = 'client') {
    if (!lastCalcData || points.length < 3) {
        showToast('Сначала нажмите «РАССЧИТАТЬ СМЕТУ»!', 'error');
        return;
    }

    // ФИКС: Рендерим чистый белый холст без интерфейса и зума для Word
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.max(canvas.width, 540);
    tempCanvas.height = canvas.height + 40;
    const tCtx = tempCanvas.getContext('2d');
    
    tCtx.fillStyle = '#ffffff';
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    
    let offsetX = (tempCanvas.width - canvas.width) / 2;
    renderCleanSketchForExport(tCtx, offsetX, 20, true);
    
    let sketchDataUrl = tempCanvas.toDataURL('image/png');

    let isClient = target === 'client';
    let docTitle = isClient
        ? `СМЕТА НА МОНТАЖ НАТЯЖНОГО ПОТОЛКА`
        : `ТЕХНИЧЕСКОЕ ЗАДАНИЕ В ЦЕХ (РАСКРОЙ БЕЗ УСАДКИ)`;

    let tableHtml = '';
    if (isClient) {
        tableHtml = `
            <h3>Расчёт стоимости материалов и работ:</h3>
            <table border="1" cellspacing="0" cellpadding="6" style="width:100%; border-collapse:collapse; font-family:Arial;">
                <tr style="background:#f1f5f9;"><th>Наименование</th><th>Объём / Кол-во</th><th>Стоимость</th></tr>
                ${lastBreakdownItems.map(i => `<tr><td>${i.title}</td><td>${i.sub}</td><td><b>${i.val}</b></td></tr>`).join('')}
                <tr style="background:#e2e8f0; font-size:16px;"><td colspan="2"><b>ИТОГО К ОПЛАТЕ:</b></td><td><b>${lastCalcData.totalText}</b></td></tr>
            </table>
        `;
    } else {
        tableHtml = `
            <p style="color:#dc2626; font-weight:bold; font-size:14px;">⚠️ ВНИМАНИЕ: Все размеры указаны БЕЗ УСАДКИ (чистый габарит комнаты)!</p>
            <h3>Таблица чистых длин стен:</h3>
            <table border="1" cellspacing="0" cellpadding="6" style="width:100%; border-collapse:collapse; font-family:Arial;">
                <tr style="background:#f1f5f9;"><th>Стена</th><th>Длина (м)</th></tr>
                ${lastCalcData.wallsData.map(w => `<tr><td>Стена <b>${w.name}</b></td><td><b>${w.m} м</b></td></tr>`).join('')}
            </table>
            ${lastCalcData.innerElements && lastCalcData.innerElements.length > 0 ? `
            <h3>Внутренние вырезы, короба и колонны:</h3>
            <table border="1" cellspacing="0" cellpadding="6" style="width:100%; border-collapse:collapse; font-family:Arial;">
                <tr style="background:#f1f5f9;"><th>Элемент</th><th>Периметр (м.п.)</th><th>Привязки</th></tr>
                ${lastCalcData.innerElements.map(it => `<tr><td><b>${it.name}</b></td><td>${it.perimM} м.п.</td><td>${it.bindingsList.join('<br>')}</td></tr>`).join('')}
            </table>` : ''}
            ${lastCalcData.diags.length > 0 ? `
            <h3>Таблица чистых диагоналей для раскроя:</h3>
            <table border="1" cellspacing="0" cellpadding="6" style="width:100%; border-collapse:collapse; font-family:Arial;">
                <tr style="background:#f1f5f9;"><th>Диагональ</th><th>Длина (м)</th><th>Тип</th></tr>
                ${lastCalcData.diags.map(d => `<tr><td>Диагональ <b>${d.name}</b></td><td><b>${(d.len / 100).toFixed(2)} м</b></td><td>${d.isCustom ? 'Ручной замер' : 'Авто'}</td></tr>`).join('')}
            </table>` : ''}
        `;
    }

    let wordHtml = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>${docTitle}</title></head>
        <body style="font-family: Arial, sans-serif; color: #111;">
            <h2 style="color: #1e293b;">${docTitle}</h2>
            <p><b>Клиент / Объект:</b> ${lastCalcData.clientName}<br>
            <b>Адрес:</b> ${lastCalcData.clientAddr}<br>
            <b>Дата замера:</b> ${new Date().toLocaleDateString()}</p>
            <p><b>Площадь:</b> ${lastCalcData.area} м² &nbsp;|&nbsp; <b>Периметр:</b> ${lastCalcData.perimeter} м.п. &nbsp;|&nbsp; <b>Углов комнаты:</b> ${lastCalcData.roomAngles} шт. ${lastCalcData.countHatchAngles > 0 ? `| <b>Углов коробов:</b> ${lastCalcData.countHatchAngles} шт.` : ''}</p>
            <hr>
            <h3>Чертёж помещения:</h3>
            <p><img src="${sketchDataUrl}" width="420" style="border:1px solid #ccc;"></p>
            ${tableHtml}
        </body>
        </html>
    `;

    let blob = new Blob(['﻿', wordHtml], { type: 'application/msword' });
    let fileName = isClient
        ? `Smeta_${lastCalcData.clientName.replace(/[^\wа-яА-ЯёЁ]/gi, '_')}.doc`
        : `Ceh_Raskroy_${lastCalcData.clientName.replace(/[^\wа-яА-ЯёЁ]/gi, '_')}.doc`;

    if (navigator.canShare) {
        const file = new File([blob], fileName, { type: 'application/msword' });
        if (navigator.canShare({ files: [file] })) {
            navigator.share({
                files: [file],
                title: docTitle
            }).catch(() => downloadBlobFile(blob, fileName));
            return;
        }
    }

    downloadBlobFile(blob, fileName);
}
