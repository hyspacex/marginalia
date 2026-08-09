import type {
  Annotation,
  AnnotationRequest,
  ContentType,
  ModelOption,
  PageSummaryV2,
  ProviderConfig,
  ProviderConfigInput,
  ReaderProfile,
  SessionState,
  SummaryRequest,
  SummarySection,
  TokenUsage,
} from '@/shared/types';
import { buildAnnotationPrompt, buildProfileUpdatePrompt, buildSummaryPrompt } from './prompt-builder';
import { getProviderDescriptor } from './provider-registry';
import { ProviderError } from './provider';
import { createAnnotationStreamParser, createSummaryStreamParser, parseReaderProfile } from './response-parsers';

interface LlmServiceDeps {
  fetch?: typeof fetch;
  now?: () => number;
  generateId?: () => string;
}

export interface StreamAnnotationsResult {
  usage: TokenUsage;
}

const ANNOTATION_MAX_OUTPUT_TOKENS = 4096;
const SUMMARY_MAX_OUTPUT_TOKENS = 2048;
const PROFILE_MAX_OUTPUT_TOKENS = 2048;

export function createLlmService(deps: LlmServiceDeps = {}) {
  const now = deps.now || (() => Date.now());
  const generateId = deps.generateId || (() => crypto.randomUUID());

  function resolve(configInput: ProviderConfigInput | ProviderConfig) {
    const descriptor = getProviderDescriptor(configInput.providerId);
    const config = 'resolvedModel' in configInput
      ? configInput
      : descriptor.resolveConfig(configInput);
    const transport = descriptor.createTransport({ fetch: deps.fetch });

    return { descriptor, config, transport };
  }

  function ensureConfigured(config: ProviderConfig) {
    if (!config.apiKey.trim()) {
      throw new ProviderError(config.providerId, 'auth', 'API key is required');
    }
  }

  function toProviderError(error: unknown, config: ProviderConfig): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    return new ProviderError(config.providerId, 'unknown', String(error));
  }

  return {
    async streamAnnotations(
      request: AnnotationRequest,
      configInput: ProviderConfigInput | ProviderConfig,
      onAnnotation: (annotation: Annotation) => void,
    ): Promise<StreamAnnotationsResult> {
      const { config, transport } = resolve(configInput);
      ensureConfigured(config);

      const { system, user } = buildAnnotationPrompt(request);
      const parser = createAnnotationStreamParser({ now, generateId });

      try {
        const result = await transport.streamText({
          config,
          systemPrompt: system,
          userPrompt: user,
          maxOutputTokens: ANNOTATION_MAX_OUTPUT_TOKENS,
        }, (delta) => {
          for (const annotation of parser.push(delta)) {
            onAnnotation(annotation);
          }
        });

        for (const annotation of parser.flush()) {
          onAnnotation(annotation);
        }

        return result;
      } catch (error) {
        throw toProviderError(error, config);
      }
    },

    async streamPageSummary(
      request: SummaryRequest,
      configInput: ProviderConfigInput | ProviderConfig,
      handlers: {
        onMeta?: (contentType: ContentType) => void;
        onSection?: (section: SummarySection) => void;
      } = {},
    ): Promise<{ summary: PageSummaryV2; usage: TokenUsage }> {
      const { config, transport } = resolve(configInput);
      ensureConfigured(config);

      const { system, user } = buildSummaryPrompt(request);

      let contentType: ContentType = request.contentType ?? 'other';
      const sections: SummarySection[] = [];
      let keyClaims: string[] = [];
      let topics: string[] = [];

      const parser = createSummaryStreamParser({
        onMeta: (type) => {
          contentType = type;
          handlers.onMeta?.(type);
        },
        onSection: (section) => {
          sections.push(section);
          handlers.onSection?.(section);
        },
        onGraph: (graph) => {
          keyClaims = graph.keyClaims;
          topics = graph.topics;
        },
      });

      try {
        const result = await transport.streamText({
          config,
          systemPrompt: system,
          userPrompt: user,
          maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        }, (delta) => {
          parser.push(delta);
        });

        parser.flush();

        if (sections.length === 0) {
          throw new ProviderError(config.providerId, 'protocol', 'Summary stream contained no sections');
        }

        return {
          summary: { version: 2, contentType, sections, keyClaims, topics },
          usage: result.usage,
        };
      } catch (error) {
        throw toProviderError(error, config);
      }
    },

    async updateReaderProfile(
      current: ReaderProfile,
      session: SessionState,
      configInput: ProviderConfigInput | ProviderConfig,
    ): Promise<ReaderProfile> {
      const { config, transport } = resolve(configInput);
      ensureConfigured(config);

      const { system, user } = buildProfileUpdatePrompt(current, session);

      try {
        const result = await transport.generateText({
          config,
          systemPrompt: system,
          userPrompt: user,
          maxOutputTokens: PROFILE_MAX_OUTPUT_TOKENS,
        });

        return parseReaderProfile(result.text, now, config.providerId);
      } catch (error) {
        const providerError = toProviderError(error, config);
        if (providerError.code === 'protocol') {
          return current;
        }
        throw providerError;
      }
    },

    async testConnection(configInput: ProviderConfigInput | ProviderConfig): Promise<void> {
      const { config, transport } = resolve(configInput);
      ensureConfigured(config);

      try {
        await transport.testConnection(config);
      } catch (error) {
        throw toProviderError(error, config);
      }
    },

    async listModels(configInput: ProviderConfigInput | ProviderConfig): Promise<ModelOption[]> {
      const { config, transport } = resolve(configInput);
      ensureConfigured(config);

      try {
        return await transport.listModels(config);
      } catch (error) {
        throw toProviderError(error, config);
      }
    },
  };
}
