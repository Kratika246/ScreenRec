# ScreenRec

Record your screen, share a link on Stop, and turn the recording into searchable, screen-aware notes.

The extension uploads to S3 while you record. A share URL is allocated before capture and copied on Stop; playback begins when the final bytes and multipart commit finish. AI runs independently, so viewers can watch while notes are being generated.

**Current status:** the owner confirmed the deployed Groq Whisper + Amazon Nova Lite flow works on 18 October 2026. Local builds, regression checks, extension packaging, and CDK synthesis have also been exercised. The full browser and failure-mode checklist remains in [acceptance](docs/acceptance.md).

## What it does

- Records a screen, window, browser tab, camera, or screen + camera.
- Provides countdown, microphone/system-audio mixing, pause/resume, camera bubble, and recording controls.
- Uploads video directly to S3 during capture, with retry and local download recovery.
- Copies a share link on Stop and provides an authenticated My recordings library.
- Generates a title, summary, and chapters from selected screen snapshots and available speech.
- Provides searchable, timestamped transcripts and click-to-seek chapters.
- Surfaces observed visual errors with timestamped evidence and a copyable bug-report draft.

Silent screen recordings can produce visual notes. Camera-only recordings use speech. Download only works locally and does not run cloud AI.

## Stack

| Layer | Implementation |
| --- | --- |
| Extension | Chrome Manifest V3, WXT, TypeScript, React, Tailwind/CSS |
| Capture | MediaRecorder WebM, persistent recorder page, canvas camera composition |
| Authentication | Cognito hosted sign-in, PKCE, chrome.identity |
| API | API Gateway REST API, Cognito authorizer, Node.js 22 Lambda |
| Storage and metadata | Private S3 multipart uploads, DynamoDB on-demand |
| Delivery | CloudFront with Origin Access Control |
| Speech | Groq whisper-large-v3-turbo; optional Amazon Transcribe |
| Screen-aware notes | Bedrock Converse, us.amazon.nova-lite-v1:0 |
| Viewer | Vite, React, public /v/:id route |
| Infrastructure | AWS CDK in TypeScript; pnpm workspace |

Groq and Nova replaced account-blocked Transcribe and Claude integrations. The [incident record](docs/known-issues.md) preserves the exact errors, request IDs, decisions, and confirmed outcome.

## Repository

~~~text
apps/extension/    Popup, recorder, overlays, upload and local recovery
apps/web/          Share viewer, playback, transcript and AI panels
infra/             CDK stack, Lambda handlers and automated tests
packages/shared/   Recording, video, transcript and AI contracts
config/            Stable extension key and ID
scripts/           Configure public app settings and publish the viewer
docs/              Architecture, troubleshooting, incidents and acceptance
~~~

## Try it locally

Prerequisites: Node.js 22+, pnpm 12, and Chrome. Deployment also requires AWS CLI v2 and credentials for the target account. Commands below use pnpm.cmd for Windows PowerShell; use pnpm on other platforms.

~~~powershell
pnpm.cmd install
pnpm.cmd --dir apps/extension dev
~~~

In the extension popup, choose Download only, select a mode, and click Start recording. Approve capture permissions and wait for the countdown. Keep the recorder tab open until saving finishes.

For the local viewer, configure VITE_API_BASE with your deployed API and run:

~~~powershell
pnpm.cmd --dir apps/web dev
~~~

Chrome is the supported assessment target. The extension is distributed as an unpacked build or ZIP, not a published Chrome Web Store listing.

## Deploy or update

Use the same AWS account and region as the existing stack. The default region is us-east-1. Preserve the stable extension key in config/extension.json; its ID is ldklccggileljcoeplibekemnoifhaef.

### 1. Configure speech transcription

