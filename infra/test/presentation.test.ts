import {presentation,formatTime} from '../../apps/extension/utils/presentation';
test('failed finalization never promises automatic playback even when a link was copied',()=>{
  const view=presentation({status:'failed',duration:5,uploadProgress:100,copied:true,shareUrl:'https://share.example/v/id'});
  expect(view.title).toBe('Your recording is safe');
  expect(view.detail).toContain('Retry');
  expect(view.clipboard).toBe('');
  expect(view.detail).not.toContain('will appear');
});
test('byte upload and finalization are distinct stages',()=>{
  const state={status:'uploading' as const,duration:5,uploadProgress:100,uploadStage:'finalizing' as const,copied:true};
  expect(presentation(state).title).toBe('Finishing your recording');
  expect(presentation(state).detail).toContain('Upload complete');
});
test('only confirmed completion is ready to share',()=>{
  expect(presentation({status:'idle',duration:5,uploadProgress:100,outcome:'ready'}).title).toBe('Ready to share');
  expect(presentation({status:'idle',duration:5,uploadProgress:100,outcome:'local'}).title).toBe('Saved to your device');
  expect(formatTime(65)).toBe('01:05');
});
