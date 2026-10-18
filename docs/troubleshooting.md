# Troubleshooting and API reference

The working defaults are Groq Whisper for speech and Amazon Nova Lite for notes. Start with the failing stage rather than changing providers or IAM based only on a generic viewer message. The [incident history](known-issues.md) records the original account blockers.

## Find the right logs

Open AWS Lambda in the deployment region, select Functions, and search ScreenRecStack.

| Symptom | Inspect |
| --- | --- |
| Video does not finish saving | API completeUpload/getPartUrl functions, recorder error, S3 parts |
| AI never starts | AiStart, committed S3 video, completion notification |
| Groq speech fails | AiResults, stage groq-transcription, SSM parameter |
| Transcript exists but notes fail | AiResults, stage summarize |
| Optional AWS Transcribe cannot start | AiStart, stage start-transcription |

For a Lambda function, select Monitor > View CloudWatch logs, then the newest relevant log stream. Capture the stage, exception name/message, timestamp, and request ID. Do not post API keys, authorization headers, or presigned video URLs.

The AiDeadLetterQueueUrl stack output identifies exhausted async failures. Automatic stuck-job reconciliation is not implemented.

## Common recovery paths

| Symptom | Action |
| --- | --- |
| Missing Groq key / 401 / 403 | Verify /screenrec/groq-api-key is a valid SecureString in the deployment region and its project allows Whisper. |
| Groq 429 | Wait for the relevant account quota to reset, then Retry transcription / Retry AI. |
| Groq file too large | Keep the entire video at or below 25,000,000 bytes; longer speech needs audio extraction/chunking, which is deferred. |
| Transcript ready, summary unavailable | Read AiResults summarize error. Fix model/IAM/request access, then Retry AI; the transcript is reused. |
| Transcribe SubscriptionRequiredException | Confirm transcriptionProvider=groq for the working path. Optional Transcribe still requires AWS account activation. |
| Claude Marketplace activation warning | Use the Nova deployment command below. Optional Claude activation is described in infra/README.md. |
| No visual evidence in an old recording | Only snapshots captured by the updated extension are available; historical frame extraction is not implemented. |
| No speech or usable snapshots | Verify actual recorded audio/capture. Camera-only silence has no visual-note input. |
| Transcript contains only a phrase you did not say | Play/download the video and check audio. Speech recognition can hallucinate on silence; do not treat text alone as capture verification. |
| Link copied but video is saving | Keep the recorder open; final part upload/commit must finish before playback. |
| Saving failed at 99% | Check completeUpload logs. Redeploy the current finalization handler and retry retained data; see the recorded 403 preflight incident. |
| Automatic clipboard copy fails | Use Copy link in the recorder/popup or select the URL in the viewer. |
| Viewer shows old assets | Allow CloudFront invalidation to finish and refresh; publish again after a new web build if needed. |
| Cognito UsernameAttributes update fails | Preserve the original pool configuration; do not change immutable username/alias settings in place. |

## Explicitly deploy the confirmed providers

From the repository root, using the existing account and region:

~~~powershell
pnpm.cmd --dir infra exec cdk deploy ScreenRecStack -c transcriptionProvider=groq -c bedrockModelId=us.amazon.nova-lite-v1:0 -c allowModelSubscription=false --outputs-file outputs.json
~~~

Then open My recordings > Retry AI. Existing processed transcript and available snapshots are reused. A model-only deployment does not require republishing the viewer. If public outputs or app source changed, follow the root configure/build/publish steps.

Groq processes the video through a five-minute presigned S3 URL. Nova inference and other AWS resources remain metered. Switching models does not override organization policies, model availability, or account restrictions.

## Retry semantics

| Library action | Intended use |
| --- | --- |
| Retry saving | Persisted video has not completed its cloud upload |
| Retry AI | AI processing failed; saved transcript is reused when available |
| Retry transcription | Visual notes succeeded after speech failure; retry speech after fixing its cause |
| Generate AI notes | Older ready recording has no AI status |
| Refresh AI notes | Viewer restarts metadata polling after an owner retry |

AI processing does not change the video's playable status. Snapshot reuse is limited by the 30-day lifecycle and successful uploads; the service does not decode new frames from a stored video. Fully successful AI results do not expose arbitrary regeneration.

## API

All routes are under the ApiUrl stack output. Owner routes require a Cognito token and enforce recording ownership. Public routes are intentionally accessible to anyone holding the recording ID.

| Method | Path | Access and behavior |
| --- | --- | --- |
| POST | /videos | Owner: allocate ID, share URL, metadata, multipart upload |
| POST | /videos/:id/parts | Owner: sign a numbered part for the stored upload |
| POST | /videos/:id/frames | Owner: sign a JPEG in fixed slots 0-15 while recording |
| POST | /videos/:id/complete | Owner: validate parts/bytes/duration and commit |
| POST | /videos/:id/cancel | Owner: abort unfinished upload |
| GET | /videos | Owner: newest 50 recordings |
| GET | /videos/:id | Public: playback URL, AI state/results, share metadata |
| GET | /videos/:id/transcript | Public: processed transcript and timed segments when ready |
| POST | /videos/:id/ai | Owner: retry failed/partial AI or start notes for an older recording |

### Request fields

| Route | Body fields |
| --- | --- |
| POST /videos | mode: screen, screen+cam, or cam; optional title (up to 200 characters) and hasAudio boolean |
| POST /videos/:id/parts | uploadId, partNumber (integer 1-10000) |
| POST /videos/:id/frames | slot (integer 0-15), timestamp (milliseconds, integer 0-86400000), size (bytes, integer 1-200000) |
| POST /videos/:id/complete | uploadId, duration (integer seconds), size (bytes), parts (ordered objects containing partNumber and etag) |
| POST /videos/:id/cancel | No body required; uses the owner's stored upload |
| POST /videos/:id/ai | No body required; server creates a new processing attempt |

Create returns videoId, uploadId, and shareUrl. Signing returns presignedUrl; snapshot signing also returns required headers. Completion requires consecutive uploaded part numbers, beginning with 1, and a valid ETag for each part.

The frame endpoint validates integer slot, timestamp, and size, signs content type and timestamp metadata, and caps each JPEG at 200,000 bytes. Raw frame objects remain private.

Playback URL appears when video status is ready. AI status is separate: pending, transcribing, summarizing, ready, no_speech, or failed. The legacy no_speech status now means neither usable speech nor visual input was available. Public responses omit upload/owner/job identifiers.

## Useful references

- [Groq speech formats and limits](https://console.groq.com/docs/speech-to-text)
- [Groq account rate limits](https://console.groq.com/docs/rate-limits)
- [AWS model access and prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)
- [Amazon Nova Lite](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html)
- [AWS service activation guidance](https://repost.aws/knowledge-center/error-access-service)
