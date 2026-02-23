import type { AnnotationRequest, AnnotationMode, ReaderProfile, SessionState, MemoryPromptFragment } from '@/shared/types';
import { MODE_LABELS } from '@/shared/constants';
import basePrompt from '@/prompts/base.txt?raw';
import closeReadingPrompt from '@/prompts/close-reading.txt?raw';
import contextPrompt from '@/prompts/context.txt?raw';
import devilAdvocatePrompt from '@/prompts/devil-advocate.txt?raw';

const modePrompts: Record<AnnotationMode, string> = {
  'close-reading': closeReadingPrompt,
  'context': contextPrompt,
  'devil-advocate': devilAdvocatePrompt,
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

function buildModeInstructions(modes: AnnotationMode[]): string {
  return modes
    .map((mode) => `### ${MODE_LABELS[mode]}\n\n${modePrompts[mode]}`)
    .join('\n\n');
}

export function buildAnnotationPrompt(request: AnnotationRequest): { system: string; user: string } {
  const modeInstructions = buildModeInstructions(request.modes);
  const memorySection = buildMemorySection(request.memoryContext);
  const modeList = request.modes.map((m) => MODE_LABELS[m]).join(', ');

  const system = `${basePrompt}\n\n## Active Modes\n\n${modeInstructions}${memorySection}`;

  let user: string;
  if (request.selectedText) {
    user = `The reader has selected the following passage for annotation:\n\n<selected_text>\n${request.selectedText}\n</selected_text>\n\nFrom the page "${request.title}" (${request.url}):\n\n<page_content>\n${request.pageContent.slice(0, 12000)}\n</page_content>\n\nGenerate annotations for the selected passage using these modes: ${modeList}`;
  } else {
    user = `Page: "${request.title}" (${request.url})\n\n<page_content>\n${request.pageContent.slice(0, 12000)}\n</page_content>\n\nGenerate annotations for this page using these modes: ${modeList}`;
  }

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
- annotationPreferences: { defaultModes: string[], depth: "brief" | "detailed", tone: "academic" | "collegial" | "casual" }
- readingGoals: string[]`;

  const user = `Current profile:\n${JSON.stringify(current, null, 2)}\n\nSession summary:\n- URL: ${session.url}\n- Title: ${session.title}\n- Modes used: ${session.modes.join(', ')}\n- Annotations generated: ${session.annotations.length}\n- Interactions: ${session.interactions.map((i) => `${i.type}${i.text ? `: ${i.text}` : ''}`).join('; ') || 'none'}\n- Duration: ${Math.round((session.lastActiveAt - session.startedAt) / 1000)}s\n\nOutput the updated profile JSON:`;

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
