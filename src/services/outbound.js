const axios = require('axios');
const ym = require('../yandex-market');
const storage = require('../storage');
const config = require('../config');
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

  /**
   * Скачать файл из MG по ID
   */
  async downloadMgFile(fileUrl) {
    const endpointUrl = config.mg.endpointUrl || storage.getMgConfig('endpointUrl');
    const token = config.mg.token || storage.getMgConfig('token');

    // fileUrl из MG может быть полным URL или относительным
    const fullUrl = fileUrl.startsWith('http')
      ? fileUrl
      : `${endpointUrl.replace(/\/+$/, '')}${fileUrl}`;

    const response = await axios.get(fullUrl, {
      headers: { 'X-Transport-Token': token },
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    return {
      buffer: Buffer.from(response.data),
      contentType: response.headers['content-type'] || 'application/octet-stream',
    };
  },

  async handleMessageSent(data) {
    const externalChatId = data.external_chat_id;
    const content = data.content;
    const msgType = data.type || 'text';
    const user = data.user;
    const items = data.items || [];

    logger.info('MG message_sent', {
      externalChatId,
      content: content?.substring(0, 50),
      type: msgType,
      user: user?.first_name,
      itemsCount: items.length,
    });

    if (!externalChatId) {
      logger.warn('Missing external_chat_id');
      return;
    }

    if (!user) {
      logger.info('No user in webhook, skipping');
      return;
    }

    const channel = storage.getChannelByMgExternalId(externalChatId);
    if (!channel) {
      logger.error('Channel not found', { externalChatId });
      return;
    }

    const marketChatId = parseInt(channel.market_chat_id, 10);

    try {
      // Обработка файлов
      if (items.length > 0) {
        for (const item of items) {
          try {
            const fileUrl = item.url || item.download_url;
            if (!fileUrl) {
              logger.warn('File item without URL', { item: JSON.stringify(item).substring(0, 200) });
              continue;
            }

            logger.info('Downloading file from MG', { fileUrl: fileUrl.substring(0, 100), name: item.caption || item.name });
            const { buffer } = await this.downloadMgFile(fileUrl);
            const filename = item.caption || item.name || 'file';

            await ym.sendFile(marketChatId, buffer, filename);
            logger.info('File sent to Market', { marketChatId, filename });
          } catch (err) {
            logger.error('Error sending file to Market', { error: err.message });
          }
        }
      }

      // Обработка текста
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
      } else if ((msgType === 'file' || msgType === 'image') && items.length === 0) {
        // Файл без items — попробуем content как текст
        if (content) {
          await ym.sendMessage(marketChatId, content);
          logger.info('File caption sent as text', { marketChatId });
        }
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
