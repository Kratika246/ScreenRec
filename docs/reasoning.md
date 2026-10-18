# Engineering decisions and tradeoffs

## 1. Executive summary

ScreenRec is a Chrome recorder built around reducing the effort between showing something on screen and sharing it with another person.

Within the two-day constraint, I prioritized the complete recording-to-sharing journey, then recovery and useful AI. The central UX decision was uploading directly to S3 during capture. This overlaps recording and transfer time, while allocating the share link before recording starts. Stop copies that link; playback follows once upload finalization completes.

WXT, React, and TypeScript reduced extension setup work and kept interface contracts consistent. AWS CDK provided a reproducible backend using managed storage, authentication, metadata, APIs, and delivery without an always-running application server.

For differentiation, the implementation combines speech with selected screen snapshots to generate summaries, chapters, and timestamped observations. Groq Whisper and Amazon Nova Lite replaced providers blocked by account activation, preserving the working flow under the deadline.

Advanced editing, collaboration, revocable sharing, long-form transcription, and broader browser support were deliberately deferred. The resulting scope favors a reviewable end-to-end experience, with explicit limits and validation evidence.

## 2. Problem understanding and two-day priorities

The central challenge was the handoff from recording to sharing. The user needs a playable result, a simple way to share it, and a recovery path if saving fails.

| Window | Priority | Reason |
| --- | --- | --- |
| Day 1 | Capture, playable WebM, real AWS upload and viewer | Establish the full path and expose permission, CORS, identity, and multipart risks early. |
| Day 2 | Recovery, screen-aware AI, and failure states | Add differentiation without making playback depend on AI. |
| Final pass | UX consistency, ZIP, documentation, and demo checks | Make the result installable and reviewable. |

These are delivery priorities, not a measured time log. Upload defects took precedence over extra features; account activation could not consume the remaining delivery window.

## 3. What makes ScreenRec different

- **Upload while recording:** reduces the transfer left after Stop and makes the preallocated share link immediately available.
- **Local recovery:** persisted recorder data provides a retry/download path when cloud saving fails.
- **Screen-aware notes:** combining speech with selected snapshots can explain visible UI and silent demonstrations.
- **Timestamped error evidence:** observed issues link back to a captured moment, making a bug-report draft easier to verify.

These are implemented capabilities and design benefits. Their effect on perceived speed and confidence has not been measured in a usability study.

## 4. UX decisions and user journey

The journey is: choose a mode, select the source, approve permissions, count down, record, stop, and share. Each state should explain what is happening and what the user can do next.

| User friction | Decision | Intended benefit |
| --- | --- | --- |
| Unclear capture start | Countdown after permissions | Time to prepare the screen and speech. |
| Losing controls when the popup closes | Persistent recorder, timer, pause/resume and stop | Accessible controls and visible session state. |
| Impersonal screen explanations | Camera bubble | Keeps the speaker visible alongside the work. |
| Waiting to obtain a URL | Allocate early and copy on Stop | One sharing action, with manual Copy link as fallback. |
| Ambiguous saving progress | Separate uploading and finalizing states | Explains why a copied link may still await playback. |
| Arriving before everything is ready | Viewer readiness states and independent AI polling | Watch once video saving completes; notes can follow. |
| Redoing work after failure | Actionable errors, retry, and download recovery | A next step using retained data. |

The UI distinguishes link copied, video playable, and AI ready. Clipboard behavior when unfocused, bubble placement, and interruption recovery remain browser acceptance scenarios.

## 5. Architecture and technology choices

| Choice | Why it suited the assignment |
| --- | --- |
| WXT | Handles MV3 entrypoints, development builds, and packaging, freeing time for recording behavior. |
| React + TypeScript | Supports changing UI state and shared extension/API/AI contracts. |
| S3 + Lambda + DynamoDB | Direct uploads, small control-plane handlers, and managed metadata without an application server. |
| Cognito + CloudFront | Hosted sign-in and delivery from private S3 origins. |
| AWS CDK | Reviewable, reproducible infrastructure in the same language as the application. |

AWS matched the requested backend and supports overlapping capture with direct-to-S3 transfer. Video bytes avoid API Gateway and Lambda.

The existing REST API, Cognito pool, and extension identity were retained to protect the working deployment. HTTP API migration offered less value under the deadline than stable uploads. WXT simplifies builds; browser permissions and media lifetimes still need explicit handling.

## 6. Recording reliability and recovery

MediaRecorder runs in a persistent extension page, separate from the MV3 service worker. The recorder owns streams, upload, and persistence; the offscreen document handles clipboard copying. The recorder tab must remain open.

Five-second recorder events are buffered into S3-compatible parts because every nonfinal part must reach 5 MiB. Two upload lanes overlap transfer with capture; the tail upload and commit finish after Stop.

IndexedDB retains chunks and acknowledgements until completion, enabling retry/download. Closing the recorder ends capture and may lose the latest unpersisted event. Recovery is implemented, but comprehensive interruption tests remain outstanding.

An observed 99% finalization failure led to replacing the missing-object HEAD preflight with ListParts. [Known issues](known-issues.md) records the cause and regression coverage.

## 7. AI integration and provider tradeoffs

Speech alone would miss visible errors and silent walkthroughs. The model therefore combines a timed transcript with selected snapshots to generate a title, summary, chapters, and observed issues. Output timestamps are checked against supplied evidence and can be selected to seek.

