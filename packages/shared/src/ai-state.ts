import type { Video } from './index.js';

export function shouldPollVideo(video: Video): boolean {
  if (video.status === 'failed') return false;
  if (video.status !== 'ready') return true;
  return !!video.aiStatus && ['pending', 'transcribing', 'summarizing'].includes(video.aiStatus);
}
export function aiLabel(video: Video): string {
  switch (video.aiStatus) {
    case 'pending': return 'Preparing AI notes';
    case 'transcribing': return 'Transcribing your recording';
    case 'summarizing': return 'Writing your notes and chapters';
    case 'ready': return 'AI notes';
    case 'no_speech': return 'No AI inputs captured';
    case 'failed': return video.transcriptReady ? 'Transcript ready · summary unavailable' : 'AI notes unavailable';
    default: return 'AI notes';
  }
}
