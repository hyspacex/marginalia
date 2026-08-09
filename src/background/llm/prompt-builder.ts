import type {
  AnnotationRequest,
  ContentType,
  MemoryPromptFragment,
  ReaderProfile,
  SessionState,
  SummaryRequest,
} from '@/shared/types';
import basePrompt from '@/prompts/base.txt?raw';
import annotatePrompt from '@/prompts/annotate.txt?raw';
import summaryBasePrompt from '@/prompts/summary/base.txt?raw';
import summaryNewsPrompt from '@/prompts/summary/news-report.txt?raw';
import summaryOpinionPrompt from '@/prompts/summary/opinion-analysis.txt?raw';
import summaryTechnicalPrompt from '@/prompts/summary/technical-blog.txt?raw';
import summaryResearchPrompt from '@/prompts/summary/research-paper.txt?raw';
import summaryDiscussionPrompt from '@/prompts/summary/discussion-thread.txt?raw';
import summaryDocsPrompt from '@/prompts/summary/reference-docs.txt?raw';
import summaryOtherPrompt from '@/prompts/summary/other.txt?raw';
import summaryClassifyPrompt from '@/prompts/summary/classify-fallback.txt?raw';

const SUMMARY_TEMPLATES: Record<ContentType, string> = {
  'news-report': summaryNewsPrompt,
  'opinion-analysis': summaryOpinionPrompt,
  'technical-blog': summaryTechnicalPrompt,
  'research-paper': summaryResearchPrompt,
  'discussion-thread': summaryDiscussionPrompt,
  'reference-docs': summaryDocsPrompt,
  'other': summaryOtherPrompt,
};

function buildMemorySection(memory: MemoryPromptFragment): string {
  const parts: string[] = [];

  if (memory.profile) {
    parts.push(`<reader_profile>\n${memory.profile}\n</reader_profile>`);
  }

  if (memory.readingHistory) {
    parts.push(`<reading_history>\n${memory.readingHistory}\n</reading_history>`);
  }

  if (memory.sessionContext) {
    parts.push(`<session_context>\n${memory.sessionContext}\n</session_context>`);
  }

  return parts.length > 0
    ? `\n\n## Reader Context\n\n${parts.join('\n\n')}`
    : '';
}

export function buildAnnotationPrompt(request: AnnotationRequest): { system: string; user: string } {
  const memorySection = buildMemorySection(request.memoryContext);
  const system = `${basePrompt}\n\n## Annotation Guidelines\n\n${annotatePrompt}${memorySection}`;
  const user = `Page: "${request.title}" (${request.url})\n\n<page_content>\n${request.pageContent.slice(0, 12000)}\n</page_content>\n\nGenerate 3-5 inline annotations for this article.`;

  return { system, user };
}

export function buildProfileUpdatePrompt(
  current: ReaderProfile,
  session: SessionState,
): { system: string; user: string } {
  const system = `You are updating a reader profile based on a reading session. Output a valid JSON object with the same structure as the current profile, incorporating any new information from the session. Only make meaningful updates — don't change things unnecessarily.

The profile JSON must have these fields:
- expertise: Record<string, "beginner" | "intermediate" | "advanced">
- interests: string[]
- annotationPreferences: { depth: "brief" | "detailed", tone: "academic" | "collegial" | "casual" }
- readingGoals: string[]`;

  const user = `Current profile:\n${JSON.stringify(current, null, 2)}\n\nSession summary:\n- URL: ${session.url}\n- Title: ${session.title}\n- Annotations generated: ${session.annotations.length}\n- Interactions: ${session.interactions.map((i) => `${i.type}${i.text ? `: ${i.text}` : ''}`).join('; ') || 'none'}\n- Duration: ${Math.round((session.lastActiveAt - session.startedAt) / 1000)}s\n\nOutput the updated profile JSON:`;

  return { system, user };
}

export function buildSummaryPrompt(request: SummaryRequest): { system: string; user: string } {
  const typeSection = request.contentType
    ? SUMMARY_TEMPLATES[request.contentType]
    : `${summaryClassifyPrompt}\n\n${(Object.keys(SUMMARY_TEMPLATES) as ContentType[])
        .map((type) => SUMMARY_TEMPLATES[type])
        .join('\n\n')}`;

  const system = `${summaryBasePrompt}\n\n## Section schema\n\n${typeSection}${buildMemorySection(request.memoryContext)}`;
  const user = `Page: "${request.title}" (${request.url})\n\n<page_content>\n${request.text.slice(0, 12000)}\n</page_content>\n\nGenerate the structured summary as JSONL.`;

  return { system, user };
}
