function copyWithSelection(text, documentObject) {
  if (!documentObject?.execCommand) throw new Error('Copying is unavailable in this browser.');
  const field = documentObject.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  documentObject.body.append(field);
  try {
    field.select();
    if (!documentObject.execCommand('copy')) throw new Error('Copying is unavailable in this browser.');
  } finally {
    field.remove();
  }
}

// Accepts the text or a promise of it. Safari only allows a clipboard write
// during the click itself, so callers start the copy before any await and the
// ClipboardItem resolves once the text is ready.
export async function copyTextToClipboard(textOrPromise, environment = {}) {
  const navigatorObject = environment.navigator || globalThis.navigator;
  const ClipboardItemClass = environment.ClipboardItem || globalThis.ClipboardItem;
  const textPromise = Promise.resolve(textOrPromise);

  if (navigatorObject?.clipboard?.write && ClipboardItemClass) {
    try {
      await navigatorObject.clipboard.write([new ClipboardItemClass({
        'text/plain': textPromise.then(text => new Blob([text], { type: 'text/plain' })),
      })]);
      return;
    } catch {
      // Older engines reject promise-backed items: try the plain text API below.
    }
  }

  const text = await textPromise;
  if (navigatorObject?.clipboard?.writeText) {
    try {
      await navigatorObject.clipboard.writeText(text);
      return;
    } catch {
      // Permission denied or an insecure context: fall back to the selection copy below.
    }
  }

  copyWithSelection(text, environment.document || globalThis.document);
}
