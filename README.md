# ScreenRec

Chrome MV3 screen recorder with a React viewer and AWS CDK backend.

## Current progress

Core implementation is in place: persistent recorder page, screen/window/tab and camera capture, microphone/system-audio mixing, countdown, pause/resume, camera composition, draggable page overlays, streaming multipart upload, recoverable local storage, Cognito hosted sign-in, public share viewer, and authenticated library.

**Verified locally:** extension type check and production build, web production build and lint, Lambda bundle, and 27 automated tests. CDK synthesis also passes without AWS lookups.

**Not yet verified:** real camera/screen permission flows, behavior across capture surfaces and multiple monitors, clipboard behavior in a loaded extension, and deployed AWS playback. AWS CLI currently has no credentials. These are acceptance gates, not claims of completion.

AI title/summary/transcript, Google federation, cloud deletion, and CI are deferred.

## Workspace

- `apps/extension`: WXT, React, TypeScript; recording lives in `recorder.html`, never in the service worker.
- `apps/web`: Vite + React share viewer.
- `infra`: CDK, bundled Node.js 22 Lambda handlers, infrastructure/API tests.
- `packages/shared`: public contracts.
- `config/extension.json`: stable public extension key and ID. No private signing key is stored.

Requires Node.js 22+, pnpm 12, AWS CLI v2, and an AWS account for cloud sharing.

## Local development

```powershell
pnpm install
pnpm --dir apps/extension dev
pnpm --dir apps/web dev
```

On Windows with restrictive PowerShell execution policy, invoke `pnpm.cmd` instead of `pnpm`.

For local recording, open the extension, choose **Download only**, and click **Start recording**. Chrome opens the source picker automatically; approve the source/camera/microphone permissions and wait for the countdown. Keep the recorder tab open until saving finishes. Stop downloads a WebM; it does not create a share link. Retained recordings can be downloaded again or discarded.

The popup and `Alt+Shift+R` control the recorder. Chrome internal pages do not allow content overlays; use the popup or recorder page there.

## AWS deployment

The checked-in extension ID is `ldklccggileljcoeplibekemnoifhaef`. Load the built extension and confirm this ID before sign-in. CDK reads the same ID for Cognito redirects and S3 CORS.

```powershell
aws configure
pnpm --dir infra exec cdk bootstrap
pnpm --dir infra exec cdk diff
pnpm --dir infra exec cdk deploy --outputs-file outputs.json
node scripts/configure.mjs infra/outputs.json
pnpm --dir apps/web build
node scripts/publish-viewer.mjs infra/outputs.json
pnpm --dir apps/extension zip
```

CDK automatically bundles Lambda TypeScript and AWS SDK dependencies before synthesis/deployment. No Docker is needed.

**Existing stacks:** inspect `cdk diff` carefully. The original username-based Cognito sign-in configuration is preserved: do not add email-only sign-in or aliases to this existing pool, because these properties cannot be updated in place. Buckets, tables, and user pools use retention policies; existing users are not migrated automatically. Function resource IDs have also changed from the initial scaffold.

The configure script writes ignored mode-specific local environment files for the extension and web app. Public configuration values are:

```dotenv
# apps/extension/.env.production.local (also .env.development.local)
WXT_API_BASE=https://API_ID.execute-api.us-east-1.amazonaws.com/prod
WXT_COGNITO_DOMAIN=https://DOMAIN.auth.us-east-1.amazoncognito.com
WXT_COGNITO_CLIENT_ID=PUBLIC_CLIENT_ID

# apps/web/.env.production.local (also .env.development.local)
VITE_API_BASE=https://API_ID.execute-api.us-east-1.amazonaws.com/prod
```

Sign in using your existing Cognito username/password from the extension or recorder. New users choose a username and provide an email address for verification. Email can be used as the username when creating an account, but an existing account must use its original username. The authorization-code flow uses PKCE, state verification, short-lived ID tokens, refresh tokens, and revocation on sign-out. No manual JWT insertion is required.

Cloud share URLs are allocated before recording and copied on Stop. The viewer displays recording/finalization state until the final part and S3 completion finish. AI will be asynchronous in a later milestone.

## Upload and recovery

Five-second MediaRecorder events are accumulated into 5 MiB parts. At most two PUT requests run concurrently; only the final part may be smaller. Failed parts retry four times with refreshed five-minute presigned URLs. Upload progress measures acknowledged bytes, not elapsed time.

IndexedDB retains source chunks and acknowledgements until successful completion. If the network fails or the recorder closes, reopen the recorder to retry or download retained data. A closed recorder cannot resume capture, but persisted data can be uploaded. An interrupted recording may lose data since the last persisted recorder event.

Local mode keeps a recoverable copy until explicitly discarded. Use **Discard / cancel** to abort unfinished cloud uploads. S3 also aborts abandoned multipart uploads after one day; after that deadline, download retained data instead of retrying the expired upload.

Limits: 24 hours and 5 GiB per recording. Content overlays require an ordinary HTTP(S) page. Camera preview depends on extension iframe/WebRTC support on the host page. Multi-monitor/window mapping and hidden-tab canvas scheduling need real-browser acceptance testing.

## API

| Method | Path | Access |
|---|---|---|
| POST | /videos | Authenticated owner; allocate recording and upload |
| POST | /videos/:id/parts | Owner; sign a part URL |
| POST | /videos/:id/complete | Owner; verify parts and commit metadata |
| POST | /videos/:id/cancel | Owner; abort an unfinished upload |
| GET | /videos/:id | Public, unlisted metadata and playback URL |
| GET | /videos | Authenticated user's newest 50 recordings |

Completion accepts ordered `{ partNumber, etag }` parts, duration in seconds, and byte size. Completion lists uploaded parts first; it only checks the completed object when reconciling a missing multipart upload after a previous commit. This avoids the S3 403 returned for a nonexistent object when the Lambda has no ListBucket permission. Public responses omit owner IDs, S3 keys, and upload IDs.

Anyone holding a share URL can view it. S3 buckets block public access; CloudFront OAC reads them. Video IDs are opaque UUIDs, not a private-sharing authorization system.

## Checks

```powershell
pnpm --dir apps/extension compile
pnpm --dir apps/extension build
pnpm --dir apps/web build
pnpm --dir apps/web lint
pnpm --dir infra build
pnpm --dir infra test --runInBand
pnpm --dir infra exec cdk synth --quiet --no-lookups
```

Tests cover multipart byte order and boundaries, invalid input, ownership, public-field filtering, undersized S3 parts, completion retries, cancellation, and private infrastructure origins.

Before submission, complete [the acceptance checklist](docs/acceptance.md), verify deployed sharing in a signed-out browser, and record the demo. See [reasoning and tradeoffs](docs/reasoning.md).
