export type RecordingMode = 'screen' | 'screen+cam' | 'cam';
export type VideoStatus = 'recording' | 'finalizing' | 'ready' | 'failed';
export interface Video { id: string; title: string; status: VideoStatus; createdAt: string; duration?: number; size?: number; playbackUrl?: string; shareUrl?: string }
export interface CreateVideoResponse { videoId: string; uploadId: string; shareUrl: string }
export interface PartInfo { partNumber: number; etag: string }
export interface RecordingState { status: 'idle' | 'preparing' | 'countdown' | 'recording' | 'paused' | 'uploading' | 'failed'; duration: number; uploadProgress: number; shareUrl?: string; videoId?: string; error?: string; copied?: boolean; countdown?: number; mode?: RecordingMode; uploadStage?: 'sending' | 'finalizing'; outcome?: 'ready' | 'local' }
