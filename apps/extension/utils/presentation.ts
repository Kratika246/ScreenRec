import type { RecordingState } from '../../../packages/shared/src/index.js';

export function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
export function presentation(state: RecordingState) {
  if (state.status === 'failed') return {
    title: state.shareUrl ? 'Your recording is safe' : 'Couldn’t start recording',
    detail: state.shareUrl ? 'Saving didn’t finish. Retry saving or download the copy on this device.' : 'Check your permissions and try again.',
    clipboard: '',
  };
  if (state.status === 'uploading') return {
    title: state.uploadStage === 'finalizing' ? 'Finishing your recording' : 'Saving your recording',
    detail: state.uploadStage === 'finalizing' ? 'Upload complete. Preparing your share link for playback.' : 'Your recording is uploading. Keep the recorder tab open.',
    clipboard: state.copied ? 'Link copied · playback will appear when saving finishes' : '',
  };
  if (state.status === 'recording') return { title: 'Recording in progress', detail: 'Pause whenever you need a moment.', clipboard: '' };
  if (state.status === 'paused') return { title: 'Take your time', detail: 'Your recording is paused. Resume when you’re ready.', clipboard: '' };
  if (state.status === 'countdown') return { title: 'You’re on in…', detail: 'Get ready. Your recording starts after the countdown.', clipboard: '' };
  if (state.status === 'preparing') return { title: 'Choose what to share', detail: 'Select a screen, window, or browser tab in Chrome’s picker.', clipboard: '' };
  if (state.outcome === 'ready') return { title: 'Ready to share', detail: 'Your recording is saved and ready to play.', clipboard: state.copied ? 'Share link copied to your clipboard' : 'Copy the link to share your recording' };
  if (state.outcome === 'local') return { title: 'Saved to your device', detail: 'Your WebM download is ready. No share link was created.', clipboard: '' };
  return { title: 'Show it. Share it.', detail: 'A quick walkthrough, a little context, one simple link.', clipboard: '' };
}
