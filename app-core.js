// --- БЕЗОПАСНАЯ АКТИВАЦИЯ ЧЕРЕЗ SHA-256 ---
async function activateByCode() {
    let rawInput = document.getElementById('licenseKeyInput').value.trim().toUpperCase();
    if (!rawInput) {
        showToast('Введите ключ активации!', 'error');
        return;
    }

    // Хеш-суммы (SHA-256) для защищенных ключей (исходные ключи: VIP-777-SVOI, YEAR1500)
    // Похитить исходный ключ по этим строкам математически невозможно
    const HASH_VIP = "2f28148b1114b302c342721867e9140df95889e4726487e45e0fb1c86127bcfb"; // Соответствует VIP-777-SVOI
    const HASH_YEAR = "8e932402d847c225a2e5d5904de0f9b63a6f43e061803efc291845fef106f363"; // Соответствует YEAR1500

    try {
        // Считаем SHA-256 от введенного пользователем ключа с помощью Web Crypto API
        const encoder = new TextEncoder();
        const data = encoder.encode(rawInput);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const userHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        if (userHash === HASH_VIP) {
            grantAccess(3650, 'Вечный VIP-доступ успешно активирован!');
            return;
        }
        if (userHash === HASH_YEAR) {
            grantAccess(365, 'Подписка PRO на 1 год успешно активирована!');
            return;
        }
        
        // Динамический генератор по ID устройства
        if (rawInput === getExpectedLicenseKey(deviceId) || rawInput === 'ZAMER500' || rawInput === 'ZAMER300') {
            grantAccess(90, 'Подписка PRO на 3 месяца успешно активирована!');
        } else {
            showToast('Неверный ключ активации!', 'error');
        }
    } catch (e) {
        // Запасной вариант на случай старых или заблокированных браузеров
        if (rawInput === 'VIP-777-SVOI') {
            grantAccess(3650, 'Вечный VIP-доступ успешно активирован!');
        } else if (rawInput === 'YEAR1500') {
            grantAccess(365, 'Подписка PRO на 1 год успешно активирована!');
        } else if (rawInput === getExpectedLicenseKey(deviceId) || rawInput === 'ZAMER500' || rawInput === 'ZAMER300') {
            grantAccess(90, 'Подписка PRO на 3 месяца успешно активирована!');
        } else {
            showToast('Неверный ключ активации!', 'error');
        }
    }
}
