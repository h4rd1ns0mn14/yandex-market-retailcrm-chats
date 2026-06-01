const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

const client = axios.create({
  baseURL: `${config.yandexMarket.apiBase}/v2/businesses/${config.yandexMarket.businessId}`,
  headers: {
    'Api-Key': config.yandexMarket.oauthToken,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    logger.error('YM API error', {
      url: err.config?.url,
      status: err.response?.status,
      data: err.response?.data,
    });
    throw err;
  }
);

const ym = {
  /**
   * Получить список чатов
   * @param {Object} params - фильтры (statuses, type, orderIds и т.д.)
   */
  async getChats(params = {}) {
    const { data } = await client.post('/chats', params);
    return data;
  },

  /**
   * Получить один чат по ID.
   * Используется для CHAT_CREATED: уведомление содержит только chatId.
   */
  async getChat(chatId) {
    const { data } = await client.get('/chat', {
      params: { chatId },
    });
    return data.result || data.chat || data;
  },

  /**
   * Получить историю сообщений чата
   * @param {number} chatId
   * @param {Object} params - messageIdFrom, limit
   */
  async getChatHistory(chatId, params = {}) {
    const { limit, messageIdFrom, pageToken } = params;
    const query = { chatId };
    if (limit) query.limit = limit;
    if (pageToken) query.pageToken = pageToken;

    const body = {};
    if (messageIdFrom) body.messageIdFrom = messageIdFrom;

    const { data } = await client.post('/chats/history', body, { params: query });
    return data;
  },

  /**
   * Получить одно сообщение по ID.
   * Используется для CHAT_MESSAGE_SENT: уведомление содержит только chatId/messageId.
   */
  async getChatMessage(chatId, messageId) {
    const { data } = await client.get('/chats/message', {
      params: { chatId, messageId },
    });
    return data.result || data.message || data;
  },

  /**
   * Отправить текстовое сообщение в чат
   * @param {number} chatId
   * @param {string} message
   */
  async sendMessage(chatId, message) {
    const { data } = await client.post('/chats/message', { message }, { params: { chatId } });
    return data;
  },

  /**
   * Отправить файл в чат
   * @param {number} chatId
   * @param {Buffer} fileBuffer
   * @param {string} filename
   */
  async sendFile(chatId, fileBuffer, filename) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fileBuffer, { filename });

    const { data } = await client.post('/chats/file/send', form, {
      headers: form.getHeaders(),
      params: { chatId },
    });
    return data;
  },

  /**
   * Создать новый чат по заказу
   * @param {number} orderId
   */
  /**
   * Скачать файл по URL (с авторизацией)
   * Для файлов мессенджера пробуем OAuth-токен пользователя, затем Api-Key
   */
  async downloadFile(fileUrl) {
    const isMessengerFile = fileUrl.includes('files.messenger.yandex.net');
    const oauthUserToken = config.yandexMarket.oauthUserToken;

    // Для файлов мессенджера — сначала OAuth, потом Api-Key
    if (isMessengerFile && oauthUserToken) {
      try {
        const response = await axios.get(fileUrl, {
          headers: { 'Authorization': `OAuth ${oauthUserToken}` },
          responseType: 'arraybuffer',
          maxRedirects: 5,
          timeout: 30000,
        });
        return {
          buffer: Buffer.from(response.data),
          contentType: response.headers['content-type'] || 'application/octet-stream',
        };
      } catch (err) {
        logger.error('OAuth download failed, trying Api-Key', { status: err.response?.status });
      }
    }

    const response = await axios.get(fileUrl, {
      headers: { 'Api-Key': config.yandexMarket.oauthToken },
      responseType: 'arraybuffer',
      maxRedirects: 5,
      timeout: 30000,
    });
    return {
      buffer: Buffer.from(response.data),
      contentType: response.headers['content-type'] || 'application/octet-stream',
    };
  },

  async createChat(orderId) {
    const { data } = await client.post('/chats/new', { orderId });
    return data;
  },
};

module.exports = ym;
