import type {
  AnnotationRequest,
  AnnotationResponse,
  Annotation,
  ModelOption,
  ProviderConfig,
  ReaderProfile,
  SessionState,
} from '@/shared/types';

export interface LLMProvider {
  id: string;
  name: string;
  models: ModelOption[];

  generateAnnotations(
    request: AnnotationRequest,
    config: ProviderConfig,
  ): Promise<AnnotationResponse>;

  streamAnnotations(
    request: AnnotationRequest,
    config: ProviderConfig,
    onAnnotation: (annotation: Annotation) => void,
  ): Promise<{ usage: { inputTokens: number; outputTokens: number } }>;

  updateReaderProfile(
    current: ReaderProfile,
    session: SessionState,
    config: ProviderConfig,
  ): Promise<ReaderProfile>;

  generatePageSummary(
    text: string,
    title: string,
    config: ProviderConfig,
  ): Promise<{ summary: string; keyClaims: string[]; topics: string[] }>;

  testConnection(config: ProviderConfig): Promise<boolean>;
}
