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
  listModels: {
    body: JSON.stringify({
      data: [
        { id: 'claude-haiku-3-5-20241022', display_name: 'Claude Haiku 3.5' },
        { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
      ],
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
  listModels: {
    body: JSON.stringify({
      data: [
        { id: 'gpt-5.4-2026-03-05', created: 1 },
        { id: 'gpt-image-1', created: 1 },
        { id: 'o4-mini', created: 1 },
      ],
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

export const openRouterFixtures = {
  generate: {
    body: JSON.stringify({
      output_text: 'hello from openrouter',
      usage: {
        input_tokens: 14,
        output_tokens: 8,
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
  listModels: {
    body: JSON.stringify({
      data: [
        {
          id: 'openai/gpt-4.1-mini',
          name: 'OpenAI GPT-4.1 mini',
          context_length: 1047576,
          pricing: {
            prompt: '0.0000004',
            completion: '0.0000016',
          },
          architecture: {
            output_modalities: ['text'],
          },
        },
        {
          id: 'openai/gpt-image-1',
          name: 'OpenAI GPT Image 1',
          context_length: 128000,
          pricing: {
            prompt: '0.000001',
            completion: '0.000002',
          },
          architecture: {
            output_modalities: ['image'],
          },
        },
      ],
    }),
  },
  streamChunks: [
    'data: {"type":"response.output_text.delta","delta":"hel"}\n\n',
    'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":7}}}\n\n',
    'data: [DONE]\n\n',
  ],
  errors: {
    auth: JSON.stringify({ error: { message: 'bad key' } }),
    rateLimit: JSON.stringify({ error: { message: 'slow down' } }),
    server: JSON.stringify({ error: { message: 'server problem' } }),
  },
};
