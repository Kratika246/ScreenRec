# Architecture, security, and tradeoffs

## Scope and assumptions

ScreenRec is an assessment-scale Chrome recorder with unlisted sharing and asynchronous AI notes. The priority is a short path from capture to a shareable link, then useful understanding of both speech and screen content.

The working deployment uses Groq Whisper for speech and Amazon Nova Lite for multimodal notes. The owner confirmed the deployed flow works on 18 October 2026. That confirmation is distinct from the broader browser/failure-mode [acceptance checklist](acceptance.md).

The current scope excludes editing, trimming, team workspaces, private/revocable links, cloud deletion, Google federation, unlimited transcription, and a Chrome Web Store release.

## Link readiness and upload

A video ID and share URL are allocated before recording. MediaRecorder emits WebM data about every five seconds. Because S3 requires every nonfinal multipart part to be at least 5 MiB, a byte-preserving buffer combines recorder events before upload. Two upload lanes overlap network work with capture.

Stop copies the existing URL immediately. Final bytes, outstanding parts, and the multipart commit still require network time. The viewer polls through that state. Link readiness, playback readiness, and AI readiness are separate milestones; no zero-latency playback guarantee is claimed.

IndexedDB retains source chunks and part acknowledgements until cloud completion. Each video part gets up to four attempts with a fresh five-minute URL. Failed uploads can be retried or downloaded. Closing the recorder ends capture and may lose the latest unpersisted event. Very long retry/download operations rebuild a large Blob and need memory profiling.

The former 99% finalization failure came from using HEAD as a preflight for an object not yet committed. Without ListBucket, S3 could return 403 rather than 404. Completion now lists multipart parts first and uses HEAD only to reconcile an already-committed upload.

## Manifest V3 and media

A persistent extension page owns MediaRecorder, streams, composition, timers, persistence, and upload queues. The service worker brokers controls and badge/state updates; it can suspend without owning the capture session. The offscreen document handles clipboard copying.

The popup opens the recorder, which immediately starts Chrome source selection. Screen + camera is composed into one canvas video track. Web Audio mixes microphone and selected-source audio when available. A content script uses Shadow DOM for page UI, and an extension-hosted camera iframe receives a local WebRTC stream.

This avoids host-page camera permission prompts, but requires the recorder tab to remain open. Browser scheduling, source coordinate mapping, multi-monitor placement, and duplicate camera presentation still need broad interactive testing.

## Speech and screen-aware AI

S3 multipart completion starts an independent AI pipeline. With the default Groq provider, AiStart dispatches AiResults. The worker reads an SSM SecureString key, signs a private video URL for five minutes, requests a verbose Whisper transcript, validates timed segments, and stores processed JSON in private S3.

The free-plan adapter enforces 25,000,000 bytes for the entire video. This is sufficient for short demos, not a general long-recording transcription solution. Audio-only extraction/chunking is the next improvement. Groq receives the recorded media, which is an explicit third-party processing boundary.

Screen understanding uses browser-side sampling instead of a video-decoding fleet. Samples are taken at the start, about every ten seconds while active, and Stop. Sixteen fixed object slots preserve the first and latest images plus a reservoir spanning capture. Each JPEG is at most 1600 x 900 and 200,000 bytes.

The reservoir bounds retained objects, not total requests: long recordings overwrite slots repeatedly. Uploads are best effort and never fail video saving. Stop gives pending snapshots at most two seconds to drain. Late or failed uploads can reduce the evidence available to the AI worker.

Nova Lite receives available snapshots and speech through Bedrock Converse. It returns validated JSON for title, summary, chapters, and observed issues. Chapter timestamps must match supplied evidence timestamps; issues must additionally reference a screen snapshot. The prompt treats screen text and transcripts as untrusted data and provides no tools.

Sampling can miss transient errors and cannot prove clicks, causal transitions, reproduction steps, or root causes. The viewer labels AI sources and supports review against video timestamps. Silent screens can generate visual notes; camera-only capture uses speech. Empty inputs finish without invented notes.

## Reliability and storage

AI upload readiness is separate from video status. Attempt IDs reject stale events, and short leases reduce duplicate concurrent speech/model calls. They do not guarantee exactly-once execution across crashes between a provider response and persistence.

Transcripts live in private S3 instead of DynamoDB to avoid item-size pressure. Metadata stores only summary/results and availability flags. Transcript readiness is published before model generation, preserving useful text if summarization fails.

A failed summary reuses the processed transcript on retry, alongside any unexpired snapshots. A failed speech stage can fall back to visual notes and expose Retry transcription. Old videos cannot gain visual evidence retroactively; server-side frame extraction is not implemented.

| Data | Retention |
| --- | --- |
| Incomplete multipart uploads | Aborted after one day |
| Raw optional Transcribe output | 30 days |
| Screen snapshots | 30 days |
| Processed transcripts and committed videos | No automatic expiry |
| AI dead-letter queue | 14 days |

Retain policies protect buckets, the table, and Cognito on stack deletion. Retained resources can continue to incur charges. Automatic reconciliation of lost terminal events or permanently stuck jobs is deferred.

