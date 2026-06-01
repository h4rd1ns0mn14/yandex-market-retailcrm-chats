const express = require('express');
const router = express.Router();
const inbound = require('../services/inbound');
const ym = require('../yandex-market');
const config = require('../config');
const logger = require('../logger');

function successResponse(time) {
  return {
    version: '1.0.0',
    name: config.module.name,
    time: time || new Date().toISOString(),
  };
}

/**
 * POST /webhook/market
 * Яндекс.Маркет присылает уведомления о чатах
 */
router.post(['/', '/notification'], async (req, res) => {
  try {
    const body = req.body;
    logger.info('Market webhook received', { type: body?.notificationType || body?.type });

    // Обработка PING от Яндекс.Маркета
    if (body?.notificationType === 'PING' || body?.type === 'PING') {
      logger.info('PING received, responding OK');
      return res.json(successResponse(body.time));
    }

    const notificationType = body.notificationType || body.type;

    switch (notificationType) {
      case 'CHAT_CREATED': {
        const { chatId } = body;
        const chat = await ym.getChat(chatId);
        const chatType = chat.context?.type || chat.type || null;
        const orderId = chat.context?.orderId || chat.orderId || null;
        await inbound.handleNewChat(chatId, chatType, orderId);
        break;
      }

      case 'CHAT_MESSAGE_SENT':
      case 'NEW_MESSAGE': {
        const chatId = body.chatId;
        const messageId = body.messageId || body.message?.messageId;
        const message = await ym.getChatMessage(chatId, messageId);
        const messageData = {
          messageId: message.messageId || messageId,
          message: message.message,
          sender: message.sender,
          createdAt: message.createdAt || body.sentAt,
          payload: message.payload || [],
        };
        await inbound.handleNewMessage(chatId, messageData);
        break;
      }

      default:
        logger.info('Unknown Market notification type', { notificationType });
    }

    res.json(successResponse(body.time || body.createdAt || body.sentAt));
  } catch (err) {
    logger.error('Error processing Market webhook', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
