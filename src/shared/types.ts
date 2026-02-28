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
}

export interface SessionState {
  tabId: number;
  url: string;
  title: string;
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
  contextWindow: number;
  costPer1kInput: number;
  costPer1kOutput: number;
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

// Message protocol
export type RequestMessage =
  | { type: 'ANNOTATE_PAGE'; payload: { url: string; title: string; text: string } }
  | { type: 'SAVE_ANNOTATION'; payload: { annotation: Annotation } }
  | { type: 'RECORD_INTERACTION'; payload: { interaction: UserInteraction } }
  | { type: 'GET_SESSION'; payload: { tabId: number } }
  | { type: 'END_SESSION'; payload: { tabId: number } }
  | { type: 'TEST_CONNECTION'; payload: { config: ProviderConfig } };

export type ResponseMessage =
  | { type: 'ANNOTATIONS_READY'; payload: { annotations: Annotation[]; usage: TokenUsage } }
  | { type: 'ANNOTATION_CHUNK'; payload: { annotation: Annotation } }
  | { type: 'STREAM_DONE'; payload: { usage: TokenUsage } }
  | { type: 'ERROR'; payload: { message: string; code: string } };

// Port message types for streaming
export type PortMessage =
  | { type: 'START_ANNOTATE'; payload: { url: string; title: string; text: string } }
  | { type: 'ANNOTATION_CHUNK'; payload: { annotation: Annotation } }
  | { type: 'STREAM_DONE'; payload: { usage: TokenUsage } }
  | { type: 'STREAM_ERROR'; payload: { message: string; code: string } };
