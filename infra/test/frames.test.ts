
import { frameSlots } from '../../apps/extension/utils/frame-slots';
test('reservoir preserves first and latest frames and never grows beyond sixteen slots',()=>{
  expect(frameSlots(0)).toEqual([0,15]);
  for(let index=1;index<5000;index++){
    const slots=frameSlots(index,()=>.5);
    expect(slots).toContain(15);
    expect(slots.every(slot=>slot>=1&&slot<=15)).toBe(true);
  }
  expect(frameSlots(100,()=>0)).toEqual([1,15]);
  expect(frameSlots(100,()=>.99)).toEqual([15]);
});
