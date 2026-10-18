export type RecordingMode = 'screen' | 'screen+cam' | 'cam';
export type VideoStatus = 'recording' | 'finalizing' | 'ready' | 'failed';
export type AiStatus = 'pending' | 'transcribing' | 'summarizing' | 'ready' | 'no_speech' | 'failed';
export interface TranscriptSegment { start: number; end: number; text: string }
export interface Transcript { text: string; segments: TranscriptSegment[]; languageCode?: string }
export interface VideoChapter { timestamp: number; title: string }
export interface VisualIssue { timestamp: number; title: string; evidence: string }
export interface Video {
  id: string; title: string; status: VideoStatus; createdAt: string;
  duration?: number; size?: number; playbackUrl?: string; shareUrl?: string;
  aiStatus?: AiStatus; aiMessage?: string; summary?: string;
  transcriptionFailed?: boolean; transcriptReady?: boolean; summaryTruncated?: boolean;
  aiSources?: 'speech' | 'screens' | 'combined'; visualFrameCount?: number; chapters?: VideoChapter[]; issues?: VisualIssue[];
}
export interface CreateVideoResponse { videoId: string; uploadId: string; shareUrl: string }
export interface PartInfo { partNumber: number; etag: string }
export interface RecordingState {
  status: 'idle' | 'preparing' | 'countdown' | 'recording' | 'paused' | 'uploading' | 'failed';
  duration: number; uploadProgress: number; shareUrl?: string; videoId?: string; error?: string;
  copied?: boolean; countdown?: number; mode?: RecordingMode; uploadStage?: 'sending' | 'finalizing'; outcome?: 'ready' | 'local';
}
