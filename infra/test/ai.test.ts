jest.mock('../lambda/groq',()=>({transcribeWithGroq:jest.fn(),GroqError:class extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status;this.name='GroqError';}}}));
jest.mock('@aws-sdk/s3-request-presigner',()=>({getSignedUrl:jest.fn().mockResolvedValue('https://private.example/signed')}));
import {transcribeWithGroq,GroqError} from '../lambda/groq';
jest.mock('@aws-sdk/client-s3',()=>({
  S3Client:jest.fn().mockImplementation(()=>({send:jest.fn()})),
  ...Object.fromEntries(['GetObject','HeadObject','PutObject','ListObjectsV2'].map(n=>[n+'Command',class{kind=n;constructor(public input:unknown){}}])),
}));
jest.mock('@aws-sdk/client-transcribe',()=>({
  TranscribeClient:jest.fn().mockImplementation(()=>({send:jest.fn()})),
  ...Object.fromEntries(['StartTranscriptionJob','GetTranscriptionJob'].map(n=>[n+'Command',class{kind=n;constructor(public input:unknown){}}])),
}));
jest.mock('@aws-sdk/client-bedrock-runtime',()=>({
  BedrockRuntimeClient:jest.fn().mockImplementation(()=>({send:jest.fn()})),
  ConverseCommand:class{constructor(public input:unknown){}},
}));
jest.mock('@aws-sdk/client-lambda',()=>({
  LambdaClient:jest.fn().mockImplementation(()=>({send:jest.fn()})),
  InvokeCommand:class{constructor(public input:unknown){}},
}));
jest.mock('@aws-sdk/client-dynamodb',()=>({DynamoDBClient:jest.fn()}));
jest.mock('@aws-sdk/lib-dynamodb',()=>({
  DynamoDBDocumentClient:{from:()=>({send:jest.fn()})},
  ...Object.fromEntries(['Get','Update'].map(n=>[n+'Command',class{kind=n;constructor(public input:unknown){}}])),
}));
import { storage,speech,bedrock,invoke,database,startProcessing,finishProcessing } from '../lambda/ai';
const id='00000000-0000-4000-8000-000000000001';
const job='screenrec-'+id+'_initial';
const video={id,s3Key:`videos/${id}/recording.webm`,status:'ready',aiStatus:'pending',aiAttempt:'initial',aiJobName:job,hasAudio:true};
const db=database.send as jest.Mock,files=storage.send as jest.Mock,transcribe=speech.send as jest.Mock,model=bedrock.send as jest.Mock,dispatch=invoke.send as jest.Mock;
const body=(data:unknown)=>({Body:{transformToString:async()=>JSON.stringify(data)}});
const event={Records:[{s3:{bucket:{name:'videos'},object:{key:video.s3Key}}}]};
beforeEach(()=>{
  jest.clearAllMocks();delete process.env.TRANSCRIPTION_PROVIDER;
  process.env.BUCKET_NAME='videos';process.env.AI_BUCKET_NAME='artifacts';process.env.TABLE_NAME='metadata';process.env.JOB_PREFIX='screenrec-';process.env.TRANSCRIBE_ROLE_ARN='role';process.env.RESULT_FUNCTION_ARN='results';process.env.BEDROCK_MODEL_ID='model';
  db.mockImplementation(async(c:{kind:string})=>c.kind==='Get'?{Item:video}:{});
  files.mockResolvedValue({ContentLength:100});transcribe.mockResolvedValue({});dispatch.mockResolvedValue({});
  model.mockResolvedValue({output:{message:{content:[{text:'{"title":"A walkthrough","summary":"The speaker explains a workflow."}'}]}}});
});
test('S3 completion starts one deterministic WebM job with private output and auto language',async()=>{
  await startProcessing(event);
  const request=transcribe.mock.calls[0][0].input;
  expect(request).toMatchObject({TranscriptionJobName:job,MediaFormat:'webm',IdentifyLanguage:true,OutputBucketName:'artifacts',OutputKey:'raw/'+job+'.json'});
  expect(request.Media.MediaFileUri).toBe('s3://videos/'+video.s3Key);
  expect(request.JobExecutionSettings).toMatchObject({AllowDeferredExecution:true,DataAccessRoleArn:'role'});
});
test('duplicate job submission reconciles the existing job instead of creating a new name',async()=>{
  transcribe.mockImplementation(async(c:{kind:string})=>{
    if(c.kind==='StartTranscriptionJob')throw Object.assign(new Error('exists'),{name:'ConflictException'});
    return {TranscriptionJob:{TranscriptionJobStatus:'IN_PROGRESS'}};
  });
  await startProcessing(event);
  expect(transcribe.mock.calls.map(([c])=>c.kind)).toEqual(['StartTranscriptionJob','GetTranscriptionJob']);
});
test('recordings without an audio track skip paid Transcribe and Bedrock calls',async()=>{
  db.mockResolvedValue({Item:{...video,hasAudio:false}});
  await startProcessing(event);
  expect(transcribe).not.toHaveBeenCalled();expect(model).not.toHaveBeenCalled();
  expect(db.mock.calls.some(([c])=>Object.values(c.input.ExpressionAttributeValues||{}).includes('no_speech'))).toBe(true);
});
test('already processing jobs and unrelated objects do not restart AI',async()=>{
  db.mockResolvedValue({Item:{...video,aiStatus:'transcribing'}});
  await startProcessing(event);
  await startProcessing({Records:[{s3:{bucket:{name:'videos'},object:{key:'processed/id/transcript.json'}}}]});
  expect(transcribe).not.toHaveBeenCalled();
});
test('completed transcript persists timing data then publishes generated title and summary',async()=>{
  transcribe.mockResolvedValue({TranscriptionJob:{TranscriptionJobStatus:'COMPLETED',LanguageCode:'en-IN'}});
  files.mockImplementation(async(c:{kind:string})=>c.kind==='GetObject'?body({results:{transcripts:[{transcript:'The speaker explains a workflow.'}],items:[{type:'pronunciation',start_time:'1',end_time:'2',alternatives:[{content:'The'}]}]}}):{});
  await finishProcessing({detail:{TranscriptionJobName:job,TranscriptionJobStatus:'COMPLETED'}});
  expect(files.mock.calls.some(([c])=>c.kind==='PutObject'&&c.input.Key===`processed/${id}/transcript.json`)).toBe(true);
  expect(model).toHaveBeenCalledTimes(1);
  const written=db.mock.calls.at(-1)[0].input.ExpressionAttributeValues;
  expect(Object.values(written)).toContain('ready');
  expect(Object.values(written)).toContain('A walkthrough');
  expect(JSON.stringify(db.mock.calls)).not.toContain('"status":');
});
test('empty speech never calls Bedrock or fabricates a summary',async()=>{
  transcribe.mockResolvedValue({TranscriptionJob:{TranscriptionJobStatus:'COMPLETED'}});
  files.mockResolvedValue(body({results:{transcripts:[{transcript:''}],items:[]}}));
  await finishProcessing({detail:{TranscriptionJobName:job}});
  expect(model).not.toHaveBeenCalled();
  expect(db.mock.calls.some(([c])=>Object.values(c.input.ExpressionAttributeValues||{}).includes('no_speech'))).toBe(true);
});
test('summary failure preserves transcript readiness for the viewer',async()=>{
  const log=jest.spyOn(console,'error').mockImplementation(()=>{});
  db.mockImplementation(async(c:{kind:string})=>c.kind==='Get'?{Item:{...video,transcriptReady:true}}:{});
  files.mockResolvedValue(body({text:'A useful explanation.',segments:[]}));
  model.mockRejectedValueOnce(new Error('model access denied'));
  await expect(finishProcessing({videoId:id,attempt:'initial',retrySummary:true})).rejects.toThrow('model access denied');
  expect(transcribe).not.toHaveBeenCalled();
  const failure=db.mock.calls.filter(([c])=>c.kind==='Update').at(-1)[0].input;
  expect(Object.values(failure.ExpressionAttributeValues)).toContain('failed');
  expect(JSON.stringify(failure)).not.toContain('transcriptReady');
  log.mockRestore();
});
test('events from older attempts cannot overwrite newer AI results',async()=>{
  db.mockResolvedValue({Item:{...video,aiJobName:'new-job',aiAttempt:'new-attempt'}});
  await finishProcessing({detail:{TranscriptionJobName:job}});
  expect(transcribe).not.toHaveBeenCalled();expect(model).not.toHaveBeenCalled();
  expect(db).toHaveBeenCalledTimes(1);
});
test('failed Transcribe jobs retain playback and give an actionable AI failure',async()=>{
  transcribe.mockResolvedValue({TranscriptionJob:{TranscriptionJobStatus:'FAILED',FailureReason:'Unsupported media duration'}});
  await finishProcessing({detail:{TranscriptionJobName:job}});
  expect(model).not.toHaveBeenCalled();
  expect(Object.values(db.mock.calls.at(-1)[0].input.ExpressionAttributeValues)).toContain('failed');
});

