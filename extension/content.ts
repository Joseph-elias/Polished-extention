// Content script for Polished
// Tracks the last editable selection so popup actions still work after focus moves.

type EditableEl = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface InputSelectionSnapshot {
  type: 'input';
  el: HTMLInputElement | HTMLTextAreaElement;
  selectedText: string;
  fullText: string;
  selectionStart: number;
  selectionEnd: number;
}

interface ContentEditableSelectionSnapshot {
  type: 'contenteditable';
  el: HTMLElement;
  selectedText: string;
  fullText: string;
  range: Range | null;
}

type SelectionSnapshot = InputSelectionSnapshot | ContentEditableSelectionSnapshot;

let lastSnapshot: SelectionSnapshot | null = null;

function nodeToElement(node: Node | EventTarget | null): Element | null {
  if (!node) return null;
  if (node instanceof Element) return node;
  if (node instanceof Node && node.nodeType === Node.TEXT_NODE) return node.parentElement;
  return null;
}

function closestAcrossShadow(start: Element | null, selector: string): Element | null {
  let current: Element | null = start;
  while (current) {
    const hit = current.closest(selector);
    if (hit) return hit;
    const root = current.getRootNode();
    if (root instanceof ShadowRoot) {
      current = root.host;
    } else {
      break;
    }
  }
  return null;
}

function getDeepActiveElement(): Element | null {
  let active: Element | null = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

function getSelectionForElement(el: HTMLElement): Selection | null {
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) {
    const rootWithSelection = root as ShadowRoot & { getSelection?: () => Selection | null };
    if (typeof rootWithSelection.getSelection === 'function') {
      const sel = rootWithSelection.getSelection();
      if (sel) return sel;
    }
  }
  return window.getSelection();
}

function getEditableFromNode(node: Node | EventTarget | null): EditableEl | null {
  const el = nodeToElement(node);
  if (!el) return null;

  const contentEditable = closestAcrossShadow(
    el,
    '[contenteditable]:not([contenteditable="false"]), [contenteditable="plaintext-only"]'
  );
  if (contentEditable instanceof HTMLElement) return contentEditable;

  const inputLike = closestAcrossShadow(el, 'textarea, input');
  if (isTextInput(inputLike)) return inputLike;
  return null;
}

function dispatchInputLikeEvents(el: HTMLElement, data: string) {
  try {
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data
    }));
  } catch {
    // Ignore when InputEvent constructor is unavailable.
  }

  try {
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data
    }));
  } catch {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function selectionRangeInside(el: HTMLElement): Range | null {
  const sel = getSelectionForElement(el);
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  return el.contains(range.commonAncestorContainer) ? range : null;
}

function setCaretToEnd(el: HTMLElement) {
  const sel = getSelectionForElement(el);
  if (!sel) return;
  const caretRange = document.createRange();
  caretRange.selectNodeContents(el);
  caretRange.collapse(false);
  sel.removeAllRanges();
  sel.addRange(caretRange);
}

function tryExecInsertText(el: HTMLElement, text: string): boolean {
  const liveRange = selectionRangeInside(el);
  if (!liveRange) return false;
  if (typeof document.execCommand !== 'function') return false;
  try {
    return document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}

function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  const allowedTypes = ['text', 'search', 'email', 'url', 'tel', 'password'];
  return allowedTypes.includes(input.type || 'text');
}

function isEditable(el: Element | null): el is EditableEl {
  if (!el) return false;
  return isTextInput(el) || (el as HTMLElement).isContentEditable;
}

function getEditableFromSelection(): EditableEl | null {
  const candidates: Array<Selection | null> = [window.getSelection()];
  const deepActive = getDeepActiveElement();
  if (deepActive) {
    const root = deepActive.getRootNode();
    if (root instanceof ShadowRoot) {
      const rootWithSelection = root as ShadowRoot & { getSelection?: () => Selection | null };
      if (typeof rootWithSelection.getSelection === 'function') {
        candidates.push(rootWithSelection.getSelection());
      }
    }
  }

  for (const sel of candidates) {
    if (!sel || sel.rangeCount === 0) continue;
    const editable = getEditableFromNode(sel.anchorNode);
    if (editable) return editable;
  }
  return null;
}

function buildSnapshotFromElement(el: EditableEl): SelectionSnapshot {
  if (isTextInput(el)) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const hasSelection = start !== end;
    return {
      type: 'input',
      el,
      selectedText: hasSelection ? el.value.substring(start, end) : el.value,
      fullText: el.value,
      selectionStart: start,
      selectionEnd: end
    };
  }

  const sel = getSelectionForElement(el);
  let selectedText = '';
  let range: Range | null = null;

  if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode) && el.contains(sel.focusNode)) {
    selectedText = sel.toString();
    if (selectedText) {
      range = sel.getRangeAt(0).cloneRange();
    }
  }

  return {
    type: 'contenteditable',
    el,
    selectedText: selectedText || el.innerText,
    fullText: el.innerText,
    range
  };
}

