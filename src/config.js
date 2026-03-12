require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  baseUrl: process.env.BASE_URL,

  retailcrm: {
    url: process.env.RETAILCRM_URL,
    apiKey: process.env.RETAILCRM_API_KEY,
  },

  yandexMarket: {
    oauthToken: process.env.YM_OAUTH_TOKEN,
    businessId: process.env.YM_BUSINESS_ID,
    apiBase: process.env.YM_API_BASE || 'https://api.partner.market.yandex.ru',
  },

  mg: {
    endpointUrl: process.env.MG_ENDPOINT_URL,
    token: process.env.MG_TOKEN,
  },

  module: {
    code: process.env.MODULE_CODE || 'yandex-market',
    name: process.env.MODULE_NAME || 'Yandex Market Chats',
  },
};
