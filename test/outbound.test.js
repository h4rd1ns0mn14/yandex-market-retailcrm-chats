const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

function createOutbound({ channel, sendMessage }) {
  const logger = {
    info() {},
    warn() {},
    error() {},
  };

  const outboundPath = path.resolve(__dirname, '../src/services/outbound.js');
  delete require.cache[outboundPath];

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'axios') {
      return {
        get: async () => {
          throw new Error('axios.get should not be called in these tests');
        },
      };
    }

    if (parent?.filename === outboundPath) {
      if (request === '../yandex-market') {
        return {
          sendMessage,
          sendFile: async () => ({ status: 'OK' }),
        };
      }
      if (request === '../storage') {
        return {
          getChannelByMgExternalId: () => channel || null,
          saveMessage() {},
          getMgConfig: () => null,
        };
      }
      if (request === '../config') {
        return { mg: {} };
      }
      if (request === '../logger') {
        return logger;
      }
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    return require(outboundPath);
  } finally {
    Module._load = originalLoad;
  }
}

test('message_sent returns success when Market accepts text without messageId', async () => {
  const outbound = createOutbound({
    channel: {
      market_chat_id: '14632887',
      mg_external_id: 'ym-chat-14632887',
    },
    sendMessage: async () => ({ status: 'OK' }),
  });

  const response = await outbound.handleMessageSent({
    external_chat_id: 'ym-chat-14632887',
    external_user_id: 'ym-buyer-14632887',
    type: 'text',
    content: '123',
    user: { first_name: 'Operator' },
    id: 22593,
  });

  assert.deepEqual(response, {
    async: false,
    external_chat_id: 'ym-chat-14632887',
    external_customer_id: 'ym-buyer-14632887',
  });
});

test('message_sent returns error when channel mapping is missing', async () => {
  const outbound = createOutbound({
    channel: null,
    sendMessage: async () => ({ status: 'OK' }),
  });

  const response = await outbound.handleMessageSent({
    external_chat_id: 'ym-chat-missing',
    external_user_id: 'ym-buyer-missing',
    type: 'text',
    content: 'hello',
    user: { first_name: 'Operator' },
    id: 1,
  });

  assert.equal(response.async, false);
  assert.equal(response.external_chat_id, 'ym-chat-missing');
  assert.equal(response.external_customer_id, 'ym-buyer-missing');
  assert.deepEqual(response.error, {
    code: 'general',
    message: 'Channel not found',
  });
});

test('message_sent returns error when Market rejects text', async () => {
  const outbound = createOutbound({
    channel: {
      market_chat_id: '14632887',
      mg_external_id: 'ym-chat-14632887',
    },
    sendMessage: async () => {
      const err = new Error('Request failed with status code 403');
      err.response = { data: { message: 'Forbidden' } };
      throw err;
    },
  });

  const response = await outbound.handleMessageSent({
    external_chat_id: 'ym-chat-14632887',
    external_user_id: 'ym-buyer-14632887',
    type: 'text',
    content: '123',
    user: { first_name: 'Operator' },
    id: 22593,
  });

  assert.deepEqual(response, {
    async: false,
    external_chat_id: 'ym-chat-14632887',
    external_customer_id: 'ym-buyer-14632887',
    error: {
      code: 'general',
      message: 'Forbidden',
    },
  });
});
