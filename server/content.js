// Everything that turns user-supplied content into safe, editor-compatible HTML.
import path from 'node:path';
import sanitizeHtml from 'sanitize-html';
import mammoth from 'mammoth';
import { marked } from 'marked';
import { HttpError } from './errors.js';

export const FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS'];
const FONT_PATTERN = new RegExp(`^["']?(${FONTS.join('|')})["']?$`, 'i');

// Matches what the editor can represent; anything else is stripped.
const SANITIZE_OPTIONS = {
  allowedTags: [
    'p',
    'br',
    'h1',
    'h2',
    'h3',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'ul',
    'ol',
    'li',
    'blockquote',
    'code',
    'pre',
    'hr',
    'a',
    'span',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'], span: ['style'] },
  // Only font-family survives on spans, and only fonts the editor offers.
  allowedStyles: { span: { 'font-family': [FONT_PATTERN] } },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Mammoth emits h4-h6 for deep headings; fold them into h3.
  transformTags: { h4: 'h3', h5: 'h3', h6: 'h3' },
};

export const MAX_CONTENT_BYTES = 1_000_000; // 1 MB of HTML per document
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB per file (stays under Vercel's 4.5 MB request limit)
export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.docx'];

export function sanitizeContent(html) {
  return sanitizeHtml(html ?? '', SANITIZE_OPTIONS);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function textToHtml(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** Converts an uploaded file into { title, html }. Throws HttpError on unsupported/invalid input. */
export async function fileToDocument({ originalname, buffer }) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new HttpError(
      415,
      `Unsupported file type "${ext || 'unknown'}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    );
  }
  if (!buffer?.length) throw new HttpError(400, 'The uploaded file is empty');

  let html;
  if (ext === '.docx') {
    try {
      ({ value: html } = await mammoth.convertToHtml({ buffer }));
    } catch {
      throw new HttpError(422, 'Could not read this .docx file. Is it a valid Word document?');
    }
  } else {
    const text = buffer.toString('utf8');
    if (text.includes('\u0000')) throw new HttpError(422, 'This file does not look like plain text');
    html = ext === '.md' ? await marked.parse(text) : textToHtml(text);
  }

  const title = path.basename(originalname, ext).trim().slice(0, 200) || 'Imported document';
  return { title, html: sanitizeContent(html) };
}
