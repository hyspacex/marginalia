export const anthropicFixtures = {
  generate: {
    body: JSON.stringify({
      content: [{ type: 'text', text: 'hello from anthropic' }],
      usage: {
        input_tokens: 12,
        output_tokens: 5,
      },
    }),
  },
  testConnection: {
    body: JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 3,
        output_tokens: 1,
      },
    }),
  },
  streamChunks: [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\n\n',
    'data: {"type":"content_block_',
    'delta","delta":{"text":"hel"}}\n\n',
    'data: {"type":"content_block_delta","delta":{"text":"lo"}}\n\n',
    'data: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
    'data: [DONE]\n\n',
  ],
  errors: {
    auth: JSON.stringify({ error: { message: 'bad key' } }),
    rateLimit: JSON.stringify({ error: { message: 'slow down' } }),
    server: JSON.stringify({ error: { message: 'server problem' } }),
  },
};

export const openAiFixtures = {
  generate: {
    body: JSON.stringify({
      output_text: 'hello from openai',
      usage: {
        input_tokens: 9,
        output_tokens: 4,
      },
    }),
  },
  testConnection: {
    body: JSON.stringify({
      output_text: 'ok',
      usage: {
        input_tokens: 3,
        output_tokens: 1,
      },
    }),
  },
  streamChunks: [
    'data: {"type":"response.output_text.delta","delta":"hel"}\n\n',
    'data: {"type":"response.output_t',
    'ext.delta","delta":"lo"}\n\n',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":6}}}\n\n',
    'data: [DONE]\n\n',
  ],
  errors: {
    auth: JSON.stringify({ error: { message: 'bad key' } }),
    rateLimit: JSON.stringify({ error: { message: 'slow down' } }),
    server: JSON.stringify({ error: { message: 'server problem' } }),
  },
};
