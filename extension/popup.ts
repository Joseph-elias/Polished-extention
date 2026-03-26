// Polished popup logic

// const API_URL = 'http://localhost:8000/rewrite';
const API_URL = 'https://polished-extention.onrender.com/rewrite';

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

document.addEventListener('DOMContentLoaded', async () => {
  const sourceText = document.getElementById('source-text') as HTMLTextAreaElement;
  const rewrittenText = document.getElementById('rewritten-text') as HTMLTextAreaElement;
  const modeSelect = document.getElementById('mode') as HTMLSelectElement;
  const rewriteBtn = document.getElementById('rewrite-btn') as HTMLButtonElement;
  const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
  const replaceBtn = document.getElementById('replace-btn') as HTMLButtonElement;
  const loading = document.getElementById('loading') as HTMLElement;
  const errorMessage = document.getElementById('error-message') as HTMLElement;

  const syncActionButtons = () => {
    copyBtn.disabled = !rewrittenText.value.trim();
    replaceBtn.disabled = !rewrittenText.value.trim();
  };

  const getSelectedTextFromPage = async (): Promise<string> => {
    const tab = await getActiveTab();
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

  try {
    const selectedText = await getSelectedTextFromPage();
    if (selectedText) {
      sourceText.value = selectedText;
      errorMessage.textContent = '';
    } else {
      sourceText.value = '';
      errorMessage.textContent = 'Highlight text on the page, then reopen Polished.';
    }
  } catch (_err) {
    sourceText.value = '';
    errorMessage.textContent = 'This page does not allow text capture (try a normal website tab).';
  }

  rewriteBtn.onclick = async () => {
    errorMessage.textContent = '';
    rewrittenText.value = '';
    syncActionButtons();
    loading.style.display = 'inline';
    rewriteBtn.disabled = true;
    try {
      const text = sourceText.value.trim();
      const mode = modeSelect.value;
      if (!text) {
        errorMessage.textContent = 'No text to rewrite.';
        return;
      }
      const res = await fetch(API_URL, {
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
        } catch (_parseErr) {
          // Keep default message when response is not JSON.
        }
        throw new Error(detail);
      }
      const data = await res.json();
      rewrittenText.value = data.rewritten_text || '';
      syncActionButtons();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to rewrite. Please try again.';
      errorMessage.textContent = msg;
    } finally {
      loading.style.display = 'none';
      rewriteBtn.disabled = false;
    }
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

  syncActionButtons();
});
