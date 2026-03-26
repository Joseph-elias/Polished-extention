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
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  let node: Node | null = sel.anchorNode;
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentNode;
  }
  if (!(node instanceof Element)) return null;

  const contentEditable = node.closest('[contenteditable="true"], [contenteditable="plaintext-only"]');
  if (contentEditable instanceof HTMLElement) {
    return contentEditable;
  }

  const inputLike = node.closest('textarea, input');
  if (isTextInput(inputLike)) return inputLike;
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

  const sel = window.getSelection();
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

function updateSnapshotFromContext() {
  const active = document.activeElement;
  if (isEditable(active)) {
    lastSnapshot = buildSnapshotFromElement(active);
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
    input.dispatchEvent(new Event('input', { bubbles: true }));
    lastSnapshot = buildSnapshotFromElement(input);
    return;
  }

  const editable = snapshot.el;
  editable.focus();

  if (snapshot.range) {
    const range = snapshot.range.cloneRange();
    range.deleteContents();
    range.insertNode(document.createTextNode(newText));
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      const caretRange = document.createRange();
      caretRange.selectNodeContents(editable);
      caretRange.collapse(false);
      sel.addRange(caretRange);
    }
  } else {
    editable.innerText = newText;
  }

  editable.dispatchEvent(new Event('input', { bubbles: true }));
  lastSnapshot = buildSnapshotFromElement(editable);
}

document.addEventListener('focusin', () => {
  updateSnapshotFromContext();
});

document.addEventListener('selectionchange', () => {
  updateSnapshotFromContext();
});

document.addEventListener('keyup', () => {
  updateSnapshotFromContext();
});

document.addEventListener('mouseup', () => {
  updateSnapshotFromContext();
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
