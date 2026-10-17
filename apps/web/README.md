# ScreenRec viewer

Set VITE_API_BASE to the deployed REST API base URL. The root configure script writes mode-specific local environment files from CDK outputs.

`pnpm --dir apps/web dev` starts local development.
`pnpm --dir apps/web build` type-checks and produces dist.
`pnpm --dir apps/web lint` runs ESLint.

Route /v/:id reads public recording metadata without sign-in, waits through upload finalization, and then shows playback. CloudFront rewrites viewer routes to index.html. See the root README for deployment and acceptance checks.
