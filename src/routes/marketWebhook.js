const express = require('express');
const router = express.Router();
const inbound = require('../services/inbound');
const logger = require('../logger');

/**
 * POST /webhook/market
 * Яндекс.Маркет присылает уведомления о чатах
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    logger.info('Market webhook received', { type: body?.notificationType || body?.type });

    // Обработка PING от Яндекс.Маркета
    if (body?.notificationType === 'PING' || body?.type === 'PING') {
      logger.info('PING received, responding OK');
      return res.json({ status: 'ok' });
    }

    const notificationType = body.notificationType || body.type;

    switch (notificationType) {
      case 'CHAT_CREATED': {
        const { chatId, type: chatType, order } = body;
        const orderId = order?.orderId || body.orderId || null;
        await inbound.handleNewChat(chatId, chatType, orderId);
        break;
      }

      case 'CHAT_MESSAGE_SENT':
      case 'NEW_MESSAGE': {
        const chatId = body.chatId;
        const messageData = {
          messageId: body.messageId || body.message?.messageId,
          message: body.message?.text || body.text || body.message?.message,
          sender: body.sender || body.message?.sender,
          createdAt: body.createdAt || body.message?.createdAt,
          payload: body.payload || body.message?.payload,
        };
        await inbound.handleNewMessage(chatId, messageData);
        break;
      }

      default:
        logger.info('Unknown Market notification type', { notificationType });
    }

    res.json({ status: 'ok' });
  } catch (err) {
    logger.error('Error processing Market webhook', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
