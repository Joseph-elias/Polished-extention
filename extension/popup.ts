// Polished popup logic
import {
  deleteNoteForPage,
  getNotesForPage,
  normalizePageUrl,
  PageNote,
  saveNoteForPage,
  updateNoteForPage
} from './utils/notesStorage.js';
import { exportAllNotesAsJson, exportAllNotesAsMarkdown } from './utils/exportNotes.js';

// const REWRITE_API_URL = 'http://localhost:8000/rewrite';
const REWRITE_API_URL = 'https://polished-extention.onrender.com/rewrite';
const TRANSLATE_API_URL = 'https://polished-extention.onrender.com/translate';

const NO_RECEIVER_ERROR = 'Could not establish connection. Receiving end does not exist.';

type TabMessage =
  | { type: 'GET_ACTIVE_TEXT' }
  | { type: 'REPLACE_ACTIVE_TEXT'; text: string };

function getActiveTab(): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!tabs.length || !tabs[0].id) {
        reject(new Error('No active tab found.'));
        return;
      }
      resolve(tabs[0]);
    });
  });
}

function sendMessageToTab<T>(tabId: number, message: TabMessage): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function injectContentScriptIfPossible(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['content.js']
  });
}

async function getSelectedTextViaExecuteScript(tabId: number): Promise<string> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const selection = window.getSelection();
      const highlighted = (selection && !selection.isCollapsed ? selection.toString() : '').trim();
      if (highlighted) return highlighted;

      const activeEl = document.activeElement;
      if (activeEl instanceof HTMLTextAreaElement) {
        const start = activeEl.selectionStart ?? 0;
        const end = activeEl.selectionEnd ?? 0;
        if (start !== end) return activeEl.value.substring(start, end).trim();
      }

      if (activeEl instanceof HTMLInputElement) {
        const allowedTypes = ['text', 'search', 'email', 'url', 'tel'];
        if (allowedTypes.includes(activeEl.type || 'text')) {
          const start = activeEl.selectionStart ?? 0;
          const end = activeEl.selectionEnd ?? 0;
          if (start !== end) return activeEl.value.substring(start, end).trim();
        }
      }

      return '';
    }
  });

  let best = '';
  for (const result of results) {
    const text = typeof result.result === 'string' ? result.result.trim() : '';
    if (text.length > best.length) best = text;
  }
  return best;
}

