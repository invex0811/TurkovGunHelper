import { getCanonicalUrl } from './pageMeta.js';

function upsertHeadElement(doc, selector, create) {
  let element = doc.head.querySelector(selector);
  if (!element) {
    element = create();
    doc.head.append(element);
  }
  return element;
}

function setMetaContent(doc, attribute, key, content) {
  const element = upsertHeadElement(doc, `meta[${attribute}="${key}"]`, () => {
    const meta = doc.createElement('meta');
    meta.setAttribute(attribute, key);
    return meta;
  });
  element.setAttribute('content', content);
}

// Mirrors what scripts/prerender.mjs writes into the static pages, so the
// rendered page keeps the same title, description and canonical URL.
export function applyPageMeta(meta, doc = globalThis.document) {
  if (!meta || !doc?.head) return;
  const url = getCanonicalUrl(meta.path);
  doc.title = meta.title;
  setMetaContent(doc, 'name', 'description', meta.description);
  setMetaContent(doc, 'property', 'og:title', meta.title);
  setMetaContent(doc, 'property', 'og:description', meta.description);
  setMetaContent(doc, 'property', 'og:url', url);
  setMetaContent(doc, 'name', 'twitter:title', meta.title);
  setMetaContent(doc, 'name', 'twitter:description', meta.description);
  const canonical = upsertHeadElement(doc, 'link[rel="canonical"]', () => {
    const link = doc.createElement('link');
    link.setAttribute('rel', 'canonical');
    return link;
  });
  canonical.setAttribute('href', url);
}
