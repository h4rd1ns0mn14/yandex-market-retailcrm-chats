# Deploy на Wispbyte (Node.js)

Этот проект — `Express` сервис без build-шага.

## 1) Подготовка проекта

Локально:

```bash
npm install
npm run start
```

Проверь, что `http://localhost:3000/health` отвечает `{"status":"ok"...}`.

## 2) Создай сервер в Wispbyte

1. В панели Wispbyte создай новый сервер типа `NodeJS` / `Generic Application`.
2. Загрузи файлы проекта (без `.env`, `node_modules`, логов).
3. Startup command укажи:

```bash
npm start
```

4. Runtime: Node.js `18+`.

## 3) Переменные окружения в панели Wispbyte

Добавь ENV переменные:

```env
PORT=3000
BASE_URL=https://<твой-публичный-url>

RETAILCRM_URL=https://rikor.retailcrm.ru
RETAILCRM_API_KEY=<retailcrm_api_key>

YM_OAUTH_TOKEN=<ym_oauth_token>
YM_OAUTH_USER_TOKEN=<ym_oauth_user_token_optional>
YM_BUSINESS_ID=<ym_business_id>
YM_API_BASE=https://api.partner.market.yandex.ru

MG_ENDPOINT_URL=
MG_TOKEN=

MODULE_CODE=yandex-market
MODULE_NAME=Yandex Market Chats
```

Важно:
- `BASE_URL` обязателен, иначе приложение не стартует.
- `MG_ENDPOINT_URL` и `MG_TOKEN` на первом запуске могут быть пустыми, они подтянутся после регистрации модуля в RetailCRM.

## 4) Домен и HTTPS

Для вебхуков Яндекс.Маркета и RetailCRM используй публичный HTTPS URL.

Вебхуки:
- `${BASE_URL}/webhook/market`
- `${BASE_URL}/webhook/retailcrm`

Healthcheck:
- `${BASE_URL}/health`

## 5) Проверка после запуска

1. В логах должно быть:
- `Registering integration module`
- `Module registered successfully`
- `Server running on port ...`

2. Проверка ручкой:

```bash
curl https://<your-domain>/health
```

3. Убедись, что вебхуки в Yandex Market и RetailCRM отдают `200`.

## 6) Важное про хранение состояния

Проект хранит состояние в `data.json` (создаётся автоматически). Не удаляй этот файл между рестартами/деплоями, иначе потеряются сопоставления каналов и сообщений.

## 7) Типовые проблемы

- `BASE_URL is not set`: не добавлена env переменная `BASE_URL`.
- `RETAILCRM_API_KEY is not set`: не задан API ключ RetailCRM.
- Ошибки при файлах: добавь `YM_OAUTH_USER_TOKEN`.

