const ym = require('../yandex-market');
const storage = require('../storage');
const logger = require('../logger');

const outbound = {
  /**
   * Обработка webhook от Message Gateway (сообщение от оператора)
   */
  async handleMgWebhook(event) {
    logger.info('MG Webhook received', { type: event.type, data: JSON.stringify(event.data || event).substring(0, 500) });

    const eventType = event.type || event.Type;

    switch (eventType) {
      case 'message_sent':
        await this.handleMessageSent(event.data || event.Data || event);
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
        logger.info('Unknown MG event type', { type: eventType, body: JSON.stringify(event).substring(0, 500) });
    }
  },

  /**
   * Отправить сообщение оператора в Маркет
   */
  async handleMessageSent(data) {
    logger.info('handleMessageSent data', { data: JSON.stringify(data).substring(0, 500) });

    const externalChatId = data.external_chat_id || data.ExternalChatID;
    const message = data.message || data.Message;
    const channelId = data.channel || data.channel_id || data.Channel;

    if (!message || !externalChatId) {
      logger.warn('Missing message or external_chat_id in MG webhook', { externalChatId, hasMessage: !!message });
      return;
    }

    // Пропускаем сообщения от бота/системы — только от оператора
    const originator = data.originator || data.Originator;
    if (originator && originator !== 'manager') {
      logger.info('Message not from manager, skipping outbound', { originator });
      return;
    }

    // Ищем канал по external_id
    const channel = storage.getChannelByMgExternalId(externalChatId);

    if (!channel) {
      logger.error('Channel not found for external_chat_id', { externalChatId });
      return;
    }

    const marketChatId = parseInt(channel.market_chat_id, 10);

    // Дедупликация: проверяем, не пришло ли это сообщение из Маркета
    const extId = message.external_id || message.ExternalID;
    if (extId && extId.startsWith('ym-msg-')) {
      logger.info('Message originated from Market, skipping outbound', { externalId: extId });
      return;
    }

    try {
      const msgType = message.type || message.Type || 'text';
      const msgText = message.text || message.Text;

      if (msgType === 'text' && msgText) {
        const result = await ym.sendMessage(marketChatId, msgText);

        logger.info('Message sent to Market', {
          marketChatId,
          text: msgText.substring(0, 50),
        });

        // Сохраняем связку
        const ymMessageId = result.messageId || result.result?.messageId;
        if (ymMessageId) {
          storage.saveMessage({
            marketMessageId: String(ymMessageId),
            mgMessageId: message.id || message.ID || 0,
            marketChatId: String(marketChatId),
            direction: 'outbound',
          });
        }
      } else if (msgType === 'file' || msgType === 'image') {
        logger.info('File/image message from CRM, text fallback to Market');
        // MG файлы не имеют прямого URL для Маркета, отправляем как текст с описанием
        if (msgText) {
          await ym.sendMessage(marketChatId, msgText);
          logger.info('File message text sent to Market', { marketChatId });
        }
      } else {
        logger.warn('Unsupported message type from MG', { type: msgType });
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