const frameObject = (timestamp = '10000') => ({
  ContentLength: 4, Metadata: { timestamp },
  Body: { transformToByteArray: async () => new Uint8Array([255,216,255,0]) },
});
test('silent screens dispatch visual analysis without starting Transcribe', async () => {
  db.mockResolvedValue({Item:{...video,hasAudio:false}});
  files.mockResolvedValue({Contents:[{Key:`frames/${id}/00.jpg`}]});
  await startProcessing(event);
  expect(transcribe).not.toHaveBeenCalled();
  expect(JSON.parse(Buffer.from(dispatch.mock.calls[0][0].input.Payload).toString())).toMatchObject({videoId:id,visualOnly:true});
});
test('silent screen snapshots generate grounded chapters and visible issue evidence', async () => {
  db.mockImplementation(async(c:{kind:string})=>c.kind==='Get'?{Item:{...video,hasAudio:false}}:{});
  files.mockImplementation(async(c:{kind:string})=>c.kind==='ListObjectsV2'?{Contents:[{Key:`frames/${id}/00.jpg`,Size:4},{Key:`frames/${id}/15.jpg`,Size:4}]}:frameObject());
  model.mockResolvedValue({output:{message:{content:[{text:JSON.stringify({title:'Login failure',summary:'The login screen shows an error.',chapters:[{timestamp:10,title:'Login error'},{timestamp:99,title:'Invented'}],issues:[{timestamp:10,title:'Login failed',evidence:'The page displays Invalid credentials.'},{timestamp:99,title:'Invented',evidence:'Unseen'}]})}]}}});
  await finishProcessing({videoId:id,attempt:'initial',visualOnly:true});
  expect(transcribe).not.toHaveBeenCalled();
  const request=model.mock.calls[0][0].input;
  expect(request.messages[0].content.filter((block:{image?:unknown})=>block.image)).toHaveLength(1);
  const values=Object.values(db.mock.calls.at(-1)[0].input.ExpressionAttributeValues);
  expect(values).toContain('screens');
  expect(values).toContainEqual([{timestamp:10,title:'Login error'}]);
  expect(values).toContainEqual([{timestamp:10,title:'Login failed',evidence:'The page displays Invalid credentials.'}]);
});
test('speech and snapshots are passed together, with independent transcript availability', async () => {
  db.mockImplementation(async(c:{kind:string})=>c.kind==='Get'?{Item:{...video,transcriptReady:true}}:{});
  files.mockImplementation(async(c:{kind:string,input:{Key?:string}})=>{
    if(c.kind==='ListObjectsV2')return {Contents:[{Key:`frames/${id}/00.jpg`,Size:4}]};
    return c.input.Key?.startsWith('frames/')?frameObject():body({text:'The login fails.',segments:[{start:1,end:2,text:'The login fails.'}]});
  });
  await finishProcessing({videoId:id,attempt:'initial'});
  expect(Object.values(db.mock.calls.at(-1)[0].input.ExpressionAttributeValues)).toContain('combined');
  expect(transcribe).not.toHaveBeenCalled();
});
test('invalid JPEGs and timestamps cannot become visual evidence',async()=>{
  db.mockResolvedValue({Item:{...video,hasAudio:false}});
  files.mockImplementation(async(c:{kind:string,input:{Key?:string}})=>{
    if(c.kind==='ListObjectsV2')return {Contents:[{Key:`frames/${id}/00.jpg`,Size:4},{Key:`frames/${id}/01.jpg`,Size:4}]};
    return c.input.Key?.endsWith('00.jpg')?frameObject('-1'):{...frameObject(),Body:{transformToByteArray:async()=>new Uint8Array([0,0,0,0])}};
  });
  await finishProcessing({videoId:id,attempt:'initial',visualOnly:true});
  expect(model).not.toHaveBeenCalled();
  expect(Object.values(db.mock.calls.at(-1)[0].input.ExpressionAttributeValues)).toContain('no_speech');
});