document.addEventListener('DOMContentLoaded', async () => {
  const sourceText = document.getElementById('source-text') as HTMLTextAreaElement;
  const rewrittenText = document.getElementById('rewritten-text') as HTMLTextAreaElement;
  const noteSelectedTextInput = document.getElementById('note-selected-text-input') as HTMLTextAreaElement;
  const noteInput = document.getElementById('note-input') as HTMLTextAreaElement;
  const modeSelect = document.getElementById('mode') as HTMLSelectElement;
  const targetLanguageSelect = document.getElementById('target-language') as HTMLSelectElement;
  const rewriteBtn = document.getElementById('rewrite-btn') as HTMLButtonElement;
  const translateBtn = document.getElementById('translate-btn') as HTMLButtonElement;
  const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
  const rewriteResultBtn = document.getElementById('rewrite-result-btn') as HTMLButtonElement;
  const replaceBtn = document.getElementById('replace-btn') as HTMLButtonElement;
  const saveNoteBtn = document.getElementById('save-note-btn') as HTMLButtonElement;
  const exportJsonBtn = document.getElementById('export-json-btn') as HTMLButtonElement;
  const exportMdBtn = document.getElementById('export-md-btn') as HTMLButtonElement;
  const notesList = document.getElementById('notes-list') as HTMLDivElement;
  const notesStatus = document.getElementById('notes-status') as HTMLElement;
  const exportStatus = document.getElementById('export-status') as HTMLElement;
  const loading = document.getElementById('loading') as HTMLElement;
  const errorMessage = document.getElementById('error-message') as HTMLElement;

  let currentOriginalUrl = '';
  let currentNormalizedUrl = '';

  const syncActionButtons = () => {
    const hasResult = !!rewrittenText.value.trim();
    copyBtn.disabled = !hasResult;
    rewriteResultBtn.disabled = !hasResult;
    replaceBtn.disabled = !hasResult;
    saveNoteBtn.disabled = !noteSelectedTextInput.value.trim() || !currentOriginalUrl;
  };

  const setBusyState = (isBusy: boolean) => {
    rewriteBtn.disabled = isBusy;
    translateBtn.disabled = isBusy;
  };

  const showLoading = (message: string) => {
    loading.textContent = message;
    loading.style.display = 'inline';
  };

  const getSelectedTextFromPage = async (): Promise<string> => {
    const tab = await getActiveTab();
    const executeScriptSelection = await getSelectedTextViaExecuteScript(tab.id!);
    if (executeScriptSelection) {
      return executeScriptSelection;
    }
    try {
      const response = await sendMessageToTab<{ text: string }>(tab.id!, { type: 'GET_ACTIVE_TEXT' });
      return response?.text || '';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes(NO_RECEIVER_ERROR)) {
        throw err;
      }
      await injectContentScriptIfPossible(tab.id!);
      const retryResponse = await sendMessageToTab<{ text: string }>(tab.id!, { type: 'GET_ACTIVE_TEXT' });
      return retryResponse?.text || '';
    }
  };

  const replaceTextInPage = async (text: string): Promise<boolean> => {
    const tab = await getActiveTab();
    try {
      const response = await sendMessageToTab<{ ok: boolean }>(tab.id!, {
        type: 'REPLACE_ACTIVE_TEXT',
        text
      });
      return !!response?.ok;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes(NO_RECEIVER_ERROR)) {
        throw err;
      }
      await injectContentScriptIfPossible(tab.id!);
      const retryResponse = await sendMessageToTab<{ ok: boolean }>(tab.id!, {
        type: 'REPLACE_ACTIVE_TEXT',
        text
      });
      return !!retryResponse?.ok;
    }
  };

  const rewriteText = async (text: string, mode: string): Promise<string> => {
    const res = await fetch(REWRITE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mode })
    });
    if (!res.ok) {
      let detail = `API error (${res.status})`;
      try {
        const errData = await res.json();
        if (errData && typeof errData.detail === 'string' && errData.detail.trim()) {
          detail = errData.detail;
        }
      } catch {
        // Keep default message when response is not JSON.
      }
      throw new Error(detail);
    }
    const data = await res.json() as { rewritten_text?: string };
    return data.rewritten_text || '';
  };

  const translateText = async (text: string, targetLanguage: string): Promise<string> => {
    const res = await fetch(TRANSLATE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target_language: targetLanguage })
    });
    if (!res.ok) {
      let detail = `API error (${res.status})`;
      try {
        const errData = await res.json();
        if (errData && typeof errData.detail === 'string' && errData.detail.trim()) {
          detail = errData.detail;
        }
      } catch {
        // Keep default message when response is not JSON.
      }
      throw new Error(detail);
    }
    const data = await res.json() as { translated_text?: string };
    return data.translated_text || '';
  };

  const showNotesStatus = (message: string) => {
    notesStatus.textContent = message;
  };

  const showExportStatus = (message: string) => {
    exportStatus.textContent = message;
  };

  const renderNotes = (notes: PageNote[]) => {
    notesList.innerHTML = '';
    if (!notes.length) {
      const empty = document.createElement('div');
      empty.className = 'note-meta';
      empty.textContent = 'No notes saved for this page yet.';
      notesList.appendChild(empty);
      return;
    }

    for (const note of notes) {
      const item = document.createElement('div');
      item.className = 'note-item';

      const selected = document.createElement('p');
      selected.className = 'note-selected-text';
      selected.textContent = note.selectedText;

      const editArea = document.createElement('textarea');
      editArea.value = note.userNote;
      editArea.placeholder = 'Add your note...';

      const meta = document.createElement('div');
      meta.className = 'note-meta';
      meta.textContent = `Updated: ${new Date(note.updatedAt).toLocaleString()}`;

      const actions = document.createElement('div');
      actions.className = 'note-actions';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'secondary';
      saveBtn.textContent = 'Save Note';
      saveBtn.onclick = async () => {
        showNotesStatus('');
        saveBtn.disabled = true;
        try {
          await updateNoteForPage(note.id, { userNote: editArea.value });
          showNotesStatus('Note updated.');
          await loadNotesForCurrentPage();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to update note.';
          showNotesStatus(msg);
        } finally {
          saveBtn.disabled = false;
        }
      };

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.onclick = async () => {
        showNotesStatus('');
        deleteBtn.disabled = true;
        try {
          const deleted = await deleteNoteForPage(note.id);
          if (deleted) {
            showNotesStatus('Note deleted.');
            await loadNotesForCurrentPage();
          } else {
            showNotesStatus('Note was already removed.');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to delete note.';
          showNotesStatus(msg);
        } finally {
          deleteBtn.disabled = false;
        }
      };

      actions.appendChild(saveBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(selected);
      item.appendChild(editArea);
      item.appendChild(meta);
      item.appendChild(actions);
      notesList.appendChild(item);
    }
  };

  const loadNotesForCurrentPage = async () => {
    if (!currentOriginalUrl) {
      notesList.innerHTML = '';
      const msg = document.createElement('div');
      msg.className = 'note-meta';
      msg.textContent = 'Notes unavailable on this page.';
      notesList.appendChild(msg);
      saveNoteBtn.disabled = true;
      return;
    }
    const notes = await getNotesForPage(currentOriginalUrl);
    renderNotes(notes);
  };

  const runRewriteFromSource = async () => {
    errorMessage.textContent = '';
    rewrittenText.value = '';
    syncActionButtons();
    showLoading('Rewriting...');
    setBusyState(true);
    try {
      const text = sourceText.value.trim();
      const mode = modeSelect.value;
      if (!text) {
        errorMessage.textContent = 'No text to rewrite.';
        return;
      }
      rewrittenText.value = await rewriteText(text, mode);
      syncActionButtons();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to rewrite. Please try again.';
      errorMessage.textContent = msg;
    } finally {
      loading.style.display = 'none';
      setBusyState(false);
    }
  };

  rewriteBtn.onclick = () => {
    void runRewriteFromSource();
  };

  translateBtn.onclick = async () => {
    errorMessage.textContent = '';
    rewrittenText.value = '';
    syncActionButtons();
    showLoading('Translating...');
    setBusyState(true);
    try {
      const text = sourceText.value.trim();
      const targetLanguage = targetLanguageSelect.value.trim();
      if (!text) {
        errorMessage.textContent = 'No text to translate.';
        return;
      }
      if (!targetLanguage) {
        errorMessage.textContent = 'Please choose a target language.';
        return;
      }
      rewrittenText.value = await translateText(text, targetLanguage);
      syncActionButtons();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to translate. Please try again.';
      errorMessage.textContent = msg;
    } finally {
      loading.style.display = 'none';
      setBusyState(false);
    }
  };

  rewriteResultBtn.onclick = () => {
    const resultText = rewrittenText.value.trim();
    if (!resultText) return;
    sourceText.value = resultText;
    syncActionButtons();
    void runRewriteFromSource();
  };

  copyBtn.onclick = () => {
    if (rewrittenText.value) {
      navigator.clipboard.writeText(rewrittenText.value);
    }
  };

  replaceBtn.onclick = () => {
    if (!rewrittenText.value) return;
    errorMessage.textContent = '';
    replaceTextInPage(rewrittenText.value)
      .then((ok) => {
        if (!ok) {
          errorMessage.textContent = 'Could not replace text. Reselect text and try again.';
        }
      })
      .catch(() => {
        errorMessage.textContent = 'Could not connect to this page.';
      });
  };

  saveNoteBtn.onclick = async () => {
    showNotesStatus('');
    const selected = noteSelectedTextInput.value.trim();
    if (!selected) {
      showNotesStatus('Add information in "Information To Save" first.');
      return;
    }
    if (!currentOriginalUrl) {
      showNotesStatus('Notes are unavailable on this page.');
      return;
    }

    saveNoteBtn.disabled = true;
    try {
      await saveNoteForPage({
        url: currentOriginalUrl,
        originalUrl: currentOriginalUrl,
        selectedText: selected,
        userNote: noteInput.value
      });
      noteSelectedTextInput.value = '';
      noteInput.value = '';
      showNotesStatus('Saved for this page.');
      await loadNotesForCurrentPage();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save note.';
      showNotesStatus(msg);
    } finally {
      syncActionButtons();
    }
  };

  exportJsonBtn.onclick = async () => {
    showExportStatus('');
    exportJsonBtn.disabled = true;
    try {
      const fileName = await exportAllNotesAsJson();
      showExportStatus(`Exported ${fileName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed.';
      showExportStatus(msg);
    } finally {
      exportJsonBtn.disabled = false;
    }
  };

  exportMdBtn.onclick = async () => {
    showExportStatus('');
    exportMdBtn.disabled = true;
    try {
      const fileName = await exportAllNotesAsMarkdown();
      showExportStatus(`Exported ${fileName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed.';
      showExportStatus(msg);
    } finally {
      exportMdBtn.disabled = false;
    }
  };

  sourceText.addEventListener('input', () => {
    syncActionButtons();
  });

  noteSelectedTextInput.addEventListener('input', () => {
    syncActionButtons();
  });

  try {
    const activeTab = await getActiveTab();
    currentOriginalUrl = activeTab.url || '';
    currentNormalizedUrl = currentOriginalUrl ? normalizePageUrl(currentOriginalUrl) : '';
  } catch {
    currentOriginalUrl = '';
    currentNormalizedUrl = '';
  }

  try {
    const selectedText = await getSelectedTextFromPage();
    if (selectedText) {
      sourceText.value = selectedText;
      if (!noteSelectedTextInput.value.trim()) {
        noteSelectedTextInput.value = selectedText;
      }
      errorMessage.textContent = '';
    } else {
      sourceText.value = '';
      errorMessage.textContent = 'No highlighted text found. Paste text here manually, or highlight text and reopen Polished.';
    }
  } catch {
    sourceText.value = '';
    errorMessage.textContent = 'This page blocks text capture. Paste text manually in Selected Text, then click Rewrite.';
  }

  if (!currentNormalizedUrl) {
    showNotesStatus('Notes unavailable on this page.');
  }
  await loadNotesForCurrentPage();
  syncActionButtons();
});
