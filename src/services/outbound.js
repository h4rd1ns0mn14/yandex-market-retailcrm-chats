const axios = require('axios');
const ym = require('../yandex-market');
const storage = require('../storage');
const config = require('../config');
const logger = require('../logger');

function messageSentResponse({ externalChatId, externalCustomerId, externalMessageId, error }) {
  const response = {
    async: false,
  };

  if (externalChatId) response.external_chat_id = String(externalChatId);
  if (externalCustomerId) response.external_customer_id = String(externalCustomerId);
  if (externalMessageId) response.external_message_id = String(externalMessageId);
  if (error) {
    response.error = {
      code: 'general',
      message: error,
    };
  }

  return response;
}

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
        return this.handleMessageSent(msgData);
      }
      case 'message_updated':
      case 'message_deleted':
      case 'message_read':
        return {};
      default:
        logger.info('Unknown MG event', { type: eventType });
        return {};
    }
  },

  /**
   * Скачать файл из MG по ID
   */
  async downloadMgFile(fileId) {
    const endpointUrl = config.mg.endpointUrl || storage.getMgConfig('endpointUrl');
    const token = config.mg.token || storage.getMgConfig('token');

    const baseURL = endpointUrl.includes('/api/transport/')
      ? endpointUrl
      : `${endpointUrl.replace(/\/+$/, '')}/api/transport/v1`;

    // Сначала получаем метаданные файла с URL для скачивания
    const metaUrl = `${baseURL}/files/${fileId}`;
    logger.info('Getting MG file metadata', { metaUrl });

    try {
      const metaRes = await axios.get(metaUrl, {
        headers: { 'X-Transport-Token': token },
        timeout: 15000,
      });

      const fileData = metaRes.data;
      logger.info('MG file metadata', { id: fileData.id, url: fileData.url?.substring(0, 100), size: fileData.size });

      // Скачиваем по URL из метаданных
      if (fileData.url) {
        const downloadUrl = fileData.url.startsWith('http')
          ? fileData.url
          : `${endpointUrl.replace(/\/+$/, '')}${fileData.url}`;

        const response = await axios.get(downloadUrl, {
          headers: { 'X-Transport-Token': token },
          responseType: 'arraybuffer',
          timeout: 30000,
        });

        return {
          buffer: Buffer.from(response.data),
          contentType: response.headers['content-type'] || 'application/octet-stream',
        };
      }
    } catch (metaErr) {
      logger.warn('MG file metadata failed, trying direct download', { error: metaErr.message, status: metaErr.response?.status });
    }

    // Фоллбэк: прямое скачивание /files/{id}/download
    const downloadUrl = `${baseURL}/files/${fileId}/download`;
    logger.info('Trying direct MG file download', { downloadUrl });

    const response = await axios.get(downloadUrl, {
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
      return messageSentResponse({ error: 'Missing external_chat_id' });
    }

    if (!user && !data.bot) {
      logger.info('No user or bot in webhook, skipping');
      return messageSentResponse({
        externalChatId,
        externalCustomerId: data.external_user_id,
        error: 'Missing message sender',
      });
    }

    const channel = storage.getChannelByMgExternalId(externalChatId);
    if (!channel) {
      logger.error('Channel not found', { externalChatId });
      return messageSentResponse({
        externalChatId,
        externalCustomerId: data.external_user_id,
        error: 'Channel not found',
      });
    }

    const marketChatId = parseInt(channel.market_chat_id, 10);
    let externalMessageId = null;
    let sentToMarket = false;

    try {
      // Обработка файлов
      if (items.length > 0) {
        for (const item of items) {
          try {
            // Скачиваем файл из MG по ID
            const fileId = item.id;
            if (!fileId) {
              logger.warn('File item without id', { item: JSON.stringify(item).substring(0, 200) });
              continue;
            }

            const filename = item.caption || item.name || 'file';
            logger.info('Downloading file from MG', { fileId, filename });
            const { buffer } = await this.downloadMgFile(fileId);

            const sendResult = await ym.sendFile(marketChatId, buffer, filename);
            logger.info('File sent to Market', { marketChatId, filename, result: JSON.stringify(sendResult).substring(0, 200) });
            sentToMarket = true;
            const ymMessageId = sendResult.messageId || sendResult.result?.messageId;
            if (ymMessageId && !externalMessageId) {
              externalMessageId = `ym-msg-${ymMessageId}`;
            }
          } catch (err) {
            logger.error('Error sending file to Market', { error: err.message, response: err.response?.data });
          }
        }
      }

      // Обработка текста
      if (msgType === 'text' && content) {
        const result = await ym.sendMessage(marketChatId, content);
        logger.info('Message sent to Market', { marketChatId, text: content.substring(0, 50) });
        sentToMarket = true;

        const ymMessageId = result.messageId || result.result?.messageId;
        if (ymMessageId) {
          externalMessageId = `ym-msg-${ymMessageId}`;
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
          const result = await ym.sendMessage(marketChatId, content);
          sentToMarket = true;
          const ymMessageId = result.messageId || result.result?.messageId;
          if (ymMessageId) {
            externalMessageId = `ym-msg-${ymMessageId}`;
          }
          logger.info('File caption sent as text', { marketChatId });
        }
      }

      if (!sentToMarket) {
        return messageSentResponse({
          externalChatId,
          externalCustomerId: data.external_user_id || `ym-buyer-${marketChatId}`,
          error: 'Message was not sent to Yandex Market',
        });
      }

      return messageSentResponse({
        externalChatId,
        externalCustomerId: data.external_user_id || `ym-buyer-${marketChatId}`,
        externalMessageId,
      });
    } catch (err) {
      logger.error('Error sending to Market', {
        marketChatId,
        error: err.message,
        response: err.response?.data,
      });
      return messageSentResponse({
        externalChatId,
        externalCustomerId: data.external_user_id || `ym-buyer-${marketChatId}`,
        error: err.response?.data?.message || err.message || 'Failed to send message',
      });
    }
  },
};

outbound.messageSentResponse = messageSentResponse;

module.exports = outbound;
