document.getElementById('launch').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'open-driver' });
  window.close();
});
