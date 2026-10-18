# ScreenRec infrastructure

AWS CDK stack, Node.js 22 Lambda handlers, and automated tests. Run commands from the repository root. Full setup is in the [root README](../README.md).

## Working defaults

| Setting | Value |
| --- | --- |
| Stack | ScreenRecStack |
| Region fallback | us-east-1 |
| Speech provider | groq |
| Speech model | whisper-large-v3-turbo |
| Notes model | us.amazon.nova-lite-v1:0 |
| Groq credential | SSM Standard SecureString /screenrec/groq-api-key |
| Owner authentication | Cognito authorizer on API Gateway REST API |

AWS credentials determine the actual deployment account/region. Existing deployments must keep using the same target.

## Commands

~~~powershell
pnpm.cmd --dir infra build
pnpm.cmd --dir infra test --runInBand
pnpm.cmd --dir infra exec cdk synth --quiet --no-lookups
pnpm.cmd --dir infra exec cdk diff ScreenRecStack
pnpm.cmd --dir infra exec cdk deploy ScreenRecStack --outputs-file outputs.json
~~~

CDK's app wrapper bundles Lambda assets before synthesis/deployment. Outputs are written under infra when using these commands. Then configure and publish the apps:

~~~powershell
node scripts/configure.mjs infra/outputs.json
pnpm.cmd --dir apps/web build
node scripts/publish-viewer.mjs infra/outputs.json
pnpm.cmd --dir apps/extension zip
~~~

## Resources and processing

The stack provisions private video, viewer, and AI-artifact buckets; DynamoDB; Cognito; a REST API; CloudFront with OAC; API and AI Lambdas; and a processing dead-letter queue.

S3 multipart completion invokes AiStart. With Groq, AiResults reads the SSM key, creates a five-minute private video URL, requests timestamped speech, persists the transcript, and calls Nova Lite with available screen snapshots. Captures with no audio track skip speech; silent audio tracks still pass through speech recognition. Provider errors preserve playback and can fall back to visual notes.

Snapshot/raw transcript artifacts expire after 30 days. Incomplete multipart uploads abort after one day. Processed transcripts and committed videos have no automatic expiry. Retained-resource policies protect data on stack deletion; retained resources may continue to incur charges.

The optional Transcribe role and EventBridge rule remain provisioned for the AWS speech path, but the Groq default does not invoke Transcribe.

## Context overrides

| Context | Default | Use |
| --- | --- | --- |
| transcriptionProvider | groq | groq or transcribe |
| bedrockModelId | us.amazon.nova-lite-v1:0 | Image-capable model/profile ID, not ARN |
| groqApiKeyParameter | /screenrec/groq-api-key | Absolute SSM parameter name |
| extensionId | config/extension.json | Only with a matching manifest key |
| allowModelSubscription | false | Optional one-time Claude activation |
| marketplaceProductId | Haiku 4.5 ID when selected | Exact product for a custom Marketplace model |

Nova uses no Marketplace subscription permissions. To explicitly retain the confirmed setup:

~~~powershell
pnpm.cmd --dir infra exec cdk deploy ScreenRecStack -c transcriptionProvider=groq -c bedrockModelId=us.amazon.nova-lite-v1:0 -c allowModelSubscription=false --outputs-file outputs.json
~~~

CLI context overrides should be supplied consistently on later deploys; they do not replace the code defaults.

## Optional legacy providers

Use transcriptionProvider=transcribe only after AWS enables Transcribe for the account. The integration uses attempt-scoped job names and terminal EventBridge events.

Claude is optional and still requires its account, first-use, billing, and Marketplace prerequisites. For Haiku 4.5 activation:

~~~powershell
pnpm.cmd --dir infra exec cdk diff ScreenRecStack -c bedrockModelId=us.anthropic.claude-haiku-4-5-20251001-v1:0 -c allowModelSubscription=true
pnpm.cmd --dir infra exec cdk deploy ScreenRecStack -c bedrockModelId=us.anthropic.claude-haiku-4-5-20251001-v1:0 -c allowModelSubscription=true --outputs-file outputs.json
~~~

This grants ViewSubscriptions and Subscribe; Subscribe is restricted to product prod-xdkflymybwmvi. Once activated, keep the explicit Claude model ID but set allowModelSubscription=false to remove activation privileges. A normal deployment without a model override selects Nova again.

Do not change the existing Cognito pool's UsernameAttributes or aliases in place. Do not rotate the stable extension key during routine updates.

See [incidents](../docs/known-issues.md), [operations/API reference](../docs/troubleshooting.md), and [architecture](../docs/reasoning.md).