function updateSnapshotFromContext(preferredNode?: Node | EventTarget | null) {
  const fromPreferred = getEditableFromNode(preferredNode ?? null);
  if (fromPreferred) {
    lastSnapshot = buildSnapshotFromElement(fromPreferred);
    return;
  }

  const deepActive = getDeepActiveElement();
  if (isEditable(deepActive)) {
    lastSnapshot = buildSnapshotFromElement(deepActive);
    return;
  }

  const fromSelection = getEditableFromSelection();
  if (fromSelection) {
    lastSnapshot = buildSnapshotFromElement(fromSelection);
  }
}

function getBestSnapshot(): SelectionSnapshot | null {
  updateSnapshotFromContext();
  if (!lastSnapshot) return null;
  if (!document.contains(lastSnapshot.el)) return null;
  return lastSnapshot;
}

function replaceUsingSnapshot(snapshot: SelectionSnapshot, newText: string) {
  if (snapshot.type === 'input') {
    const input = snapshot.el;
    const liveStart = input.selectionStart;
    const liveEnd = input.selectionEnd;
    const hasLiveSelection = liveStart !== null && liveEnd !== null && liveStart !== liveEnd;

    const start = hasLiveSelection ? (liveStart as number) : snapshot.selectionStart;
    const end = hasLiveSelection ? (liveEnd as number) : snapshot.selectionEnd;
    const before = input.value.substring(0, start);
    const after = input.value.substring(end);
    input.value = before + newText + after;
    const caret = before.length + newText.length;
    input.focus();
    input.setSelectionRange(caret, caret);
    try {
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertReplacementText',
        data: newText
      }));
    } catch {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    lastSnapshot = buildSnapshotFromElement(input);
    return;
  }

  const editable = snapshot.el;
  editable.focus();

  if (tryExecInsertText(editable, newText)) {
    // execCommand('insertText') already triggers native input events on modern editors.
    // Dispatching synthetic events here can cause duplicate insertion in apps like WhatsApp Web.
    lastSnapshot = buildSnapshotFromElement(editable);
    return;
  }

  const liveRange = selectionRangeInside(editable);
  if (liveRange) {
    const range = liveRange.cloneRange();
    range.deleteContents();
    range.insertNode(document.createTextNode(newText));
    setCaretToEnd(editable);
  } else if (snapshot.range && document.contains(snapshot.range.commonAncestorContainer)) {
    const range = snapshot.range.cloneRange();
    range.deleteContents();
    range.insertNode(document.createTextNode(newText));
    setCaretToEnd(editable);
  } else {
    editable.textContent = newText;
    setCaretToEnd(editable);
  }

  dispatchInputLikeEvents(editable, newText);
  lastSnapshot = buildSnapshotFromElement(editable);
}

document.addEventListener('focusin', (event) => {
  updateSnapshotFromContext(event.target);
});

document.addEventListener('selectionchange', () => {
  updateSnapshotFromContext();
});

document.addEventListener('keyup', (event) => {
  updateSnapshotFromContext(event.target);
});

document.addEventListener('mouseup', (event) => {
  updateSnapshotFromContext(event.target);
});

document.addEventListener('input', (event) => {
  updateSnapshotFromContext(event.target);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_ACTIVE_TEXT') {
    const snapshot = getBestSnapshot();
    sendResponse({ text: snapshot?.selectedText || '' });
    return true;
  }

  if (msg.type === 'REPLACE_ACTIVE_TEXT') {
    const snapshot = getBestSnapshot();
    if (snapshot && typeof msg.text === 'string') {
      replaceUsingSnapshot(snapshot, msg.text);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
    return true;
  }
});
