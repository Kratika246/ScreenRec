import { createHash } from 'node:crypto';
import { PartBuffer, PART_SIZE } from '../../apps/extension/utils/multipart';
test('preserves exact byte order across small chunks, full parts and final tail', async () => {
  const data = new Uint8Array(PART_SIZE * 2 + 73);
  for(let i=0;i<data.length;i++) data[i]=i%251;
  const buffer=new PartBuffer(),parts:Blob[]=[];
  for(let i=0;i<data.length;i+=735911)parts.push(...buffer.push(new Blob([data.slice(i,i+735911)])));
  const tail=buffer.flush(); if(tail)parts.push(tail);
  expect(parts.map(p=>p.size)).toEqual([PART_SIZE,PART_SIZE,73]);
  expect(createHash('sha256').update(new Uint8Array(await new Blob(parts).arrayBuffer())).digest('hex')).toBe(createHash('sha256').update(data).digest('hex'));
  expect(buffer.flush()).toBeUndefined();
});
test('short recording is one legal final part and exact boundary has no empty tail',()=>{
  const short=new PartBuffer();expect(short.push(new Blob(['hello']))).toEqual([]);expect(short.flush()?.size).toBe(5);
  const exact=new PartBuffer();expect(exact.push(new Blob([new Uint8Array(PART_SIZE)]))[0].size).toBe(PART_SIZE);expect(exact.flush()).toBeUndefined();
});
