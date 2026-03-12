const express = require('express');
const router = express.Router();
const outbound = require('../services/outbound');
const logger = require('../logger');

/**
 * POST /webhook/retailcrm
 * Message Gateway присылает события о сообщениях операторов
 */
router.post('/', async (req, res) => {
  try {
    logger.info('RetailCRM webhook raw body', { body: JSON.stringify(req.body).substring(0, 1000) });

    const events = Array.isArray(req.body) ? req.body : [req.body];

    logger.info(`RetailCRM MG webhook: ${events.length} event(s)`);

    for (const event of events) {
      try {
        await outbound.handleMgWebhook(event);
      } catch (err) {
        logger.error('Error processing MG event', {
          type: event.type,
          error: err.message,
        });
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    logger.error('Error processing RetailCRM webhook', { error: err.message });
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET для проверки доступности (MG может пинговать)
router.get('/', (req, res) => {
  logger.info('RetailCRM webhook GET ping');
  res.json({ status: 'ok' });
});

module.exports = router;
