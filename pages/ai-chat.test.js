/**
 * Property-based tests for AI content sanitization in AIChatPage.
 * Uses fast-check for XSS payload generation.
 *
 * **Validates: Requirements 6.3, 8.4**
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

// ── Setup DOMPurify with jsdom window ─────────────────────────────────────────

const { window } = new JSDOM('');
const purify = DOMPurify(window);

// ── Inline the sanitization pipeline from pages/ai-chat.js ───────────────────

function renderMarkdown(text) {
  const html = marked.parse(text);
  return purify.sanitize(html);
}

// ── DOM-based danger check ────────────────────────────────────────────────────
// Parses the sanitized HTML as a real DOM tree and inspects elements/attributes.
// This correctly distinguishes executable content from HTML-encoded safe text.

function hasDangerousContent(sanitizedHtml) {
  const doc = new JSDOM(sanitizedHtml).window.document;

  // No <script> elements should survive
  if (doc.querySelectorAll('script').length > 0) return true;

  for (const el of doc.querySelectorAll('*')) {
    // No event handler attributes (on*)
    for (const attr of el.attributes) {
      if (attr.name.toLowerCase().startsWith('on')) return true;
    }
    // No javascript: URIs in href or src
    const href = el.getAttribute('href') || '';
    const src = el.getAttribute('src') || '';
    if (/^javascript:/i.test(href) || /^javascript:/i.test(src)) return true;
  }

  return false;
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

/** Generates a random alphanumeric payload body */
const arbPayloadBody = fc.string({ minLength: 1, maxLength: 20 });

/** Generates XSS payloads of various types */
const arbXssPayload = fc.oneof(
  // Classic script tag
  arbPayloadBody.map(body => `<script>${body}</script>`),
  // Script tag with attributes
  arbPayloadBody.map(body => `<script type="text/javascript">${body}</script>`),
  // Inline event handlers on img
  arbPayloadBody.map(body => `<img src=x onerror="${body}">`),
  arbPayloadBody.map(body => `<img src=x onload="${body}">`),
  // javascript: URI in anchor
  arbPayloadBody.map(body => `<a href="javascript:${body}">click</a>`),
  // onclick on arbitrary element
  arbPayloadBody.map(body => `<div onclick="${body}">text</div>`),
  // Mixed: markdown wrapping XSS
  arbPayloadBody.map(body => `**bold** <script>${body}</script> _italic_`),
  // XSS inside markdown link
  arbPayloadBody.map(body => `[link](javascript:${body})`),
  // Nested/obfuscated variants
  arbPayloadBody.map(body => `<IMG SRC=x ONERROR="${body}">`),
  arbPayloadBody.map(body => `<svg onload="${body}"></svg>`),
);

/** Generates strings that embed XSS payloads within markdown prose */
const arbMarkdownWithXss = fc.tuple(
  fc.string({ maxLength: 50 }),
  arbXssPayload,
  fc.string({ maxLength: 50 })
).map(([prefix, payload, suffix]) => `${prefix}\n${payload}\n${suffix}`);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AIChatPage — Property 6: Sanitização de conteúdo AI', () => {
  /**
   * **Validates: Requirements 6.3, 8.4**
   *
   * For any input containing XSS payloads, after running through
   * marked.parse() + DOMPurify.sanitize(), the output must not contain
   * any executable script content when parsed as a real DOM tree.
   *
   * Note: HTML-encoded text (e.g. &lt;script&gt;) is safe and not flagged —
   * only actual executable DOM nodes and event-handler attributes are checked.
   */
  it('no XSS payload survives the marked + DOMPurify pipeline', () => {
    fc.assert(
      fc.property(arbXssPayload, (input) => {
        const output = renderMarkdown(input);
        return !hasDangerousContent(output);
      })
    );
  });

  it('no XSS payload embedded in markdown prose survives sanitization', () => {
    fc.assert(
      fc.property(arbMarkdownWithXss, (input) => {
        const output = renderMarkdown(input);
        return !hasDangerousContent(output);
      })
    );
  });

  it('sanitized output contains no <script> elements', () => {
    fc.assert(
      fc.property(arbXssPayload, (input) => {
        const output = renderMarkdown(input);
        const doc = new JSDOM(output).window.document;
        return doc.querySelectorAll('script').length === 0;
      })
    );
  });

  it('sanitized output contains no on* event handler attributes', () => {
    fc.assert(
      fc.property(arbXssPayload, (input) => {
        const output = renderMarkdown(input);
        const doc = new JSDOM(output).window.document;
        for (const el of doc.querySelectorAll('*')) {
          for (const attr of el.attributes) {
            if (attr.name.toLowerCase().startsWith('on')) return false;
          }
        }
        return true;
      })
    );
  });

  it('sanitized output contains no javascript: URIs in href or src', () => {
    fc.assert(
      fc.property(arbXssPayload, (input) => {
        const output = renderMarkdown(input);
        const doc = new JSDOM(output).window.document;
        for (const el of doc.querySelectorAll('*')) {
          const href = el.getAttribute('href') || '';
          const src = el.getAttribute('src') || '';
          if (/^javascript:/i.test(href) || /^javascript:/i.test(src)) return false;
        }
        return true;
      })
    );
  });
});
