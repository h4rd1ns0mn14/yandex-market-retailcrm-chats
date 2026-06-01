const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function loadInboundWithMocks({ initialChannels = {} } = {}) {
  const calls = [];
  const channels = { ...initialChannels };
  const mgConfig = {};

  const storage = {
    getChannelByMarketChatId(marketChatId) {
      return channels[marketChatId] || null;
    },
    getIntegrationChannel() {
      return mgConfig.integrationChannel || null;
    },
    saveIntegrationChannel(channel) {
      mgConfig.integrationChannel = {
        mg_channel_id: channel.mgChannelId,
        mg_external_id: channel.mgExternalId,
        name: channel.name,
      };
    },
    saveChannel({ marketChatId, mgChannelId, mgExternalId, chatType, orderId }) {
      channels[marketChatId] = {
        market_chat_id: marketChatId,
        mg_channel_id: mgChannelId,
        mg_external_id: mgExternalId,
        chat_type: chatType,
        order_id: orderId,
      };
    },
  };

  const retailcrm = {
    async activateChannel(payload) {
      calls.push(payload);
      return { id: 777 };
    },
  };

  const logger = {
    info() {},
    warn() {},
    error() {},
  };

  const mocks = new Map([
    ['src/yandex-market.js', {}],
    ['src/retailcrm.js', retailcrm],
    ['src/storage.js', storage],
    ['src/logger.js', logger],
  ]);

  for (const [relativePath, exports] of mocks) {
    const fullPath = path.join(root, relativePath);
    require.cache[require.resolve(fullPath)] = {
      id: fullPath,
      filename: fullPath,
      loaded: true,
      exports,
    };
  }

  const inboundPath = path.join(root, 'src/services/inbound.js');
  delete require.cache[require.resolve(inboundPath)];

  return {
    inbound: require(inboundPath),
    calls,
  };
}

test('handleNewChat reuses one RetailCRM channel for all Yandex Market chats', async () => {
  const { inbound, calls } = loadInboundWithMocks();

  const first = await inbound.handleNewChat(101, 'ORDER', 5001);
  const second = await inbound.handleNewChat(102, 'ORDER', 5002);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].externalId, 'yandex-market');
  assert.equal(calls[0].name, 'Yandex Market Chats');

  assert.equal(first.mg_channel_id, 777);
  assert.equal(second.mg_channel_id, 777);
  assert.equal(first.mg_external_id, 'ym-chat-101');
  assert.equal(second.mg_external_id, 'ym-chat-102');
});

test('handleNewChat migrates existing chat bindings to the integration channel', async () => {
  const { inbound, calls } = loadInboundWithMocks({
    initialChannels: {
      101: {
        market_chat_id: '101',
        mg_channel_id: 111,
        mg_external_id: 'ym-chat-101',
        chat_type: 'ORDER',
        order_id: '5001',
      },
    },
  });

  const channel = await inbound.handleNewChat(101, 'ORDER', 5001);

  assert.equal(calls.length, 1);
  assert.equal(channel.mg_channel_id, 777);
  assert.equal(channel.mg_external_id, 'ym-chat-101');
});
