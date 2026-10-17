// Offscreen document only provides clipboard access; it never records.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'clipboard' || typeof message.url !== 'string') return;
  const textarea = document.createElement('textarea'); textarea.value = message.url; document.body.append(textarea); textarea.select();
  const ok = document.execCommand('copy'); textarea.remove(); respond({ok});
});
