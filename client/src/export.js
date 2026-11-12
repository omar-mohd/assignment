import TurndownService from 'turndown';

function safeFilename(title) {
  return (
    (title || 'document')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .trim()
      .slice(0, 100) || 'document'
  );
}

export function htmlToMarkdown(html) {
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
  td.keep(['u']); // Markdown has no underline; keep the tag (most renderers support it)
  // TipTap wraps list-item text in <p>; unwrap so lists stay tight.
  td.addRule('tightListParagraph', {
    filter: (node) => node.nodeName === 'P' && node.parentNode?.nodeName === 'LI',
    replacement: (content) => content,
  });
  return td.turndown(html || '');
}

export function downloadMarkdown(title, html) {
  const md = `${htmlToMarkdown(html)}\n`;
  const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${safeFilename(title)}.md` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * PDF via the browser's print engine ("Save as PDF"): selectable text, real fonts, zero dependencies.
 * Print CSS (styles.css @media print) hides the app chrome; the doc title becomes the default file name.
 */
export function exportPdf(title) {
  const previous = document.title;
  document.title = safeFilename(title);
  window.addEventListener('afterprint', () => (document.title = previous), { once: true });
  window.print();
}
