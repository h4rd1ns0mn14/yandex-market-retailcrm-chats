const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const dbPath = path.join(__dirname, '..', 'data.json');

// Инициализация структуры данных
function loadDb() {
  try {
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    logger.error('Error loading DB', { error: err.message });
  }
  
  return {
    channels: {},
    messages: {},
    mgConfig: {},
  };
}

function saveDb(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error('Error saving DB', { error: err.message });
  }
}

// Глобальный объект данных
let db = loadDb();

const storage = {
  // ===== Каналы =====
  getChannelByMarketChatId(marketChatId) {
    return db.channels[marketChatId] || null;
  },

  getChannelByMgExternalId(externalId) {
    return Object.values(db.channels).find(ch => ch.mg_external_id === externalId) || null;
  },

  saveChannel({ marketChatId, mgChannelId, mgExternalId, chatType, orderId }) {
    db.channels[marketChatId] = {
      market_chat_id: marketChatId,
      mg_channel_id: mgChannelId,
      mg_external_id: mgExternalId,
      chat_type: chatType,
      order_id: orderId,
      created_at: new Date().toISOString(),
    };
    saveDb(db);
  },

  // ===== Сообщения =====
  getMessageByMarketId(marketMessageId) {
    return db.messages[marketMessageId] || null;
  },

  getMessageByMgId(mgMessageId) {
    return Object.values(db.messages).find(msg => msg.mg_message_id === String(mgMessageId)) || null;
  },

  saveMessage({ marketMessageId, mgMessageId, marketChatId, direction }) {
    db.messages[marketMessageId] = {
      market_message_id: marketMessageId,
      mg_message_id: String(mgMessageId),
      market_chat_id: marketChatId,
      direction,
      created_at: new Date().toISOString(),
    };
    saveDb(db);
  },

  // ===== MG Config =====
  getMgConfig(key) {
    return db.mgConfig[key] || null;
  },

  setMgConfig(key, value) {
    db.mgConfig[key] = value;
    saveDb(db);
  },
};

module.exports = storage;
