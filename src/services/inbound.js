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
      logger.info('Channel created', { channel });
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

    // Для системных сообщений Маркета — пропускаем
    if (isFromMarket) {
      logger.info('System message from Market, skipping', { messageId, sender });
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
          logger.info('File forwarded to RetailCRM', { messageId, fileName: file.name, originator });
        } catch (err) {
          logger.error('Error forwarding file to RetailCRM', { messageId, fileName: file.name, error: err.message });
        }
      }

      if (text) {
        const result = await retailcrm.sendMessage({
          channelId: channel.mg_channel_id,
          externalChatId: channel.mg_external_id,
          externalMessageId: `ym-msg-${messageId}`,
          text,
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
    } else {
      // Только текст
      const result = await retailcrm.sendMessage({
        channelId: channel.mg_channel_id,
        externalChatId: channel.mg_external_id,
        externalMessageId: `ym-msg-${messageId}`,
        text: text || '[Без текста]',
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

      logger.info('Message forwarded to RetailCRM', { messageId, originator, sender });
    }
  },

  /**
   * Обработка нового сообщения из Маркета
   */
  async handleNewMessage(chatId, messageData, customerInfo) {
    const { messageId, message, sender, createdAt, payload: msgPayload } = messageData;

    logger.info('New message from Market', { chatId, messageId, sender, message: message?.substring(0, 100) });

    // Дедупликация
    const existing = storage.getMessageByMarketId(String(messageId));
    if (existing) {
      return;
    }

    // Получаем или создаём канал
    let channel = storage.getChannelByMarketChatId(String(chatId));
    if (!channel) {
      channel = await this.handleNewChat(chatId, null, null);
    }

    await this.forwardMessage(channel, chatId, messageId, message, createdAt, sender, customerInfo, msgPayload);
  },

  /**
   * Полный sync: забираем все чаты и их историю
   */
  async syncPendingChats() {
    logger.info('Syncing pending chats from Market...');

    try {
      const response = await ym.getChats({
        statuses: ['WAITING_FOR_PARTNER', 'NEW', 'WAITING_FOR_CUSTOMER'],
      });

      const chats = response.chats || response.result?.chats || [];
      logger.info(`Found ${chats.length} pending chats`);

      for (const chat of chats) {
        const { chatId, type, order, context } = chat;
        const orderId = order?.orderId || null;
        const customerInfo = context?.customer || null;

        await this.handleNewChat(chatId, type, orderId);

        // Загружаем историю
        const history = await ym.getChatHistory(chatId, { limit: 50 });
        const messages = history.messages || history.result?.messages || [];

        for (const msg of messages) {
          try {
            await this.handleNewMessage(chatId, msg, customerInfo);
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
