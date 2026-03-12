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
    form.append('chatId', String(chatId));
    form.append('file', fileBuffer, { filename });

    const { data } = await client.post('/chats/file/send', form, {
      headers: form.getHeaders(),
    });
    return data;
  },

  /**
   * Создать новый чат по заказу
   * @param {number} orderId
   */
  async createChat(orderId) {
    const { data } = await client.post('/chats/new', { orderId });
    return data;
  },
};

module.exports = ym;
