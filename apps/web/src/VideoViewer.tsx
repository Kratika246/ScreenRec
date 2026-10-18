import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Video, Transcript } from '../../../packages/shared/src/index';
import { aiLabel, shouldPollVideo } from '../../../packages/shared/src/ai-state';
import './viewer.css';

function timestamp(seconds: number) {
  const value = Math.floor(seconds);
  const hours = Math.floor(value / 3600);
  return (hours ? hours + ':' : '') + `${Math.floor(value / 60) % 60}`.padStart(2, '0') + ':' + `${value % 60}`.padStart(2, '0');
}
function Viewer({ id }: { id: string | undefined }) {
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState(''), [copied, setCopied] = useState(false), [playbackError, setPlaybackError] = useState('');
  const [transcript, setTranscript] = useState<Transcript | null>(null), [transcriptError, setTranscriptError] = useState('');
  const [transcriptRetry, setTranscriptRetry] = useState(0), [query, setQuery] = useState(''), [visible, setVisible] = useState(100);
  const [metadataRetry,setMetadataRetry]=useState(0);
  const [reportCopied, setReportCopied] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const player = useRef<HTMLVideoElement>(null);
  const base = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function load() {
      let again = true;
      try {
        const response = await fetch(`${base}/videos/${id}`, { signal: controller.signal });
        if (!response.ok) {
          if (response.status === 404 || response.status === 400) { again = false; throw new Error('This recording does not exist. Check the shared link.'); }
          throw new Error('Connection failed. Retrying…');
        }
        const data: Video = await response.json();
        if (!disposed) { setVideo(data); setError(''); }
        again = shouldPollVideo(data);
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'Unable to load recording. Retrying…'); }
      if (!disposed && again) timer = setTimeout(() => void load(), 3000);
    }
    void load();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [id, base, metadataRetry]);
  const transcriptReady = !!video?.transcriptReady;
  useEffect(() => {
    if (!transcriptReady) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${base}/videos/${id}/transcript`, { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load the transcript. Please retry.');
        const data: Transcript = await response.json();
        if (!controller.signal.aborted) { setTranscript(data); setTranscriptError(''); }
      } catch (e) { if (!controller.signal.aborted) setTranscriptError(e instanceof Error ? e.message : 'Transcript unavailable.'); }
    })();
    return () => controller.abort();
  }, [id, transcriptReady, transcriptRetry, base]);
  const matchingSegments = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return (transcript?.segments || []).filter(segment => !search || segment.text.toLocaleLowerCase().includes(search));
  }, [transcript, query]);
  async function copy() {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError('Clipboard blocked. Select and copy the link below.'); }
  }
  async function copyReport() {
    if (!video) return;
    const report = [
      video.title, '', video.summary || '', '', 'Observed issues',
      ...(video.issues || []).map(issue => `[${timestamp(issue.timestamp)}] ${issue.title}\nEvidence: ${issue.evidence}`),
      '', 'Recording: ' + location.href,
      'AI draft based on selected screen snapshots. Verify observations; reproduction steps and root cause are not established.',
    ].join('\n');
    try { await navigator.clipboard.writeText(report); setReportCopied(true); setTimeout(() => setReportCopied(false), 2000); }
    catch { setError('Clipboard blocked. Copy the observed evidence from this page.'); }
  }
  function seek(seconds: number) {
    if (!player.current) return;
    player.current.currentTime = seconds;
    setCurrentTime(seconds);
    void player.current.play().catch(() => setPlaybackError('Press Play in the video to continue.'));
  }
  const processing = video?.aiStatus && ['pending', 'transcribing', 'summarizing'].includes(video.aiStatus);
  return <div className="viewer-root">
    <header className="viewer-header"><a className="viewer-logo" href="/">ScreenRec</a><button className="copy-link-btn" onClick={() => void copy()}>{copied ? 'Copied!' : 'Copy link'}</button></header>
    <main className="viewer-main">
      {error && <p role="alert">{error}</p>}
      {!video && !error && <p role="status">Loading recording…</p>}
      {video && <>
        <div className="player-container">{video.status === 'ready' && video.playbackUrl
          ? <video ref={player} className="player" src={video.playbackUrl} controls playsInline preload="auto" onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)} onError={() => setPlaybackError('Playback failed. Retry playback or check your connection.')} onCanPlay={() => setPlaybackError('')}/>
          : <div className="player-placeholder"><p role="status">{video.status === 'failed' ? 'This upload was canceled or failed.' : video.status === 'recording' ? 'Recording or upload is in progress. Playback will appear here automatically.' : 'Finalizing your recording. Playback will appear here automatically.'}</p></div>}
        </div>
        {playbackError && <p role="alert">{playbackError}<button onClick={() => player.current?.load()}>Retry playback</button></p>}
        <div className="video-meta"><h1 className="video-title">{video.title}</h1><p>{video.status === 'ready' ? 'Ready to play' : 'Saving'} · {timestamp(video.duration ?? 0)} · {new Date(video.createdAt).toLocaleString()}</p></div>
        {video.status === 'ready' && <section className="ai-panel" aria-labelledby="ai-heading">
          <div className="ai-heading-row"><h2 id="ai-heading">{aiLabel(video)}</h2><span className={processing ? 'ai-badge working' : 'ai-badge'}>{processing ? 'In progress' : video.aiStatus === 'ready' ? 'Generated with AI' : 'Recording insights'}</span></div>
          <div aria-live="polite">
            {processing && <p className="ai-processing"><span className="ai-spinner"/>{video.aiStatus === 'transcribing' ? 'Turning your spoken explanation into a searchable transcript.' : video.aiStatus === 'summarizing' ? 'Reading available screen snapshots and speech to write your notes and chapters.' : 'Preparing your recording for AI analysis.'} You can play the video now.</p>}
            {video.aiStatus === 'no_speech' && <p className="ai-empty">{video.aiMessage || 'No speech or usable screen snapshots were captured.'} The video still plays normally. Record a shared screen or include speech in your next recording to generate notes.</p>}
            {video.aiStatus === 'failed' && <p className="ai-empty">{video.aiMessage || 'AI processing could not finish. Retry AI from My recordings in the extension.'} <button className='transcript-retry' onClick={()=>setMetadataRetry(value=>value+1)}>Refresh AI notes</button></p>}
            {!video.aiStatus && <p className="ai-empty">AI notes have not been generated for this recording. The owner can start AI from My recordings in the extension. <button className='transcript-retry' onClick={()=>setMetadataRetry(value=>value+1)}>Refresh AI notes</button></p>}
            {video.aiStatus === 'ready' && video.aiMessage && <p className="ai-empty" role="status">{video.aiMessage}</p>}
            {video.summary && <div className="ai-summary"><h3>Summary</h3><p>{video.summary}</p>{video.summaryTruncated && <small>This summary uses excerpts from a long recording. The complete transcript is below.</small>}<small>{video.aiSources === 'combined' ? 'Based on speech and selected screen snapshots.' : video.aiSources === 'screens' ? 'Based on selected screen snapshots; no speech was needed.' : 'Based on speech.'} {video.visualFrameCount ? `${video.visualFrameCount} snapshots analyzed. Actions between snapshots may be missed. ` : ''}Check important details against the recording.</small></div>}
          </div>
          {!!video.chapters?.length && <div className="chapters-section"><h3>Chapters</h3><div className="chapter-grid">{video.chapters.map(chapter => <button key={chapter.timestamp} className="chapter-button" onClick={() => seek(chapter.timestamp)}><time>{timestamp(chapter.timestamp)}</time><span>{chapter.title}</span></button>)}</div></div>}
          {!!video.issues?.length && <div className="issues-section"><div className="ai-heading-row"><h3>Observed issues</h3><button className="transcript-retry" onClick={() => void copyReport()}>{reportCopied ? 'Copied!' : 'Copy bug report'}</button></div><p className="transcript-hint">AI observations from screen snapshots. Review the evidence before reporting a bug.</p>{video.issues.map((issue, index) => <article className="issue-card" key={issue.timestamp + '-' + index}><button className="issue-seek" onClick={() => seek(issue.timestamp)}><time>{timestamp(issue.timestamp)}</time><strong>{issue.title}</strong></button><p>{issue.evidence}</p></article>)}</div>}
          {transcriptReady && <div className="transcript-section">
            <div className="transcript-heading"><h3>Transcript {transcript?.languageCode && <span>{transcript.languageCode}</span>}</h3><label className="transcript-search"><span className="sr-only">Search transcript</span><input type="search" placeholder="Find something in the recording…" value={query} onChange={event => { setQuery(event.target.value); setVisible(100); }}/></label></div>
            <p className="transcript-hint">Select a timestamp to jump to that moment.</p>
            {transcriptError ? <p role="alert">{transcriptError} <button className="transcript-retry" onClick={() => setTranscriptRetry(value => value + 1)}>Retry transcript</button></p> : !transcript ? <p role="status">Loading transcript…</p> : transcript.segments.length ? <>
              <div className="transcript-list">{matchingSegments.slice(0, visible).map((segment, index) => <button key={segment.start + '-' + index} className={currentTime >= segment.start && currentTime <= segment.end ? 'transcript-row active' : 'transcript-row'} aria-label={`Jump to ${timestamp(segment.start)}: ${segment.text}`} onClick={() => seek(segment.start)}><time>{timestamp(segment.start)}</time><span>{segment.text}</span></button>)}
                {!matchingSegments.length && <p className="ai-empty">No matching words. Try another search.</p>}
              </div>
              {matchingSegments.length > visible && <button className="transcript-more" onClick={() => setVisible(value => value + 100)}>Show more transcript</button>}
            </> : <p className="transcript-plain">{transcript.text}</p>}
          </div>}
        </section>}
      </>}
      <div className="share-section"><h2>Share this recording</h2><div className="share-url-row"><input className="share-url-input" readOnly value={location.href} aria-label="Recording share URL" onFocus={event => event.target.select()}/><button className="share-copy-btn" onClick={() => void copy()}>{copied ? 'Copied!' : 'Copy link'}</button></div><p>Anyone with this link can view the recording and its AI notes.</p></div>
    </main>
  </div>;
}
export default function VideoViewer() { const { id } = useParams<{ id: string }>(); return <Viewer key={id} id={id}/>; }
