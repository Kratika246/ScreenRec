
jest.mock('@aws-sdk/client-ssm',()=>({
  SSMClient:jest.fn().mockImplementation(()=>({send:jest.fn()})),
  GetParameterCommand:class{constructor(public input:unknown){}},
}));
import { parameters, transcribeWithGroq, parseGroqTranscript } from '../lambda/groq';
const read=parameters.send as jest.Mock;
const fetcher=jest.fn();
beforeEach(()=>{jest.clearAllMocks();jest.spyOn(global,'fetch').mockImplementation(fetcher);process.env.GROQ_API_KEY_PARAMETER='/screenrec/groq-api-key';read.mockResolvedValue({Parameter:{Value:'gsk_test_private_key'}});});
afterEach(()=>jest.restoreAllMocks());
test('Groq keeps valid segment timestamps and filters malformed or likely silent segments',()=>{
  expect(parseGroqTranscript({text:'Hello. Noise',language:'english',segments:[
    {start:1,end:2,text:'Hello.'},{start:-1,end:0,text:'Invalid'},
    {start:3,end:4,text:'Noise',no_speech_prob:.99,avg_logprob:-2},
  ]})).toEqual({text:'Hello.',languageCode:'english',segments:[{start:1,end:2,text:'Hello.'}]});
  expect(parseGroqTranscript({text:'',segments:[]}).text).toBe('');
  expect(()=>parseGroqTranscript({text:42})).toThrow();
});
test('server reads decrypted key and sends private media URL with timestamp response format',async()=>{
  fetcher.mockResolvedValue({ok:true,json:async()=>({text:'Hello',segments:[{start:0,end:1,text:'Hello'}]})});
  const result=await transcribeWithGroq('https://s3.example/private-signed');
  expect(read.mock.calls[0][0].input).toEqual({Name:'/screenrec/groq-api-key',WithDecryption:true});
  const [url,request]=fetcher.mock.calls[0];
  expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
  expect(request.headers.Authorization).toBe('Bearer gsk_test_private_key');
  expect(request.body.get('url')).toBe('https://s3.example/private-signed');
  expect(request.body.get('response_format')).toBe('verbose_json');
  expect(request.body.get('timestamp_granularities[]')).toBe('segment');
  expect(result.segments[0].start).toBe(0);
});
test('quota responses do not expose provider internals or credentials',async()=>{
  const cancel=jest.fn();
  fetcher.mockResolvedValue({ok:false,status:429,body:{cancel}});
  await expect(transcribeWithGroq('private-url')).rejects.toThrow('quota');
  expect(cancel).toHaveBeenCalled();
});
test('missing key never sends a request to Groq',async()=>{
  read.mockResolvedValue({Parameter:{Value:'placeholder'}});
  await expect(transcribeWithGroq('private-url')).rejects.toThrow('valid Groq API key');
  expect(fetcher).not.toHaveBeenCalled();
});
