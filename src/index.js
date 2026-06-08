const express = require('express');
const config = require('./config');
const retailcrm = require('./retailcrm');
const inbound = require('./services/inbound');
const ym = require('./yandex-market');
const storage = require('./storage');
const logger = require('./logger');

const marketWebhookRouter = require('./routes/marketWebhook');
const retailcrmWebhookRouter = require('./routes/retailcrmWebhook');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Логирование запросов (кроме health)
app.use((req, res, next) => {
  if (req.path !== '/health') {
    logger.info(`${req.method} ${req.path}`);
  }
  next();
});

// Маршруты
app.use('/webhook/market', marketWebhookRouter);
app.use('/webhook/retailcrm', retailcrmWebhookRouter);

// Прокси для файлов Яндекс.Маркета (требуют авторизации)
app.get('/files/:fileId', async (req, res) => {
  try {
    const fileUrl = Buffer.from(req.params.fileId, 'base64url').toString('utf-8');
    logger.info('Proxying file', { fileUrl: fileUrl.substring(0, 100) });
    const { buffer, contentType } = await ym.downloadFile(fileUrl);
    res.set('Content-Type', contentType);
    res.send(buffer);
  } catch (err) {
    logger.error('File proxy error', { error: err.message });
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ручной триггер синхронизации
app.post('/sync', async (req, res) => {
  try {
    await inbound.syncChats();
    res.json({ status: 'synced' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Тестовая отправка сообщения в Маркет (для отладки outbound)
app.post('/test-send', async (req, res) => {
  try {
    const { chatId, message } = req.body;
    if (!chatId || !message) {
      return res.status(400).json({ error: 'chatId and message required' });
    }
    const result = await ym.sendMessage(parseInt(chatId, 10), message);
    res.json({ status: 'sent', result });
  } catch (err) {
    res.status(500).json({ error: err.message, response: err.response?.data });
  }
});

// ===== Запуск =====
async function start() {
  try {
    logger.info('Registering integration module in RetailCRM...');
    await retailcrm.registerModule();
    logger.info('Module registered successfully');

    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Webhook URLs: ${config.baseUrl}/webhook/market | ${config.baseUrl}/webhook/retailcrm`);
    });

    // Обновляем настройки существующих каналов (file/image support)
    setTimeout(async () => {
      try {
        const channels = Array.from(
          new Map(storage.getAllChannels().map(ch => [ch.mg_channel_id, ch])).values()
        );
        for (const ch of channels) {
          try {
            await retailcrm.updateChannel(ch.mg_channel_id, {
              settings: {
                text: { creating: 'both', editing: 'receive', quoting: 'receive', deleting: 'receive' },
                file: { creating: 'both', max_files_count: 10 },
                image: { creating: 'both', max_files_count: 10 },
              },
            });
            logger.info('Channel settings updated', { mgChannelId: ch.mg_channel_id });
          } catch (e) {
            logger.error('Channel settings update failed', {
              mgChannelId: ch.mg_channel_id,
              status: e.response?.status,
              response: e.response?.data,
              error: e.message,
            });
          }
        }
        logger.info('Channels updated with file support');
      } catch (e) { /* ignore */ }

      logger.info('Running initial sync...');
      await inbound.syncChats();
    }, 3000);

    // Инкрементальная синхронизация каждые 15 секунд
    setInterval(async () => {
      try {
        await inbound.syncChats();
      } catch (err) {
        logger.error('Periodic sync error', { error: err.message });
      }
    }, 15 * 1000);

  } catch (err) {
    logger.error('Failed to start', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

start();
