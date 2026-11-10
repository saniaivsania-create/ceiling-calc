const CACHE_NAME = 'potolok-pro-offline-v88';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './canvas-view.js',
  './calc-export.js',
  './app-core.js',
  './manifest.json'
];

// Установка: скачиваем свежие файлы в память устройства
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Активация: мгновенно стираем все старые версии кэша
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Перехват запросов: Сначала кэш (для мгновенного открытия), затем сеть
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Если файл есть в кэше — отдаем его моментально!
      if (cachedResponse) {
        return cachedResponse;
      }
      // Если файла в кэше нет — идем в интернет
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Если интернета нет и файла нет, отдаем главную страницу
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
