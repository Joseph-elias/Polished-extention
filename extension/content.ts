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
const INLINE_API_URL = 'https://polished-extention.onrender.com/rewrite';
const INLINE_TOOLBAR_ID = 'polished-inline-toolbar';
const INLINE_TOOLBAR_STATUS_ID = 'polished-inline-toolbar-status';
const INLINE_TOOLBAR_STYLE_ID = 'polished-inline-toolbar-style';

type RewriteMode = 'grammar_only' | 'natural' | 'professional' | 'concise';

interface InlineAction {
  label: string;
  mode: RewriteMode;
}

const INLINE_ACTIONS: InlineAction[] = [
  { label: 'Grammar Only', mode: 'grammar_only' },
  { label: 'Natural', mode: 'natural' },
  { label: 'Professional', mode: 'professional' },
  { label: 'Concise', mode: 'concise' }
];

let toolbarBusy = false;
let toolbarEl: HTMLDivElement | null = null;
let toolbarStatusEl: HTMLDivElement | null = null;
let selectionRaf: number | null = null;

function ensureInlineToolbarStyles() {
  if (document.getElementById(INLINE_TOOLBAR_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = INLINE_TOOLBAR_STYLE_ID;
  style.textContent = `
    #${INLINE_TOOLBAR_ID} {
      position: fixed;
      z-index: 2147483647;
      display: none;
      max-width: min(560px, calc(100vw - 16px));
      pointer-events: auto;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.28);
      background:
        radial-gradient(circle at top right, rgba(111, 214, 197, 0.27), transparent 48%),
        linear-gradient(135deg, rgba(11, 17, 27, 0.96), rgba(14, 25, 40, 0.92));
      box-shadow:
        0 10px 30px rgba(2, 8, 20, 0.35),
        0 2px 8px rgba(0, 0, 0, 0.22);
      backdrop-filter: blur(12px) saturate(135%);
      -webkit-backdrop-filter: blur(12px) saturate(135%);
      padding: 10px;
      font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
      color: #ecf4ff;
      animation: polished-toolbar-in 130ms ease-out;
    }

    #${INLINE_TOOLBAR_ID}[data-busy="true"] {
      cursor: wait;
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-btn {
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 999px;
      padding: 7px 11px;
      min-height: 30px;
      font-size: 12px;
      line-height: 1;
      letter-spacing: 0.01em;
      font-weight: 600;
      color: #f5fbff;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.06));
      cursor: pointer;
      transition: transform 110ms ease, background-color 110ms ease, border-color 110ms ease, box-shadow 110ms ease, opacity 110ms ease;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-btn:hover:not(:disabled) {
      border-color: rgba(255, 255, 255, 0.45);
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.09));
      transform: translateY(-1px);
      box-shadow: 0 6px 14px rgba(2, 8, 20, 0.32);
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-btn:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-btn:focus-visible {
      outline: 2px solid rgba(112, 228, 208, 0.9);
      outline-offset: 1px;
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-btn:disabled {
      opacity: 0.55;
      cursor: wait;
      transform: none;
    }

    #${INLINE_TOOLBAR_STATUS_ID} {
      margin-top: 8px;
      min-height: 14px;
      font-size: 11px;
      font-weight: 500;
      color: rgba(236, 244, 255, 0.86);
      display: none;
    }

    #${INLINE_TOOLBAR_STATUS_ID}[data-visible="true"] {
      display: block;
    }

    #${INLINE_TOOLBAR_STATUS_ID}[data-error="true"] {
      color: #ffc8cf;
    }

    #${INLINE_TOOLBAR_STATUS_ID}[data-loading="true"]::after {
      content: "";
      display: inline-block;
      margin-left: 6px;
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: rgba(112, 228, 208, 0.92);
      box-shadow: 0 0 0 0 rgba(112, 228, 208, 0.75);
      animation: polished-pulse 1.2s infinite;
      vertical-align: middle;
    }

    @keyframes polished-toolbar-in {
      from { opacity: 0; transform: translate(-50%, calc(var(--polished-shift, 0%) + 4px)) scale(0.98); }
      to { opacity: 1; transform: translate(-50%, var(--polished-shift, 0%)) scale(1); }
    }

    @keyframes polished-pulse {
      0% { box-shadow: 0 0 0 0 rgba(112, 228, 208, 0.75); }
      80% { box-shadow: 0 0 0 8px rgba(112, 228, 208, 0); }
      100% { box-shadow: 0 0 0 0 rgba(112, 228, 208, 0); }
    }
  `;
  document.documentElement.appendChild(style);
}

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

function ensureInlineToolbar(): HTMLDivElement {
  if (toolbarEl && document.contains(toolbarEl)) return toolbarEl;
  ensureInlineToolbarStyles();

  const el = document.createElement('div');
  el.id = INLINE_TOOLBAR_ID;
  el.setAttribute('aria-hidden', 'true');

  const row = document.createElement('div');
  row.className = 'polished-inline-row';

  for (const action of INLINE_ACTIONS) {
    const btn = document.createElement('button');
    btn.className = 'polished-inline-btn';
    btn.type = 'button';
    btn.textContent = action.label;
    btn.dataset.mode = action.mode;
    btn.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    btn.addEventListener('click', () => {
      void runInlineRewrite(action.mode);
    });
    row.appendChild(btn);
  }

  const status = document.createElement('div');
  status.id = INLINE_TOOLBAR_STATUS_ID;

  el.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  el.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  el.appendChild(row);
  el.appendChild(status);
  document.documentElement.appendChild(el);
  toolbarEl = el;
  toolbarStatusEl = status;
  return el;
}

function hideInlineToolbar() {
  if (!toolbarEl) return;
  toolbarEl.style.display = 'none';
  toolbarEl.setAttribute('aria-hidden', 'true');
  toolbarEl.removeAttribute('data-busy');
  if (toolbarStatusEl) {
    toolbarStatusEl.dataset.visible = 'false';
    toolbarStatusEl.dataset.loading = 'false';
    toolbarStatusEl.dataset.error = 'false';
    toolbarStatusEl.textContent = '';
  }
}

function setToolbarStatus(message: string, isError = false, isLoading = false) {
  const status = toolbarStatusEl;
  if (!status) return;
  if (!message) {
    status.dataset.visible = 'false';
    status.dataset.loading = 'false';
    status.dataset.error = 'false';
    status.textContent = '';
    return;
  }
  status.dataset.visible = 'true';
  status.dataset.loading = isLoading ? 'true' : 'false';
  status.dataset.error = isError ? 'true' : 'false';
  status.textContent = message;
}

function getAnchorRectForSnapshot(snapshot: SelectionSnapshot): DOMRect | null {
  if (snapshot.type === 'input') {
    return snapshot.el.getBoundingClientRect();
  }

  const currentRange = selectionRangeInside(snapshot.el);
  if (currentRange) {
    const rect = currentRange.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rect;
  }

  if (snapshot.range) {
    const rect = snapshot.range.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rect;
  }

  return snapshot.el.getBoundingClientRect();
}

function positionInlineToolbar(anchorRect: DOMRect) {
  const el = ensureInlineToolbar();
  el.style.display = 'block';
  el.setAttribute('aria-hidden', 'false');

  const viewportPadding = 8;
  const centerX = anchorRect.left + (anchorRect.width / 2);
  const showAbove = anchorRect.top > 56;
  const top = showAbove ? anchorRect.top - 8 : anchorRect.bottom + 8;
  const translateY = showAbove ? '-100%' : '0%';
  el.style.setProperty('--polished-shift', translateY);

  el.style.left = `${Math.max(viewportPadding, Math.min(window.innerWidth - viewportPadding, centerX))}px`;
  el.style.top = `${Math.max(viewportPadding, Math.min(window.innerHeight - viewportPadding, top))}px`;
  el.style.transform = `translate(-50%, ${translateY})`;
}

function hasDisplayableSelection(snapshot: SelectionSnapshot | null): boolean {
  if (!snapshot) return false;
  if (!document.contains(snapshot.el)) return false;
  return !!getInlineSelectedText(snapshot).trim();
}

function getInlineSelectedText(snapshot: SelectionSnapshot): string {
  if (snapshot.type === 'input') {
    const start = snapshot.el.selectionStart ?? snapshot.selectionStart;
    const end = snapshot.el.selectionEnd ?? snapshot.selectionEnd;
    if (start === end) return '';
    return snapshot.el.value.substring(start, end);
  }

  const liveRange = selectionRangeInside(snapshot.el);
  if (liveRange && !liveRange.collapsed) {
    return liveRange.toString();
  }

  if (
    snapshot.range &&
    !snapshot.range.collapsed &&
    document.contains(snapshot.range.commonAncestorContainer)
  ) {
    return snapshot.range.toString();
  }

  return '';
}

function refreshInlineToolbar() {
  if (toolbarBusy) return;
  const snapshot = getBestSnapshot();
  if (!snapshot || !hasDisplayableSelection(snapshot)) {
    hideInlineToolbar();
    return;
  }

  const rect = getAnchorRectForSnapshot(snapshot);
  if (!rect) {
    hideInlineToolbar();
    return;
  }
  positionInlineToolbar(rect);
}

async function runInlineRewrite(mode: RewriteMode) {
  if (toolbarBusy) return;
  const snapshot = getBestSnapshot();
  if (!snapshot) {
    hideInlineToolbar();
    return;
  }
  const selectedText = getInlineSelectedText(snapshot).trim();
  if (!selectedText) {
    hideInlineToolbar();
    return;
  }

  toolbarBusy = true;
  const toolbar = ensureInlineToolbar();
  toolbar.dataset.busy = 'true';
  const buttons = toolbar.querySelectorAll('button');
  buttons.forEach((button) => {
    (button as HTMLButtonElement).disabled = true;
    button.setAttribute('aria-disabled', 'true');
  });
  setToolbarStatus('Rewriting...', false, true);

  try {
    const response = await fetch(INLINE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: selectedText, mode })
    });

    if (!response.ok) {
      let detail = `Rewrite failed (${response.status})`;
      try {
        const data = await response.json();
        if (data && typeof data.detail === 'string' && data.detail.trim()) {
          detail = data.detail;
        }
      } catch {
        // Keep default error text when response body is non-JSON.
      }
      throw new Error(detail);
    }

    const data = await response.json() as { rewritten_text?: string };
    const rewritten = (data.rewritten_text || '').trim();
    if (!rewritten) {
      throw new Error('No rewritten text returned.');
    }

    replaceUsingSnapshot(snapshot, rewritten);
    hideInlineToolbar();
  } catch (_error) {
    setToolbarStatus('Could not rewrite. Try again.', true);
  } finally {
    toolbarBusy = false;
    toolbar.removeAttribute('data-busy');
    buttons.forEach((button) => {
      (button as HTMLButtonElement).disabled = false;
      button.removeAttribute('aria-disabled');
    });
  }
}

function scheduleSelectionRefresh() {
  if (selectionRaf !== null) return;
  selectionRaf = window.requestAnimationFrame(() => {
    selectionRaf = null;
    refreshInlineToolbar();
  });
}

document.addEventListener('focusin', (event) => {
  updateSnapshotFromContext(event.target);
  scheduleSelectionRefresh();
});

document.addEventListener('selectionchange', () => {
  updateSnapshotFromContext();
  scheduleSelectionRefresh();
});

document.addEventListener('keyup', (event) => {
  updateSnapshotFromContext(event.target);
  if (event.key === 'Escape') {
    hideInlineToolbar();
    return;
  }
  scheduleSelectionRefresh();
});

document.addEventListener('mouseup', (event) => {
  updateSnapshotFromContext(event.target);
  scheduleSelectionRefresh();
});

document.addEventListener('input', (event) => {
  updateSnapshotFromContext(event.target);
  scheduleSelectionRefresh();
});

window.addEventListener('scroll', () => {
  scheduleSelectionRefresh();
}, true);

window.addEventListener('resize', () => {
  scheduleSelectionRefresh();
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
