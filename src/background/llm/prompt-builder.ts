import type { AnnotationRequest, ReaderProfile, SessionState, MemoryPromptFragment } from '@/shared/types';
import basePrompt from '@/prompts/base.txt?raw';
import annotatePrompt from '@/prompts/annotate.txt?raw';

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

export function buildSummaryPrompt(
  text: string,
  title: string,
): { system: string; user: string } {
  const system = `Summarize the following page for a reading graph. Output a JSON object with:
- summary: 2-3 sentence summary
- keyClaims: array of 2-5 key claims or arguments
- topics: array of 3-7 topic tags (lowercase, hyphenated)

Output only the JSON object, nothing else.`;

  const user = `Title: ${title}\n\n${text.slice(0, 8000)}`;

  return { system, user };
}