test('starter exposes a safe AWS error code when no visual fallback exists', async()=>{
  const log=jest.spyOn(console,'error').mockImplementation(()=>{});
  const error=Object.assign(new Error('private ARN and account details'),{name:'AccessDeniedException'});
  transcribe.mockRejectedValue(error);
  await expect(startProcessing(event)).rejects.toThrow('private ARN');
  const values=Object.values(db.mock.calls.at(-1)[0].input.ExpressionAttributeValues);
  expect(values).toContain('failed');
  expect(values.some(value=>typeof value==='string'&&value.includes('AccessDeniedException'))).toBe(true);
  expect(JSON.stringify(values)).not.toContain('private ARN');
  log.mockRestore();
});
test('starter falls back to screen analysis when transcription fails',async()=>{
  const log=jest.spyOn(console,'error').mockImplementation(()=>{});
  transcribe.mockRejectedValue(Object.assign(new Error('denied'),{name:'AccessDeniedException'}));
  files.mockImplementation(async(c:{kind:string})=>c.kind==='ListObjectsV2'?{Contents:[{Key:`frames/${id}/00.jpg`}]}:{ContentLength:100});
  await startProcessing(event);
  expect(JSON.parse(Buffer.from(dispatch.mock.calls[0][0].input.Payload).toString())).toMatchObject({videoId:id,visualOnly:true});
  const values=Object.values(db.mock.calls.at(-1)[0].input.ExpressionAttributeValues);
  expect(values).toContain('summarizing');
  expect(values.some(value=>typeof value==='string'&&value.includes('screen snapshots only'))).toBe(true);
  log.mockRestore();
});
test('visual fallback retains its missing-transcript explanation after successful analysis',async()=>{
  const warning='Speech transcription is unavailable (AccessDeniedException). These notes use screen snapshots only; no transcript is available.';
  db.mockImplementation(async(c:{kind:string})=>c.kind==='Get'?{Item:{...video,aiStatus:'summarizing',aiMessage:warning}}:{});
  files.mockImplementation(async(c:{kind:string})=>c.kind==='ListObjectsV2'?{Contents:[{Key:`frames/${id}/00.jpg`,Size:4}]}:frameObject());
  await finishProcessing({videoId:id,attempt:'initial',visualOnly:true});
  const values=Object.values(db.mock.calls.at(-1)[0].input.ExpressionAttributeValues);
  expect(values).toContain('ready');expect(values).toContain('screens');expect(values).toContain(warning);
  expect(transcribe).not.toHaveBeenCalled();
});
test('failed transcription job analyzes snapshots in the same worker',async()=>{
  transcribe.mockResolvedValue({TranscriptionJob:{TranscriptionJobStatus:'FAILED',FailureReason:'Unsupported media duration'}});
  files.mockImplementation(async(c:{kind:string})=>c.kind==='ListObjectsV2'?{Contents:[{Key:`frames/${id}/00.jpg`,Size:4}]}:frameObject());
  await finishProcessing({detail:{TranscriptionJobName:job}});
  expect(model).toHaveBeenCalledTimes(1);expect(dispatch).not.toHaveBeenCalled();
  expect(Object.values(db.mock.calls.at(-1)[0].input.ExpressionAttributeValues)).toContain('ready');
});