Create a [Groq API key](https://console.groq.com/keys). In AWS Systems Manager > Parameter Store, in the deployment region, create:

| Setting | Value |
| --- | --- |
| Name | /screenrec/groq-api-key |
| Tier | Standard |
| Type | SecureString |
| Encryption | Default aws/ssm key |
| Value | Your Groq API key |

Only the AI results Lambda receives permission to read this parameter. Keep the key out of extension files, Git, and chat.

Groq's free plan has file, request, and audio-duration quotas. This implementation enforces a **25 MB limit on the entire video file**, not just its audio. Use short recordings for the demo; audio-only extraction and chunking are deferred. Check [file support](https://console.groq.com/docs/speech-to-text) and your [account limits](https://console.groq.com/docs/rate-limits).

### 2. Deploy the AWS stack

~~~powershell
aws sts get-caller-identity
pnpm.cmd install
pnpm.cmd --dir infra exec cdk diff ScreenRecStack
pnpm.cmd --dir infra exec cdk deploy ScreenRecStack --outputs-file outputs.json
~~~

For an account/region that has never been bootstrapped, run pnpm.cmd --dir infra exec cdk bootstrap first.

The defaults are Groq for speech and Nova Lite for multimodal notes. Amazon models avoid the Claude Marketplace activation prerequisite, but Bedrock inference and AWS hosting remain metered.

**Existing users:** do not change the original Cognito pool's UsernameAttributes or aliases. Its username-based configuration is retained to avoid immutable-property deployment failures. Google sign-in is not implemented.

### 3. Configure and publish the apps

From the repository root:

~~~powershell
node scripts/configure.mjs infra/outputs.json
pnpm.cmd --dir apps/web build
node scripts/publish-viewer.mjs infra/outputs.json
pnpm.cmd --dir apps/extension zip
~~~

The configuration script writes ignored .env.development.local and .env.production.local files for both apps. They contain public API/Cognito settings; the Groq key stays in SSM. The publishing script uploads the SPA and requests a CloudFront invalidation, which may remain InProgress briefly.

Open chrome://extensions, enable Developer mode, and load unpacked from apps/extension/.output/chrome-mv3, or reload the existing extension.

The distributable is apps/extension/.output/screenrec-extension-1.0.0-chrome.zip. A backend-only fix does not require rebuilding the viewer; rebuild each app when its source or public configuration changes.

## Recording and AI flow

~~~text
Start -> Chrome source picker -> permissions -> countdown -> record
    |-> WebM chunks -> 5 MiB multipart buffer -> S3 video parts
    |-> selected JPEG snapshots -> private AI artifact bucket

Stop -> copy preallocated link -> drain final uploads -> complete S3 upload
                                                        |
                                      +-----------------+----------------+
                                      |                                  |
                               Viewer plays                       AI starter Lambda
                                                                         |
                                                           Groq speech transcript
                                                           (skip if no audio track)
                                                                         |
                                                           Private transcript in S3
                                                                         |
                                                         Nova Lite: speech + snapshots
                                                                         |
                                                   Title, summary, chapters, observed issues
                                                                         |
                                                        Viewer updates automatically
~~~

The service worker brokers controls and recording state. A persistent recorder page owns capture, MediaRecorder, tracks, upload queues, and IndexedDB. The offscreen document handles clipboard copying.

### AI inputs and limits

| Input or behavior | Current limit |
| --- | --- |
| Video recording | Completion validates up to 24 hours / 5 GiB |
| Groq transcription | Entire video must be at most 25,000,000 bytes |
| Screen sampling | Start, about every 10 seconds while active, and Stop |
| Retained screen snapshots | At most 16: first, latest, and a reservoir across capture |
| Each snapshot | JPEG, at most 1600 x 900 and 200,000 bytes |
| Snapshot retention | 30 days |
| Transcript | Up to 1,000,000 text characters and 5 MiB serialized payload |
| Long summary input | First 45,000 and last 15,000 transcript characters, labeled excerpted |

Snapshots are best effort; short events between samples may be missed. Notes describe observed evidence, not proven clicks, reproduction steps, or root causes. Review AI output against the recording.

### Retry and recovery

Open My recordings and select Retry AI for a failed notes job. A summary retry reuses the saved transcript and any remaining snapshots. Retry transcription is available after a visual-only fallback; Generate AI notes is available for older recordings without notes.

Older recordings without snapshots can use existing speech, but the backend does not extract historical video frames. After snapshots expire, visual evidence cannot be reused.

AI errors leave playback available. If speech fails and snapshots exist, the worker attempts visual notes and labels the missing transcript. Known no-audio recordings with no usable snapshots show an empty-input state. A failed viewer has Refresh AI notes to resume metadata polling after an owner retry.

Video uploads use four attempts per part with fresh presigned URLs. IndexedDB retains chunks and acknowledgements until completion. Reopen the recorder to retry saving or download retained data. Closing the tab ends capture and may lose data since the last persisted recorder event. Incomplete S3 multipart uploads expire after one day.

## Sharing and privacy

Share links are unlisted: anyone holding a link can view the video, transcript, and AI notes. Expiring links, revocation, private sharing, and cloud deletion are deferred.

S3 buckets block direct public access; CloudFront serves video through OAC. Public metadata excludes owner IDs, upload IDs, and internal job identifiers. Raw snapshots remain private; issue evidence is public text with video timestamps.

Cloud recording sends visible screen snapshots to AWS. Groq receives a five-minute presigned URL to the recorded video for speech processing. Nova Lite processes transcript text and snapshots through its US inference profile. Anything visible in the selected capture may be included.

## Checks and delivery

~~~powershell
pnpm.cmd --dir apps/extension compile
pnpm.cmd --dir apps/extension zip
pnpm.cmd --dir apps/web build
pnpm.cmd --dir apps/web lint
pnpm.cmd --dir infra build
pnpm.cmd --dir infra test --runInBand
pnpm.cmd --dir infra exec cdk synth --quiet --no-lookups
~~~

Automated coverage includes multipart ordering/retries, ownership, public field filtering, finalization recovery, AI attempts and leases, provider failures, transcript timestamps, evidence validation, viewer polling, and CDK/IAM wiring. It does not replace real Chrome capture and clipboard tests.

For delivery, complete the [acceptance checklist](docs/acceptance.md), rebuild the ZIP, and record the demo with ScreenRec itself.

## Documentation

- [Architecture, security, costs, and tradeoffs](docs/reasoning.md)
- [Troubleshooting and API reference](docs/troubleshooting.md)
- [Deployment incidents and resolved blockers](docs/known-issues.md)
- [Acceptance and demo checklist](docs/acceptance.md)
- [Extension development](apps/extension/README.md)
- [Viewer development](apps/web/README.md)
- [Infrastructure and optional providers](infra/README.md)

Remaining work includes Google federation, account quotas, audio extraction/chunking, cloud deletion, private/revocable sharing, library pagination, CI, and broader multi-monitor/background-tab testing.
