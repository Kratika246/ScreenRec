import {UploadQueue,uploadPartWithRetry} from '../../apps/extension/utils/upload';
test('network failure and expired URL retry the same bytes with fresh signing',async()=>{
  const data=new Blob(['same bytes']), getUrl=jest.fn().mockResolvedValueOnce('expired').mockResolvedValue('fresh');
  const put=jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response('',{status:403})).mockResolvedValue(new Response('',{headers:{ETag:'etag'}}));
  const wait=jest.fn().mockResolvedValue(undefined);
  expect(await uploadPartWithRetry(data,getUrl,put,wait)).toBe('etag');
  expect(getUrl).toHaveBeenCalledTimes(3);expect(wait.mock.calls).toEqual([[1000],[2000]]);
  for(const [,init] of put.mock.calls)expect(init.body).toBe(data);
});
test('missing ETag never counts as an acknowledged part and exhausted retries reject',async()=>{
  const put=jest.fn().mockResolvedValue(new Response(''));
  await expect(uploadPartWithRetry(new Blob(['x']),async()=>'url',put,async()=>{})).rejects.toThrow('ETag');
  expect(put).toHaveBeenCalledTimes(4);
});
test('queue runs at most two uploads and drains every accepted job',async()=>{
  const queue=new UploadQueue(), release:(()=>void)[]=[];
  let running=0, peak=0, done=0;
  for(let i=0;i<6;i++)queue.add(async()=>{running++;peak=Math.max(peak,running);await new Promise<void>(resolve=>release.push(resolve));running--;done++;});
  const drained=queue.drain();
  for(let batch=0;batch<3;batch++){await new Promise(resolve=>setImmediate(resolve));expect(release).toHaveLength(2);release.splice(0).forEach(resolve=>resolve());}
  await drained;expect(peak).toBe(2);expect(done).toBe(6);
});
test('queue exposes failure to completion even if later uploads succeed',async()=>{
  const queue=new UploadQueue();queue.add(async()=>{throw new Error('part lost');});queue.add(async()=>{});
  await expect(queue.drain()).rejects.toThrow('part lost');
});
