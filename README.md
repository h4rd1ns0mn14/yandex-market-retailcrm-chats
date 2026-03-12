# Yandex Market Chats ↔ RetailCRM Integration

Модуль интеграции чатов Яндекс.Маркета с RetailCRM через Message Gateway Transport API.

## Структура проекта

```
yandex-market-chats/
├── package.json
├── .env.example
├── src/
│   ├── index.js              # Точка входа
│   ├── config.js             # Конфигурация
│   ├── logger.js             # Логирование
│   ├── storage.js            # SQLite хранилище
│   ├── yandex-market.js      # Яндекс.Маркет API клиент
│   ├── retailcrm.js          # RetailCRM API клиент
│   ├── routes/
│   │   ├── marketWebhook.js      # Вебхук от Маркета
│   │   └── retailcrmWebhook.js   # Вебхук от RetailCRM
│   └── services/
│       ├── inbound.js        # Обработка входящих (Маркет → CRM)
│       └── outbound.js       # Обработка исходящих (CRM → Маркет)
```

## Установка

```bash
npm install
```

## Настройка

1. Скопируйте `.env.example` в `.env`:
   ```bash
   cp .env.example .env
   ```

2. Заполните переменные окружения:
   - `BASE_URL` — публичный URL вашего сервера
   - `RETAILCRM_API_KEY` — API-ключ RetailCRM
   - `YM_OAUTH_TOKEN` — OAuth-токен Яндекс.Маркета
   - `YM_BUSINESS_ID` — ID бизнеса в Яндекс.Маркете

## Запуск

```bash
# Продакшен
npm start

# Разработка (с авто-перезагрузкой)
npm run dev
```

## Вебхуки

- **Яндекс.Маркет:** `POST /webhook/market`
- **RetailCRM MG:** `POST /webhook/retailcrm`
- **Healthcheck:** `GET /health`
- **Ручная синхронизация:** `POST /sync`

## Деплой

### Railway

1. Создайте репозиторий на GitHub
2. Подключите Railway к репозиторию
3. Добавьте переменные окружения в Railway Dashboard
4. Деплой автоматический

### Render

1. Создайте новый Web Service
2. Подключите GitHub репозиторий
3. Укажите переменные окружения
4. Deploy

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `PORT` | Порт сервера (по умолчанию 3000) |
| `BASE_URL` | Публичный URL для вебхуков |
| `RETAILCRM_URL` | URL RetailCRM (https://rikor.retailcrm.ru) |
| `RETAILCRM_API_KEY` | API-ключ RetailCRM |
| `YM_OAUTH_TOKEN` | OAuth-токен Яндекс.Маркета |
| `YM_BUSINESS_ID` | ID бизнеса в Яндекс.Маркете |
| `YM_API_BASE` | Базовый URL API Маркета |
| `MODULE_CODE` | Код модуля (yandex-market) |
| `MODULE_NAME` | Название модуля |

## Лицензия

MIT
