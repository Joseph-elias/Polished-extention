// Utility: (for future use) get text from active field
export function getActiveFieldText() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_ACTIVE_TEXT' }, (response) => {
                resolve(response && response.text ? response.text : '');
            });
        });
    });
}
