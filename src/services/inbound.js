const ym = require('../yandex-market');
const retailcrm = require('../retailcrm');
const storage = require('../storage');
const logger = require('../logger');

let syncing = false;

const inbound = {
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

  async forwardMessage(channel, chatId, messageId, text, createdAt, sender, customerInfo, msgPayload, isHistorical) {
    const isFromBuyer = sender === 'CUSTOMER' || sender === 'BUYER' || sender === 'USER';
    const isFromMarket = sender === 'MARKET' || sender === 'SUPPORT';
    // Исторические сообщения всегда channel чтобы не триггерить уведомления
    const originator = (isFromBuyer && !isHistorical) ? 'customer' : 'channel';

    if (isFromMarket) return;

    // Пропускаем сообщения PARTNER — они отправлены нами из CRM или из кабинета Маркета
    const isFromPartner = sender === 'PARTNER';
    if (isFromPartner) {
      // Просто сохраняем для дедупликации, не отправляем в CRM
      storage.saveMessage({
        marketMessageId: String(messageId),
        mgMessageId: 0,
        marketChatId: String(chatId),
        direction: 'outbound',
      });
      return;
    }

    const customer = {
      externalId: `ym-buyer-${chatId}`,
      nickname: customerInfo?.name || 'Покупатель',
      firstName: customerInfo?.name || 'Покупатель',
      lastName: '',
    };

    // Вложения
    const attachments = msgPayload || [];
    if (attachments.length > 0) {
      logger.info('Attachments found', { messageId, count: attachments.length, first: JSON.stringify(attachments[0]).substring(0, 200) });
    }

    // Отправляем текст, если есть
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
    }

    // Отправляем файлы как вложения (скачиваем и загружаем в MG)
    if (attachments.length > 0 && attachments[0].url) {
      for (let i = 0; i < attachments.length; i++) {
        const f = attachments[i];
        try {
          const result = await retailcrm.sendFileMessage({
            channelId: channel.mg_channel_id,
            externalChatId: channel.mg_external_id,
            externalMessageId: `ym-msg-${messageId}-file-${i}`,
            fileUrl: f.url,
            fileName: f.name || 'Фото',
            createdAt: createdAt || new Date().toISOString(),
            customer,
            originator,
          });
          logger.info('File sent to MG', { messageId, fileIndex: i, fileName: f.name });
        } catch (err) {
          logger.error('Failed to send file to MG', { messageId, fileIndex: i, error: err.message });
          await retailcrm.sendMessage({
            channelId: channel.mg_channel_id,
            externalChatId: channel.mg_external_id,
            externalMessageId: `ym-msg-${messageId}-file-${i}`,
            text: `📎 ${f.name || 'Фото'}: ${f.url}`,
            createdAt: createdAt || new Date().toISOString(),
            customer,
            originator,
          });
        }
      }
    }

    // Если нет ни текста, ни вложений — сохраняем запись
    if (!text && attachments.length === 0) {
      storage.saveMessage({
        marketMessageId: String(messageId),
        mgMessageId: 0,
        marketChatId: String(chatId),
        direction: isFromBuyer ? 'inbound' : 'outbound',
      });
    }
  },

  async handleNewMessage(chatId, messageData, customerInfo, isHistorical) {
    const { messageId, message, sender, createdAt, payload: msgPayload } = messageData;

    if (storage.getMessageByMarketId(String(messageId))) return;

    let channel = storage.getChannelByMarketChatId(String(chatId));
    if (!channel) {
      channel = await this.handleNewChat(chatId, null, null);
    }

    await this.forwardMessage(channel, chatId, messageId, message, createdAt, sender, customerInfo, msgPayload, isHistorical);
    storage.setLastMessageId(String(chatId), messageId);
  },

  async syncChats() {
    if (syncing) return;
    syncing = true;

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

        const lastMsgId = storage.getLastMessageId(String(chatId));
        const isHistorical = !lastMsgId; // первая загрузка = историческая
        const historyParams = { limit: 50 };
        if (lastMsgId) {
          historyParams.messageIdFrom = lastMsgId;
        }

        const history = await ym.getChatHistory(chatId, historyParams);
        const messages = history.messages || history.result?.messages || [];

        const newMessages = lastMsgId
          ? messages.filter(m => m.messageId !== lastMsgId)
          : messages;

        if (newMessages.length > 0) {
          logger.info('New messages', { chatId, count: newMessages.length, historical: isHistorical });
        }

        for (const msg of newMessages) {
          try {
            await this.handleNewMessage(chatId, msg, customerInfo, isHistorical);
          } catch (err) {
            logger.error('Error processing msg', { chatId, messageId: msg.messageId, error: err.message });
          }
        }
      }
    } catch (err) {
      logger.error('Error syncing chats', { error: err.message });
    } finally {
      syncing = false;
    }
  },
};

module.exports = inbound;