**Groq Whisper** replaced Transcribe after SubscriptionRequiredException. It accepts WebM and provides segment timestamps through a free plan suited to short demos. The tradeoffs are third-party media processing, quotas, and a 25 MB whole-video limit; audio extraction/chunking is deferred.

**Nova Lite** replaced Claude after Marketplace AccessDeniedException. Its image-and-text support works through the same Bedrock Converse contract, preserving the notes pipeline while avoiding that activation prerequisite. AWS inference remains metered. [Incident details](known-issues.md) explain both changes.

AI runs independently of playback. Summary retries reuse the saved transcript and available snapshots; speech failure can fall back to labeled visual notes. Sparse snapshots can miss events and cannot establish reproduction steps or root causes. AI accuracy needs review against playback.

## 8. Security, scalability, and cost

Owner operations require Cognito authentication and ownership checks. Private S3 buckets use CloudFront OAC for delivery; upload URLs expire after five minutes. The Groq key stays in server-side SSM.

Links are **unlisted**: anyone holding one can view the video and notes. Groq receives the recorded media through a private URL; Nova processes transcript and snapshots through its US inference profile.

Direct S3 transfer, on-demand metadata, and asynchronous AI support growth, but quotas, client storage, concurrency, and bandwidth still limit capacity. No production load test is claimed.

The appendix's **USD 3-5 allowance per 1,000 short demo recordings** is illustrative, not measured spending or a current-price guarantee. Its bitrate, viewing, retention, and token assumptions materially affect the result.

## 9. Testing and validation

| Evidence | What it establishes |
| --- | --- |
| Automated checks | Multipart/retry, ownership, public fields, AI failure/timestamp, attempt/lease, polling, and infrastructure/IAM coverage. Services are mocked. |
| Local builds | TypeScript, lint, packaging, and synthesis compatibility; not deployed provider access. |
| Owner confirmation, 18 October 2026 | The deployed Groq + Nova flow was reported working. |
| Remaining acceptance work | Full browser/failure, multi-monitor, background scheduling, AI-quality, and performance coverage. |

The [acceptance checklist](acceptance.md) keeps unverified scenarios visible. Recovery tests do not prove every interruption is recoverable. Provider changes bypassed the AWS blockers; Transcribe and Claude activation were not confirmed fixed.

## 10. Limitations and future improvements

The deadline favored capture, sharing, recovery, and useful AI over feature breadth.

| Deferred work | Reason and consequence |
| --- | --- |
| Audio chunking and historical frame extraction | Adds media processing/alignment; speech needs short files and old videos cannot gain uncaptured evidence. |
| Editing, trimming, and more formats | A separate workflow; this release shares the original WebM. |
| Teams and Google federation | Expands identity cases; the current library uses Cognito username/password. |
| Private/revocable links, deletion, retention controls | Requires coordinated access/storage/cache changes; sharing remains unlisted. |
| Quotas, alarms, job reconciliation, pagination | Operational hardening remains; the library returns the newest 50 recordings. |
| Cross-browser automation, CI, and Web Store distribution | Expands release testing; Chrome and unpacked/ZIP delivery are supported. |

Next: audio extraction/chunking and broader capture tests, then job recovery/monitoring and budgets, then deletion/sharing controls. Editing and collaboration would follow those reliability and capacity improvements.

## 11. Technical appendix

### Capture and evidence details

Screen + camera is composed into a canvas video track; Web Audio mixes microphone and available source audio. Page UI uses Shadow DOM, with an extension-hosted camera iframe receiving a local WebRTC stream.

Sampling occurs at the start, about every ten seconds while active, and Stop. Sixteen fixed slots retain the first/latest images and a reservoir spanning capture. Each JPEG is capped at 1600 x 900 and 200,000 bytes. Slots bound retained objects, not total upload requests. Snapshot upload is best effort and gets at most two seconds to drain at Stop, so late/failed uploads can reduce evidence.

### Failure isolation, access, and retention

Each video part gets up to four attempts with a fresh URL. Completion validates ownership, upload identity, ordered parts, ETags, sizes, and duration. The 5 GiB completion limit does not itself cap bytes sent through presigned PUTs; per-user abuse controls remain deferred.

AI attempt IDs reject stale events, and short leases reduce duplicate concurrent calls. They do not guarantee exactly-once execution across a crash between provider response and persistence. Transcripts live in private S3 to avoid DynamoDB item-size pressure. Old videos without snapshots remain speech-only; retries cannot reconstruct expired evidence.

The model treats transcript/image text as untrusted data and receives no tools. Bedrock IAM is scoped to the configured profile/model; Nova needs no Marketplace subscription actions. Optional Claude activation restricts Subscribe to a specific product. Public metadata excludes ownership/upload/internal job identifiers. Broader HTTPS extension host permissions should be narrowed for a production release.

| Data | Retention |
| --- | --- |
| Incomplete multipart uploads | Aborted after one day |
| Screen snapshots and raw optional Transcribe output | 30 days |
| Processed transcripts and committed videos | No automatic expiry |
| AI dead-letter queue | 14 days |

Retain policies protect buckets, the table, and Cognito on stack deletion; retained resources may still incur charges. Automatic stuck-job reconciliation is deferred. The original Cognito pool's immutable username/alias configuration is preserved.

### Illustrative cost per 1,000 short recordings

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
