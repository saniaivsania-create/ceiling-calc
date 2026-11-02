// --- ПЕРЕМЕННЫЕ РАСЧЁТА И ЭКСПОРТА ---
let lastEstimateText = '';
let lastFactoryText = '';
let lastBreakdownItems = [];
let lastCalcData = null;
let selectedExportFormat = 'png';

const PRICE_FIELDS = [
    'priceCanvas', 'priceProfile', 'priceInsert', 'priceLight', 'priceChandelier',
    'priceCornice', 'pricePipe', 'priceAngle', 'priceHatch',
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

// --- МАТЕМАТИКА ПЛОЩАДИ (ФОРМУЛА ГАУССА) ---
function calculatePolygonAreaM2() {
    if (points.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];
        sum += (p1.x * p2.y - p2.x * p1.y);
    }
    let pxArea = Math.abs(sum) / 2;
    let cm2Area = pxArea * (cmPerPixel * cmPerPixel);
    return cm2Area / 10000;
}

// --- ВЫЧИСЛЕНИЕ СМЕТЫ И ПОГОНАЖА ---
function performCalculation() {
    if (points.length < 3) {
        showToast('Поставьте минимум 3 точки на чертеже!', 'error');
        if (typeof isTabMode !== 'undefined' && isTabMode) switchTab('sketch');
        return;
    }
    if (!isClosed) {
        isClosed = true;
        if (typeof untanglePolygon === 'function') untanglePolygon();
        rebuildWallInputs();
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
    calculate();
    if (typeof isTabMode !== 'undefined' && isTabMode) switchTab('estimate');
    showToast('Смета успешно рассчитана!', 'success');
}

function calculate() {
    if (typeof syncCurrentRoomState === 'function') syncCurrentRoomState();
    let wallsData = [];
    let roomPerimCm = 0;
    let wallCount = getWallCount();

    for (let i = 0; i < wallCount; i++) {
        let p1 = points[i];
        let p2 = points[(i + 1) % points.length];
        let inp = document.getElementById(`wall-input-${i}`);
        let val = inp ? (parseFloat(inp.value) || 0) : Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) * cmPerPixel);
        roomPerimCm += val;
        wallsData.push({ name: `${p1.label}-${p2.label}`, cm: val });
    }

    let roomPerimeterM = roomPerimCm / 100;
    let grossArea = calculatePolygonAreaM2();

    // 1. Параметры чердачного люка / внутреннего короба
    let cHatch = parseFloat(document.getElementById('countHatch')?.value) || 0;
    let hLen = parseFloat(document.getElementById('hatchLength')?.value) || 120;
    let hWid = parseFloat(document.getElementById('hatchWidth')?.value) || 60;
    let pHatch = parseFloat(document.getElementById('priceHatch')?.value) || 0;
    let isSubArea = document.getElementById('hatchSubtractArea')?.checked ?? true;

    let singleHatchPerimM = (2 * (hLen + hWid)) / 100;
    let totalHatchPerimM = singleHatchPerimM * cHatch;
    let singleHatchAreaM2 = (hLen * hWid) / 10000;
    let totalHatchAreaM2 = singleHatchAreaM2 * cHatch;

    let netArea = grossArea;
    if (cHatch > 0 && isSubArea) {
        netArea = Math.max(0.1, grossArea - totalHatchAreaM2);
    }

    // 2. Базовые прайсы и объёмы
    let pCanvas = parseFloat(document.getElementById('priceCanvas').value) || 0;
    let pProfile = parseFloat(document.getElementById('priceProfile').value) || 0;
    let cInsert = parseFloat(document.getElementById('countInsert').value) || 0;
    let pInsert = parseFloat(document.getElementById('priceInsert').value) || 0;
    let cLights = parseFloat(document.getElementById('countLights').value) || 0;
    let pLight = parseFloat(document.getElementById('priceLight').value) || 0;
    let cChandeliers = parseFloat(document.getElementById('countChandeliers').value) || 0;
    let pChandelier = parseFloat(document.getElementById('priceChandelier').value) || 0;
    let cCornice = parseFloat(document.getElementById('countCornice').value) || 0;
    let pCornice = parseFloat(document.getElementById('priceCornice').value) || 0;
    let cPipes = parseFloat(document.getElementById('countPipes').value) || 0;
    let pPipe = parseFloat(document.getElementById('pricePipe').value) || 0;

    let cLightLines = parseFloat(document.getElementById('countLightLines').value) || 0;
    let pLightLines = parseFloat(document.getElementById('priceLightLines').value) || 0;
    let cTrack = parseFloat(document.getElementById('countTrack').value) || 0;
    let pTrack = parseFloat(document.getElementById('priceTrack').value) || 0;
    let cNiche = parseFloat(document.getElementById('countNiche').value) || 0;
    let pNiche = parseFloat(document.getElementById('priceNiche').value) || 0;
    let cShadow = parseFloat(document.getElementById('countShadow').value) || 0;
    let pShadow = parseFloat(document.getElementById('priceShadow').value) || 0;

    // Углы (комната + по 4 угла на каждый люк)
    let roomAngles = points.length;
    let hatchAngles = cHatch * 4;
    let totalAngles = roomAngles + hatchAngles;
    let extraAngles = totalAngles > 4 ? totalAngles - 4 : 0;
    document.getElementById('countAngles').value = extraAngles;
    let pAngle = parseFloat(document.getElementById('priceAngle').value) || 0;

    let name1 = document.getElementById('customName1').value.trim() || 'Доп. работа 1';
    let custom1 = parseFloat(document.getElementById('customPrice1').value) || 0;
    let name2 = document.getElementById('customName2').value.trim() || 'Доп. работа 2';
    let custom2 = parseFloat(document.getElementById('customPrice2').value) || 0;

    // 3. Подсчёт позиций
    let costCanvas = Math.round(netArea * pCanvas);
    let costProfile = Math.round(roomPerimeterM * pProfile);
    let costInsert = Math.round(cInsert * pInsert);
    let costAngles = Math.round(extraAngles * pAngle);
    let costLights = Math.round(cLights * pLight);
    let costChandelier = Math.round(cChandeliers * pChandelier);
    let costCornice = Math.round(cCornice * pCornice);
    let costPipes = Math.round(cPipes * pPipe);
    let costHatch = Math.round(totalHatchPerimM * pHatch);

    let costLightLines = Math.round(cLightLines * pLightLines);
    let costTrack = Math.round(cTrack * pTrack);
    let costNiche = Math.round(cNiche * pNiche);
    let costShadow = Math.round(cShadow * pShadow);

    let total = costCanvas + costProfile + costInsert + costAngles + costLights + costChandelier + 
                costCornice + costPipes + costHatch + costLightLines + costTrack + costNiche + 
                costShadow + custom1 + custom2;

    rooms[activeRoomIdx].lastTotal = total;
    let currentRoomTitle = rooms[activeRoomIdx].title;
    document.getElementById('activeRoomEstimateTitle').innerText = currentRoomTitle;

    // 4. Формирование детализации для сметы
    lastBreakdownItems = [
        { 
            title: 'Полотно потолка' + (cHatch > 0 && isSubArea ? ' (за вычетом люка)' : ''), 
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

    if (cHatch > 0) {
        lastBreakdownItems.push({ 
            title: `Обход люка (${hLen}×${hWid} см, ${cHatch} шт.)`, 
            sub: `Брус/профиль: ${totalHatchPerimM.toFixed(2)} м.п. × ${pHatch} ₽`, 
            val: `${costHatch.toLocaleString()} ₽` 
        });
    }

    lastBreakdownItems.push({ 
        title: `Углы (всего: ${totalAngles} шт.` + (hatchAngles > 0 ? `, из них люк: ${hatchAngles}` : '') + `)`, 
        sub: `Доп. углы (>4): ${extraAngles} шт. × ${pAngle} ₽`, 
        val: `${costAngles.toLocaleString()} ₽` 
    });

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

    let allRoomsSum = rooms.reduce((acc, r) => acc + (r.lastTotal || 0), 0);
    const allRoomsRow = document.getElementById('allRoomsTotalRow');
    if (rooms.length > 1) {
        allRoomsRow.style.display = 'flex';
        document.getElementById('resAllRoomsTotal').innerText = Math.round(allRoomsSum).toLocaleString() + ' ₽';
    } else {
        allRoomsRow.style.display = 'none';
    }

    let clientName = document.getElementById('clientName').value || 'Заказчик';
    let clientAddr = document.getElementById('clientAddress').value || 'Не указан';
    let clientPhone = document.getElementById('clientPhone').value || '';
    let clientDate = document.getElementById('clientDate').value || '';
    let diags = getCleanDiagonals();

    lastCalcData = {
        clientName: `${clientName} (${currentRoomTitle})`,
        clientAddr,
        clientPhone,
        clientDate,
        area: netArea.toFixed(2),
        grossArea: grossArea.toFixed(2),
        perimeter: roomPerimeterM.toFixed(2),
        totalAngles,
        hatchCount: cHatch,
        hatchSize: `${hLen}×${hWid}`,
        hatchPerimM: totalHatchPerimM.toFixed(2),
        wallsData,
        diags,
        totalText: Math.round(total).toLocaleString() + ' ₽'
    };

    // 5. Формирование текстов для отправки
    lastEstimateText =
        `📋 СМЕТА НА НАТЯЖНОЙ ПОТОЛОК (${currentRoomTitle})\n` +
        `👤 Клиент: ${clientName} ${clientPhone ? '('+clientPhone+')' : ''}\n` +
        `📍 Адрес: ${clientAddr}\n` +
        (clientDate ? `📅 Дата: ${clientDate}\n` : '') +
        `──────────────────\n` +
        `🔹 Площадь потолка: ${netArea.toFixed(2)} м² (${costCanvas} ₽)\n` +
        `🔹 Профиль (багет): ${roomPerimeterM.toFixed(2)} м.п. (${costProfile} ₽)\n` +
        (cInsert > 0 ? `🔹 Вставка: ${cInsert} м.п. (${costInsert} ₽)\n` : '') +
        (cHatch > 0 ? `🔹 Обход люка (${hLen}×${hWid} см): ${totalHatchPerimM.toFixed(2)} м.п. (${costHatch} ₽)\n` : '') +
        `🔹 Углы (${totalAngles} шт): ${costAngles} ₽\n` +
        (cLights > 0 ? `🔹 Светильники (${cLights} шт): ${costLights} ₽\n` : '') +
        (cChandeliers > 0 ? `🔹 Люстра (${cChandeliers} шт): ${costChandelier} ₽\n` : '') +
        (cCornice > 0 ? `🔹 Карниз (${cCornice} м.п.): ${costCornice} ₽\n` : '') +
        (cPipes > 0 ? `🔹 Обход труб (${cPipes} шт): ${costPipes} ₽\n` : '') +
        (cLightLines > 0 ? `🔹 Световые линии (${cLightLines} м.п.): ${costLightLines} ₽\n` : '') +
        (cTrack > 0 ? `🔹 Трековая система (${cTrack} м.п.): ${costTrack} ₽\n` : '') +
        (cNiche > 0 ? `🔹 Скрытая ниша ПК-5 (${cNiche} м.п.): ${costNiche} ₽\n` : '') +
        (cShadow > 0 ? `🔹 Теневой/Парящий (${cShadow} м.п.): ${costShadow} ₽\n` : '') +
        (custom1 > 0 ? `🔹 ${name1}: ${custom1} ₽\n` : '') +
        (custom2 > 0 ? `🔹 ${name2}: ${custom2} ₽\n` : '') +
        `──────────────────\n` +
        `💰 ИТОГО К ОПЛАТЕ: ${Math.round(total).toLocaleString()} ₽` +
        (rooms.length > 1 ? `\n🏢 ВСЕ КОМНАТЫ ЗАКАЗА: ${Math.round(allRoomsSum).toLocaleString()} ₽` : '');

    lastFactoryText =
        `🏭 ЗАКАЗ В ЦЕХ НА РАСКРОЙ ПОЛОТНА\n` +
        `📍 Объект: ${clientName} — ${currentRoomTitle} (${clientAddr})\n` +
        `──────────────────\n` +
        `📐 Площадь: ${netArea.toFixed(2)} м² | Периметр: ${roomPerimeterM.toFixed(2)} м.п. | Углов: ${totalAngles} шт.\n` +
        (cHatch > 0 ? `🚪 Внутренний люк: ${hLen}×${hWid} см (${cHatch} шт.), периметр: ${totalHatchPerimM.toFixed(2)} м.п.\n` : '') +
        `📏 СТЕНЫ (см):\n` +
        wallsData.map(w => `  • Стена ${w.name}: ${w.cm} см`).join('\n') + `\n` +
        (diags.length > 0 ? `📐 ДИАГОНАЛИ (см):\n` + diags.map(d => `  • Диагональ ${d.name}: ${d.len} см`).join('\n') : '');
}

// --- УПРАВЛЕНИЕ ЭКСПОРТОМ И ШТОРКОЙ ---
function selectExportFormat(fmt) {
    selectedExportFormat = fmt;
    document.getElementById('fmtTabPng').classList.toggle('active', fmt === 'png');
    document.getElementById('fmtTabDoc').classList.toggle('active', fmt === 'doc');
}

function openExportSheet() {
    if (!lastCalcData || points.length < 3) {
        showToast('Сначала начертите комнату и нажмите «РАССЧИТАТЬ СМЕТУ»!', 'error');
        return;
    }
    document.getElementById('exportSheetOverlay').classList.add('open');
}

function closeExportSheet() {
    document.getElementById('exportSheetOverlay').classList.remove('open');
}

function triggerCombinedShare(target) {
    closeExportSheet();
    if (selectedExportFormat === 'png') {
        if (target === 'client') exportClientImage();
        else exportFactoryImage();
    } else {
        exportWordDoc(target);
    }
}

// --- ЭКСПОРТ В PNG КЛИЕНТУ И В ЦЕХ ---
async function exportClientImage() {
    if (!lastCalcData || points.length < 3) {
        showToast('Сначала нажмите «РАССЧИТАТЬ СМЕТУ»!', 'error');
        return;
    }

    const tempCanvas = document.createElement('canvas');
    const pad = 18;
    const headerH = 78;
    const rowH = 36;
    const footerH = lastBreakdownItems.length * rowH + 70;

    tempCanvas.width = Math.max(canvas.width, 380);
    tempCanvas.height = headerH + canvas.height + footerH;
    const tCtx = tempCanvas.getContext('2d');

    const isLight = document.body.classList.contains('light-theme');
    const bgExport = isLight ? '#ffffff' : '#0f172a';
    const textMainExport = isLight ? '#0f172a' : '#ffffff';
    const textMutedExport = isLight ? '#64748b' : '#94a3b8';

    tCtx.fillStyle = bgExport;
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    tCtx.fillStyle = textMainExport;
    tCtx.font = 'bold 16px Inter, Roboto, sans-serif';
    tCtx.fillText(`📋 Смета и чертёж — ${lastCalcData.clientName}`, pad, 28);

    tCtx.fillStyle = textMutedExport;
    tCtx.font = '13px Inter, Roboto, sans-serif';
    tCtx.fillText(`📍 Адрес: ${lastCalcData.clientAddr}`, pad, 50);

    tCtx.fillStyle = '#059669';
    tCtx.font = 'bold 14px Inter, Roboto, sans-serif';
    tCtx.fillText(`Площадь: ${lastCalcData.area} м² | Периметр: ${lastCalcData.perimeter} м.п.`, pad, 70);

    let offsetX = (tempCanvas.width - canvas.width) / 2;
    tCtx.drawImage(canvas, offsetX, headerH);

    let startY = headerH + canvas.height + 24;
    lastBreakdownItems.forEach((item, idx) => {
        let y = startY + idx * rowH;
        tCtx.fillStyle = textMainExport;
        tCtx.font = '400 13px Inter, Roboto, sans-serif';
        tCtx.fillText(item.title, pad, y);

        tCtx.fillStyle = textMutedExport;
        tCtx.font = '400 11px Inter, Roboto, sans-serif';
        tCtx.fillText(item.sub, pad, y + 15);

        tCtx.fillStyle = textMainExport;
        tCtx.font = '600 13px Inter, Roboto, sans-serif';
        let valW = tCtx.measureText(item.val).width;
        tCtx.fillText(item.val, tempCanvas.width - pad - valW, y + 8);
    });

    let totalY = startY + lastBreakdownItems.length * rowH + 16;
    tCtx.fillStyle = isLight ? '#f1f5f9' : '#1e293b';
    tCtx.fillRect(pad, totalY - 22, tempCanvas.width - pad * 2, 38);

    tCtx.fillStyle = textMainExport;
    tCtx.font = '600 15px Inter, Roboto, sans-serif';
    tCtx.fillText('ИТОГО К ОПЛАТЕ:', pad + 10, totalY + 2);

    tCtx.fillStyle = textMainExport;
    tCtx.font = '700 18px Inter, Roboto, sans-serif';
    let totW = tCtx.measureText(lastCalcData.totalText).width;
    tCtx.fillText(lastCalcData.totalText, tempCanvas.width - pad - totW - 10, totalY + 2);

    shareOrDownloadBlob(tempCanvas, `Smeta_${lastCalcData.clientName}.png`, lastEstimateText);
}

async function exportFactoryImage() {
    if (!lastCalcData || points.length < 3) {
        showToast('Сначала нажмите «РАССЧИТАТЬ СМЕТУ»!', 'error');
        return;
    }

    const tempCanvas = document.createElement('canvas');
    const pad = 18;
    const headerH = 78;
    const linesCount = Math.ceil(lastCalcData.wallsData.length / 2) + Math.ceil(lastCalcData.diags.length / 2) + (lastCalcData.hatchCount > 0 ? 5 : 3);
    const footerH = linesCount * 24 + 45;

    tempCanvas.width = Math.max(canvas.width, 380);
    tempCanvas.height = headerH + canvas.height + footerH;
    const tCtx = tempCanvas.getContext('2d');

    const isLight = document.body.classList.contains('light-theme');
    const bgExport = isLight ? '#ffffff' : '#0f172a';
    const textMainExport = isLight ? '#0f172a' : '#ffffff';
    const textMutedExport = isLight ? '#475569' : '#cbd5e1';

    tCtx.fillStyle = bgExport;
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    tCtx.fillStyle = textMainExport;
    tCtx.font = 'bold 16px Inter, Roboto, sans-serif';
    tCtx.fillText(`🏭 ЗАКАЗ В ЦЕХ (ЛИСТ РАСКРОЯ)`, pad, 28);

    tCtx.fillStyle = textMainExport;
    tCtx.font = '13px Inter, Roboto, sans-serif';
    tCtx.fillText(`Объект: ${lastCalcData.clientName} (${lastCalcData.clientAddr})`, pad, 50);

    tCtx.fillStyle = textMutedExport;
    tCtx.font = 'bold 13px Inter, Roboto, sans-serif';
    let hatchInfo = lastCalcData.hatchCount > 0 ? `  |  Люк: ${lastCalcData.hatchSize} см (${lastCalcData.hatchCount} шт)` : '';
    tCtx.fillText(`S = ${lastCalcData.area} м²  |  P = ${lastCalcData.perimeter} м.п.  |  Углов: ${lastCalcData.totalAngles}${hatchInfo}`, pad, 70);

    let offsetX = (tempCanvas.width - canvas.width) / 2;
    tCtx.drawImage(canvas, offsetX, headerH);

    let y = headerH + canvas.height + 24;
    tCtx.fillStyle = textMainExport;
    tCtx.font = 'bold 13px Inter, Roboto, sans-serif';
    tCtx.fillText('📏 ДЛИНЫ СТЕН (см):', pad, y);
    y += 22;

    tCtx.fillStyle = textMainExport;
    tCtx.font = '12px Inter, Roboto, monospace';
    lastCalcData.wallsData.forEach((w, i) => {
        let colX = (i % 2 === 0) ? pad : tempCanvas.width / 2;
        tCtx.fillText(`Стена ${w.name}: ${w.cm} см`, colX, y);
        if (i % 2 === 1 || i === lastCalcData.wallsData.length - 1) y += 22;
    });

    if (lastCalcData.diags.length > 0) {
        y += 8;
        tCtx.fillStyle = textMainExport;
        tCtx.font = 'bold 13px Inter, Roboto, sans-serif';
        tCtx.fillText('📐 ДИАГОНАЛИ РАСКРОЯ (см):', pad, y);
        y += 22;

        tCtx.fillStyle = textMutedExport;
        tCtx.font = '12px Inter, Roboto, monospace';
        lastCalcData.diags.forEach((d, i) => {
            let colX = (i % 2 === 0) ? pad : tempCanvas.width / 2;
            tCtx.fillText(`Диагональ ${d.name}: ${d.len} см`, colX, y);
            if (i % 2 === 1 || i === lastCalcData.diags.length - 1) y += 22;
        });
    }

    shareOrDownloadBlob(tempCanvas, `Raskroy_Ceh_${lastCalcData.clientName}.png`, lastFactoryText);
}

// --- ЭКСПОРТ В WORD (.DOC) И БЕЗОПАСНАЯ ОТПРАВКА ---
function shareOrDownloadBlob(tempCanvas, fileName, shareText) {
    tempCanvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], fileName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ title: fileName, text: shareText, files: [file] });
                return;
            } catch (err) {}
        }
        const link = document.createElement('a');
        link.download = fileName;
        const objUrl = URL.createObjectURL(blob);
        link.href = objUrl;
        link.click();
        setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    }, 'image/png');
}

