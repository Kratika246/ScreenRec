import type { RecordingState } from '../../../packages/shared/src/index';
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  main(ctx) {
    let host: HTMLDivElement | undefined, shadow: ShadowRoot | undefined, bubble: HTMLDivElement | undefined, last: RecordingState | undefined, observer: ResizeObserver | undefined, toastTimer: ReturnType<typeof setTimeout> | undefined;
    const send = (type: string) => browser.runtime.sendMessage({ type }).catch(() => {});
    function remove() { observer?.disconnect(); clearTimeout(toastTimer); host?.remove(); host = undefined; shadow = undefined; bubble = undefined; }
    function position() {
      if (!bubble) return;
      const rect = bubble.getBoundingClientRect();
      void browser.runtime.sendMessage({target:'recorder',type:'BUBBLE_POSITION',x:(rect.left+rect.width/2)/innerWidth,y:(rect.top+rect.height/2)/innerHeight,rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,outerWidth,outerHeight,screenX,screenY,screenWidth:screen.width,screenHeight:screen.height,screenLeft:(screen as Screen & {availLeft?:number}).availLeft||0,screenTop:(screen as Screen & {availTop?:number}).availTop||0}});
    }
    function draggable(element: HTMLElement) {
      let dragging=false,dx=0,dy=0;
      element.onpointerdown=event=>{
        if(['BUTTON','IFRAME'].includes((event.target as HTMLElement).tagName))return;
        dragging=true; const rect=element.getBoundingClientRect();dx=event.clientX-rect.left;dy=event.clientY-rect.top;element.setPointerCapture(event.pointerId);
      };
      element.onpointermove=event=>{
        if(!dragging)return;
        element.style.left=Math.max(0,Math.min(innerWidth-element.offsetWidth,event.clientX-dx))+'px';
        element.style.top=Math.max(0,Math.min(innerHeight-element.offsetHeight,event.clientY-dy))+'px';
        element.style.bottom='auto';element.style.right='auto';position();
      };
      element.onpointerup=()=>{dragging=false;position();};
    }
    function update(state: RecordingState) {
      last=state;
      if(document.visibilityState!=='visible'){remove();return;}
      if(!['countdown','recording','paused','uploading'].includes(state.status)){
        remove();
        if(state.copied || state.error) {
          host=document.createElement('div');host.style.cssText='position:fixed;bottom:24px;right:24px;z-index:2147483647';
          const notice=host.attachShadow({mode:'closed'}),text=document.createElement('p');
          text.style.cssText='background:#181827;color:white;font:14px system-ui;padding:16px;border:1px solid #7963df;border-radius:12px';
          text.setAttribute('role','status');text.textContent=state.error?'Recording needs attention. Open the extension to recover it.':'Link copied. Your recording is ready.';
          notice.append(text);document.documentElement.append(host);toastTimer=setTimeout(remove,5000);
        }
        return;
      }
      if(!host) {
        host=document.createElement('div');host.style.cssText='all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
        shadow=host.attachShadow({mode:'closed'});
        const style=document.createElement('style');style.textContent=':host{all:initial}section{position:fixed;bottom:20px;right:24px;pointer-events:auto;font:14px system-ui;background:#181827;color:white;border:1px solid #7963df;border-radius:14px;padding:12px;box-shadow:0 8px 32px #0008;cursor:move}button{background:#7963df;color:white;border:0;border-radius:6px;padding:8px;margin:4px;cursor:pointer}p{margin:6px}.bubble{pointer-events:auto;position:fixed;bottom:145px;right:24px;width:160px;height:160px;border-radius:50%;overflow:hidden;border:3px solid #7963df;background:#181827;cursor:move;min-width:100px;min-height:100px;max-width:300px;max-height:300px;resize:both}.bubble iframe{width:100%;height:100%;border:0;pointer-events:none}.handle{position:absolute;inset:0;background:transparent}';
        shadow.append(style);const bar=document.createElement('section'),status=document.createElement('p');status.id='status';status.setAttribute('aria-live','polite');bar.append(status);
        const pause=document.createElement('button');pause.id='pause';pause.textContent='Pause';pause.onclick=()=>void send(pause.textContent==='Resume'?'RESUME_RECORDING':'PAUSE_RECORDING');
        const stop=document.createElement('button');stop.id='stop';stop.textContent='Stop';stop.onclick=()=>void send('STOP_RECORDING');
        bar.append(pause,stop);shadow.append(bar);document.documentElement.append(host);draggable(bar);
      }
      if(state.mode && state.mode!=='screen' && !bubble && ['recording','paused'].includes(state.status)) {
        bubble=document.createElement('div');bubble.className='bubble';bubble.title='Drag to move camera; resize from the lower right';
        const iframe=document.createElement('iframe');iframe.src=browser.runtime.getURL('/camera.html');iframe.title='Camera preview';
        const handle=document.createElement('div');handle.className='handle';bubble.append(iframe,handle);shadow!.append(bubble);draggable(bubble);
        observer=new ResizeObserver(position);observer.observe(bubble);position();
      }
      if(state.status==='uploading' && bubble){bubble.remove();bubble=undefined;}
      shadow!.getElementById('status')!.textContent=state.status==='countdown'?`Starting in ${state.countdown}`:`${state.status} · ${Math.floor(state.duration/60)}:${String(state.duration%60).padStart(2,'0')}${state.copied?' · Link copied':''}`;
      const pause=shadow!.getElementById('pause') as HTMLButtonElement,stop=shadow!.getElementById('stop') as HTMLButtonElement;
      pause.textContent=state.status==='paused'?'Resume':'Pause';pause.disabled=!['recording','paused'].includes(state.status);stop.disabled=pause.disabled;
    }
    const listener=(message:{type:string;state:RecordingState})=>{if(message.type==='RECORDING_STATE_UPDATE')update(message.state);};
    const visible=()=>{if(last)update(last);},resize=()=>position();
    browser.runtime.onMessage.addListener(listener);void browser.runtime.sendMessage({type:'GET_STATE'}).then(update).catch(()=>{});
    document.addEventListener('visibilitychange',visible);window.addEventListener('resize',resize);
    ctx.onInvalidated(()=>{remove();browser.runtime.onMessage.removeListener(listener);document.removeEventListener('visibilitychange',visible);window.removeEventListener('resize',resize);});
  }
});
