import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Video } from '../../../packages/shared/src/index';
import './viewer.css';

function Viewer({id}:{id:string|undefined}) {
  const [video,setVideo]=useState<Video|null>(null),[error,setError]=useState(''),[copied,setCopied]=useState(false),[playbackError,setPlaybackError]=useState('');
  const player=useRef<HTMLVideoElement>(null);
  useEffect(()=>{
    let disposed=false, timer:ReturnType<typeof setTimeout>|undefined;
    const controller=new AbortController();
    async function load() {
      let again=true;
      try {
        const response=await fetch(`${(import.meta.env.VITE_API_BASE||'').replace(/\/$/,'')}/videos/${id}`,{signal:controller.signal});
        if(!response.ok) { if(response.status===404 || response.status===400) { again=false; throw new Error('This recording does not exist. Check the shared link.'); } throw new Error('Connection failed. Retrying…'); }
        const data:Video=await response.json();
        if(!disposed) { setVideo(data); setError(''); }
        again=!['ready','failed'].includes(data.status);
      } catch(e) { if(!disposed)setError(e instanceof Error?e.message:'Unable to load recording. Retrying…'); }
      if(!disposed && again)timer=setTimeout(()=>void load(),2000);
    }
    void load(); return()=>{disposed=true;controller.abort();clearTimeout(timer);};
  },[id]);
  async function copy() {try{await navigator.clipboard.writeText(location.href);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{setError('Clipboard blocked. Select and copy the link below.');}}
  return <div className="viewer-root">
    <header className="viewer-header"><a className="viewer-logo" href="/">ScreenRec</a><button className="copy-link-btn" onClick={()=>void copy()}>{copied?'Copied!':'Copy link'}</button></header>
    <main className="viewer-main">
      {error&&<p role="alert">{error}</p>}
      {!video&&!error&&<p role="status">Loading recording…</p>}
      {video&&<>
        <div className="player-container">{video.status==='ready'&&video.playbackUrl?
          <video ref={player} className="player" src={video.playbackUrl} controls playsInline preload="auto" onError={()=>setPlaybackError('Playback failed. Retry playback or check your connection.')} onCanPlay={()=>setPlaybackError('')}/>:
          <div className="player-placeholder"><p role="status">{video.status==='failed'?'This upload was canceled or failed.':video.status==='recording'?'Recording or upload is in progress. Playback will appear here automatically.':'Finalizing your recording. Playback will appear here automatically.'}</p></div>}
        </div>
        {playbackError&&<p role="alert">{playbackError}<button onClick={()=>player.current?.load()}>Retry playback</button></p>}
        <div className="video-meta"><h1 className="video-title">{video.title}</h1><p>{video.status} · {video.duration??0}s · {new Date(video.createdAt).toLocaleString()}</p></div>
      </>}
      <div className="share-section"><h2>Share this recording</h2><div className="share-url-row"><input className="share-url-input" readOnly value={location.href} aria-label="Recording share URL" onFocus={e=>e.target.select()}/><button className="share-copy-btn" onClick={()=>void copy()}>{copied?'Copied!':'Copy link'}</button></div><p>Anyone with this link can view the recording.</p></div>
    </main>
  </div>;
}

export default function VideoViewer() { const {id}=useParams<{id:string}>(); return <Viewer key={id} id={id}/>; }
