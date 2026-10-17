# ScreenRec infrastructure

Run pnpm from the workspace root. This package owns CDK, Lambda dependencies, and API/infrastructure tests.

- `pnpm --dir infra build`: type-check and bundle Lambda into dist/lambda.
- `pnpm --dir infra test --runInBand`: run API, multipart, upload, and CDK tests.
- `pnpm --dir infra exec cdk synth --quiet --no-lookups`: bundle and synthesize.
- `pnpm --dir infra exec cdk diff`: review changes before deployment.
- `pnpm --dir infra exec cdk deploy --outputs-file outputs.json`: deploy.

The stable extension ID comes from config/extension.json; override CDK with `-c extensionId=...` only when using a matching manifest public key.

After deployment, run `node scripts/configure.mjs infra/outputs.json` from the root, build the viewer, and run `node scripts/publish-viewer.mjs infra/outputs.json`.

See the root README for retained-resource migration considerations and the full setup.
