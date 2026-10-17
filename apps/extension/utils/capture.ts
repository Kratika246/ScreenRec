// The picker returns whether the user agreed to share source audio.
// Never request a desktop audio track when that checkbox was not selected.
export function desktopConstraints(streamId: string, canRequestAudioTrack: boolean) {
  if (!streamId) throw new Error('No capture source selected.');
  const source = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId } };
  return { video: source, audio: canRequestAudioTrack ? source : false };
}
