import { useEffect, useState, type ReactNode } from 'react';
import type { RecordingMode, RecordingState, Video } from '../../../../packages/shared/src/index';
import { formatTime, presentation } from '../../utils/presentation';
import './App.css';

type IconName = 'screen' | 'camera' | 'layers' | 'mic' | 'arrow' | 'pause' | 'play' | 'stop' | 'copy' | 'check' | 'link' | 'folder';
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    screen: <><rect x="3" y="4" width="18" height="13" rx="3"/><path d="M8 21h8m-4-4v4"/></>,
    camera: <><rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/></>,
    layers: <><rect x="3" y="4" width="18" height="14" rx="3"/><circle cx="17" cy="17" r="5"/></>,
    mic: <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    pause: <><path d="M8 5v14m8-14v14" strokeWidth="4"/></>,
    play: <path d="m8 5 11 7-11 7Z"/>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    link: <><path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)"/></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>,
  };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
async function send(message: object) {
  const result = await browser.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  return result;
}
export default function App() {
  const [mode, setMode] = useState<RecordingMode>('screen+cam');
  const [mic, setMic] = useState(true), [local, setLocal] = useState(false);
  const [state, setState] = useState<RecordingState>({ status: 'idle', duration: 0, uploadProgress: 0 });
  const [videos, setVideos] = useState<Video[]>([]), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [signedIn, setSignedIn] = useState(false), [busy, setBusy] = useState(false), [loadingLibrary, setLoadingLibrary] = useState(false);
  const [view, setView] = useState<'record' | 'library'>('record');
  const act = async (message: object) => {
    setError('');
    try { return await send(message); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.'); return undefined; }
  };
  const loadLibrary = async () => {
    setLoadingLibrary(true);
    const result = await act({ type: 'LIST_VIDEOS' });
    if (result) setVideos(result.videos);
    setLoadingLibrary(false);
  };
  useEffect(() => {
    void send({ type: 'GET_STATE' }).then(setState).catch(e => setError(String(e)));
    void browser.storage.local.get(['refreshToken', 'recordingPreferences']).then(r => {
      setSignedIn(!!r.refreshToken);
      const p = r.recordingPreferences as { mode?: RecordingMode; micEnabled?: boolean; local?: boolean } | undefined;
      if (p?.mode) setMode(p.mode);
      if (p?.micEnabled !== undefined) setMic(p.micEnabled);
      if (p?.local !== undefined) setLocal(p.local);
    });
    const listener = (msg: { type: string; state: RecordingState }) => { if (msg.type === 'RECORDING_STATE_UPDATE') setState(msg.state); };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setNotice('Link copied'); setTimeout(() => setNotice(''), 2500); }
    catch { setError('Clipboard unavailable. Open recording controls to copy the link.'); }
  };
  async function start() {
    setBusy(true);
    await browser.storage.local.set({ recordingPreferences: { mode, micEnabled: mic, local } });
    await act({ type: 'START_RECORDING', mode, micEnabled: mic, local });
    setBusy(false);
  }
  const active = state.status === 'recording' || state.status === 'paused';
  const waiting = state.status === 'preparing' || state.status === 'countdown';
  const saving = state.status === 'uploading', failed = state.status === 'failed';
  const ready = state.outcome === 'ready' && state.status === 'idle';
  const info = presentation(state);
  const modes: { value: RecordingMode; label: string; icon: IconName }[] = [
    { value: 'screen', label: 'Screen', icon: 'screen' },
    { value: 'screen+cam', label: 'Screen + cam', icon: 'layers' },
    { value: 'cam', label: 'Camera', icon: 'camera' },
  ];
  return <div className="popup-root">
    <header className="header">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setView('record'); }}><span className="brand-icon"><Icon name="screen"/></span>ScreenRec<span className="brand-dot"/></a>
      <span className="shortcut">Alt ⇧ R</span>
    </header>
    <nav className="tabs" aria-label="Extension pages">
      <button className={view === 'record' ? 'selected' : ''} onClick={() => setView('record')}>Record</button>
      <button className={view === 'library' ? 'selected' : ''} onClick={() => { setView('library'); void loadLibrary(); }}>My recordings</button>
    </nav>
    <main>
      {error && <div className="alert" role="alert">{error}</div>}
      {notice && <div className="toast" role="status"><Icon name="check"/>{notice}</div>}
      {view === 'record' ? <>
        <section className="intro"><span className="eyebrow">{active ? 'YOU’RE LIVE' : saving ? 'ALMOST THERE' : ready ? 'ALL DONE' : 'LESS TYPING. MORE SHOWING.'}</span><h1>{info.title}</h1><p>{info.detail}</p></section>
        {failed && <section className="failure-card" role="alert">
          <p>{state.error}</p>
          <div className="inline-actions">
            {state.shareUrl && <button className="button small" onClick={() => void act({ type: 'RETRY_UPLOAD' })}>Retry saving</button>}
            <button className="text-button" onClick={() => void act({ type: 'OPEN_RECORDER' })}>{state.shareUrl ? 'Download / recover' : 'Recording controls'}</button>
          </div>
        </section>}
        {active ? <section className="session-card">
          <span className={state.status === 'paused' ? 'status-pill paused' : 'status-pill'}><i/>{state.status === 'paused' ? 'Paused' : 'Recording'}</span>
          <div className="big-timer">{formatTime(state.duration)}</div>
          <div className="record-controls"><button className="secondary-button" onClick={() => void act({ type: state.status === 'paused' ? 'RESUME_RECORDING' : 'PAUSE_RECORDING' })}><Icon name={state.status === 'paused' ? 'play' : 'pause'}/>{state.status === 'paused' ? 'Resume' : 'Pause'}</button><button className="stop-button" onClick={() => void act({ type: 'STOP_RECORDING' })}><Icon name="stop"/>Stop recording</button></div>
        </section> : saving ? <section className="session-card saving-card">
          <span className="saving-spinner"/><strong>{state.uploadStage === 'finalizing' ? 'Upload complete' : `${Math.round(state.uploadProgress)}% uploaded`}</strong>
          <div className="progress-track"><span style={{ width: `${state.uploadProgress}%` }}/></div>
          <p>{info.clipboard || 'Your local copy stays safe until saving finishes.'}</p>
        </section> : waiting ? <section className="session-card"><div className="big-timer">{state.status === 'countdown' ? state.countdown : <span className="saving-spinner"/>}</div><p>{state.status === 'countdown' ? 'A little moment to get ready.' : 'Chrome’s source picker is opening…'}</p><button className="text-button" onClick={() => void act({type:'OPEN_RECORDER'})}>View recording controls</button></section> : <>
          {ready && state.shareUrl && <section className="success-card"><span className="success-icon"><Icon name="check"/></span><div><strong>Ready for its audience.</strong><p>{info.clipboard}</p></div><div className="inline-actions"><button className="button small" onClick={() => void copy(state.shareUrl!)}><Icon name="copy"/>Copy link</button><a className="text-button" href={state.shareUrl} target="_blank" rel="noreferrer">Open video ↗</a></div></section>}
          <fieldset className="mode-group"><legend>What are we recording?</legend><div className="mode-grid">{modes.map(item => <button key={item.value} className={mode === item.value ? 'mode-card chosen' : 'mode-card'} aria-pressed={mode === item.value} onClick={() => setMode(item.value)}><Icon name={item.icon}/><span>{item.label}</span></button>)}</div></fieldset>
          <section className="settings-panel">
            <div className="setting-row"><span className="setting-label"><Icon name="mic"/><span>Microphone<small>{mic ? 'Your voice, included' : 'Record without your voice'}</small></span></span><button className={mic ? 'switch on' : 'switch'} role="switch" aria-checked={mic} aria-label="Microphone" onClick={() => setMic(!mic)}><span/></button></div>
            <div className="destination"><button className={!local ? 'chosen' : ''} onClick={() => setLocal(false)}><Icon name="link"/>Share link</button><button className={local ? 'chosen' : ''} onClick={() => setLocal(true)}><Icon name="folder"/>Download only</button></div>
          </section>
          <button className="start-button" disabled={busy} onClick={() => void start()}><span className="record-symbol"/>{busy ? 'Getting ready…' : 'Start recording'}<Icon name="arrow"/></button>
          <p className="start-hint">{local ? 'Saved on your device. No account needed.' : 'Cloud AI uses speech and selected screen snapshots.'}</p>
        </>}
        {(active || failed) && <button className="text-button controls-link" onClick={() => void act({ type: 'OPEN_RECORDER' })}>Open recording controls ↗</button>}
      </> : <section className="library">
        <div className="library-heading"><div><span className="eyebrow">YOUR WORK, IN ONE PLACE</span><h1>My recordings</h1></div><button className="text-button" disabled={loadingLibrary} onClick={() => void loadLibrary()}>{loadingLibrary ? 'Loading…' : 'Refresh'}</button></div>
        {!videos.length && <div className="empty-state"><span className="empty-icon"><Icon name="folder"/></span><h2>Your next great explanation<br/>starts here.</h2><p>{signedIn ? 'Your shared recordings will appear here.' : 'Sign in to see your shared recordings.'}</p><button className="secondary-button" onClick={() => setView('record')}>Make a recording</button></div>}
        {videos.map(video => <article key={video.id} className="library-card"><span className="video-icon"><Icon name="play"/></span><div><h2>{video.title}</h2><p>{formatTime(video.duration || 0)} · {new Date(video.createdAt).toLocaleDateString()} · {video.status === 'ready' ? 'Ready' : video.status === 'failed' ? 'Needs attention' : 'Saving'}</p>{video.aiStatus && <small className="library-ai-status">{video.aiStatus==='ready'?'AI notes ready':video.aiStatus==='no_speech'?'No AI inputs captured':video.aiStatus==='failed'?'AI needs attention':'Generating AI notes...'}</small>}{video.status==='ready' && (!video.aiStatus || video.aiStatus==='failed' || (video.aiStatus==='ready' && video.transcriptionFailed)) && <button className="text-button" onClick={async()=>{await act({type:'RETRY_AI',videoId:video.id});await loadLibrary();}}>{video.transcriptionFailed?'Retry transcription':video.aiStatus?'Retry AI':'Generate AI notes'}</button>}</div>{video.status === 'ready' && video.shareUrl && <><button className="icon-button" aria-label={`Copy link to ${video.title}`} onClick={() => void copy(video.shareUrl!)}><Icon name="copy"/></button><a className="icon-button" aria-label={`Open ${video.title}`} href={video.shareUrl} target="_blank" rel="noreferrer">↗</a></>}</article>)}
      </section>}
    </main>
    <footer><span><i className={signedIn ? 'online' : ''}/>{signedIn ? 'Connected to your workspace' : local ? 'Local recording' : 'Sign in to share recordings'}</span><button className="text-button" onClick={async () => { setBusy(true); const result = await act({ type: signedIn ? 'SIGN_OUT' : 'SIGN_IN' }); if (result) setSignedIn(!signedIn); setBusy(false); }} disabled={busy}>{signedIn ? 'Sign out' : 'Sign in'}</button></footer>
  </div>;
}
