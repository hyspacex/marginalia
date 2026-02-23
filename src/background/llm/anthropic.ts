import type {
  Annotation,
  AnnotationMode,
  AnnotationRequest,
  AnnotationResponse,
  ProviderConfig,
  ReaderProfile,
  SessionState,
  TokenUsage,
} from '@/shared/types';
import { ANTHROPIC_MODELS } from '@/shared/constants';
import type { LLMProvider } from './provider';
import { buildAnnotationPrompt, buildProfileUpdatePrompt, buildSummaryPrompt } from './prompt-builder';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: AnthropicMessage[];
  stream?: boolean;
}

function parseAnnotationLines(text: string, modes: AnnotationMode[]): Annotation[] {
  const annotations: Annotation[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.mode && parsed.content) {
        annotations.push({
          id: crypto.randomUUID(),
          mode: parsed.mode as AnnotationMode,
          content: parsed.content,
          anchor: parsed.anchor,
          timestamp: Date.now(),
        });
      }
    } catch {
      // Skip unparseable lines
    }
  }
  return annotations;
}

async function anthropicFetch(
  config: ProviderConfig,
  body: AnthropicRequest,
): Promise<Response> {
  const res = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    let message = `Anthropic API error: ${res.status}`;
    try {
      const parsed = JSON.parse(errBody);
      message = parsed.error?.message || message;
    } catch { /* use default */ }

    if (res.status === 401) throw new Error('Invalid API key');
    if (res.status === 429) throw new Error('Rate limited — please wait a moment');
    throw new Error(message);
  }

  return res;
}

export const anthropicProvider: LLMProvider = {
  id: 'anthropic',
  name: 'Anthropic (Claude)',
  models: ANTHROPIC_MODELS,

  async generateAnnotations(
    request: AnnotationRequest,
    config: ProviderConfig,
  ): Promise<AnnotationResponse> {
    const { system, user } = buildAnnotationPrompt(request);

    const res = await anthropicFetch(config, {
      model: config.model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const annotations = parseAnnotationLines(text, request.modes);
    const usage: TokenUsage = {
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
    };

    return { annotations, usage };
  },

  async streamAnnotations(
    request: AnnotationRequest,
    config: ProviderConfig,
    onAnnotation: (annotation: Annotation) => void,
  ): Promise<{ usage: TokenUsage }> {
    const { system, user } = buildAnnotationPrompt(request);

    const res = await anthropicFetch(config, {
      model: config.model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
      stream: true,
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);

          if (event.type === 'content_block_delta' && event.delta?.text) {
            fullText += event.delta.text;

            // Try to parse complete JSONL lines from accumulated text
            const textLines = fullText.split('\n');
            // Keep the last (possibly incomplete) line in fullText
            const completeLines = textLines.slice(0, -1);
            fullText = textLines[textLines.length - 1];

            for (const jsonLine of completeLines) {
              const trimmed = jsonLine.trim();
              if (!trimmed || !trimmed.startsWith('{')) continue;
              try {
                const parsed = JSON.parse(trimmed);
                if (parsed.mode && parsed.content) {
                  onAnnotation({
                    id: crypto.randomUUID(),
                    mode: parsed.mode as AnnotationMode,
                    content: parsed.content,
                    anchor: parsed.anchor,
                    timestamp: Date.now(),
                  });
                }
              } catch {
                // Incomplete JSON, skip
              }
            }
          }

          if (event.type === 'message_delta' && event.usage) {
            usage.outputTokens = event.usage.output_tokens || 0;
          }

          if (event.type === 'message_start' && event.message?.usage) {
            usage.inputTokens = event.message.usage.input_tokens || 0;
          }
        } catch {
          // Skip unparseable SSE events
        }
      }
    }

    // Parse any remaining text
    if (fullText.trim()) {
      const trimmed = fullText.trim();
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.mode && parsed.content) {
            onAnnotation({
              id: crypto.randomUUID(),
              mode: parsed.mode as AnnotationMode,
              content: parsed.content,
              anchor: parsed.anchor,
              timestamp: Date.now(),
            });
          }
        } catch { /* skip */ }
      }
    }

    return { usage };
  },

  async updateReaderProfile(
    current: ReaderProfile,
    session: SessionState,
    config: ProviderConfig,
  ): Promise<ReaderProfile> {
    const { system, user } = buildProfileUpdatePrompt(current, session);

    const res = await anthropicFetch(config, {
      model: config.model,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    try {
      // Extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const profile = JSON.parse(jsonMatch[0]) as ReaderProfile;
        profile.updatedAt = new Date().toISOString();
        return profile;
      }
    } catch {
      // Return current profile if parsing fails
    }

    return current;
  },

  async generatePageSummary(
    text: string,
    title: string,
    config: ProviderConfig,
  ): Promise<{ summary: string; keyClaims: string[]; topics: string[] }> {
    const { system, user } = buildSummaryPrompt(text, title);

    const res = await anthropicFetch(config, {
      model: config.model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const data = await res.json();
    const responseText = data.content?.[0]?.text || '';

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch { /* fall through */ }

    return { summary: '', keyClaims: [], topics: [] };
  },

  async testConnection(config: ProviderConfig): Promise<boolean> {
    try {
      const res = await anthropicFetch(config, {
        model: config.model,
        max_tokens: 10,
        system: 'Respond with "ok".',
        messages: [{ role: 'user', content: 'Test' }],
      });
      const data = await res.json();
      return !!data.content;
    } catch {
      return false;
    }
  },
};
