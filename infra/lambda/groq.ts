
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { Transcript } from '../../packages/shared/src/index';
export const parameters = new SSMClient({});
export class GroqError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'GroqError'; }
}
export function parseGroqTranscript(value: unknown): Transcript {
  if (!value || typeof value !== 'object') throw new Error('Invalid Groq response');
  const data = value as { text?: unknown; language?: unknown; segments?: unknown };
  if (typeof data.text !== 'string' || data.text.length > 1000000) throw new Error('Invalid Groq transcript text');
  const segments: Transcript['segments'] = [];
  for (const entry of Array.isArray(data.segments) ? data.segments : []) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string,unknown>;
    if (typeof item.no_speech_prob === 'number' && item.no_speech_prob > .6 && typeof item.avg_logprob === 'number' && item.avg_logprob < -1) continue;
    if (typeof item.start !== 'number' || typeof item.end !== 'number' || !Number.isFinite(item.start) || !Number.isFinite(item.end) ||
        item.start < 0 || item.end < item.start || item.end > 86400 || typeof item.text !== 'string' || !item.text.trim()) continue;
    segments.push({ start: item.start, end: item.end, text: item.text.trim() });
  }
  segments.sort((a,b)=>a.start-b.start);
  const text = Array.isArray(data.segments) ? segments.map(segment=>segment.text).join(' ') : data.text.trim();
  return { text, segments, ...(typeof data.language === 'string' && data.language.length < 80 ? {languageCode:data.language}: {}) };
}
export async function transcribeWithGroq(mediaUrl: string): Promise<Transcript> {
  const result = await parameters.send(new GetParameterCommand({ Name: process.env.GROQ_API_KEY_PARAMETER, WithDecryption: true }));
  const key = result.Parameter?.Value?.trim();
  if (!key?.startsWith('gsk_')) throw new Error('Set a valid Groq API key in the configured SSM SecureString parameter.');
  const form = new FormData();
  form.set('model', 'whisper-large-v3-turbo');
  form.set('url', mediaUrl);
  form.set('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.set('temperature', '0');
  // Never log the key, signed media URL, request form, or provider response body.
  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form, signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    const message = response.status === 429 ? 'Groq free-plan quota reached. Retry transcription after your quota resets.' :
      response.status === 401 || response.status === 403 ? 'Groq rejected the API key or model access. Check the SSM key and Groq project permissions.' :
      response.status === 413 ? 'Recording exceeds the Groq free-plan size limit of 25 MB.' : 'Groq transcription failed (HTTP ' + response.status + '). Retry transcription.';
    throw new GroqError(response.status, message);
  }
  return parseGroqTranscript(await response.json());
}
