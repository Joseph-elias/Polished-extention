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
const INLINE_TRANSLATE_API_URL = 'https://polished-extention.onrender.com/translate';
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

const TARGET_LANGUAGES = [
  'Arabic',
  'English',
  'French',
  'German',
  'Italian',
  'Spanish',
  'Portuguese',
  'Turkish'
] as const;

let toolbarBusy = false;
let toolbarEl: HTMLDivElement | null = null;
let toolbarStatusEl: HTMLDivElement | null = null;
let toolbarLanguageSelectEl: HTMLSelectElement | null = null;
let selectionRaf: number | null = null;
let lastGenericSelectedText = '';
const STICKY_STYLE_ID = 'polished-sticky-notes-style';
const STICKY_DOCK_ID = 'polished-sticky-notes-dock';
const STICKY_PANEL_ID = 'polished-sticky-notes-panel';
const NOTES_STORAGE_KEY = 'pageNotes';

type StoredPageNote = {
  id: string;
  url: string;
  originalUrl: string;
  selectedText: string;
  userNote: string;
  createdAt: string;
  updatedAt: string;
};

type StoredNotesByPage = Record<string, StoredPageNote[]>;

function getGenericSelectionText(): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
  return sel.toString().trim();
}

function rememberGenericSelection() {
  const selected = getGenericSelectionText();
  if (selected) {
    lastGenericSelectedText = selected;
  }
}

function normalizePageUrlForNotes(url: string): string {
  const trackingPatterns = [
    /^utm_/i,
    /^fbclid$/i,
    /^gclid$/i,
    /^mc_cid$/i,
    /^mc_eid$/i,
    /^igshid$/i,
    /^ref$/i,
    /^ref_src$/i
  ];

  function isTrackingParam(paramName: string): boolean {
    return trackingPatterns.some((pattern) => pattern.test(paramName));
  }

  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const retainedParams: Array<[string, string]> = [];
    parsed.searchParams.forEach((value, key) => {
      if (!isTrackingParam(key)) {
        retainedParams.push([key, value]);
      }
    });
    parsed.search = '';
    for (const [key, value] of retainedParams) {
      parsed.searchParams.append(key, value);
    }
    if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
      parsed.port = '';
    }
    return parsed.toString();
  } catch {
    return url.split('#')[0].trim();
  }
}

function getNotesForCurrentPageFromStorage(): Promise<StoredPageNote[]> {
  if (!location.href) return Promise.resolve([]);
  const normalizedUrl = normalizePageUrlForNotes(location.href);
  return new Promise((resolve) => {
    chrome.storage.local.get(NOTES_STORAGE_KEY, (result) => {
      const allNotes = (result[NOTES_STORAGE_KEY] as StoredNotesByPage | undefined) || {};
      resolve(allNotes[normalizedUrl] || []);
    });
  });
}

function getAllStoredNotes(): Promise<StoredNotesByPage> {
  return new Promise((resolve) => {
    chrome.storage.local.get(NOTES_STORAGE_KEY, (result) => {
      const allNotes = (result[NOTES_STORAGE_KEY] as StoredNotesByPage | undefined) || {};
      resolve(allNotes);
    });
  });
}

function setAllStoredNotes(notesByPage: StoredNotesByPage): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notesByPage }, () => {
      resolve();
    });
  });
}

async function saveInlineNoteForCurrentPage(selectedText: string): Promise<boolean> {
  const text = selectedText.trim();
  if (!text || !location.href) return false;

  const normalizedUrl = normalizePageUrlForNotes(location.href);
  const allNotes = await getAllStoredNotes();
  const currentNotes = allNotes[normalizedUrl] || [];
  const now = new Date().toISOString();

  const duplicate = currentNotes.find((note) => note.selectedText.trim() === text);
  if (duplicate) {
    allNotes[normalizedUrl] = currentNotes.map((note) =>
      note.id === duplicate.id
        ? { ...note, updatedAt: now }
        : note
    );
    await setAllStoredNotes(allNotes);
    return true;
  }

  const newNote: StoredPageNote = {
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    url: normalizedUrl,
    originalUrl: location.href,
    selectedText: text,
    userNote: '',
    createdAt: now,
    updatedAt: now
  };

  allNotes[normalizedUrl] = [newNote, ...currentNotes];
  await setAllStoredNotes(allNotes);
  return true;
}

