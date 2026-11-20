import {
  MAX_PASTE_HTML_LENGTH,
  stanzaBreaksFromHtml,
} from '../../shared/lyrics-import';

// Lyrics copied from a web page, read from both copies the clipboard holds:
// the plain text for the words, and the HTML for the stanza breaks the text
// copy loses (see `stanzaBreaksFromHtml`).

// Elements a browser lays out as blocks, so each starts and ends a stanza.
const BLOCKS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TR',
  'UL',
]);
const UNSHOWN = new Set(['HEAD', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE']);

/**
 * Reads copied HTML as text: a line per line break, a blank line between
 * blocks, and white space collapsed as a browser shows it. DOMParser builds
 * an inert document: nothing in it runs or loads.
 */
export function textOfHtml(html: string): string {
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  let text = '';
  const read = (node: Node, isPreformatted: boolean): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? '';
      text += isPreformatted ? value : value.replace(/[ \t\n\f\r]+/gu, ' ');
      return;
    }
    if (!(node instanceof Element) || UNSHOWN.has(node.tagName)) return;
    if (node.tagName === 'BR') {
      text += '\n';
      return;
    }
    const isBlock = BLOCKS.has(node.tagName);
    if (isBlock) text += '\n\n';
    node.childNodes.forEach((child) =>
      read(child, isPreformatted || node.tagName === 'PRE'),
    );
    if (isBlock) text += '\n\n';
  };
  read(body, false);
  return text;
}

/**
 * The lyrics to paste from a clipboard's text and HTML copies: the text, with
 * the HTML's stanza breaks when it has some the text lost; otherwise null, to
 * paste the text as it is.
 */
export function lyricsWithStanzaBreaks(
  plain: string,
  html: string,
): string | null {
  if (html === '' || html.length > MAX_PASTE_HTML_LENGTH) return null;
  return stanzaBreaksFromHtml(plain, textOfHtml(html));
}
