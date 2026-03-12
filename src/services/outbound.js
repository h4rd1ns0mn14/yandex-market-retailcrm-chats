const ym = require('../yandex-market');
const storage = require('../storage');
const logger = require('../logger');

const outbound = {
  /**
   * Обработка webhook от Message Gateway (сообщение от оператора)
   */
  async handleMgWebhook(event) {
    logger.info('MG Webhook received', { type: event.type });

    switch (event.type) {
      case 'message_sent':
        await this.handleMessageSent(event.data);
        break;

      case 'message_updated':
        logger.info('Message update not supported by Market API, skipping');
        break;

      case 'message_deleted':
        logger.info('Message deletion not supported by Market API, skipping');
        break;

      case 'message_read':
        logger.info('Message read event, skipping');
        break;

      default:
        logger.info('Unknown MG event type', { type: event.type });
    }
  },

  /**
   * Отправить сообщение оператора в Маркет
   */
  async handleMessageSent(data) {
    const { channel_id, external_chat_id, message } = data;

    if (!message || !external_chat_id) {
      logger.warn('Missing message or external_chat_id in MG webhook');
      return;
    }

    // Ищем канал по external_id
    const channel = storage.getChannelByMgExternalId(external_chat_id);

    if (!channel) {
      logger.error('Channel not found for external_chat_id', { external_chat_id });
      return;
    }

    const marketChatId = parseInt(channel.market_chat_id, 10);

    // Дедупликация: проверяем, не пришло ли это сообщение из Маркета
    if (message.external_id && message.external_id.startsWith('ym-msg-')) {
      logger.info('Message originated from Market, skipping outbound', {
        externalId: message.external_id,
      });
      return;
    }

    try {
      if (message.type === 'text' && message.text) {
        const result = await ym.sendMessage(marketChatId, message.text);

        logger.info('Message sent to Market', {
          marketChatId,
          text: message.text.substring(0, 50),
        });

        // Сохраняем связку
        if (result.messageId || result.result?.messageId) {
          const ymMessageId = result.messageId || result.result?.messageId;
          storage.saveMessage({
            marketMessageId: String(ymMessageId),
            mgMessageId: message.id || 0,
            marketChatId: String(marketChatId),
            direction: 'outbound',
          });
        }
      } else if (message.type === 'file' && message.file) {
        logger.info('File message from CRM, attempting to forward to Market');
        // Для файлов нужно скачать из MG и отправить в Маркет
        // Это требует дополнительной реализации получения файла из MG
        logger.warn('File forwarding not fully implemented yet');
      } else {
        logger.warn('Unsupported message type from MG', { type: message.type });
      }
    } catch (err) {
      logger.error('Error sending message to Market', {
        marketChatId,
        error: err.message,
        response: err.response?.data,
      });
    }
  },
};

module.exports = outbound;
