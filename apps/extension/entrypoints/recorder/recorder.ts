import './style.css';
import { api, signIn, token } from '../../utils/auth';
import { UploadQueue, uploadPartWithRetry } from '../../utils/upload';
import { PartBuffer, PART_SIZE } from '../../utils/multipart';
import { recordingBlob, removeSession, saveChunk, saveSession, sessions, type Session } from '../../utils/store';
import { formatTime, presentation } from '../../utils/presentation';
import { FrameSampler } from '../../utils/frames';
import { desktopConstraints } from '../../utils/capture';
import type { RecordingState, RecordingMode } from '../../../../packages/shared/src/index';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const startButton = el<HTMLButtonElement>('start'), stopButton = el<HTMLButtonElement>('stop'), pauseButton = el<HTMLButtonElement>('pause');
const mode = el<HTMLSelectElement>('mode'), mic = el<HTMLInputElement>('mic'), local = el<HTMLInputElement>('local');
const params = new URLSearchParams(location.search);
mode.value = params.get('mode') || 'screen'; mic.checked = params.get('mic') !== 'false'; local.checked = params.get('local') === 'true';
let state: RecordingState = { status: 'idle', duration: 0, uploadProgress: 0 };
let session: Session | undefined, recorder: MediaRecorder | undefined;
let sources: MediaStream[] = [], audio: AudioContext | undefined, drawTimer: number | undefined, ticker: number | undefined;
let frames:FrameSampler|undefined,frameStop:Promise<void>|undefined;
let activeStart = 0, elapsed = 0, chunkIndex = 0, nextPart = 1, buffer = new PartBuffer();
let persist = Promise.resolve(), queue = new UploadQueue();
let uploadError: unknown, stopped = false, writeError: unknown;
let bubble = { x: .82, y: .8 }, camera: MediaStream | undefined;
let bubbleRect: {left:number;top:number;width:number;height:number;viewportWidth:number;viewportHeight:number;outerWidth:number;outerHeight:number;screenX:number;screenY:number;screenWidth:number;screenHeight:number;screenLeft:number;screenTop:number} | undefined;
const peers = new Map<string, RTCPeerConnection>();
const signal = (message: object) => chrome.runtime.sendMessage(message).catch(() => {});
function report(patch: Partial<RecordingState> = {}) {
  state = { ...state, ...patch };
  signal({ type: 'SESSION_STATE', state });
  const info=presentation(state);
  document.body.dataset.status=state.status;
  el('session-title').textContent=info.title;
  el('message').textContent=info.detail;
  el('phase').textContent=state.status==='recording'?'Recording':state.status==='paused'?'Paused':state.status==='failed'?'Needs attention':state.status==='uploading'?'Saving':state.outcome==='ready'?'Ready to share':'Ready when you are';
  el('timer').textContent=formatTime(state.duration);
  el('progress').textContent=state.status==='uploading'
    ? (state.uploadStage==='finalizing'?'100% uploaded - Finishing your recording.':Math.round(state.uploadProgress)+'% uploaded')+(info.clipboard?' - '+info.clipboard:'')
    : state.status==='failed' ? (session?.total?'Your recorded data is still saved on this device.':'No recording was lost.') : info.clipboard || info.detail;
  el('error').textContent=state.error || ''; el('error').hidden=!state.error;
  el('retry').hidden=state.status!=='failed'||!session?.videoId;
  el('share').hidden=state.outcome!=='ready'||state.status==='failed';
  el('countdown').hidden=state.status!=='countdown';
  el('countdown-number').textContent=String(state.countdown || 3);
  el('upload-track').hidden=state.status!=='uploading';
  el('upload-bar').style.width=state.uploadProgress+'%';
  el('preview-placeholder').hidden=!!session;
  const locked=['preparing','countdown','recording','paused','uploading'].includes(state.status);
  startButton.disabled=locked;
  el<HTMLButtonElement>('signin').disabled=locked;
  mode.disabled=locked;mic.disabled=locked;local.disabled=locked;
}
function duration() { return Math.round((elapsed + (activeStart ? performance.now() - activeStart : 0)) / 1000); }
async function copyLink() {
  if (!session?.shareUrl) return;
  el<HTMLAnchorElement>('share').href = session.shareUrl; el('share').hidden = false; el('copy').hidden = false;
  try {
    try { await navigator.clipboard.writeText(session.shareUrl); }
    catch { const result = await chrome.runtime.sendMessage({type:'COPY_SHARE',url:session.shareUrl}); if(!result?.ok) throw new Error('Clipboard blocked'); }
    report({ copied: true });
  }
  catch { report({ copied: false }); el('message').textContent = 'Automatic clipboard copy was blocked. Click Copy link.'; }
}
function cleanup() {
  sources.forEach(s => s.getTracks().forEach(t => t.stop())); sources = [];
  if (drawTimer) clearInterval(drawTimer);
  if (ticker) clearInterval(ticker);
  void audio?.close(); audio = undefined;
  peers.forEach(p => p.close()); peers.clear(); camera = undefined;
  pauseButton.disabled = true; stopButton.disabled = true;
}
async function sendPart(current: Session, number: number, blob: Blob) {
  const etag = await uploadPartWithRetry(blob, async () => {
    const result = await api(`/videos/${current.videoId}/parts`, {uploadId:current.uploadId,partNumber:number});
    return result.presignedUrl;
  });
  current.parts=[...current.parts.filter(p=>p.partNumber!==number),{partNumber:number,etag,size:blob.size}];
  await saveSession(current);
  if(current===session)report({uploadProgress:Math.min(100,current.parts.reduce((sum,p)=>sum+p.size,0)/Math.max(1,current.total)*100)});
}
function enqueue(blob: Blob) {
  const current=session!, number=nextPart++;
  queue.add(()=>sendPart(current,number,blob));
}
async function complete(current: Session) {
  if (!current.total) throw new Error('No recorded data. Please record again.');
  await api(`/videos/${current.videoId}/complete`, { uploadId: current.uploadId, parts: [...current.parts].sort((a,b) => a.partNumber-b.partNumber), duration: current.duration, size: current.total });
  await removeSession(current.id);
}
async function finish() {
  const current = session!;
  try {
    await persist;
    if (writeError) throw writeError;
    current.duration = duration(); await saveSession(current);
    if (current.local) { await download(current); report({ status: 'idle', uploadProgress: 100, outcome:'local' }); }
    else {
      await frameStop;
      const tail = buffer.flush(); if (tail) enqueue(tail);
      await queue.drain(); if (uploadError) throw uploadError;
      report({uploadProgress:100,uploadStage:'finalizing'});
      await complete(current); report({ status: 'idle', uploadProgress: 100, outcome:'ready' });
      el('message').textContent = 'Recording is ready to play.';
    }
  } catch (error) { report({ status: 'failed', error: error instanceof Error?error.message:String(error) }); el('message').textContent = 'Recording retained below. Retry upload or download your recording.'; }
  finally { cleanup(); startButton.disabled = false; await recoveries(); }
}
function stop() {
  if (!recorder || recorder.state === 'inactive' || stopped) return;
  stopped = true;
  elapsed += activeStart ? performance.now() - activeStart : 0; activeStart = 0;
  report({ status: 'uploading', duration: duration(),uploadStage:'sending' });
  void copyLink(); frameStop=frames?.stop(); recorder.stop(); cleanup();
}
function togglePause() {
  if (!recorder || !['recording', 'paused'].includes(recorder.state)) return;
  if (recorder.state === 'recording') { recorder.pause(); elapsed += performance.now() - activeStart; activeStart = 0; report({ status: 'paused' }); pauseButton.textContent = 'Resume'; }
  else { recorder.resume(); activeStart = performance.now(); report({ status: 'recording' }); pauseButton.textContent = 'Pause'; }
}
async function videoFor(stream: MediaStream) {
  const video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play(); return video;
}
function chooseDesktop(): Promise<MediaStream> {
  return new Promise((resolve,reject)=>{
    if(!chrome.desktopCapture){reject(new Error('Reload the extension to enable screen capture.'));return;}
    chrome.desktopCapture.chooseDesktopMedia(['screen','window','tab','audio'],(streamId,options)=>{
      const error=chrome.runtime.lastError?.message;
      if(error){reject(new Error(error));return;}
      if(!streamId){reject(new DOMException('Source selection canceled.','AbortError'));return;}
      navigator.mediaDevices.getUserMedia(desktopConstraints(streamId,options.canRequestAudioTrack) as MediaStreamConstraints).then(resolve,reject);
    });
  });
}
async function begin() {
  if (!['idle', 'failed'].includes(state.status)) return;
  frames?.cancel();frames=undefined;frameStop=undefined;
  session = undefined;
  startButton.disabled = true; report({ status: 'preparing', error: undefined, copied: false, duration:0,uploadProgress:0, shareUrl: undefined,outcome:undefined,uploadStage:undefined }); el('share').hidden = true; el('copy').hidden = true;
  let screen: MediaStream | undefined;
  try {
    if(!local.checked)await token();
    const screenRequest = mode.value !== 'cam' ? chooseDesktop() : undefined;
    screen = await screenRequest;
    if (screen) sources.push(screen);
    if (mode.value !== 'screen') { camera = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false }); sources.push(camera); }
    if (mic.checked) { const microphone = await navigator.mediaDevices.getUserMedia({ audio: true }); sources.push(microphone); }
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mime) throw new Error('This browser cannot record WebM.');
    session = { id: crypto.randomUUID(), mode: mode.value, local: local.checked, duration: 0, mime, hasAudio:sources.some(s=>s.getAudioTracks().length>0), total: 0, parts: [] };
    if (!session.local) Object.assign(session, await api('/videos', { mode: mode.value as RecordingMode, title: `Recording ${new Date().toLocaleString()}`,hasAudio:session.hasAudio }));
    await saveSession(session);
    const screenPreview=screen?await videoFor(screen):undefined;
    let videoStream = screen || camera!;
    if (screen && camera) {
      const screenVideo = screenPreview!, cameraVideo = await videoFor(camera);
      const canvas = document.createElement('canvas');
      const settings = screen.getVideoTracks()[0]!.getSettings();
      canvas.width = settings.width || 1920; canvas.height = settings.height || 1080;
      const context = canvas.getContext('2d')!;
      const draw = () => {
        context.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
        let radius = Math.min(canvas.width, canvas.height) * .1, cx=bubble.x*canvas.width, cy=bubble.y*canvas.height;
        if(bubbleRect) {
          const r=bubbleRect, surface=settings.displaySurface;
          const border=Math.max(0,(r.outerWidth-r.viewportWidth)/2), header=Math.max(0,r.outerHeight-r.viewportHeight-border);
          const sx=surface==='monitor'?canvas.width/r.screenWidth:surface==='window'?canvas.width/r.outerWidth:canvas.width/r.viewportWidth;
          const sy=surface==='monitor'?canvas.height/r.screenHeight:surface==='window'?canvas.height/r.outerHeight:canvas.height/r.viewportHeight;
          cx=(r.left+r.width/2+(surface==='monitor'?r.screenX-r.screenLeft+border:surface==='window'?border:0))*sx;
          cy=(r.top+r.height/2+(surface==='monitor'?r.screenY-r.screenTop+header:surface==='window'?header:0))*sy;
          radius=Math.max(r.width*sx,r.height*sy)/2+6;
        }
        const x = Math.max(radius, Math.min(canvas.width-radius, cx)), y = Math.max(radius, Math.min(canvas.height-radius, cy));
        context.save(); context.beginPath(); context.arc(x, y, radius, 0, Math.PI*2); context.clip();
        const side = Math.min(cameraVideo.videoWidth, cameraVideo.videoHeight);
        context.drawImage(cameraVideo, (cameraVideo.videoWidth-side)/2, (cameraVideo.videoHeight-side)/2, side, side, x-radius, y-radius, radius*2, radius*2); context.restore();
      };
      draw(); drawTimer = window.setInterval(draw, 1000 / 30);
      videoStream = canvas.captureStream(30); sources.push(videoStream);
    }
    const tracks = [...videoStream.getVideoTracks()];
    const audioTracks = sources.flatMap(s => s.getAudioTracks());
    if (audioTracks.length) {
      audio = new AudioContext(); await audio.resume(); const destination = audio.createMediaStreamDestination();
      audioTracks.forEach(track => audio!.createMediaStreamSource(new MediaStream([track])).connect(destination));
      tracks.push(...destination.stream.getAudioTracks()); sources.push(destination.stream);
    }
    const stream = new MediaStream(tracks); el<HTMLVideoElement>('preview').srcObject = stream;
    screen?.getVideoTracks()[0]?.addEventListener('ended', () => { if (recorder?.state !== 'inactive') stop(); else cleanup(); });
    buffer = new PartBuffer(); nextPart = 1; chunkIndex = 0; queue = new UploadQueue(); persist = Promise.resolve(); uploadError = undefined; writeError = undefined; stopped = false; elapsed = 0;
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 });
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      const current = session!, index = chunkIndex++;
      persist = persist.then(async () => {
        await saveChunk(current.id, index, event.data); current.total += event.data.size; current.duration = duration(); await saveSession(current);
        if (current.total > 5 * 1024 ** 3 || current.duration > 86400) { stop(); throw new Error('Recording exceeds the cloud limit. Download the retained recording.'); }
        if (!current.local) buffer.push(event.data).forEach(enqueue);
      }).catch(error => { writeError = error; stop(); });
    };
    recorder.onstop = () => void finish();
    recorder.onerror = event => { uploadError = new Error(`Recorder failure: ${event.type}`); stop(); };
    for (let n = 3; n > 0; n--) { report({ status: 'countdown', countdown: n }); await new Promise(r => setTimeout(r, 1000)); }
    if (screen && screen.getVideoTracks()[0]?.readyState === 'ended') throw new Error('Screen sharing ended before recording.');
    recorder.start(5000); activeStart = performance.now();
    if(screenPreview && !session.local) {
      const current=session;
      frames=new FrameSampler(screenPreview,()=>recorder?.state==='recording',()=>duration(),async(slot,timestamp,blob)=>{
        const result=await api(`/videos/${current.videoId}/frames`,{slot,timestamp,size:blob.size});
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
        try {const response=await fetch(result.presignedUrl,{method:'PUT',headers:result.headers,body:blob,signal:controller.signal});if(!response.ok)throw new Error('Snapshot upload failed');}
        finally {clearTimeout(timer);}
      });
      frames.start();
    }
    report({ status: 'recording', duration: 0, uploadProgress: 0, videoId: session.videoId, shareUrl: session.shareUrl, mode: mode.value as RecordingMode });
    ticker = window.setInterval(() => report({ duration: duration() }), 1000);
    stopButton.disabled = false; pauseButton.disabled = false; pauseButton.textContent = 'Pause';
    el('message').textContent = 'Recording. Keep this tab open; controls are also available from the extension.';
  } catch (error) {
    frames?.cancel();cleanup(); if (session?.videoId) await api(`/videos/${session.videoId}/cancel`, {}).catch(() => {});
    if (session) await removeSession(session.id).catch(() => {});
    session = undefined; report({ status: error instanceof DOMException && error.name==='AbortError'?'idle':'failed', error: error instanceof DOMException && error.name==='AbortError'?undefined:error instanceof Error?error.message:String(error) }); startButton.disabled = false;
  }
}
async function download(current: Session) {
  const blob = await recordingBlob(current), url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `screenrec-${current.id}.webm`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function retry(current: Session) {
  if (!['idle', 'failed'].includes(state.status)) throw new Error('Finish the active recording first.');
  session = current; report({ status: 'uploading', error: undefined, shareUrl: current.shareUrl,uploadStage:'sending',outcome:undefined });
  try {
    const blob = await recordingBlob(current);
    current.total=blob.size; await saveSession(current);
    for (let offset = 0, n = 1; offset < blob.size; offset += PART_SIZE, n++) {
      if (!current.parts.some(p => p.partNumber === n)) await sendPart(current, n, blob.slice(offset, offset + PART_SIZE));
    }
    report({uploadProgress:100,uploadStage:'finalizing'});
    await complete(current); report({ status: 'idle', uploadProgress: 100, outcome:'ready' }); await recoveries();
  } catch(error) { report({ status: 'failed', error: error instanceof Error?error.message:String(error) }); }
}
async function recoveries() {
  const host = el('recoveries'); host.replaceChildren();
  for (const current of await sessions()) {
    if(!current.total)continue;
    const row = document.createElement('div'); row.className='recovery-card'; const label=document.createElement('p'); label.textContent = `${current.local ? 'Local' : 'Cloud'} · ${current.duration}s · ${(current.total/1048576).toFixed(1)} MiB`; row.append(label);
    const action = (label: string, run: () => Promise<unknown>) => { const button = document.createElement('button'); button.textContent = label; button.className=label==='Discard / cancel'?'text-button':'secondary-button'; button.onclick = () => { button.disabled = true; run().catch(error => { el('message').textContent = String(error); }).finally(() => { button.disabled = false; }); }; row.append(button); };
    action('Download', () => download(current));
    if (!current.local) action('Retry upload', () => retry(current));
    action('Discard / cancel', async () => {
      if (session?.id === current.id && !['idle', 'failed'].includes(state.status)) throw new Error('Stop and finish the active recording first.');
      if (current.videoId) await api(`/videos/${current.videoId}/cancel`, {});
      await removeSession(current.id); await recoveries();
    });
    host.append(row);
  }
  el('recovery-section').hidden=!host.childElementCount;
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id || msg.target !== 'recorder') return;
  if(msg.type==='BEGIN_RECORDING' && ['idle','failed'].includes(state.status)){
    if(['screen','screen+cam','cam'].includes(msg.mode))mode.value=msg.mode;
    mic.checked=!!msg.micEnabled;local.checked=!!msg.local;
    void begin();
  }
  if(msg.type==='RETRY_UPLOAD'){
    void (async()=>{
      const retained=(await sessions()).filter(s=>!s.local&&s.total>0);
      const current=session?.videoId?session:retained.length===1?retained[0]:undefined;
      if(current)await retry(current);
      else {const tab=await chrome.tabs.getCurrent();if(tab?.id)await chrome.tabs.update(tab.id,{active:true});el('message').textContent='Choose a retained recording below to retry saving.';}
    })().catch(error=>report({status:'failed',error:error instanceof Error?error.message:String(error)}));
  }
  if (msg.type === 'STOP_RECORDING') stop();
  if (msg.type === 'PAUSE_RECORDING' && recorder?.state === 'recording') togglePause();
  if (msg.type === 'RESUME_RECORDING' && recorder?.state === 'paused') togglePause();
  if (msg.type === 'BUBBLE_POSITION' && msg.rect && Object.values(msg.rect).every(v=>typeof v==='number'&&Number.isFinite(v)) && msg.rect.viewportWidth>0 && msg.rect.viewportHeight>0) { bubbleRect=msg.rect; bubble = { x: Math.max(.1, Math.min(.9, msg.x)), y: Math.max(.1, Math.min(.9, msg.y)) }; }
  if (msg.type === 'PREVIEW_CLOSE') { peers.get(msg.peerId)?.close(); peers.delete(msg.peerId); }
  if (msg.type === 'PREVIEW_OFFER' && camera) {
    const peer = new RTCPeerConnection({ iceServers: [] }); peers.get(msg.peerId)?.close(); peers.set(msg.peerId, peer);
    peer.onconnectionstatechange=()=>{if(['closed','failed','disconnected'].includes(peer.connectionState)){peer.close();peers.delete(msg.peerId);}};
    camera.getVideoTracks().forEach(track => peer.addTrack(track, camera!));
    peer.onicecandidate = event => { if (event.candidate) signal({ type: 'PREVIEW_ICE', peerId: msg.peerId, from: 'recorder', candidate: event.candidate.toJSON() }); };
    void (async () => { await peer.setRemoteDescription(msg.sdp); await peer.setLocalDescription(await peer.createAnswer()); await signal({ type: 'PREVIEW_ANSWER', peerId: msg.peerId, sdp: peer.localDescription?.toJSON(), from: 'recorder' }); })().catch(() => { peer.close(); peers.delete(msg.peerId); });
  }
  if (msg.type === 'PREVIEW_ICE' && msg.from === 'preview') void peers.get(msg.peerId)?.addIceCandidate(msg.candidate).catch(() => {});
  respond({ ok: true });
});
el('signin').onclick = () => { void signIn().then(() => { el('message').textContent = 'Signed in. Ready to record.'; }).catch(error => { el('message').textContent = String(error); }); };
startButton.onclick = () => void begin(); stopButton.onclick = stop; pauseButton.onclick = togglePause; el('copy').onclick = () => void copyLink(); el('retry').onclick=()=>{if(session)void retry(session);};
window.addEventListener('beforeunload', event => { if (!['idle', 'failed'].includes(state.status)) { event.preventDefault(); event.returnValue = ''; } });
void navigator.storage.persist();
report(); void recoveries().then(()=>{if(params.get('autostart')==='true')void begin();});
