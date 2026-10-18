import { parseTranscript, parseSummary, parseAnalysis, summaryInput, SUMMARY_INPUT_LIMIT } from '../lambda/ai-text';
import { shouldPollVideo, aiLabel } from '../../packages/shared/src/ai-state';

test('transcript keeps word timestamps, punctuation, and language', () => {
  const transcript = parseTranscript({results:{transcripts:[{transcript:'Hello there. Another thought.'}],items:[
    {type:'pronunciation',start_time:'1.1',end_time:'1.5',alternatives:[{content:'Hello'}]},
    {type:'pronunciation',start_time:'1.6',end_time:'2',alternatives:[{content:'there'}]},
    {type:'punctuation',alternatives:[{content:'.'}]},
    {type:'pronunciation',start_time:'16',end_time:'17',alternatives:[{content:'Another'}]},
    {type:'pronunciation',start_time:'17',end_time:'18',alternatives:[{content:'thought'}]},
    {type:'punctuation',alternatives:[{content:'.'}]},
  ]}},'en-IN');
  expect(transcript.text).toBe('Hello there. Another thought.');
  expect(transcript.segments).toEqual([{start:1.1,end:2,text:'Hello there.'},{start:16,end:18,text:'Another thought.'}]);
  expect(transcript.languageCode).toBe('en-IN');
});
test('silence is empty and malformed word timings never become seek targets',()=>{
  expect(parseTranscript({results:{transcripts:[{transcript:'  '}],items:[]}}).text).toBe('');
  const data=parseTranscript({results:{transcripts:[{transcript:'Text'}],items:[
    {start_time:'NaN',end_time:'2',alternatives:[{content:'bad'}]},
    {start_time:'-1',end_time:'2',alternatives:[{content:'bad'}]},
    {start_time:'4',end_time:'2',alternatives:[{content:'bad'}]},
  ]}});
  expect(data.segments).toEqual([]);
});
test('model output is validated before updating the public title',()=>{
  expect(parseSummary('{"title":"Fixing the login flow","summary":"The recording explains a login bug."}').title).toBe('Fixing the login flow');
  for(const output of ['not json','{}','{"title":"","summary":"text"}',JSON.stringify({title:'x'.repeat(141),summary:'text'})])expect(()=>parseSummary(output)).toThrow();
});
test('long summary input is bounded and explicitly marked excerpted',()=>{
  const result=summaryInput('a'.repeat(70000));
  expect(result.truncated).toBe(true);
  expect(result.text.length).toBeLessThan(SUMMARY_INPUT_LIMIT+100);
  expect(summaryInput('short')).toEqual({text:'short',truncated:false});
});
test('ready playback keeps polling until AI reaches its own terminal state',()=>{
  const video={id:'id',title:'title',status:'ready' as const,createdAt:'date'};
  expect(shouldPollVideo({...video,aiStatus:'transcribing'})).toBe(true);
  expect(shouldPollVideo({...video,aiStatus:'summarizing'})).toBe(true);
  for(const aiStatus of ['ready','failed','no_speech'] as const)expect(shouldPollVideo({...video,aiStatus})).toBe(false);
  expect(shouldPollVideo(video)).toBe(false);
  expect(shouldPollVideo({...video,status:'recording'})).toBe(true);
  expect(aiLabel({...video,aiStatus:'no_speech'})).toBe('No AI inputs captured');
});

test('speech-only output cannot introduce visual issue evidence or invented chapter timestamps',()=>{
  const result=parseAnalysis(JSON.stringify({title:'Demo',summary:'A workflow.',chapters:[{timestamp:1,title:'Introduction'},{timestamp:3,title:'Unseen'}],issues:[{timestamp:1,title:'Error',evidence:'Claim'}]}),[1],[]);
  expect(result.chapters).toEqual([{timestamp:1,title:'Introduction'}]);
  expect(result.issues).toEqual([]);
});
test('chapter and issue output stays bounded even if the model returns excessive entries',()=>{
  const entries=Array.from({length:40},(_,timestamp)=>({timestamp,title:'Topic',evidence:'Visible error'}));
  const result=parseAnalysis(JSON.stringify({title:'Demo',summary:'A workflow.',chapters:entries,issues:entries}),entries.map(item=>item.timestamp),entries.map(item=>item.timestamp));
  expect(result.chapters).toHaveLength(12);expect(result.issues).toHaveLength(5);
});
