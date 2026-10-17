import {desktopConstraints} from '../../apps/extension/utils/capture';
test('desktop capture does not request source audio when the picker denied it',()=>{
  const constraints=desktopConstraints('selected-source',false);
  expect(constraints.audio).toBe(false);
  expect(constraints.video.mandatory).toEqual({chromeMediaSource:'desktop',chromeMediaSourceId:'selected-source'});
});
test('approved source audio uses the same single-use capture ID as video',()=>{
  const constraints=desktopConstraints('selected-source',true);
  expect(constraints.audio).toEqual(constraints.video);
});
test('canceling the picker never starts media capture',()=>{
  expect(()=>desktopConstraints('',false)).toThrow('No capture source');
});
