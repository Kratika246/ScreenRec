const peerId = crypto.randomUUID(), peer = new RTCPeerConnection({ iceServers: [] });
const send = (message: object) => chrome.runtime.sendMessage({ ...message, peerId, from: 'preview' }).catch(() => {});
peer.addTransceiver('video', { direction: 'recvonly' });
peer.ontrack = event => { const video = document.getElementById('camera') as HTMLVideoElement; video.srcObject = event.streams[0] || new MediaStream([event.track]); void video.play(); };
peer.onicecandidate = event => { if(event.candidate) void send({ type:'PREVIEW_ICE',candidate:event.candidate.toJSON() }); };
const pending: RTCIceCandidateInit[] = [];
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(sender.id!==chrome.runtime.id || message.target!=='preview' || message.peerId!==peerId)return;
  if(message.type==='PREVIEW_ANSWER') void peer.setRemoteDescription(message.sdp).then(async()=>{for(const candidate of pending.splice(0))await peer.addIceCandidate(candidate);}).catch(()=>{});
  if(message.type==='PREVIEW_ICE' && message.from==='recorder'){if(peer.remoteDescription)void peer.addIceCandidate(message.candidate).catch(()=>{});else pending.push(message.candidate);}
});
void (async()=>{await peer.setLocalDescription(await peer.createOffer());await send({type:'PREVIEW_OFFER',sdp:peer.localDescription?.toJSON()});})();
window.addEventListener('pagehide',()=>{peer.close();void send({type:'PREVIEW_CLOSE'});});
