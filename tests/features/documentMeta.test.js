import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPageMeta } from '../../src/features/seo/documentMeta.js';
import { HOME_META, NOT_FOUND_META } from '../../src/features/seo/pageMeta.js';

// The few DOM calls applyPageMeta makes, enough to check the head it leaves.
function createHead() {
  const elements = [];
  const matches = (element, selector) => {
    const match = /^(\w+)\[(\w+(?::\w+)?)="([^"]+)"\]$/.exec(selector);
    return Boolean(match) && element.tag === match[1] && element.attributes[match[2]] === match[3];
  };
  const createElement = tag => {
    const element = {
      tag,
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      remove() { elements.splice(elements.indexOf(this), 1); },
    };
    return element;
  };
  const head = {
    querySelector: selector => elements.find(element => matches(element, selector)) ?? null,
    append: element => elements.push(element),
  };
  return { title: '', head, createElement };
}

test('a not-found page gets noindex and loses the canonical URL; the next page restores both', () => {
  const doc = createHead();
  applyPageMeta(HOME_META, doc);
  assert.equal(doc.head.querySelector('link[rel="canonical"]').getAttribute('href'), 'https://tarkovgunhelper.com/');
  assert.equal(doc.head.querySelector('meta[name="robots"]'), null);

  applyPageMeta(NOT_FOUND_META, doc);
  assert.equal(doc.title, NOT_FOUND_META.title);
  assert.equal(doc.head.querySelector('meta[name="robots"]').getAttribute('content'), 'noindex');
  assert.equal(doc.head.querySelector('link[rel="canonical"]'), null);
  assert.equal(doc.head.querySelector('meta[property="og:url"]'), null);

  applyPageMeta(HOME_META, doc);
  assert.equal(doc.head.querySelector('meta[name="robots"]'), null);
  assert.equal(doc.head.querySelector('link[rel="canonical"]').getAttribute('href'), 'https://tarkovgunhelper.com/');
  assert.equal(doc.head.querySelector('meta[property="og:url"]').getAttribute('content'), 'https://tarkovgunhelper.com/');
});
