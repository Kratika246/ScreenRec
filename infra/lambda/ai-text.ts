import type { Transcript, TranscriptSegment } from '../../packages/shared/src/index';

interface SpeechItem {
  type?: string; start_time?: string; end_time?: string;
  alternatives?: { content?: string }[];
}
interface TranscribeOutput {
  results?: { transcripts?: { transcript?: string }[]; items?: SpeechItem[] };
}
export function parseTranscript(input: TranscribeOutput, languageCode?: string): Transcript {
  const text = (input.results?.transcripts?.[0]?.transcript || '').trim();
  if (text.length > 1000000) throw new Error('Transcript exceeds the supported size');
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | undefined, words = 0;
  const flush = () => { if (current) segments.push(current); current = undefined; words = 0; };
  for (const item of input.results?.items || []) {
    const content = item.alternatives?.[0]?.content?.trim();
    if (!content) continue;
    if (item.type === 'punctuation') {
      if (current) current.text += content;
      if (/[.!?。！？]$/.test(content) && words >= 6) flush();
      continue;
    }
    const start = Number(item.start_time), end = Number(item.end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) continue;
    if (current && (start - current.start >= 12 || words >= 35)) flush();
    if (!current) current = { start, end, text: content };
    else { current.text += ' ' + content; current.end = end; }
    words++;
  }
  flush();
  return { text, segments, ...(languageCode ? { languageCode } : {}) };
}
export const SUMMARY_INPUT_LIMIT = 60000;
export function summaryInput(text: string) {
  if (text.length <= SUMMARY_INPUT_LIMIT) return { text, truncated: false };
  return {
    text: text.slice(0, 45000) + '\n[Middle of the transcript omitted for length]\n' + text.slice(-15000),
    truncated: true,
  };
}
export function parseSummary(text: string): { title: string; summary: string } {
  const cleaned = text.trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '');
  const data: unknown = JSON.parse(cleaned);
  if (!data || typeof data !== 'object') throw new Error('Invalid summary response');
  const value = data as Record<string, unknown>;
  if (typeof value.title !== 'string' || typeof value.summary !== 'string' ||
      !value.title.trim() || !value.summary.trim() || value.title.length > 140 || value.summary.length > 1200) {
    throw new Error('Invalid summary fields');
  }
  return { title: value.title.trim(), summary: value.summary.trim() };
}

// Accept only timestamps supplied as evidence, never invented moments.
export function parseAnalysis(text: string, chapterTimes: number[], frameTimes: number[]) {
  const base = parseSummary(text);
  const data = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  const validText = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
  const validTime = (value: unknown, times: number[]): value is number => typeof value === 'number' && Number.isFinite(value) && times.some(time => Math.abs(time - value) < .001);
  const chapters: { timestamp: number; title: string }[] = [];
  const issues: { timestamp: number; title: string; evidence: string }[] = [];
  for (const item of Array.isArray(data.chapters) ? data.chapters.slice(0, 12) : []) {
    if (item && validTime(item.timestamp, chapterTimes) && validText(item.title, 140) && !chapters.some(chapter => chapter.timestamp === item.timestamp))
      chapters.push({ timestamp: item.timestamp, title: item.title.trim() });
  }
  for (const item of Array.isArray(data.issues) ? data.issues.slice(0, 5) : []) {
    if (item && validTime(item.timestamp, frameTimes) && validText(item.title, 140) && validText(item.evidence, 600))
      issues.push({ timestamp: item.timestamp, title: item.title.trim(), evidence: item.evidence.trim() });
  }
  return { ...base, chapters: chapters.sort((a,b) => a.timestamp-b.timestamp), issues: issues.sort((a,b) => a.timestamp-b.timestamp) };
}
