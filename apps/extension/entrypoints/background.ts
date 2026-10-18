import type { RecordingState } from '../../../packages/shared/src/index';
import { api, signIn, signOut, token } from '../utils/auth';

export default defineBackground(() => {
  const recorderUrl = chrome.runtime.getURL('/recorder.html');
  const trusted = (sender: chrome.runtime.MessageSender) => sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL('/'));
  async function recorder() { return (await chrome.tabs.query({})).find(t => t.url?.startsWith(recorderUrl)); }
  async function open(mode = 'screen', micEnabled = true, local = false, autostart = true) {
    const current = await recorder();
    if (current?.id) { await chrome.tabs.update(current.id, { active: true }); if(autostart) await chrome.runtime.sendMessage({target:'recorder',type:'BEGIN_RECORDING',mode,micEnabled,local}); return; }
    await chrome.tabs.create({ url: `${recorderUrl}?${new URLSearchParams({ mode, mic: String(micEnabled), local: String(local), autostart: String(autostart) })}` });
  }
  async function publish(state: RecordingState) {
    await chrome.storage.session.set({ recordingState: state });
    await chrome.action.setBadgeText({ text: state.status === 'recording' ? `${Math.floor(state.duration / 60)}:${String(state.duration % 60).padStart(2, '0')}` : state.status === 'paused' ? 'Ⅱ' : state.status === 'countdown' ? String(state.countdown) : state.status === 'uploading' ? '↑' : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#7c6af7' });
    chrome.runtime.sendMessage({ type: 'RECORDING_STATE_UPDATE', state }).catch(() => {});
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.filter(t => t.id && /^https?:/.test(t.url || '')).map(t => chrome.tabs.sendMessage(t.id!, { type: 'RECORDING_STATE_UPDATE', state }).catch(() => {})));
  }
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (sender.id !== chrome.runtime.id || msg.target === 'recorder' || msg.target === 'preview' || msg.target === 'clipboard') return;
    const handle = async () => {
      switch (msg.type) {
        case 'GET_STATE': {
          if (!await recorder()) return { status: 'idle', duration: 0, uploadProgress: 0 };
          const stored = await chrome.storage.session.get('recordingState');
          return stored.recordingState || { status: 'preparing', duration: 0, uploadProgress: 0 };
        }
        case 'START_RECORDING': if (trusted(sender)) {if(!msg.local){try{await token();}catch{await signIn();}} await open(msg.mode, msg.micEnabled, msg.local);} return { ok: true };
        case 'OPEN_RECORDER': if(trusted(sender))await open(msg.mode,msg.micEnabled,msg.local,false); return {ok:true};
        case 'RETRY_UPLOAD': if(trusted(sender))return chrome.runtime.sendMessage({target:'recorder',type:'RETRY_UPLOAD'}); break;
        case 'STOP_RECORDING': case 'PAUSE_RECORDING': case 'RESUME_RECORDING':
          return chrome.runtime.sendMessage({ target: 'recorder', type: msg.type });
        case 'SESSION_STATE': if (sender.url?.startsWith(recorderUrl)) await publish(msg.state); return { ok: true };
        case 'COPY_SHARE':
          if (!sender.url?.startsWith(recorderUrl) || typeof msg.url !== 'string' || !msg.url.startsWith('https://')) throw new Error('Invalid share URL');
          if (!await chrome.offscreen.hasDocument()) await chrome.offscreen.createDocument({url:'offscreen.html',reasons:[chrome.offscreen.Reason.CLIPBOARD],justification:'Copy the recording share URL after stopping'});
          return chrome.runtime.sendMessage({target:'clipboard',url:msg.url});
        case 'SIGN_IN': if (trusted(sender)) await signIn(); return { ok: true };
        case 'SIGN_OUT': if (trusted(sender)) await signOut(); return { ok: true };
        case 'RETRY_AI': if(trusted(sender) && typeof msg.videoId==='string' && /^[a-f0-9-]{36}$/i.test(msg.videoId))return api('/videos/'+msg.videoId+'/ai',{}); break;
        case 'LIST_VIDEOS': if (trusted(sender)) return api('/videos'); break;
        case 'PREVIEW_OFFER': case 'PREVIEW_ANSWER': case 'PREVIEW_ICE': case 'PREVIEW_CLOSE':
          if (!trusted(sender)) break;
          if (msg.type === 'PREVIEW_OFFER' && !sender.url?.startsWith(chrome.runtime.getURL('/camera.html'))) break;
          if (msg.type !== 'PREVIEW_OFFER' && !sender.url?.startsWith(recorderUrl) && !sender.url?.startsWith(chrome.runtime.getURL('/camera.html'))) break;
          chrome.runtime.sendMessage({ ...msg, target: msg.type === 'PREVIEW_OFFER' || msg.type === 'PREVIEW_CLOSE' || msg.from === 'preview' ? 'recorder' : 'preview' }).catch(() => {});
          return { ok: true };
      }
    };
    handle().then(respond).catch(error => respond({ error: String(error.message || error) }));
    return true;
  });
  chrome.commands.onCommand.addListener(async () => {
    const { recordingState } = await chrome.storage.session.get('recordingState');
    if (recordingState && ['recording', 'paused'].includes((recordingState as RecordingState).status) && await recorder()) chrome.runtime.sendMessage({ target: 'recorder', type: 'STOP_RECORDING' }).catch(() => {});
    else await open();
  });
  chrome.tabs.onRemoved.addListener(async () => { if (!await recorder()) await publish({ status: 'idle', duration: 0, uploadProgress: 0 }); });
});