async function exportWordDoc(target = 'client') {
    if (!lastCalcData || points.length < 3) {
        showToast('Сначала нажмите «РАССЧИТАТЬ СМЕТУ»!', 'error');
        return;
    }

    let sketchDataUrl = canvas.toDataURL('image/png');
    let isClient = target === 'client';
    let docTitle = isClient
        ? `СМЕТА НА МОНТАЖ НАТЯЖНОГО ПОТОЛКА`
        : `ТЕХНИЧЕСКОЕ ЗАДАНИЕ В ЦЕХ (РАСКРОЙ ПОЛОТНА)`;

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
            <h3>Таблица длин стен (см):</h3>
            <table border="1" cellspacing="0" cellpadding="6" style="width:100%; border-collapse:collapse; font-family:Arial;">
                <tr style="background:#f1f5f9;"><th>Стена</th><th>Длина (см)</th></tr>
                ${lastCalcData.wallsData.map(w => `<tr><td>Стена <b>${w.name}</b></td><td><b>${w.cm} см</b></td></tr>`).join('')}
            </table>
            ${lastCalcData.hatchCount > 0 ? `
            <p><b>Внутренний люк / короб:</b> ${lastCalcData.hatchSize} см (${lastCalcData.hatchCount} шт.), периметр: ${lastCalcData.hatchPerimM} м.п.</p>
            ` : ''}
            ${lastCalcData.diags.length > 0 ? `
            <h3>Таблица диагоналей для раскроя (см):</h3>
            <table border="1" cellspacing="0" cellpadding="6" style="width:100%; border-collapse:collapse; font-family:Arial;">
                <tr style="background:#f1f5f9;"><th>Диагональ</th><th>Длина (см)</th></tr>
                ${lastCalcData.diags.map(d => `<tr><td>Диагональ <b>${d.name}</b></td><td><b>${d.len} см</b></td></tr>`).join('')}
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
            <p><b>Площадь потолка:</b> ${lastCalcData.area} м² &nbsp;|&nbsp; <b>Периметр:</b> ${lastCalcData.perimeter} м.п. &nbsp;|&nbsp; <b>Углов:</b> ${lastCalcData.totalAngles} шт.</p>
            <hr>
            <h3>Чертёж помещения:</h3>
            <p><img src="${sketchDataUrl}" width="420"></p>
            ${tableHtml}
        </body>
        </html>
    `;

    let blob = new Blob(['\ufeff', wordHtml], { type: 'application/msword' });
    let fileName = isClient
        ? `Smeta_${lastCalcData.clientName.replace(/\s+/g, '_')}.doc`
        : `Ceh_Raskroy_${lastCalcData.clientName.replace(/\s+/g, '_')}.doc`;

    let file = new File([blob], fileName, { type: 'application/msword' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
                title: fileName,
                text: isClient ? lastEstimateText : lastFactoryText,
                files: [file]
            });
            return;
        } catch (e) {}
    }

    let link = document.createElement('a');
    const objUrl = URL.createObjectURL(blob);
    link.href = objUrl;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
}
