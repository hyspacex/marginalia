export interface ExtractedContent {
  title: string;
  content: string;
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  url: string;
  length: number;
}

export interface Annotation {
  id: string;
  content: string;
  anchor: string;      // REQUIRED: exact quote from article
  timestamp: number;
}

export interface AnnotationRequest {
  pageContent: string;
  memoryContext: MemoryPromptFragment;
  url: string;
  title: string;
}

export interface AnnotationResponse {
  annotations: Annotation[];
  usage: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface MemoryPromptFragment {
  profile?: string;
  readingHistory?: string;
  sessionContext?: string;
}

export interface ReaderProfile {
  expertise: Record<string, 'beginner' | 'intermediate' | 'advanced'>;
  interests: string[];
  annotationPreferences: {
    depth: 'brief' | 'detailed';
    tone: 'academic' | 'collegial' | 'casual';
  };
  readingGoals: string[];
  updatedAt: string;
}

// `summary` stays a flattened markdown string so entries written before the
// sectioned-summary redesign coexist with new ones; `sections`/`contentType`
// are optional non-indexed additions (no Dexie schema bump required).
export interface ReadingGraphEntry {
  id?: number;
  url: string;
  title: string;
  domain: string;
  readAt: string;
  durationSeconds: number;
  summary: string;
  keyClaims: string[];
  topics: string[];
  savedAnnotations: Annotation[];
  contentType?: ContentType;
  sections?: SummarySection[];
}

export type ContentType =
  | 'news-report'
  | 'opinion-analysis'
  | 'technical-blog'
  | 'research-paper'
  | 'discussion-thread'
  | 'reference-docs'
  | 'other';

export interface SummarySection {
  id: string;       // stable slug, e.g. 'what-happened', 'net-new'
  heading: string;  // display label
  markdown: string; // bullet body
}

export interface PageSummaryV2 {
  version: 2;
  contentType: ContentType;
  sections: SummarySection[];
  keyClaims: string[];
  topics: string[];
}

// Page signals collected in the content script (needs live DOM) and classified
// deterministically in the service worker; null classification falls back to
// in-prompt LLM classification.
export interface PageMetadata {
  jsonLdTypes: string[];
  ogType: string | null;
  host: string;
  urlPath: string;
  byline: string | null;
  siteName: string | null;
  wordCount: number;
}

export interface SummaryRequest {
  text: string;
  title: string;
  url: string;
  metadata: PageMetadata;
  contentType: ContentType | null;
  memoryContext: MemoryPromptFragment;
}

export type SessionMode = 'full' | 'summary-only';

export interface SessionState {
  tabId: number;
  url: string;
  title: string;
  pageContent: string;
  pageSummary: PageSummaryV2 | null;
  annotations: Annotation[];
  interactions: UserInteraction[];
  startedAt: number;
  lastActiveAt: number;
}

export interface UserInteraction {
  type: 'thumbs_up' | 'thumbs_down' | 'save' | 'highlight';
  annotationId?: string;
  text?: string;
  timestamp: number;
}

export interface ModelOption {
  id: string;
  name: string;
  contextWindow: number | null;
  costPer1kInput: number | null;
  costPer1kOutput: number | null;
}

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'local';

export type ProviderModelMode = 'catalog' | 'custom';

export interface StoredProviderConfig {
  apiKey: string;
  baseUrl: string;
  modelMode: ProviderModelMode;
  modelId: string;
  options: Record<string, string>;
}

export interface ProviderConfigInput extends StoredProviderConfig {
  providerId: ProviderId;
}

export interface StoredProvidersState {
  version: number;
  activeProviderId: ProviderId;
  configsByProvider: Partial<Record<ProviderId, StoredProviderConfig>>;
}

export interface ProviderConfig extends ProviderConfigInput {
  resolvedModel: string;
}

// Message protocol — service worker messages
export type RequestMessage =
  | { type: 'SAVE_ANNOTATION'; payload: { annotation: Annotation } }
  | { type: 'RECORD_INTERACTION'; payload: { interaction: UserInteraction } }
  | { type: 'GET_SESSION'; payload: { tabId: number } }
  | { type: 'END_SESSION'; payload: { tabId: number } }
  | { type: 'LIST_MODELS'; payload: { config: ProviderConfigInput } }
  | { type: 'TEST_CONNECTION'; payload: { config: ProviderConfigInput } }
  | { type: 'ADD_AUTO_SITE'; payload: { hostname: string } };

// Message protocol — messages to the content script
export type ContentMessage =
  | { type: 'TOGGLE_ANNOTATIONS' }
  | { type: 'PAGE_NAVIGATED'; payload: { url: string } };

export type ResponseMessage =
  | { type: 'ANNOTATIONS_READY'; payload: { annotations: Annotation[]; usage: TokenUsage } }
  | { type: 'MODEL_CATALOG'; payload: { models: ModelOption[] } }
  | { type: 'ANNOTATION_CHUNK'; payload: { annotation: Annotation } }
  | { type: 'STREAM_DONE'; payload: { usage: TokenUsage } }
  | { type: 'ERROR'; payload: { message: string; code: string } };

// Port message types for streaming
export type PortMessage =
  | { type: 'START_ANNOTATE'; payload: {
      url: string;
      title: string;
      text: string;
      metadata: PageMetadata;
      mode: SessionMode;
    } }
  | { type: 'ANNOTATION_CHUNK'; payload: { annotation: Annotation } }
  | { type: 'SUMMARY_META'; payload: { contentType: ContentType } }
  | { type: 'SUMMARY_SECTION'; payload: { section: SummarySection } }
  | { type: 'SUMMARY_DONE'; payload: { keyClaims: string[]; topics: string[] } }
  | { type: 'SUMMARY_ERROR'; payload: { message: string } }
  | { type: 'STREAM_DONE'; payload: { usage: TokenUsage } }
  | { type: 'STREAM_ERROR'; payload: { message: string; code: string } };
