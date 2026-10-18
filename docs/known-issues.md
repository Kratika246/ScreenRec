# Deployment incidents and current status

**Current outcome, 18 October 2026:** the owner deployed Groq Whisper + Amazon Nova Lite and confirmed the flow works. The two original AWS access blockers below are bypassed by provider selection; they were not confirmed resolved for Transcribe or Claude.

| Stage | Observed failure | Current decision |
| --- | --- | --- |
| Speech | Transcribe SubscriptionRequiredException | Default to Groq Whisper |
| Notes | Claude Marketplace AccessDeniedException | Default to Amazon Nova Lite |
| Upload finalization | Missing-object HEAD could return 403 | List multipart parts first |

These records preserve the real failure evidence and explain the changes. Routine recovery steps are in [troubleshooting](troubleshooting.md).

## 1. Amazon Transcribe account activation

| Field | Observed value |
| --- | --- |
| Time | 2026-10-18 02:14:35.150 UTC |
| Region | us-east-1 |
| Function | ScreenRecStack-AiStart74D0AD1F-FEwnJ5ZGQaup |
| Stage | start-transcription |
| HTTP status | 400 |
| Transcribe request ID | e8f55402-38dd-4abf-93d2-f5fb77062211 |
| Lambda request ID | 6da97e14-740c-4228-a839-9193b9363ea8 |

> SubscriptionRequiredException: The AWS Access Key Id needs a subscription for the service

The viewer initially showed only: "Transcription could not start. Retry AI from My recordings."

The request reached Transcribe, but AWS rejected service access before a job could start. Bedrock playground access did not establish access to this separate service. Repeating the request or changing the recording codec could not resolve account activation.

The proposed AWS support request was **"Unblock/Activate Amazon Transcribe machine learning APIs for this account"**. Support turnaround and eventual Transcribe activation were not verified. Waiting for account activation did not fit the submission deadline.

### Mitigation

Groq whisper-large-v3-turbo became the default speech provider. AiResults obtains its key from an SSM SecureString and sends Groq a five-minute private S3 URL for the video. Timestamped Whisper segments map to the existing transcript contract.

The adapter enforces a 25 MB limit for the whole video and handles quota/key failures. When snapshots exist, speech failure can produce clearly labeled visual-only notes and an owner transcription retry.

Transcribe remains optional via transcriptionProvider=transcribe. To return to it, the account owner must resolve service access with AWS and run a real transcription test. See [AWS service activation guidance](https://repost.aws/knowledge-center/error-access-service).

## 2. Claude Marketplace activation

After Groq deployment, the viewer showed "Transcript ready / summary unavailable" and a timestamped English transcript containing "Thank you." The presence of this artifact confirmed a completed transcript path, not speech accuracy. A separate worker log identified the notes-stage blocker.

| Field | Observed value |
| --- | --- |
| Time | 2026-10-18 03:03:40.207 UTC |
| Region | us-east-1 |
| Function/stage | AiResults / summarize |
| HTTP status | 403 |
| Exception | AccessDeniedException |
| Bedrock request ID | 691eb71c-9ab9-4417-97de-f713bc9ffa66 |
| Lambda request ID | 7d685f72-677e-40eb-8b1f-f3b22e999f4a |

> Model access is denied due to IAM user or service role is not authorized to perform the required AWS Marketplace actions (aws-marketplace:ViewSubscriptions, aws-marketplace:Subscribe) to enable access to this model.

The runtime role had bedrock:InvokeModel permissions, but Claude's Marketplace activation was not complete. An earlier playground test was not sufficient evidence of durable account access: AWS documents that initial invocations can temporarily succeed while subscription setup is still being finalized.

An opt-in CDK activation path was prepared. It grants ViewSubscriptions and Subscribe, restricting Subscribe to Claude Haiku 4.5 product prod-xdkflymybwmvi. This was not confirmed to complete account activation; the owner continued to see the activation warning. Anthropic first-use, Marketplace billing, and organization controls remain external prerequisites.

### Working mitigation

The default multimodal model changed to **us.amazon.nova-lite-v1:0**. Nova Lite accepts images and text through the same Converse API, while Amazon models do not require Marketplace subscriptions.

The owner deployed with Nova selected and allowModelSubscription=false, retried AI using the saved transcript and snapshots, and reported success. Default IAM scopes invocation to Nova's inference profile and backing foundation model and grants no Marketplace subscription actions.

Nova inference is still metered. This change bypasses the observed Marketplace prerequisite; it does not imply all models or all accounts have unrestricted access.

Sources: [AWS model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html), [Nova Lite](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html), [Haiku 4.5 product ID](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html).

## 3. Cognito update incompatibility

An update attempted to change UsernameAttributes on the already-deployed user pool. CloudFormation reported:

> Invalid request provided: Updates are not allowed for property - UsernameAttributes.

The stack now preserves the original username-based pool and its logical identity. Routine deployments must not switch immutable username/alias configuration in place. Google federation is deferred.

## 4. Upload finalization at 99%

The prior completion implementation used HEAD before the multipart object existed. S3 can return 403 for a missing object when the caller lacks ListBucket, so treating only 404 as "not yet created" caused saving to fail.

Completion now validates the upload through ListParts first. HEAD is used to reconcile a previously committed object after NoSuchUpload or an ambiguous completion response. Regression coverage checks the missing-object 403 and metadata-recovery cases.

## Verification boundaries

The request IDs and exceptions above came from deployed logs supplied by the owner. Local automated tests exercise providers with mocks and verify infrastructure templates, packaging, and contracts. The owner's latest confirmation establishes a working deployed flow, not exhaustive browser or AI-quality coverage.

Remaining limitations include Groq's file/quota limits, snapshot gaps and 30-day expiry, no historical frame extraction, public-by-link sharing, and unverified multi-monitor/background-tab edge cases. Track those in [acceptance](acceptance.md), not as claims of completed testing.
