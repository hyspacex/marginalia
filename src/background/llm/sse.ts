import type { ProviderId } from '@/shared/types';

export async function consumeSseStream(
  _providerId: ProviderId,
  stream: ReadableStream<Uint8Array>,
  onEvent: (payload: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventLines: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line) {
        flushEvent(eventLines, onEvent);
        eventLines = [];
        continue;
      }

      eventLines.push(line);
    }
  }

  if (buffer) {
    eventLines.push(buffer);
  }

  flushEvent(eventLines, onEvent);
}

function flushEvent(lines: string[], onEvent: (payload: string) => void) {
  if (lines.length === 0) return;

  const dataLines = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return;

  onEvent(dataLines.join('\n'));
}
