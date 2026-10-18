import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadObjectCommand, ListPartsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { randomUUID } from 'node:crypto';
import type { Video } from '../../packages/shared/src/index';

const BUCKET = process.env.BUCKET_NAME!, TABLE = process.env.TABLE_NAME!;
export const aiInvoker=new LambdaClient({});
export const s3 = new S3Client({}), ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
type Event = { body?: string | null; pathParameters?: { id?: string }; queryStringParameters?: Record<string,string>; requestContext?: { authorizer?: { claims?: { sub?: string } }; requestId?: string } };
type Item = Video & { userId: string; uploadId: string; s3Key: string; updatedAt: string; hasAudio?: boolean; aiAttempt?: string };
class HttpError extends Error { constructor(public code: number, message: string) { super(message); } }
const response = (statusCode: number, body: unknown) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
function handler(operation: string, run: (event: Event) => Promise<unknown>) {
  return async (event: Event, context?: { awsRequestId?: string }) => {
    try { return response(200, await run(event)); }
    catch(error) {
      const requestId=event.requestContext?.requestId || context?.awsRequestId;
      if(error instanceof HttpError) return response(error.code,{error:error.message,requestId});
      console.error({operation,requestId,error});
      return response(500,{error:'The server could not finish this request. Please retry.',requestId});
    }
  };
}
function body(event: Event): Record<string, unknown> { try { const result = JSON.parse(event.body || '{}'); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result; } catch { throw new HttpError(400, 'Invalid JSON body'); } }
function user(event: Event) { const id = event.requestContext?.authorizer?.claims?.sub; if(!id) throw new HttpError(401,'Unauthorized'); return id; }
async function item(event: Event, owner = true): Promise<Item> {
  const ownerId = owner ? user(event) : undefined;
  const id = event.pathParameters?.id;
  if(!id || !/^[a-f0-9-]{36}$/i.test(id)) throw new HttpError(400,'Invalid video ID');
  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: {id}, ConsistentRead: true }));
  if(!result.Item) throw new HttpError(404,'Video not found');
  if(owner && result.Item.userId !== ownerId) throw new HttpError(403,'Forbidden');
  return result.Item as Item;
}
function checkUpload(video: Item, uploadId: unknown) { if(uploadId !== video.uploadId) throw new HttpError(400,'Upload does not match this recording'); }
function publicVideo(video: Item): Video {
  return { id:video.id, title:video.title, status:video.status, createdAt:video.createdAt, duration:video.duration, size:video.size, shareUrl:`${process.env.VIEWER_URL}/v/${video.id}`,
    aiStatus:video.aiStatus,aiMessage:video.aiMessage,summary:video.summary,transcriptReady:!!video.transcriptReady,transcriptionFailed:!!video.transcriptionFailed,summaryTruncated:video.summaryTruncated,aiSources:video.aiSources,visualFrameCount:video.visualFrameCount,chapters:video.chapters,issues:video.issues,
    ...(video.status==='ready' ? {playbackUrl:`${process.env.CLOUDFRONT_URL}/${video.s3Key}`} : {}) };
}
export const createVideo = handler('createVideo', async event => {
  const userId=user(event), input=body(event), id=randomUUID();
  if(!['screen','screen+cam','cam'].includes(String(input.mode))) throw new HttpError(400,'Invalid recording mode');
  if(input.title !== undefined && (typeof input.title !== 'string' || input.title.length>200)) throw new HttpError(400,'Title must be at most 200 characters');
  if(input.hasAudio!==undefined && typeof input.hasAudio!=='boolean')throw new HttpError(400,'Invalid audio flag');
  const title=String(input.title || 'Untitled recording'), key=`videos/${id}/recording.webm`;
  const upload=await s3.send(new CreateMultipartUploadCommand({Bucket:BUCKET,Key:key,ContentType:'video/webm'}));
  try {
    await ddb.send(new PutCommand({TableName:TABLE,Item:{id,userId,title,mode:input.mode,hasAudio:input.hasAudio!==false,aiStatus:'pending',aiAttempt:'initial',status:'recording',uploadId:upload.UploadId,s3Key:key,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}}));
  } catch(error) { await s3.send(new AbortMultipartUploadCommand({Bucket:BUCKET,Key:key,UploadId:upload.UploadId})); throw error; }
  return {videoId:id,uploadId:upload.UploadId,shareUrl:`${process.env.VIEWER_URL}/v/${id}`};
});
export const getPartUrl = handler('getPartUrl', async event => {
  const video=await item(event), input=body(event); checkUpload(video,input.uploadId);
  if(video.status!=='recording') throw new HttpError(409,'Recording is not accepting parts');
  if(!Number.isInteger(input.partNumber) || Number(input.partNumber)<1 || Number(input.partNumber)>10000) throw new HttpError(400,'Part number must be between 1 and 10000');
  const presignedUrl=await getSignedUrl(s3,new UploadPartCommand({Bucket:BUCKET,Key:video.s3Key,UploadId:video.uploadId,PartNumber:Number(input.partNumber)}),{expiresIn:300});
  return {presignedUrl};
});
export const completeUpload = handler('completeUpload', async event => {
  const video=await item(event), input=body(event); checkUpload(video,input.uploadId);
  if(video.status==='ready') return {videoId:video.id,shareUrl:`${process.env.VIEWER_URL}/v/${video.id}`,
    aiStatus:video.aiStatus,aiMessage:video.aiMessage,summary:video.summary,transcriptReady:!!video.transcriptReady,transcriptionFailed:!!video.transcriptionFailed,summaryTruncated:video.summaryTruncated,aiSources:video.aiSources,visualFrameCount:video.visualFrameCount,chapters:video.chapters,issues:video.issues,status:'ready'};
  if(video.status==='failed') throw new HttpError(409,'Recording was canceled');
  if(!Number.isInteger(input.duration) || Number(input.duration)<0 || Number(input.duration)>86400 || !Number.isSafeInteger(input.size) || Number(input.size)<=0 || Number(input.size)>5*1024**3) throw new HttpError(400,'Invalid duration or size (maximum 24 hours / 5 GiB)');
  if(!Array.isArray(input.parts) || !input.parts.length || input.parts.length>10000) throw new HttpError(400,'Invalid parts');
  const parts=input.parts as {partNumber:number;etag:string}[];
  if(parts.some((p,i)=>!p || p.partNumber!==i+1 || typeof p.etag!=='string' || !p.etag.trim())) throw new HttpError(400,'Parts must be consecutive, ordered, and have ETags');
  // Inspect the multipart upload first. HEAD on a not-yet-created object returns
  // 403 (not 404) without ListBucket permission, so it cannot be a preflight.
  const actual: {PartNumber?:number;ETag?:string;Size?:number}[]=[];
  let completed=false, marker: string | undefined;
  try {
    do {
      const page=await s3.send(new ListPartsCommand({Bucket:BUCKET,Key:video.s3Key,UploadId:video.uploadId,PartNumberMarker:marker}));
      actual.push(...(page.Parts||[]));
      marker=page.IsTruncated?page.NextPartNumberMarker:undefined;
    } while(marker);
  } catch(error) {
    // S3 already committed the upload, but the metadata write may have failed.
    if((error as {name?:string}).name!=='NoSuchUpload') throw error;
    try {
      const head=await s3.send(new HeadObjectCommand({Bucket:BUCKET,Key:video.s3Key}));
      if(head.ContentLength!==input.size) throw new HttpError(409,'Stored size mismatch');
      completed=true;
    } catch(headError) {
      if(headError instanceof HttpError) throw headError;
      const code=(headError as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode;
      if(code===403 || code===404 || (headError as {name?:string}).name==='NotFound') throw new HttpError(409,'This upload has expired or was canceled. Download your retained recording.');
      throw headError;
    }
  }
  if(!completed) {
    if(actual.length!==parts.length || actual.some((p,i)=>p.PartNumber!==parts[i].partNumber || p.ETag!==parts[i].etag || (i<actual.length-1 && (p.Size||0)<5*1024**2)) || actual.reduce((sum,p)=>sum+(p.Size||0),0)!==input.size) throw new HttpError(400,'Uploaded parts do not match the completion request');
    await ddb.send(new UpdateCommand({TableName:TABLE,Key:{id:video.id},UpdateExpression:'SET #s = :s',ConditionExpression:'#s = :recording OR #s = :s',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':'finalizing',':recording':'recording'}}));
    try { await s3.send(new CompleteMultipartUploadCommand({Bucket:BUCKET,Key:video.s3Key,UploadId:video.uploadId,MultipartUpload:{Parts:parts.map(p=>({PartNumber:p.partNumber,ETag:p.etag}))}})); }
    catch(error) { const head=await s3.send(new HeadObjectCommand({Bucket:BUCKET,Key:video.s3Key})).catch(()=>undefined); if(head?.ContentLength!==input.size) throw error; }
  }
  await ddb.send(new UpdateCommand({TableName:TABLE,Key:{id:video.id},UpdateExpression:'SET #s = :s, #d = :d, #z = :z, updatedAt = :u',ExpressionAttributeNames:{'#s':'status','#d':'duration','#z':'size'},ExpressionAttributeValues:{':s':'ready',':d':input.duration,':z':input.size,':u':new Date().toISOString()}}));
  return {videoId:video.id,shareUrl:`${process.env.VIEWER_URL}/v/${video.id}`,
    aiStatus:video.aiStatus,aiMessage:video.aiMessage,summary:video.summary,transcriptReady:!!video.transcriptReady,transcriptionFailed:!!video.transcriptionFailed,summaryTruncated:video.summaryTruncated,aiSources:video.aiSources,visualFrameCount:video.visualFrameCount,chapters:video.chapters,issues:video.issues,status:'ready'};
});
export const cancelUpload = handler('cancelUpload', async event => {
  const video=await item(event);
  if(video.status==='ready') throw new HttpError(409,'Completed recordings cannot be canceled');
  if(video.status==='finalizing') throw new HttpError(409,'Recording is being finalized; retry completion');
  await ddb.send(new UpdateCommand({TableName:TABLE,Key:{id:video.id},UpdateExpression:'SET #s = :failed',ConditionExpression:'#s = :recording OR #s = :failed',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':failed':'failed',':recording':'recording'}}));
  try { await s3.send(new AbortMultipartUploadCommand({Bucket:BUCKET,Key:video.s3Key,UploadId:video.uploadId})); } catch(error) { if((error as {name?:string}).name!=='NoSuchUpload') throw error; }
  return {status:'failed'};
});
export const getVideo = handler('getVideo', async event => publicVideo(await item(event,false)));
export const listVideos = handler('listVideos', async event => {
  const userId=user(event);
  const result=await ddb.send(new QueryCommand({TableName:TABLE,IndexName:'byUserId',KeyConditionExpression:'userId = :uid',ExpressionAttributeValues:{':uid':userId},ScanIndexForward:false,Limit:50}));
  return {videos:(result.Items||[]).map(v=>publicVideo(v as Item))};
});


// Public transcripts follow the same unlisted-link policy as video playback.
// Raw Transcribe output and internal job identifiers are never returned.
export const getTranscript=handler('getTranscript',async event=>{
  const video=await item(event,false);
  if(!video.transcriptReady)throw new HttpError(409,'The transcript is not ready yet.');
  const result=await s3.send(new GetObjectCommand({Bucket:process.env.AI_BUCKET_NAME,Key:`processed/${video.id}/transcript.json`}));
  if(!result.Body || (result.ContentLength||0)>5*1024**2)throw new HttpError(502,'Transcript is unavailable. Please retry.');
  return JSON.parse(await result.Body.transformToString());
});
export const retryAi=handler('retryAi',async event=>{
  const video=await item(event);
  if(video.status!=='ready')throw new HttpError(409,'Finish saving the recording first.');
  if(video.aiStatus && video.aiStatus!=='failed' && !(video.aiStatus==='ready' && video.transcriptionFailed))throw new HttpError(409,'AI is already processing or has finished for this recording.');
  const attempt=randomUUID();
  await ddb.send(new UpdateCommand({
    TableName:TABLE,Key:{id:video.id},
    UpdateExpression:'SET aiStatus = :pending, aiAttempt = :attempt, aiMessage = :empty, aiLeaseUntil = :zero REMOVE aiJobName, transcriptionFailed',
    ConditionExpression:'attribute_not_exists(aiStatus) OR aiStatus = :failed OR (aiStatus = :ready AND transcriptionFailed = :true)',
    ExpressionAttributeValues:{':pending':'pending',':attempt':attempt,':empty':'',':zero':0,':failed':'failed',':ready':'ready',':true':true},
  }));
  try {
    await aiInvoker.send(new InvokeCommand({FunctionName:process.env.AI_START_FUNCTION_ARN,InvocationType:'Event',Payload:Buffer.from(JSON.stringify({videoId:video.id}))}));
  } catch(error) {
    await ddb.send(new UpdateCommand({
      TableName:TABLE,Key:{id:video.id},UpdateExpression:'SET aiStatus = :failed, aiMessage = :message',
      ConditionExpression:'aiAttempt = :attempt',
      ExpressionAttributeValues:{':attempt':attempt,':failed':'failed',':message':'AI could not be queued. Please retry.'},
    }));
    throw error;
  }
  return {aiStatus:'pending'};
});


export const getFrameUrl=handler('getFrameUrl',async event=>{
  const video=await item(event),input=body(event);
  if(video.status!=='recording')throw new HttpError(409,'Recording is no longer accepting screen snapshots.');
  if(!Number.isInteger(input.slot)||Number(input.slot)<0||Number(input.slot)>15 ||
     !Number.isInteger(input.timestamp)||Number(input.timestamp)<0||Number(input.timestamp)>86400000 ||
     !Number.isInteger(input.size)||Number(input.size)<1||Number(input.size)>200000)throw new HttpError(400,'Invalid screen snapshot');
  const headers={'Content-Type':'image/jpeg','x-amz-meta-timestamp':String(input.timestamp)};
  const presignedUrl=await getSignedUrl(s3,new PutObjectCommand({
    Bucket:process.env.AI_BUCKET_NAME,Key:`frames/${video.id}/${String(input.slot).padStart(2,'0')}.jpg`,
    ContentType:'image/jpeg',ContentLength:Number(input.size),Metadata:{timestamp:String(input.timestamp)},
  }),{expiresIn:300,unhoistableHeaders:new Set(['x-amz-meta-timestamp']),signableHeaders:new Set(['content-type'])});
  return {presignedUrl,headers};
});
