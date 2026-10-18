jest.mock('@aws-sdk/client-lambda',()=>({LambdaClient:jest.fn().mockImplementation(()=>({send:jest.fn().mockResolvedValue({})})),InvokeCommand:class{constructor(public input:unknown){}}}));
jest.mock('@aws-sdk/client-s3',()=>({
  S3Client:jest.fn().mockImplementation(()=>({send:jest.fn()})),
  ...Object.fromEntries(['CreateMultipartUpload','UploadPart','CompleteMultipartUpload','AbortMultipartUpload','HeadObject','ListParts','GetObject','PutObject'].map(n=>[n+'Command',class { input:unknown; kind=n; constructor(input:unknown){this.input=input;} }]))
}));
jest.mock('@aws-sdk/client-dynamodb',()=>({DynamoDBClient:jest.fn()}));
jest.mock('@aws-sdk/lib-dynamodb',()=>({
  DynamoDBDocumentClient:{from:()=>({send:jest.fn()})},
  ...Object.fromEntries(['Put','Get','Query','Update'].map(n=>[n+'Command',class {input:unknown;kind=n;constructor(input:unknown){this.input=input;}}]))
}));
jest.mock('@aws-sdk/s3-request-presigner',()=>({getSignedUrl:jest.fn().mockResolvedValue('https://upload.example/part')}));
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {s3,ddb,getVideo,getPartUrl,completeUpload,cancelUpload,createVideo,listVideos,getTranscript,retryAi,aiInvoker,getFrameUrl} from '../lambda/videos';
const id='00000000-0000-4000-8000-000000000001';
const video={id,userId:'owner',uploadId:'upload',s3Key:`videos/${id}/recording.webm`,status:'recording',title:'Demo',createdAt:'2026-10-18'};
const event=(body:unknown={},owner='owner')=>({pathParameters:{id},body:JSON.stringify(body),requestContext:{authorizer:{claims:{sub:owner}}}});
const db=ddb.send as jest.Mock,storage=s3.send as jest.Mock;
beforeEach(()=>{jest.clearAllMocks();db.mockResolvedValue({Item:video});storage.mockResolvedValue({});process.env.CLOUDFRONT_URL='https://cdn.example';process.env.VIEWER_URL='https://viewer.example';});
test('public response excludes private ownership and multipart fields',async()=>{
  db.mockResolvedValue({Item:{...video,status:'ready'}});
  const result=await getVideo({pathParameters:{id}});
  expect(result.statusCode).toBe(200);const body=JSON.parse(result.body);
  expect(body.playbackUrl).toBe(`https://cdn.example/${video.s3Key}`);
  expect(body.userId).toBeUndefined();expect(body.uploadId).toBeUndefined();expect(body.s3Key).toBeUndefined();
});
test('writes reject missing authentication and foreign owners',async()=>{
  expect((await getPartUrl({pathParameters:{id},body:'{}'})).statusCode).toBe(401);
  expect((await getPartUrl(event({uploadId:'upload',partNumber:1},'other'))).statusCode).toBe(403);
  expect(storage).not.toHaveBeenCalled();
});
test('signing rejects arbitrary upload IDs, invalid part numbers and malformed JSON',async()=>{
  for(const body of [{uploadId:'foreign',partNumber:1},{uploadId:'upload',partNumber:0},{uploadId:'upload',partNumber:1.5},{uploadId:'upload',partNumber:10001}])expect((await getPartUrl(event(body))).statusCode).toBe(400);
  expect((await getPartUrl({...event(),body:'{'})).statusCode).toBe(400);
});
test('completion is idempotent after success without repeating S3 operations',async()=>{
  db.mockResolvedValue({Item:{...video,status:'ready'}});
  expect((await completeUpload(event({uploadId:'upload'}))).statusCode).toBe(200);
  expect(storage).not.toHaveBeenCalled();
});
test('completion rejects missing ETags and nonconsecutive parts',async()=>{
  for(const parts of [[{partNumber:1,etag:''}],[{partNumber:2,etag:'etag'}]])expect((await completeUpload(event({uploadId:'upload',duration:1,size:10,parts}))).statusCode).toBe(400);
});
test('valid completion verifies S3 parts and updates readiness and duration',async()=>{
  storage.mockImplementation(async(command:{kind:string})=>{
    if(command.kind==='HeadObject')throw Object.assign(new Error('not found'),{name:'NotFound'});
    if(command.kind==='ListParts')return {Parts:[{PartNumber:1,ETag:'etag',Size:10}]};
    return {};
  });
  const result=await completeUpload(event({uploadId:'upload',duration:3,size:10,parts:[{partNumber:1,etag:'etag'}]}));
  expect(result.statusCode).toBe(200);
  expect(storage.mock.calls.some(([c])=>c.kind==='CompleteMultipartUpload')).toBe(true);
  expect(db.mock.calls.at(-1)[0].input.ExpressionAttributeValues).toMatchObject({':s':'ready',':d':3,':z':10});
});
test('undersized nonfinal parts never complete',async()=>{
  storage.mockImplementation(async(c:{kind:string})=>{if(c.kind==='HeadObject')throw Object.assign(new Error(),{name:'NotFound'});return {Parts:[{PartNumber:1,ETag:'a',Size:3},{PartNumber:2,ETag:'b',Size:3}]};});
  expect((await completeUpload(event({uploadId:'upload',duration:1,size:6,parts:[{partNumber:1,etag:'a'},{partNumber:2,etag:'b'}]}))).statusCode).toBe(400);
  expect(storage.mock.calls.some(([c])=>c.kind==='CompleteMultipartUpload')).toBe(false);
});
test('retry recovers S3-completed upload after metadata failure',async()=>{
  storage.mockImplementation(async(c:{kind:string})=>{if(c.kind==='ListParts')throw Object.assign(new Error('already committed'),{name:'NoSuchUpload'});return {ContentLength:10};});
  expect((await completeUpload(event({uploadId:'upload',duration:1,size:10,parts:[{partNumber:1,etag:'a'}]}))).statusCode).toBe(200);
  expect(storage.mock.calls.map(([c])=>c.kind)).toEqual(['ListParts','HeadObject']);
});
test('cancel aborts owner upload and marks failed',async()=>{
  expect((await cancelUpload(event())).statusCode).toBe(200);
  expect(storage.mock.calls[0][0].kind).toBe('AbortMultipartUpload');
});
test('creation rejects malformed modes and returns preallocated viewer URL',async()=>{
  expect((await createVideo(event({mode:'bad'}))).statusCode).toBe(400);
  storage.mockResolvedValue({UploadId:'new-upload'});
  const result=await createVideo(event({mode:'screen',title:'Demo'}));
  expect(result.statusCode).toBe(200);expect(JSON.parse(result.body).shareUrl).toMatch(/^https:\/\/viewer.example\/v\//);
});
test('library requires authentication and filters private metadata',async()=>{
  expect((await listVideos({})).statusCode).toBe(401);
  db.mockResolvedValue({Items:[video]});
  const result=await listVideos(event());expect(JSON.parse(result.body).videos[0].uploadId).toBeUndefined();
});

test('fresh upload completes without HEAD or ListBucket permission',async()=>{
  storage.mockImplementation(async(c:{kind:string})=>{
    if(c.kind==='HeadObject')throw Object.assign(new Error('Access denied: object does not exist'),{name:'Forbidden',$metadata:{httpStatusCode:403}});
    if(c.kind==='ListParts')return {Parts:[{PartNumber:1,ETag:'etag',Size:10}]};
    return {};
  });
  const result=await completeUpload(event({uploadId:'upload',duration:5,size:10,parts:[{partNumber:1,etag:'etag'}]}));
  expect(result.statusCode).toBe(200);
  expect(storage.mock.calls.map(([c])=>c.kind)).toEqual(['ListParts','CompleteMultipartUpload']);
});
test('expired upload reports a recovery action instead of generic server failure',async()=>{
  storage.mockImplementation(async(c:{kind:string})=>{
    if(c.kind==='ListParts')throw Object.assign(new Error('gone'),{name:'NoSuchUpload'});
    throw Object.assign(new Error('missing object is forbidden without ListBucket'),{$metadata:{httpStatusCode:403}});
  });
  const result=await completeUpload(event({uploadId:'upload',duration:5,size:10,parts:[{partNumber:1,etag:'etag'}]}));
  expect(result.statusCode).toBe(409);
  expect(JSON.parse(result.body).error).toContain('Download');
});
test('unexpected failures expose a support reference without leaking AWS details',async()=>{
  const log=jest.spyOn(console,'error').mockImplementation(()=>{});
  db.mockRejectedValueOnce(new Error('private internals'));
  const result=await getVideo({...event(),requestContext:{requestId:'reference-123'}});
  expect(result.statusCode).toBe(500);
  expect(JSON.parse(result.body)).toMatchObject({requestId:'reference-123'});
  expect(result.body).not.toContain('private internals');
  expect(log).toHaveBeenCalled();log.mockRestore();
});

test('public AI metadata excludes internal attempts and job names',async()=>{
  db.mockResolvedValue({Item:{...video,status:'ready',aiStatus:'ready',summary:'A useful summary',transcriptReady:true,aiJobName:'private-job',aiAttempt:'private-attempt'}});
  const result=JSON.parse((await getVideo({pathParameters:{id}})).body);
  expect(result).toMatchObject({aiStatus:'ready',summary:'A useful summary',transcriptReady:true});
  expect(result.aiJobName).toBeUndefined();expect(result.aiAttempt).toBeUndefined();
});
test('known silent recording stores its audio flag for the S3 worker',async()=>{
  storage.mockResolvedValue({UploadId:'new'});
  await createVideo(event({mode:'screen',hasAudio:false}));
  const put=db.mock.calls.find(([c])=>c.kind==='Put')[0].input;
  expect(put.Item.hasAudio).toBe(false);expect(put.Item.aiStatus).toBe('pending');
});
test('transcript is public only after it is ready and only the processed object is read',async()=>{
  expect((await getTranscript({pathParameters:{id}})).statusCode).toBe(409);
  db.mockResolvedValue({Item:{...video,status:'ready',transcriptReady:true}});
  storage.mockResolvedValue({Body:{transformToString:async()=>JSON.stringify({text:'Hello',segments:[{start:0,end:1,text:'Hello'}]})}});
  const result=await getTranscript({pathParameters:{id}});
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body).text).toBe('Hello');
  expect(storage.mock.calls[0][0].input.Key).toBe(`processed/${id}/transcript.json`);
});
test('AI retry is owner-only and refuses an active job',async()=>{
  expect((await retryAi(event({},'other'))).statusCode).toBe(403);
  db.mockResolvedValue({Item:{...video,status:'ready',aiStatus:'transcribing'}});
  expect((await retryAi(event())).statusCode).toBe(409);
  expect(aiInvoker.send).not.toHaveBeenCalled();
});
test('owner can retry failed AI without changing playback state',async()=>{
  db.mockResolvedValue({Item:{...video,status:'ready',aiStatus:'failed',transcriptReady:true}});
  const result=await retryAi(event());
  expect(result.statusCode).toBe(200);expect(aiInvoker.send).toHaveBeenCalledTimes(1);
  expect(db.mock.calls[1][0].input.UpdateExpression).not.toContain('#s');
});

