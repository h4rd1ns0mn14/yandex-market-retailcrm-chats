const express = require('express');
const config = require('./config');
const retailcrm = require('./retailcrm');
const inbound = require('./services/inbound');
const logger = require('./logger');

const marketWebhookRouter = require('./routes/marketWebhook');
const retailcrmWebhookRouter = require('./routes/retailcrmWebhook');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Логирование запросов
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    query: req.query,
    ip: req.ip,
  });
  next();
});

// Маршруты
app.use('/webhook/market', marketWebhookRouter);
app.use('/webhook/retailcrm', retailcrmWebhookRouter);

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ручной триггер синхронизации
app.post('/sync', async (req, res) => {
  try {
    await inbound.syncPendingChats();
    res.json({ status: 'synced' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Запуск =====
async function start() {
  try {
    // 1. Регистрируем модуль в RetailCRM
    logger.info('Registering integration module in RetailCRM...');
    await retailcrm.registerModule();
    logger.info('Module registered successfully');

    // 2. Запускаем HTTP-сервер
    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Market webhook URL: ${config.baseUrl}/webhook/market`);
      logger.info(`RetailCRM webhook URL: ${config.baseUrl}/webhook/retailcrm`);
    });

    // 3. Первичная синхронизация
    setTimeout(async () => {
      logger.info('Running initial sync...');
      await inbound.syncPendingChats();
    }, 5000);

    // 4. Периодическая синхронизация (каждые 2 минуты)
    setInterval(async () => {
      try {
        await inbound.syncPendingChats();
      } catch (err) {
        logger.error('Periodic sync error', { error: err.message });
      }
    }, 2 * 60 * 1000);

  } catch (err) {
    logger.error('Failed to start', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

start();
