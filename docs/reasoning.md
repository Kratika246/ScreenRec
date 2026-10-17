# Architecture and tradeoffs

The main UX improvement is overlapping recording with upload. The share URL exists before capture starts and is copied as soon as the user stops. This is distinct from playback readiness: the last bytes and S3 multipart commit still require network time. The viewer polls through finalization without waiting for future AI processing.

A persistent recorder page owns MediaRecorder, tracks, timers, composition, IndexedDB, and upload queues. The MV3 service worker only brokers messages and updates state/badges. This survives service-worker suspension. The popup starts a persistent recorder page that immediately opens Chrome desktopCapture source selection, eliminating a second start click. Only the selected single-use stream ID is redeemed by the recorder. Keeping that page open is a visible requirement.

Screen+camera produces one canvas video track; microphone and system audio are mixed through Web Audio. Page overlays use Shadow DOM and an extension iframe receiving a local WebRTC camera stream. No camera permissions are requested from host websites. Overlay/source coordinate mapping across windows and monitors needs real-browser verification; capture scheduling in background tabs is also an acceptance gate.

S3 requires every nonfinal part to be at least 5 MiB. Five-second recorder events therefore feed a byte-preserving part buffer rather than becoming S3 parts directly. Two parallel requests bound network concurrency. IndexedDB keeps the source recording until cloud commit; this costs local disk but makes failures recoverable. In-memory queues are backed by Blob data, and retry/download currently rebuild the full persisted Blob. Very long recordings need further memory profiling.

Cognito hosted sign-in preserves the original username-based user pool and uses authorization code + PKCE, OAuth state checks, refresh, and revocation. Google federation is deferred. An ID token authenticates the REST API's Cognito authorizer. Upload handlers enforce ownership and stored upload identity. Public reads intentionally allow anyone with the opaque UUID link to view the recording; private sharing, expiry and revocation are future features.

Buckets deny public access and require TLS. CloudFront OAC grants origin access. Presigned part URLs expire after five minutes. Completion checks the actual S3 part list, minimum part sizes, ETags and total bytes. The API rejects completion above 5 GiB or 24 hours, but a presigned multipart PUT does not itself cap transmitted bytes: per-user quotas and abuse controls are future work. API Gateway throttling and incomplete-upload lifecycle cleanup limit common failure costs.

Lambda assets are bundled explicitly, including AWS SDK dependencies. Separate private buckets hold the SPA and videos. SPA routes rewrite to index.html; video paths retain normal CDN range-request behavior. API URLs are explicit rather than depending on a broken CloudFront path prefix.

The existing REST API is retained to reduce migration work. HTTP API could reduce API request cost later. Broad HTTPS extension host permissions permit configurable Cognito/API/S3 endpoints; a production release should generate a deployment-specific allowlist. AI, cloud deletion, infinite library pagination, CI and automatic user migration are deferred.

For 1,000 videos, estimate cost using recorded GB, storage retention, delivered GB per view, multipart PUT/GET counts, API/Lambda calls and DynamoDB operations. At 2.5 Mbps, ten minutes is roughly 0.19 GB before audio, so 1,000 recordings store roughly 190 GB and one full view each delivers roughly another 190 GB. Multiply these quantities by current regional AWS prices; no fixed dollar quote is claimed here. Transcribe and Bedrock costs are excluded because AI is deferred.

Before production, add account quotas, retention controls, monitoring/alarms, recovery expiration UX, robust seek metadata for WebM if browser testing requires it, automated extension end-to-end coverage, and explicit public/private sharing controls.