async function updateStickyNoteInStorage(noteId: string, userNote: string): Promise<boolean> {
  const allNotes = await getAllStoredNotes();
  const now = new Date().toISOString();
  let found = false;

  for (const [url, notes] of Object.entries(allNotes)) {
    const hasTarget = notes.some((note) => note.id === noteId);
    if (!hasTarget) continue;
    found = true;
    allNotes[url] = notes.map((note) =>
      note.id === noteId
        ? { ...note, userNote: userNote.trim(), updatedAt: now }
        : note
    );
    break;
  }

  if (!found) return false;
  await setAllStoredNotes(allNotes);
  return true;
}

async function deleteStickyNoteFromStorage(noteId: string): Promise<boolean> {
  const allNotes = await getAllStoredNotes();
  let changed = false;

  for (const [url, notes] of Object.entries(allNotes)) {
    const filtered = notes.filter((note) => note.id !== noteId);
    if (filtered.length === notes.length) continue;
    changed = true;
    if (filtered.length > 0) {
      allNotes[url] = filtered;
    } else {
      delete allNotes[url];
    }
    break;
  }

  if (!changed) return false;
  await setAllStoredNotes(allNotes);
  return true;
}

function ensureStickyNotesStyles() {
  if (document.getElementById(STICKY_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STICKY_STYLE_ID;
  style.textContent = `
    #${STICKY_DOCK_ID} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483646;
      font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
      pointer-events: auto;
      display: grid;
      gap: 8px;
    }

    #${STICKY_DOCK_ID} .polished-sticky-toggle {
      justify-self: end;
      border: 1px solid rgba(255, 255, 255, 0.42);
      border-radius: 999px;
      min-height: 36px;
      padding: 0 12px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: #f8fcff;
      background: linear-gradient(135deg, rgba(17, 121, 134, 0.95), rgba(34, 87, 163, 0.95));
      box-shadow: 0 8px 20px rgba(4, 12, 25, 0.35);
      cursor: pointer;
    }

    #${STICKY_PANEL_ID} {
      width: min(340px, calc(100vw - 22px));
      max-height: min(60vh, 520px);
      overflow: auto;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.26);
      background:
        radial-gradient(circle at top right, rgba(120, 199, 255, 0.22), transparent 48%),
        linear-gradient(145deg, rgba(12, 21, 35, 0.96), rgba(16, 30, 49, 0.93));
      box-shadow: 0 16px 36px rgba(2, 8, 20, 0.4);
      color: #e7f2ff;
      display: none;
    }

    #${STICKY_PANEL_ID}[data-open="true"] {
      display: block;
    }

    #${STICKY_PANEL_ID} .polished-sticky-head {
      position: sticky;
      top: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      background: rgba(9, 16, 26, 0.84);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.16);
    }

    #${STICKY_PANEL_ID} .polished-sticky-title {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(217, 236, 253, 0.88);
    }

    #${STICKY_PANEL_ID} .polished-sticky-close {
      border: 0;
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
      color: #f8fcff;
      cursor: pointer;
      font-size: 14px;
      font-weight: 700;
    }

    #${STICKY_PANEL_ID} .polished-sticky-list {
      padding: 10px;
      display: grid;
      gap: 8px;
    }

    #${STICKY_PANEL_ID} .polished-sticky-card {
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.07);
      padding: 8px;
      display: grid;
      gap: 6px;
    }

    #${STICKY_PANEL_ID} .polished-sticky-card blockquote {
      margin: 0;
      padding: 6px 8px;
      border-left: 3px solid rgba(117, 214, 196, 0.9);
      background: rgba(6, 20, 34, 0.48);
      border-radius: 6px;
      font-size: 12px;
      line-height: 1.35;
      color: #ecf6ff;
      white-space: pre-wrap;
    }

    #${STICKY_PANEL_ID} .polished-sticky-note {
      font-size: 12px;
      line-height: 1.35;
      color: #cfe4f9;
      white-space: pre-wrap;
    }

    #${STICKY_PANEL_ID} .polished-sticky-meta {
      font-size: 10px;
      color: rgba(200, 222, 245, 0.78);
    }

    #${STICKY_PANEL_ID} .polished-sticky-actions {
      margin-top: 2px;
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }

    #${STICKY_PANEL_ID} .polished-sticky-icon-btn {
      width: 28px;
      height: 28px;
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.08);
      color: #ecf6ff;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
    }

    #${STICKY_PANEL_ID} .polished-sticky-icon-btn:hover {
      background: rgba(255, 255, 255, 0.18);
    }

    #${STICKY_PANEL_ID} .polished-sticky-icon-btn.danger {
      color: #ffd7dc;
      border-color: rgba(255, 172, 183, 0.5);
      background: rgba(255, 106, 129, 0.13);
    }

    #${STICKY_PANEL_ID} .polished-sticky-icon-btn.danger:hover {
      background: rgba(255, 106, 129, 0.25);
    }

    #${STICKY_PANEL_ID} .polished-sticky-edit-wrap {
      display: none;
      gap: 6px;
    }

    #${STICKY_PANEL_ID} .polished-sticky-edit-wrap[data-open="true"] {
      display: grid;
    }

    #${STICKY_PANEL_ID} .polished-sticky-edit-wrap textarea {
      min-height: 58px;
      resize: vertical;
      border-radius: 8px;
      border: 1px solid rgba(166, 202, 235, 0.45);
      background: rgba(7, 18, 31, 0.62);
      color: #eef7ff;
      padding: 8px;
      font: inherit;
      font-size: 12px;
      line-height: 1.35;
    }

    #${STICKY_PANEL_ID} .polished-sticky-edit-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }

    #${STICKY_PANEL_ID} .polished-sticky-edit-buttons button {
      min-height: 30px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      color: #edf7ff;
      background: rgba(255, 255, 255, 0.08);
    }

    #${STICKY_PANEL_ID} .polished-sticky-edit-buttons button:hover {
      background: rgba(255, 255, 255, 0.16);
    }
  `;
  document.documentElement.appendChild(style);
}

function ensureStickyNotesUi(): { dock: HTMLDivElement; panel: HTMLDivElement; list: HTMLDivElement; toggle: HTMLButtonElement } {
  let dock = document.getElementById(STICKY_DOCK_ID) as HTMLDivElement | null;
  if (!dock) {
    ensureStickyNotesStyles();
    dock = document.createElement('div');
    dock.id = STICKY_DOCK_ID;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'polished-sticky-toggle';
    toggle.textContent = 'Notes';

    const panel = document.createElement('div');
    panel.id = STICKY_PANEL_ID;
    panel.dataset.open = 'false';

    const head = document.createElement('div');
    head.className = 'polished-sticky-head';

    const title = document.createElement('div');
    title.className = 'polished-sticky-title';
    title.textContent = 'Page Notes';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'polished-sticky-close';
    close.textContent = 'x';

    const list = document.createElement('div');
    list.className = 'polished-sticky-list';

    close.addEventListener('click', () => {
      panel.dataset.open = 'false';
    });
    toggle.addEventListener('click', () => {
      panel.dataset.open = panel.dataset.open === 'true' ? 'false' : 'true';
    });

    head.appendChild(title);
    head.appendChild(close);
    panel.appendChild(head);
    panel.appendChild(list);
    dock.appendChild(toggle);
    dock.appendChild(panel);
    document.documentElement.appendChild(dock);
  }

  const panel = dock.querySelector(`#${STICKY_PANEL_ID}`) as HTMLDivElement;
  const list = panel.querySelector('.polished-sticky-list') as HTMLDivElement;
  const toggle = dock.querySelector('.polished-sticky-toggle') as HTMLButtonElement;
  return { dock, panel, list, toggle };
}

function renderStickyNotes(notes: StoredPageNote[]) {
  const { dock, panel, list, toggle } = ensureStickyNotesUi();
  list.innerHTML = '';

  if (!notes.length) {
    dock.style.display = 'none';
    panel.dataset.open = 'false';
    return;
  }

  dock.style.display = 'grid';
  toggle.textContent = `Notes (${notes.length})`;

  for (const note of notes) {
    const card = document.createElement('article');
    card.className = 'polished-sticky-card';

    const selected = document.createElement('blockquote');
    selected.textContent = note.selectedText;
    card.appendChild(selected);

    if (note.userNote && note.userNote.trim()) {
      const userNote = document.createElement('div');
      userNote.className = 'polished-sticky-note';
      userNote.textContent = note.userNote.trim();
      card.appendChild(userNote);
    }

    const editWrap = document.createElement('div');
    editWrap.className = 'polished-sticky-edit-wrap';
    editWrap.dataset.open = 'false';

    const editArea = document.createElement('textarea');
    editArea.value = note.userNote || '';
    editArea.placeholder = 'Update your note...';

    const editButtons = document.createElement('div');
    editButtons.className = 'polished-sticky-edit-buttons';

    const saveEditBtn = document.createElement('button');
    saveEditBtn.type = 'button';
    saveEditBtn.textContent = 'Save';
    saveEditBtn.addEventListener('click', async () => {
      saveEditBtn.disabled = true;
      try {
        await updateStickyNoteInStorage(note.id, editArea.value);
      } finally {
        saveEditBtn.disabled = false;
      }
    });

    const cancelEditBtn = document.createElement('button');
    cancelEditBtn.type = 'button';
    cancelEditBtn.textContent = 'Cancel';
    cancelEditBtn.addEventListener('click', () => {
      editArea.value = note.userNote || '';
      editWrap.dataset.open = 'false';
    });

    editButtons.appendChild(saveEditBtn);
    editButtons.appendChild(cancelEditBtn);
    editWrap.appendChild(editArea);
    editWrap.appendChild(editButtons);
    card.appendChild(editWrap);

    const meta = document.createElement('div');
    meta.className = 'polished-sticky-meta';
    meta.textContent = `Updated ${new Date(note.updatedAt).toLocaleString()}`;
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'polished-sticky-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'polished-sticky-icon-btn';
    editBtn.title = 'Edit note';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', () => {
      editWrap.dataset.open = editWrap.dataset.open === 'true' ? 'false' : 'true';
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'polished-sticky-icon-btn danger';
    deleteBtn.title = 'Delete note';
    deleteBtn.textContent = '🗑';
    deleteBtn.addEventListener('click', async () => {
      deleteBtn.disabled = true;
      try {
        await deleteStickyNoteFromStorage(note.id);
      } finally {
        deleteBtn.disabled = false;
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(actions);

    list.appendChild(card);
  }
}

function initStickyNotesRestore() {
  if (window.top !== window.self) return;
  void getNotesForCurrentPageFromStorage().then((notes) => {
    renderStickyNotes(notes);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!changes[NOTES_STORAGE_KEY]) return;
    void getNotesForCurrentPageFromStorage().then((notes) => {
      renderStickyNotes(notes);
    });
  });
}

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

    #${INLINE_TOOLBAR_ID} .polished-inline-rewrite-section {
      display: grid;
      gap: 6px;
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-rewrite-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(220, 235, 252, 0.84);
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-translate-row {
      margin-top: 8px;
      display: grid;
      grid-template-columns: minmax(150px, 1fr) auto;
      gap: 8px;
      align-items: center;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.14);
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-note-row {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.14);
      display: flex;
      justify-content: flex-end;
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-language-field {
      display: grid;
      gap: 4px;
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-language-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(220, 235, 252, 0.84);
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

    #${INLINE_TOOLBAR_ID} .polished-inline-translate-btn {
      background: linear-gradient(135deg, rgba(91, 176, 253, 0.34), rgba(46, 125, 211, 0.35));
      border-color: rgba(165, 206, 245, 0.52);
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-translate-btn:hover:not(:disabled) {
      border-color: rgba(188, 220, 251, 0.85);
      background: linear-gradient(135deg, rgba(112, 190, 255, 0.48), rgba(60, 144, 236, 0.48));
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-select {
      width: 100%;
      min-height: 34px;
      border-radius: 10px;
      border: 1px solid rgba(168, 206, 239, 0.42);
      padding: 0 32px 0 10px;
      font-size: 12px;
      font-weight: 600;
      color: #ecf4ff;
      appearance: none;
      -webkit-appearance: none;
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.06));
      background-repeat: no-repeat;
      outline: none;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15);
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-select:focus {
      border-color: rgba(112, 228, 208, 0.86);
      box-shadow: 0 0 0 2px rgba(112, 228, 208, 0.26);
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-select:disabled {
      opacity: 0.55;
      cursor: wait;
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-select option {
      color: #0f172a;
      background: #f8fafc;
      font-weight: 600;
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-language-wrap {
      position: relative;
    }

    #${INLINE_TOOLBAR_ID} .polished-inline-language-wrap::after {
      content: "";
      position: absolute;
      top: 50%;
      right: 11px;
      width: 8px;
      height: 8px;
      border-right: 2px solid rgba(218, 238, 255, 0.86);
      border-bottom: 2px solid rgba(218, 238, 255, 0.86);
      transform: translateY(-65%) rotate(45deg);
      pointer-events: none;
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

  const rewriteSection = document.createElement('div');
  rewriteSection.className = 'polished-inline-rewrite-section';

  const rewriteLabel = document.createElement('span');
  rewriteLabel.className = 'polished-inline-rewrite-label';
  rewriteLabel.textContent = 'Rewrite';

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

  const translateRow = document.createElement('div');
  translateRow.className = 'polished-inline-translate-row';

  const languageField = document.createElement('div');
  languageField.className = 'polished-inline-language-field';

  const langLabel = document.createElement('span');
  langLabel.className = 'polished-inline-language-label';
  langLabel.textContent = 'Translate To';

  const languageWrap = document.createElement('div');
  languageWrap.className = 'polished-inline-language-wrap';

  const langSelect = document.createElement('select');
  langSelect.className = 'polished-inline-select';
  for (const language of TARGET_LANGUAGES) {
    const option = document.createElement('option');
    option.value = language;
    option.textContent = language;
    if (language === 'English') option.selected = true;
    langSelect.appendChild(option);
  }
  langSelect.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });
  languageWrap.appendChild(langSelect);
  languageField.appendChild(langLabel);
  languageField.appendChild(languageWrap);

  const translateBtn = document.createElement('button');
  translateBtn.type = 'button';
  translateBtn.className = 'polished-inline-btn polished-inline-translate-btn';
  translateBtn.textContent = 'Translate';
  translateBtn.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  translateBtn.addEventListener('click', () => {
    void runInlineTranslate((toolbarLanguageSelectEl?.value || 'English').trim());
  });

  translateRow.appendChild(languageField);
  translateRow.appendChild(translateBtn);

  const noteRow = document.createElement('div');
  noteRow.className = 'polished-inline-note-row';

  const saveNoteBtn = document.createElement('button');
  saveNoteBtn.type = 'button';
  saveNoteBtn.className = 'polished-inline-btn';
  saveNoteBtn.textContent = 'Save As Note';
  saveNoteBtn.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  saveNoteBtn.addEventListener('click', () => {
    void runInlineSaveNote();
  });
  noteRow.appendChild(saveNoteBtn);

  const status = document.createElement('div');
  status.id = INLINE_TOOLBAR_STATUS_ID;

  el.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  rewriteSection.appendChild(rewriteLabel);
  rewriteSection.appendChild(row);
  el.appendChild(rewriteSection);
  el.appendChild(translateRow);
  el.appendChild(noteRow);
  el.appendChild(status);
  document.documentElement.appendChild(el);
  toolbarEl = el;
  toolbarStatusEl = status;
  toolbarLanguageSelectEl = langSelect;
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
  const langSelect = toolbarLanguageSelectEl;
  buttons.forEach((button) => {
    (button as HTMLButtonElement).disabled = true;
    button.setAttribute('aria-disabled', 'true');
  });
  if (langSelect) langSelect.disabled = true;
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
    if (langSelect) langSelect.disabled = false;
  }
}

async function runInlineTranslate(targetLanguage: string) {
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
  if (!targetLanguage) {
    setToolbarStatus('Choose a target language.', true, false);
    return;
  }

  toolbarBusy = true;
  const toolbar = ensureInlineToolbar();
  toolbar.dataset.busy = 'true';
  const buttons = toolbar.querySelectorAll('button');
  const langSelect = toolbarLanguageSelectEl;
  buttons.forEach((button) => {
    (button as HTMLButtonElement).disabled = true;
    button.setAttribute('aria-disabled', 'true');
  });
  if (langSelect) langSelect.disabled = true;
  setToolbarStatus(`Translating to ${targetLanguage}...`, false, true);

  try {
    const response = await fetch(INLINE_TRANSLATE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: selectedText, target_language: targetLanguage })
    });

    if (!response.ok) {
      let detail = `Translation failed (${response.status})`;
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

    const data = await response.json() as { translated_text?: string };
    const translated = (data.translated_text || '').trim();
    if (!translated) {
      throw new Error('No translated text returned.');
    }

    replaceUsingSnapshot(snapshot, translated);
    hideInlineToolbar();
  } catch (_error) {
    setToolbarStatus('Could not translate. Try again.', true, false);
  } finally {
    toolbarBusy = false;
    toolbar.removeAttribute('data-busy');
    buttons.forEach((button) => {
      (button as HTMLButtonElement).disabled = false;
      button.removeAttribute('aria-disabled');
    });
    if (langSelect) langSelect.disabled = false;
  }
}

async function runInlineSaveNote() {
  if (toolbarBusy) return;
  const snapshot = getBestSnapshot();
  if (!snapshot) {
    hideInlineToolbar();
    return;
  }

  const selectedText = getInlineSelectedText(snapshot).trim();
  if (!selectedText) {
    setToolbarStatus('Select text first.', true, false);
    return;
  }

  toolbarBusy = true;
  const toolbar = ensureInlineToolbar();
  toolbar.dataset.busy = 'true';
  const buttons = toolbar.querySelectorAll('button');
  const langSelect = toolbarLanguageSelectEl;
  buttons.forEach((button) => {
    (button as HTMLButtonElement).disabled = true;
    button.setAttribute('aria-disabled', 'true');
  });
  if (langSelect) langSelect.disabled = true;
  setToolbarStatus('Saving note...', false, true);

  try {
    const ok = await saveInlineNoteForCurrentPage(selectedText);
    if (!ok) {
      setToolbarStatus('Could not save note.', true, false);
      return;
    }
    setToolbarStatus('Saved for this page.', false, false);
  } catch {
    setToolbarStatus('Could not save note.', true, false);
  } finally {
    toolbarBusy = false;
    toolbar.removeAttribute('data-busy');
    buttons.forEach((button) => {
      (button as HTMLButtonElement).disabled = false;
      button.removeAttribute('aria-disabled');
    });
    if (langSelect) langSelect.disabled = false;
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
  rememberGenericSelection();
  scheduleSelectionRefresh();
});

document.addEventListener('keyup', (event) => {
  updateSnapshotFromContext(event.target);
  if (event.key === 'Escape') {
    hideInlineToolbar();
    return;
  }
  rememberGenericSelection();
  scheduleSelectionRefresh();
});

document.addEventListener('mouseup', (event) => {
  updateSnapshotFromContext(event.target);
  rememberGenericSelection();
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

initStickyNotesRestore();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_ACTIVE_TEXT') {
    const snapshot = getBestSnapshot();
    const selectedFromEditable = snapshot ? getInlineSelectedText(snapshot).trim() : '';
    const selectedFromPage = getGenericSelectionText();
    const bestSelectedText = selectedFromEditable || selectedFromPage || lastGenericSelectedText || '';
    sendResponse({ text: bestSelectedText });
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
