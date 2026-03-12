const { v4: uuidv4 } = require('uuid');
const ym = require('../yandex-market');
const retailcrm = require('../retailcrm');
const storage = require('../storage');
const logger = require('../logger');

const inbound = {
  /**
   * Обработка нового чата из Маркета
   */
  async handleNewChat(chatId, chatType, orderId) {
    let channel = storage.getChannelByMarketChatId(String(chatId));

    if (!channel) {
      const externalId = `ym-chat-${chatId}`;
      const channelName = orderId
        ? `Маркет: Заказ ${orderId}`
        : `Маркет: Чат ${chatId}`;

      const result = await retailcrm.activateChannel({
        externalId,
        name: channelName,
      });

      storage.saveChannel({
        marketChatId: String(chatId),
        mgChannelId: result.id || result.channel_id,
        mgExternalId: externalId,
        chatType: chatType || 'UNKNOWN',
        orderId: orderId ? String(orderId) : null,
      });

      channel = storage.getChannelByMarketChatId(String(chatId));
      logger.info('Channel created', { chatId, mgChannelId: channel.mg_channel_id });
    }

    return channel;
  },

  /**
   * Отправить сообщение в MG с правильным originator
   */
  async forwardMessage(channel, chatId, messageId, text, createdAt, sender, customerInfo, msgPayload) {
    const isFromBuyer = sender === 'CUSTOMER' || sender === 'BUYER' || sender === 'USER';
    const isFromMarket = sender === 'MARKET' || sender === 'SUPPORT';
    const originator = isFromBuyer ? 'customer' : 'channel';

    if (isFromMarket) {
      return;
    }

    const customer = {
      externalId: `ym-buyer-${chatId}`,
      nickname: customerInfo?.name || 'Покупатель',
      firstName: customerInfo?.name || 'Покупатель',
      lastName: '',
    };

    // Вложения (фото/файлы)
    const attachments = msgPayload || [];
    if (attachments.length > 0) {
      logger.info('Message has attachments', { messageId, attachments: JSON.stringify(attachments).substring(0, 500) });
    }
    if (attachments.length > 0 && attachments[0].url) {
      for (const file of attachments) {
        try {
          await retailcrm.sendFileMessage({
            channelId: channel.mg_channel_id,
            externalChatId: channel.mg_external_id,
            externalMessageId: `ym-msg-${messageId}-file-${file.name || 'attachment'}`,
            fileUrl: file.url,
            fileName: file.name || 'attachment',
            createdAt: createdAt || new Date().toISOString(),
            customer,
            originator,
          });
        } catch (err) {
          logger.error('Error forwarding file', { messageId, error: err.message });
        }
      }
    }

    // Текст (или если нет вложений)
    if (text || attachments.length === 0) {
      const result = await retailcrm.sendMessage({
        channelId: channel.mg_channel_id,
        externalChatId: channel.mg_external_id,
        externalMessageId: `ym-msg-${messageId}`,
        text: text || '[Вложение]',
        createdAt: createdAt || new Date().toISOString(),
        customer,
        originator,
      });

      storage.saveMessage({
        marketMessageId: String(messageId),
        mgMessageId: result.message_id,
        marketChatId: String(chatId),
        direction: isFromBuyer ? 'inbound' : 'outbound',
      });
    } else {
      storage.saveMessage({
        marketMessageId: String(messageId),
        mgMessageId: 0,
        marketChatId: String(chatId),
        direction: isFromBuyer ? 'inbound' : 'outbound',
      });
    }
  },

  /**
   * Обработка сообщения из Маркета
   */
  async handleNewMessage(chatId, messageData, customerInfo) {
    const { messageId, message, sender, createdAt, payload: msgPayload } = messageData;

    // Дедупликация
    if (storage.getMessageByMarketId(String(messageId))) {
      return;
    }

    let channel = storage.getChannelByMarketChatId(String(chatId));
    if (!channel) {
      channel = await this.handleNewChat(chatId, null, null);
    }

    await this.forwardMessage(channel, chatId, messageId, message, createdAt, sender, customerInfo, msgPayload);

    // Обновляем последний messageId
    storage.setLastMessageId(String(chatId), messageId);
  },

  /**
   * Инкрементальная синхронизация — только новые сообщения
   */
  async syncChats() {
    try {
      const response = await ym.getChats({
        statuses: ['WAITING_FOR_PARTNER', 'NEW', 'WAITING_FOR_CUSTOMER'],
      });

      const chats = response.chats || response.result?.chats || [];

      for (const chat of chats) {
        const { chatId, type, order, context } = chat;
        const orderId = order?.orderId || null;
        const customerInfo = context?.customer || null;

        await this.handleNewChat(chatId, type, orderId);

        // Загружаем только новые сообщения (после последнего известного)
        const lastMsgId = storage.getLastMessageId(String(chatId));
        const historyParams = { limit: 50 };
        if (lastMsgId) {
          historyParams.messageIdFrom = lastMsgId;
        }

        const history = await ym.getChatHistory(chatId, historyParams);
        const messages = history.messages || history.result?.messages || [];

        // Фильтруем — messageIdFrom включает само сообщение, пропускаем его
        const newMessages = lastMsgId
          ? messages.filter(m => m.messageId !== lastMsgId)
          : messages;

        if (newMessages.length > 0) {
          logger.info('New messages in chat', { chatId, count: newMessages.length });
        }

        for (const msg of newMessages) {
          try {
            await this.handleNewMessage(chatId, msg, customerInfo);
          } catch (err) {
            logger.error('Error processing message', {
              chatId,
              messageId: msg.messageId,
              error: err.message,
            });
          }
        }
      }
    } catch (err) {
      logger.error('Error syncing chats', { error: err.message });
    }
  },
};

module.exports = inbound;
