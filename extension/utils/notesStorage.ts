export type PageNote = {
  id: string;
  url: string;
  originalUrl: string;
  selectedText: string;
  userNote: string;
  createdAt: string;
  updatedAt: string;
};

export type NotesByPage = Record<string, PageNote[]>;

export type SavePageNoteInput = {
  url: string;
  originalUrl: string;
  selectedText: string;
  userNote?: string;
};

export type UpdatePageNoteChanges = {
  selectedText?: string;
  userNote?: string;
};

const PAGE_NOTES_KEY = 'pageNotes';
const TRACKING_PARAM_PATTERNS = [
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
  return TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(paramName));
}

function getStorageValue<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result[key] as T | undefined);
    });
  });
}

function setStorageValue<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function sortNotes(notes: PageNote[]): PageNote[] {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function makeNoteId(): string {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizePageUrl(url: string): string {
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

export async function getAllNotesByPage(): Promise<NotesByPage> {
  const stored = await getStorageValue<NotesByPage>(PAGE_NOTES_KEY);
  return stored || {};
}

export async function getNotesForPage(url: string): Promise<PageNote[]> {
  const normalizedUrl = normalizePageUrl(url);
  const allNotes = await getAllNotesByPage();
  const notes = allNotes[normalizedUrl] || [];
  return sortNotes(notes);
}

export async function saveNoteForPage(input: SavePageNoteInput): Promise<PageNote> {
  const normalizedUrl = normalizePageUrl(input.url);
  const selectedText = input.selectedText.trim();
  const now = new Date().toISOString();
  const allNotes = await getAllNotesByPage();
  const existingNotes = allNotes[normalizedUrl] || [];

  const duplicate = existingNotes.find(
    (note) => note.selectedText.trim() === selectedText
  );

  if (duplicate) {
    const updatedDuplicate: PageNote = {
      ...duplicate,
      userNote: (input.userNote ?? duplicate.userNote).trim(),
      updatedAt: now
    };
    allNotes[normalizedUrl] = sortNotes(
      existingNotes.map((note) => (note.id === updatedDuplicate.id ? updatedDuplicate : note))
    );
    await setStorageValue(PAGE_NOTES_KEY, allNotes);
    return updatedDuplicate;
  }

  const newNote: PageNote = {
    id: makeNoteId(),
    url: normalizedUrl,
    originalUrl: input.originalUrl,
    selectedText,
    userNote: (input.userNote || '').trim(),
    createdAt: now,
    updatedAt: now
  };

  allNotes[normalizedUrl] = sortNotes([newNote, ...existingNotes]);
  await setStorageValue(PAGE_NOTES_KEY, allNotes);
  return newNote;
}

export async function updateNoteForPage(noteId: string, changes: UpdatePageNoteChanges): Promise<PageNote | null> {
  const allNotes = await getAllNotesByPage();
  const now = new Date().toISOString();

  for (const [pageUrl, notes] of Object.entries(allNotes)) {
    const existing = notes.find((note) => note.id === noteId);
    if (!existing) continue;

    const updatedNote: PageNote = {
      ...existing,
      selectedText: changes.selectedText !== undefined ? changes.selectedText.trim() : existing.selectedText,
      userNote: changes.userNote !== undefined ? changes.userNote.trim() : existing.userNote,
      updatedAt: now
    };

    allNotes[pageUrl] = sortNotes(
      notes.map((note) => (note.id === noteId ? updatedNote : note))
    );
    await setStorageValue(PAGE_NOTES_KEY, allNotes);
    return updatedNote;
  }

  return null;
}

export async function deleteNoteForPage(noteId: string): Promise<boolean> {
  const allNotes = await getAllNotesByPage();
  let changed = false;

  for (const [pageUrl, notes] of Object.entries(allNotes)) {
    const filtered = notes.filter((note) => note.id !== noteId);
    if (filtered.length === notes.length) continue;
    changed = true;
    if (filtered.length > 0) {
      allNotes[pageUrl] = sortNotes(filtered);
    } else {
      delete allNotes[pageUrl];
    }
  }

  if (!changed) return false;
  await setStorageValue(PAGE_NOTES_KEY, allNotes);
  return true;
}
