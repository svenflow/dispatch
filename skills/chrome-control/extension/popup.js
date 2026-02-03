// Check connection status
chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');

  if (response && response.connected) {
    dot.className = 'dot connected';
    text.textContent = 'Connected';
  } else {
    dot.className = 'dot disconnected';
    text.textContent = 'Disconnected';
  }
});
