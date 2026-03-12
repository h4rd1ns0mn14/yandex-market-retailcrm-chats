const axios = require('axios');
const config = require('./config');
const storage = require('./storage');
const logger = require('./logger');

// ===== RetailCRM основной API =====
const crmClient = axios.create({
  baseURL: config.retailcrm.url,
  timeout: 15000,
});

// Логирование ответов для отладки
crmClient.interceptors.response.use(
  (res) => res,
  (err) => {
    logger.error('RetailCRM API error', {
      url: err.config?.url,
      method: err.config?.method,
      status: err.response?.status,
      data: err.response?.data,
    });
    throw err;
  }
);

// ===== Transport API (Message Gateway) =====
function getMgClient() {
  const endpointUrl = config.mg.endpointUrl || storage.getMgConfig('endpointUrl');
  const token = config.mg.token || storage.getMgConfig('token');

  if (!endpointUrl || !token) {
    throw new Error('MG Transport API not configured. Run registerModule() first.');
  }

  return axios.create({
    baseURL: endpointUrl,
    headers: {
      'X-Transport-Token': token,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

const retailcrm = {
  /**
   * Регистрация транспортного модуля в RetailCRM
   */
  async registerModule() {
    const webhookUrl = `${config.baseUrl}/webhook/retailcrm`;

    // Минимальная конфигурация для mgTransport
    const crmUrl = config.retailcrm.url || 'https://rikor.retailcrm.ru';
    const moduleData = {
      code: config.module.code,
      active: true,
      name: config.module.name,
      clientId: crmUrl.replace('https://', '').replace('http://', '').replace(/\/$/, ''),
      integrations: {
        mgTransport: {
          webhookUrl,
        },
      },
    };

    logger.info('Registering integration module', { webhookUrl, code: config.module.code });

    // RetailCRM требует integrationModule как JSON string в form-urlencoded
    const payload = new URLSearchParams();
    payload.append('integrationModule', JSON.stringify(moduleData));

    try {
      const { data } = await crmClient.post(
        `/api/v5/integration-modules/${config.module.code}/edit`,
        payload.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          params: { apiKey: config.retailcrm.apiKey },
        }
      );

      logger.info('RetailCRM response', { data });

      if (!data.success) {
        throw new Error(`Module registration failed: ${JSON.stringify(data)}`);
      }

      // Сохраняем endpointUrl и token
      const info = data.info || {};
      if (info.mgTransport) {
        const { endpointUrl, token } = info.mgTransport;
        storage.setMgConfig('endpointUrl', endpointUrl);
        storage.setMgConfig('token', token);
        logger.info('MG Transport configured', { endpointUrl });
      }

      return data;
    } catch (err) {
      if (err.response?.status === 403) {
        // Модуль уже существует, пробуем получить информацию
        logger.warn('Module may already exist, trying to get info...');
        
        try {
          const { data } = await crmClient.get(
            `/api/v5/integration-modules/${config.module.code}`,
            {
              params: { apiKey: config.retailcrm.apiKey },
            }
          );

          if (data.success && data.info?.mgTransport) {
            const { endpointUrl, token } = data.info.mgTransport;
            storage.setMgConfig('endpointUrl', endpointUrl);
            storage.setMgConfig('token', token);
            logger.info('MG Transport loaded from existing module', { endpointUrl });
            return data;
          }
        } catch (getErr) {
          logger.error('Failed to get existing module', { error: getErr.message });
        }
      }
      throw err;
    }
  },

  /**
   * Активировать канал в Message Gateway
   */
  async activateChannel({ externalId, name, avatarUrl }) {
    const mg = getMgClient();

    const { data } = await mg.post('/channels', {
      type: 'custom',
      name: name || 'Yandex Market',
      settings: {
        text: { creating: 'both', editing: 'receive', quoting: 'receive', deleting: 'receive' },
        file: { max_files_count: 1 },
      },
      external_id: externalId,
      avatar_url: avatarUrl || 'https://yastatic.net/market-export/_/i/favicon/yandex-market-32.png',
    });

    logger.info('Channel activated', { channelId: data.channel_id, externalId });
    return data;
  },

  /**
   * Обновить канал
   */
  async updateChannel(channelId, updates) {
    const mg = getMgClient();
    const { data } = await mg.put(`/channels/${channelId}`, updates);
    return data;
  },

  /**
   * Отправить сообщение в MG (входящее от покупателя)
   */
  async sendMessage({ channelId, externalChatId, externalMessageId, text, createdAt, customer }) {
    const mg = getMgClient();

    const payload = {
      channel_id: channelId,
      external_chat_id: externalChatId,
      message: {
        external_id: externalMessageId,
        type: 'text',
        text,
        created_at: createdAt || new Date().toISOString(),
      },
      customer: {
        external_id: customer.externalId,
        nickname: customer.nickname || 'Покупатель',
        first_name: customer.firstName || '',
        last_name: customer.lastName || '',
      },
    };

    const { data } = await mg.post('/messages', payload);
    logger.info('Message sent to MG', { messageId: data.message_id, externalMessageId });
    return data;
  },

  /**
   * Отправить файл-сообщение в MG
   */
  async sendFileMessage({ channelId, externalChatId, externalMessageId, fileUrl, fileName, createdAt, customer }) {
    const mg = getMgClient();

    // Сначала загружаем файл по URL
    const uploadRes = await mg.post('/files/upload_by_url', {
      url: fileUrl,
    });

    const payload = {
      channel_id: channelId,
      external_chat_id: externalChatId,
      message: {
        external_id: externalMessageId,
        type: 'file',
        file: {
          id: uploadRes.data.id,
          name: fileName,
        },
        created_at: createdAt || new Date().toISOString(),
      },
      customer: {
        external_id: customer.externalId,
        nickname: customer.nickname || 'Покупатель',
      },
    };

    const { data } = await mg.post('/messages', payload);
    return data;
  },

  /**
   * Пометить сообщения как прочитанные
   */
  async markRead(channelId, externalChatId, untilMessageExternalId) {
    const mg = getMgClient();
    await mg.post('/messages/read', {
      channel_id: channelId,
      external_chat_id: externalChatId,
      until_message_external_id: untilMessageExternalId,
    });
  },
};

module.exports = retailcrm;
