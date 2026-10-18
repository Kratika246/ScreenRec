# ScreenRec extension

Chrome Manifest V3 extension built with WXT, React, and TypeScript. See the [root README](../../README.md) for cloud setup and the supported flow.

## Commands

Run from the repository root:

~~~powershell
pnpm.cmd --dir apps/extension dev
pnpm.cmd --dir apps/extension compile
pnpm.cmd --dir apps/extension build
pnpm.cmd --dir apps/extension zip
~~~

Load the production folder apps/extension/.output/chrome-mv3 through chrome://extensions > Developer mode > Load unpacked. The ZIP is generated in apps/extension/.output.

## Configuration

Run node scripts/configure.mjs infra/outputs.json after deployment. It writes ignored development/production local environment files containing WXT_API_BASE, WXT_COGNITO_DOMAIN, and WXT_COGNITO_CLIENT_ID. Rebuild after changing them.

The manifest key and ID come from config/extension.json. Preserve them so Cognito callbacks, S3 CORS, and local recovery data remain compatible.

## Runtime responsibilities

| Component | Responsibility |
| --- | --- |
| Popup | Mode/microphone selection, start/stop, library, share/retry actions |
| Persistent recorder page | Source picker, permissions, countdown, tracks, MediaRecorder, composition, persistence, uploads |
| Service worker | Messages, controls, badge, recording state |
| Content script and camera iframe | Page overlays, floating controls, camera presentation |
| Offscreen document | Clipboard copying |

Start recording opens the persistent recorder and source selection automatically. Keep that page open until saving completes. The service worker does not own MediaRecorder.

Cloud mode streams buffered multipart video parts and selected screen snapshots directly to private S3. Snapshot upload is best effort and does not fail video saving. AI provider keys are never shipped in extension code.

Download only needs no cloud account and creates a local WebM without a share link or AI processing. Alt+Shift+R opens the recorder or stops an active recording; Chrome shortcut settings may override availability.

## Recovery and limitations

IndexedDB retains recorder chunks and multipart acknowledgements until successful completion. The recorder can retry saving or download retained data. It cannot resume an interrupted capture session. Four attempts are made per video part.

The link is copied on Stop; playback still waits for the tail upload and S3 commit. Copy link is the manual fallback if automatic clipboard access is blocked.

Capture/system-audio availability depends on Chrome, the operating system, and the selected source. Page overlays require ordinary HTTP(S) pages; restricted pages use popup/recorder controls. Multi-monitor placement, background capture scheduling, and WebM seeking require the [browser acceptance checks](../../docs/acceptance.md).

Chrome is the supported target. Firefox scripts are scaffolding and do not establish compatibility with the Chrome-specific APIs used here.
