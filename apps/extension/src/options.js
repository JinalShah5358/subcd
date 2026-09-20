const DEFAULT_API = 'http://localhost:4000/api/v1';

const apiInput = document.getElementById('api-base');
const saved = document.getElementById('saved');

document.getElementById('version').textContent = chrome.runtime.getManifest().version;

chrome.storage.local.get('apiBase').then(({ apiBase }) => {
  apiInput.value = apiBase || DEFAULT_API;
});

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ apiBase: apiInput.value.trim() || DEFAULT_API });
  saved.hidden = false;
  setTimeout(() => {
    saved.hidden = true;
  }, 2000);
});
