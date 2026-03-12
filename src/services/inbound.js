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
    logger.info('New chat from Market', { chatId, chatType, orderId });

    // Проверяем, есть ли уже канал
    let channel = storage.getChannelByMarketChatId(String(chatId));

    if (!channel) {
      const externalId = `ym-chat-${chatId}`;
      const channelName = orderId
        ? `Маркет: Заказ ${orderId}`
        : `Маркет: Чат ${chatId}`;

      // Создаём канал в MG
      const result = await retailcrm.activateChannel({
        externalId,
        name: channelName,
      });

      storage.saveChannel({
        marketChatId: String(chatId),
        mgChannelId: result.channel_id,
        mgExternalId: externalId,
        chatType: chatType || 'UNKNOWN',
        orderId: orderId ? String(orderId) : null,
      });

      channel = storage.getChannelByMarketChatId(String(chatId));
      logger.info('Channel created', { channel });
    }

    return channel;
  },

  /**
   * Обработка нового сообщения из Маркета
   */
  async handleNewMessage(chatId, messageData) {
    const { messageId, message, sender, createdAt, payload: msgPayload } = messageData;

    logger.info('New message from Market', { chatId, messageId, sender, message: message?.substring(0, 100) });

    // Дедупликация
    const existing = storage.getMessageByMarketId(String(messageId));
    if (existing) {
      logger.info('Message already processed, skipping', { messageId });
      return;
    }

    // Получаем или создаём канал
    let channel = storage.getChannelByMarketChatId(String(chatId));
    if (!channel) {
      channel = await this.handleNewChat(chatId, null, null);
    }

    // Определяем, от кого сообщение
    const isFromBuyer = sender === 'CUSTOMER' || sender === 'BUYER' || sender === 'USER';

    if (!isFromBuyer) {
      // Сообщение от продавца — уже отправлено из CRM, пропускаем
      logger.info('Message from seller, skipping inbound', { messageId });
      return;
    }

    const customer = {
      externalId: `ym-buyer-${chatId}`,
      nickname: 'Покупатель',
      firstName: 'Покупатель',
      lastName: 'Маркет',
    };

    // Отправляем в RetailCRM
    const result = await retailcrm.sendMessage({
      channelId: channel.mg_channel_id,
      externalChatId: channel.mg_external_id,
      externalMessageId: `ym-msg-${messageId}`,
      text: message || '[Без текста]',
      createdAt: createdAt || new Date().toISOString(),
      customer,
    });

    storage.saveMessage({
      marketMessageId: String(messageId),
      mgMessageId: result.message_id,
      marketChatId: String(chatId),
      direction: 'inbound',
    });

    logger.info('Message forwarded to RetailCRM', { messageId, mgMessageId: result.message_id });
  },

  /**
   * Полный sync: забираем все чаты WAITING_FOR_PARTNER и их историю
   */
  async syncPendingChats() {
    logger.info('Syncing pending chats from Market...');

    try {
      const response = await ym.getChats({
        statuses: ['WAITING_FOR_PARTNER'],
      });

      const chats = response.chats || response.result?.chats || [];
      logger.info(`Found ${chats.length} pending chats`);

      for (const chat of chats) {
        const { chatId, type, order } = chat;
        const orderId = order?.orderId || null;

        await this.handleNewChat(chatId, type, orderId);

        // Загружаем историю
        const history = await ym.getChatHistory(chatId, { limit: 50 });
        const messages = history.messages || history.result?.messages || [];

        for (const msg of messages) {
          try {
            await this.handleNewMessage(chatId, msg);
          } catch (err) {
            logger.error('Error processing history message', {
              chatId,
              messageId: msg.messageId,
              error: err.message,
            });
          }
        }
      }
    } catch (err) {
      logger.error('Error syncing pending chats', { error: err.message });
    }
  },
};

module.exports = inbound;
