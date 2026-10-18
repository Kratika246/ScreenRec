# ScreenRec viewer

Vite + React SPA for shareable recordings and AI notes. The [root README](../../README.md) covers deployment and provider setup.

## Develop and publish

Run from the repository root:

~~~powershell
node scripts/configure.mjs infra/outputs.json
pnpm.cmd --dir apps/web dev
~~~

The configure script writes VITE_API_BASE to ignored development/production local environment files. It must point to the deployed REST API base URL. There is no local backend emulator.

~~~powershell
pnpm.cmd --dir apps/web lint
pnpm.cmd --dir apps/web build
node scripts/publish-viewer.mjs infra/outputs.json
~~~

The build output is apps/web/dist. Publishing syncs hashed assets, uploads index.html without cache, and requests invalidation of viewer routes.

## Behavior

The public /v/:id route polls recording metadata through upload finalization and AI processing. Once ready, the video plays independently of AI status. Metadata refresh does not remount the player.

The viewer displays the generated title, summary, source labels, clickable chapters, observed issues, and a copyable bug-report draft. Transcripts load separately, support search, and offer click-to-seek timestamps.

A summary failure preserves the transcript. Visual-only fallback explains that speech is unavailable. Owner retries happen in the extension; Refresh AI notes resumes polling on a failed viewer.

## Delivery and access

CloudFront rewrites / and /v/:id to index.html. Video paths use a separate private S3 origin with OAC; they retain normal video/range-request behavior.

Anyone with a recording link can view its video and notes without signing in. This is unlisted sharing. The landing page is presentational; the extension is distributed as ZIP/unpacked and is not listed in the Chrome Web Store.

For endpoint details and operational recovery, see [troubleshooting](../../docs/troubleshooting.md). Validate browser playback and seeking with [acceptance](../../docs/acceptance.md).
