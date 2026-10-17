# ScreenRec extension

See the root README for configuration and deployment.

`pnpm --dir apps/extension dev` starts WXT development.
`pnpm --dir apps/extension compile` checks TypeScript.
`pnpm --dir apps/extension build` creates .output/chrome-mv3.
`pnpm --dir apps/extension zip` packages the extension.

Start recording in the popup opens Chrome source selection automatically from a persistent recorder page. Capture permissions and countdown happen there. Keep it open until finalization finishes. Select Download only to work without AWS; local recordings produce downloads, never share links.

The service worker brokers controls and state. It never owns MediaRecorder. The offscreen document handles clipboard copying only.