test('subscription errors identify account activation rather than suggesting IAM or repeated retries',async()=>{
  const log=jest.spyOn(console,'error').mockImplementation(()=>{});
  transcribe.mockRejectedValue(Object.assign(new Error('The AWS Access Key Id needs a subscription for the service'),{name:'SubscriptionRequiredException'}));
  await expect(startProcessing(event)).rejects.toThrow('subscription');
  const values=Object.values(db.mock.calls.at(-1)[0].input.ExpressionAttributeValues);
  expect(values).toContain('failed');
  expect(values.some(value=>typeof value==='string'&&value.includes('not enabled for this AWS account'))).toBe(true);
  log.mockRestore();
});

test('Groq provider dispatches directly without calling the blocked AWS service',async()=>{
  process.env.TRANSCRIPTION_PROVIDER='groq';
  await startProcessing(event);
  expect(transcribe).not.toHaveBeenCalled();
  expect(JSON.parse(Buffer.from(dispatch.mock.calls[0][0].input.Payload).toString())).toMatchObject({groq:true,visualOnly:false});
});
test('Groq transcript is persisted and reused by the existing visual summary pipeline',async()=>{
  (transcribeWithGroq as jest.Mock).mockResolvedValue({text:'A login walkthrough.',segments:[{start:0,end:3,text:'A login walkthrough.'}]});
  await finishProcessing({videoId:id,attempt:'initial',groq:true});
  expect(transcribe).not.toHaveBeenCalled();
  expect(transcribeWithGroq).toHaveBeenCalledWith('https://private.example/signed');
  expect(files.mock.calls.some(([c])=>c.kind==='PutObject')).toBe(true);
  expect(Object.values(db.mock.calls.at(-1)[0].input.ExpressionAttributeValues)).toContain('ready');
});
test('oversized free-plan recordings bypass Groq and still analyze available screens',async()=>{
  const log=jest.spyOn(console,'error').mockImplementation(()=>{});
  files.mockImplementation(async(c:{kind:string})=>c.kind==='HeadObject'?{ContentLength:26000000}:c.kind==='ListObjectsV2'?{Contents:[{Key:`frames/${id}/00.jpg`,Size:4}]}:frameObject());
  await finishProcessing({videoId:id,attempt:'initial',groq:true});
  expect(transcribeWithGroq).not.toHaveBeenCalled();expect(model).toHaveBeenCalledTimes(1);
  expect(Object.values(db.mock.calls.at(-1)[0].input.ExpressionAttributeValues)).toContain(true);
  log.mockRestore();
});
test('Groq quota errors retain playback and give an actionable failure without snapshots',async()=>{
  const log=jest.spyOn(console,'error').mockImplementation(()=>{});
  let reads=0;db.mockImplementation(async(c:{kind:string})=>c.kind==='Get'?{Item:{...video,aiStatus:++reads>=3?'failed':'pending'}}:{});
  (transcribeWithGroq as jest.Mock).mockRejectedValue(new GroqError(429,'Groq free-plan quota reached.'));
  await expect(finishProcessing({videoId:id,attempt:'initial',groq:true})).rejects.toThrow('quota');
  expect(Object.values(db.mock.calls.filter(([c])=>c.kind==='Update').at(-1)[0].input.ExpressionAttributeValues)).toContain('Groq free-plan quota reached.');
  log.mockRestore();
});

test('Bedrock access failures identify the summary stage and preserve transcript readiness',async()=>{
  const log=jest.spyOn(console,'error').mockImplementation(()=>{});
  db.mockImplementation(async(c:{kind:string})=>c.kind==='Get'?{Item:{...video,transcriptReady:true}}:{});
  files.mockResolvedValue(body({text:'An explanation.',segments:[]}));
  model.mockRejectedValueOnce(Object.assign(new Error('private account details'),{name:'AccessDeniedException',$metadata:{requestId:'bedrock-reference'}}));
  await expect(finishProcessing({videoId:id,attempt:'initial'})).rejects.toThrow('private account details');
  const values=Object.values(db.mock.calls.filter(([c])=>c.kind==='Update').at(-1)[0].input.ExpressionAttributeValues);
  expect(values.some(value=>typeof value==='string'&&value.includes('AccessDeniedException')&&value.includes('transcript is ready'))).toBe(true);
  expect(JSON.stringify(values)).not.toContain('private account details');
  expect(log).toHaveBeenCalledWith(expect.objectContaining({stage:'summarize',requestId:'bedrock-reference'}));
  log.mockRestore();
});
