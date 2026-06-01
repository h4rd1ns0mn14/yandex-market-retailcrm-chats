const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const express = require('express');

const root = path.resolve(__dirname, '..');

function mockModule(relativePath, exports) {
  const fullPath = path.join(root, relativePath);
  require.cache[require.resolve(fullPath)] = {
    id: fullPath,
    filename: fullPath,
    loaded: true,
    exports,
  };
}

async function postJson(app, url, body) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const { port } = server.address();

  try {
    return await new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end(payload);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function loadAppWithMocks() {
  const handledChats = [];
  const handledMessages = [];
  const fetchedMessages = [];
  const fetchedChats = [];

  mockModule('src/config.js', {
    module: { name: 'Yandex Market Chats' },
  });
  mockModule('src/logger.js', {
    info() {},
    warn() {},
    error() {},
  });
  mockModule('src/yandex-market.js', {
    async getChat(chatId) {
      fetchedChats.push({ chatId });
      return {
        chatId,
        orderId: 5001,
        context: {
          type: 'ORDER',
          orderId: 5001,
          customer: { name: 'Buyer Name' },
        },
      };
    },
    async getChatMessage(chatId, messageId) {
      fetchedMessages.push({ chatId, messageId });
      return {
        messageId,
        message: 'Message loaded from Market API',
        sender: 'USER',
        createdAt: '2026-06-01T00:00:01Z',
        payload: [{ name: 'photo.jpg', url: 'https://example.test/photo.jpg', size: 123 }],
      };
    },
  });
  mockModule('src/services/inbound.js', {
    async handleNewChat(chatId, chatType, orderId) {
      handledChats.push({ chatId, chatType, orderId });
    },
    async handleNewMessage(chatId, messageData) {
      handledMessages.push({ chatId, messageData });
    },
  });

  const routePath = path.join(root, 'src/routes/marketWebhook.js');
  delete require.cache[require.resolve(routePath)];

  const app = express();
  app.use(express.json());
  app.use('/webhook/market', require(routePath));

  return { app, handledChats, handledMessages, fetchedChats, fetchedMessages };
}

test('CHAT_CREATED loads chat context using Market API before creating the chat binding', async () => {
  const { app, handledChats, fetchedChats } = loadAppWithMocks();

  const response = await postJson(app, '/webhook/market/notification', {
    notificationType: 'CHAT_CREATED',
    chatId: 14604709,
    businessId: 209888193,
    createdAt: '2026-06-01T00:00:00Z',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(fetchedChats, [{ chatId: 14604709 }]);
  assert.deepEqual(handledChats, [{
    chatId: 14604709,
    chatType: 'ORDER',
    orderId: 5001,
  }]);
});

test('CHAT_MESSAGE_SENT loads message details using Market API before forwarding', async () => {
  const { app, handledMessages, fetchedMessages } = loadAppWithMocks();

  const response = await postJson(app, '/webhook/market/notification', {
    notificationType: 'CHAT_MESSAGE_SENT',
    chatId: 14604709,
    messageId: '1780212617058078',
    sentAt: '2026-06-01T00:00:00Z',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(fetchedMessages, [{
    chatId: 14604709,
    messageId: '1780212617058078',
  }]);
  assert.equal(handledMessages.length, 1);
  assert.equal(handledMessages[0].chatId, 14604709);
  assert.equal(handledMessages[0].messageData.message, 'Message loaded from Market API');
  assert.equal(handledMessages[0].messageData.sender, 'USER');
  assert.deepEqual(handledMessages[0].messageData.payload, [{
    name: 'photo.jpg',
    url: 'https://example.test/photo.jpg',
    size: 123,
  }]);
  assert.equal(response.body.version, '1.0.0');
  assert.equal(response.body.name, 'Yandex Market Chats');
  assert.equal(response.body.time, '2026-06-01T00:00:00Z');
});
