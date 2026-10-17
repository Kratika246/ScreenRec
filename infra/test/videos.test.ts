jest.mock('@aws-sdk/client-s3',()=>({
  S3Client:jest.fn().mockImplementation(()=>({send:jest.fn()})),
  ...Object.fromEntries(['CreateMultipartUpload','UploadPart','CompleteMultipartUpload','AbortMultipartUpload','HeadObject','ListParts'].map(n=>[n+'Command',class { input:unknown; kind=n; constructor(input:unknown){this.input=input;} }]))
}));
jest.mock('@aws-sdk/client-dynamodb',()=>({DynamoDBClient:jest.fn()}));
jest.mock('@aws-sdk/lib-dynamodb',()=>({
  DynamoDBDocumentClient:{from:()=>({send:jest.fn()})},
  ...Object.fromEntries(['Put','Get','Query','Update'].map(n=>[n+'Command',class {input:unknown;kind=n;constructor(input:unknown){this.input=input;}}]))
}));
jest.mock('@aws-sdk/s3-request-presigner',()=>({getSignedUrl:jest.fn().mockResolvedValue('https://upload.example/part')}));
import {s3,ddb,getVideo,getPartUrl,completeUpload,cancelUpload,createVideo,listVideos} from '../lambda/videos';
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
