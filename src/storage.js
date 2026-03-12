const Database = require('better-sqlite3');
const path = require('path');
const logger = require('./logger');

const db = new Database(path.join(__dirname, '..', 'data.db'));

// Создаём таблицы
db.exec(`
  CREATE TABLE IF NOT EXISTS channels (
    market_chat_id TEXT PRIMARY KEY,
    mg_channel_id  INTEGER,
    mg_external_id TEXT,
    chat_type      TEXT,
    order_id       TEXT,
    created_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    market_message_id TEXT PRIMARY KEY,
    mg_message_id     INTEGER,
    market_chat_id    TEXT,
    direction         TEXT,
    created_at        TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mg_config (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

const storage = {
  // ===== Каналы =====
  getChannelByMarketChatId(marketChatId) {
    return db.prepare('SELECT * FROM channels WHERE market_chat_id = ?').get(marketChatId);
  },

  getChannelByMgExternalId(externalId) {
    return db.prepare('SELECT * FROM channels WHERE mg_external_id = ?').get(externalId);
  },

  saveChannel({ marketChatId, mgChannelId, mgExternalId, chatType, orderId }) {
    db.prepare(`
      INSERT OR REPLACE INTO channels (market_chat_id, mg_channel_id, mg_external_id, chat_type, order_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(marketChatId, mgChannelId, mgExternalId, chatType, orderId);
  },

  // ===== Сообщения =====
  getMessageByMarketId(marketMessageId) {
    return db.prepare('SELECT * FROM messages WHERE market_message_id = ?').get(marketMessageId);
  },

  getMessageByMgId(mgMessageId) {
    return db.prepare('SELECT * FROM messages WHERE mg_message_id = ?').get(String(mgMessageId));
  },

  saveMessage({ marketMessageId, mgMessageId, marketChatId, direction }) {
    db.prepare(`
      INSERT OR REPLACE INTO messages (market_message_id, mg_message_id, market_chat_id, direction)
      VALUES (?, ?, ?, ?)
    `).run(marketMessageId, String(mgMessageId), marketChatId, direction);
  },

  // ===== MG Config =====
  getMgConfig(key) {
    const row = db.prepare('SELECT value FROM mg_config WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  setMgConfig(key, value) {
    db.prepare('INSERT OR REPLACE INTO mg_config (key, value) VALUES (?, ?)').run(key, value);
  },
};

module.exports = storage;
