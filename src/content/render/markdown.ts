import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderMarkdownToHtml(markdown: string): string {
  if (!markdown.trim()) return '';

  const raw = marked.parse(markdown.trim(), { async: false }) as string;
  return DOMPurify.sanitize(raw);
}
