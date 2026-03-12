const ym = require('../yandex-market');
const storage = require('../storage');
const logger = require('../logger');

const outbound = {
  async handleMgWebhook(event) {
    const eventType = event.type || event.Type;
    logger.info('MG Webhook', { type: eventType });

    switch (eventType) {
      case 'message_sent': {
        let msgData = event.data || event.Data || event;
        if (typeof msgData === 'string') {
          msgData = JSON.parse(msgData);
        }
        await this.handleMessageSent(msgData);
        break;
      }
      case 'message_updated':
      case 'message_deleted':
      case 'message_read':
        break;
      default:
        logger.info('Unknown MG event', { type: eventType });
    }
  },

  async handleMessageSent(data) {
    // MG webhook format:
    // data.content = текст сообщения
    // data.type = "text" / "file" / "image"
    // data.external_chat_id = "ym-chat-XXXXX"
    // data.channel_id = number
    // data.user = {id, first_name, last_name} — оператор
    // data.customer = {first_name, last_name} — покупатель
    // data.id = message id in MG

    const externalChatId = data.external_chat_id;
    const content = data.content;
    const msgType = data.type || 'text';
    const user = data.user; // оператор

    logger.info('MG message_sent', { externalChatId, content: content?.substring(0, 50), type: msgType, user: user?.first_name });

    if (!content || !externalChatId) {
      logger.warn('Missing content or external_chat_id', { externalChatId, hasContent: !!content });
      return;
    }

    // Если нет user — значит сообщение не от оператора (возможно наше входящее)
    if (!user) {
      logger.info('No user in webhook, likely our own message, skipping');
      return;
    }

    // Ищем канал
    const channel = storage.getChannelByMgExternalId(externalChatId);
    if (!channel) {
      logger.error('Channel not found', { externalChatId });
      return;
    }

    const marketChatId = parseInt(channel.market_chat_id, 10);

    try {
      if (msgType === 'text' && content) {
        const result = await ym.sendMessage(marketChatId, content);
        logger.info('Message sent to Market', { marketChatId, text: content.substring(0, 50) });

        const ymMessageId = result.messageId || result.result?.messageId;
        if (ymMessageId) {
          storage.saveMessage({
            marketMessageId: String(ymMessageId),
            mgMessageId: String(data.id || 0),
            marketChatId: String(marketChatId),
            direction: 'outbound',
          });
        }
      } else {
        logger.warn('Non-text message from CRM, skipping', { type: msgType });
      }
    } catch (err) {
      logger.error('Error sending to Market', {
        marketChatId,
        error: err.message,
        response: err.response?.data,
      });
    }
  },
};

module.exports = outbound;