test('snapshot URLs require ownership and enforce bounded slots, size, and timestamps',async()=>{
  const valid={slot:0,timestamp:1000,size:100};
  expect((await getFrameUrl(event(valid,'other'))).statusCode).toBe(403);
  for(const input of [{...valid,slot:16},{...valid,slot:-1},{...valid,timestamp:-1},{...valid,size:200001},{...valid,size:0}])
    expect((await getFrameUrl(event(input))).statusCode).toBe(400);
  const response=await getFrameUrl(event(valid));
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body).headers).toEqual({'Content-Type':'image/jpeg','x-amz-meta-timestamp':'1000'});
  const signed=(getSignedUrl as jest.Mock).mock.calls.at(-1);
  expect(signed[1].input).toMatchObject({Key:`frames/${id}/00.jpg`,ContentLength:100,Metadata:{timestamp:'1000'}});
  expect(signed[2].unhoistableHeaders.has('x-amz-meta-timestamp')).toBe(true);
  db.mockResolvedValue({Item:{...video,status:'ready'}});
  expect((await getFrameUrl(event(valid))).statusCode).toBe(409);
});

test('owner can retry transcription after visual fallback, but cannot regenerate a fully successful result',async()=>{
  db.mockResolvedValue({Item:{...video,status:'ready',aiStatus:'ready',transcriptionFailed:true}});
  expect((await retryAi(event())).statusCode).toBe(200);
  expect(db.mock.calls[1][0].input.ConditionExpression).toContain('transcriptionFailed = :true');
  expect(db.mock.calls[1][0].input.UpdateExpression).toContain('REMOVE aiJobName, transcriptionFailed');
  db.mockResolvedValue({Item:{...video,status:'ready',aiStatus:'ready',transcriptionFailed:false}});
  expect((await retryAi(event())).statusCode).toBe(409);
});
