# StreamLive WebApp 1.4.3 · Liquid Glass (build 143)

## Установка
1. Распакуй ZIP в **корень** сайта (рядом с `includes/`).
2. Должны появиться `/webapp/`, `/assets/webapp/`, `/api/native_*.php`.
3. Проверка: `https://сайт/webapp/verify.php`
4. Приложение: `https://сайт/webapp/?v=143`

## Обновление с build 142
Перезапиши файлы из ZIP. Открой `/webapp/?v=143` в инкогнито или сбрось Service Worker (Настройки → 7 тапов по версии → разработчик → сброс SW).

## Важно
- Аккаунт общий с сайтом. Гостевого входа нет.
- Если API отдаёт «Проверка браузера» — исключи `/webapp/api/` из anti-bot (см. ВАЖНО_403_API.txt).
