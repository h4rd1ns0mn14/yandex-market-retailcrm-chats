const fs = require('fs');
const path = require('path');

function loadLocalEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadLocalEnv();

module.exports = {
  port: process.env.PORT || 3000,
  baseUrl: process.env.BASE_URL,

  retailcrm: {
    url: process.env.RETAILCRM_URL || 'https://rikor.retailcrm.ru',
    apiKey: process.env.RETAILCRM_API_KEY,
  },

  yandexMarket: {
    oauthToken: process.env.YM_OAUTH_TOKEN,
    oauthUserToken: process.env.YM_OAUTH_USER_TOKEN,
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