## Authentication and sharing

Cognito hosted sign-in uses authorization code + PKCE, OAuth state checks, refresh, and revocation. The original username-based pool is preserved because UsernameAttributes and aliases cannot be changed in place. Google federation remains deferred.

API Gateway's REST API uses a Cognito authorizer for owner operations. Handlers enforce ownership and stored upload identity. The existing REST API was kept to avoid migration risk; HTTP API is a future cost reduction.

Public reads intentionally allow anyone with an opaque UUID link to access video and notes. This is unlisted sharing, not private access control. Metadata excludes owner IDs, internal job names, and upload identifiers.

## Security boundaries

- S3 buckets block public access, require TLS, and use managed encryption. CloudFront OAC authorizes video/site origin access.
- Video and snapshot uploads go directly to S3 through five-minute presigned URLs. Snapshot signing constrains key slots, content type, byte count, and timestamp metadata.
- Completion validates consecutive part numbers, ETags, minimum part sizes, total bytes, duration, and ownership. The 5 GiB completion limit does not itself cap bytes sent through presigned multipart PUTs.
- Only AiResults reads the configured SSM key. Keys stay out of the extension and public API. Groq logs omit secrets, signed URLs, and provider response bodies.
- Bedrock invocation is scoped to the configured profile and backing model. Default Nova needs no Marketplace subscription permissions.
- The optional Claude activation path restricts Subscribe to the exact configured product. It does not bypass account billing, first-use, or organization controls.
- API throttling and incomplete-upload cleanup limit common failure costs. Per-user quotas, abuse controls, retention controls, alarms, and tighter deployment-specific extension host permissions are future work.

## Scalability

S3 handles video transfer directly; Lambda does not relay video bytes. CloudFront caches delivery, DynamoDB uses on-demand capacity, and AI runs asynchronously. The browser holds only bounded snapshot queues, but local recording persistence still grows with duration.

The main practical limits are provider quotas, Lambda concurrency, video bandwidth, client storage/memory, and the 25 MB speech adapter. A production version needs audio extraction, durable job orchestration, per-user budgets, larger-library pagination, monitoring, and deletion policies.

## Rough cost per 1,000 short recordings

This is a planning example, not a measured bill or current-price guarantee. Assume 1,000 recordings of 30 seconds, 5 MB each, one full playback each, one month of retention, up to sixteen 200 KB snapshots per recording, and one AI call with 8,000 total input tokens including images and 500 output tokens.

| Component | Illustrative calculation | USD |
| --- | --- | --- |
| S3 video + snapshot storage | 8.2 GB-month x 0.023 | 0.19 |
| CloudFront video transfer | 5 GB x 0.085 | 0.43 |
| Nova Lite input | 8 million tokens x 0.06 per million | 0.48 |
| Nova Lite output | 0.5 million tokens x 0.24 per million | 0.12 |
| Groq speech | 500 minutes spread within free-plan hourly/daily quotas | 0.00 |
| Listed components subtotal | Before allowances, taxes, and items below | 1.22 |

Budget roughly **USD 3-5 for this specific short-demo workload**, allowing for control-plane requests, Lambda, DynamoDB, logs, and S3-to-Groq internet transfer. This is an engineering allowance, not a quoted total. Authentication activity, retries, region/edge pricing, image tokenization, retention, and actual bitrate can change it substantially. Free allowances may reduce the bill; exceeding Groq free quotas blocks transcription rather than providing unlimited free service.

The unit-rate assumptions are illustrated in AWS's [Nova cost discussion](https://aws.amazon.com/blogs/machine-learning/effective-cost-optimization-strategies-for-amazon-bedrock/), [S3 cost example](https://docs.aws.amazon.com/solutions/latest/live-streaming-on-aws-with-amazon-s3/cost-example-1.html), and [CloudFront transfer example](https://aws.amazon.com/blogs/networking-and-content-delivery/implementing-granular-cost-analysis-for-multi-tenant-cloudfront-distributions/). Check current [S3](https://aws.amazon.com/s3/pricing/), [CloudFront](https://aws.amazon.com/cloudfront/pricing/), [Bedrock](https://aws.amazon.com/bedrock/pricing/), and [Groq limits](https://console.groq.com/docs/rate-limits) before operating at scale.

For comparison, 1,000 ten-minute recordings at 2.5 Mbps store roughly 190 GB before snapshots/audio and deliver a similar amount per full view. That workload exceeds the current free speech adapter's per-file limit and needs a different processing design.

## Provider decisions and verification

Transcribe account activation and Claude Marketplace activation blocked the original AWS-only AI plan. Groq Whisper and Nova Lite removed those specific dependencies while retaining AWS storage, APIs, metadata, delivery, and multimodal processing. [Known issues](known-issues.md) preserves the exact failures and the owner's successful deployment confirmation.

Automated tests cover contracts, validation, IAM templates, concurrency guards, and recovery paths with mocked services. Local builds verify packaging/type compatibility. The owner confirmed the working deployment; comprehensive browser, abuse, performance, and AI-quality validation remain separate acceptance work.
