# Acceptance and demo checklist

## Verification record

| Evidence | Status |
| --- | --- |
| Owner's deployed Groq + Nova flow | Confirmed working on 18 October 2026 |
| Groq transcript artifact in deployed viewer | Observed before the notes-stage fix |
| Nova configuration/IAM and AI regression checks | Passed locally during implementation |
| Extension packaging, viewer build/lint, Lambda build, CDK synthesis | Exercised locally during implementation |
| Full browser, failure-mode, and quality matrix below | Not individually certified |

Unchecked items are deliberate validation tasks. The owner's general success confirmation does not mark every scenario as tested.

## Fast demo

- [ ] Load the current production extension and confirm its stable ID.
- [ ] Record 20-30 seconds of a narrated screen walkthrough, keeping the whole video below 25 MB.
- [ ] Stop and open the copied link in a signed-out browser.
- [ ] Show playback independently of AI processing, then title, summary, chapters, and transcript.
- [ ] Search the transcript and select a timestamp/chapter to seek.
- [ ] Show a silent screen recording with visual notes and no speech transcript.
- [ ] If demonstrating issue detection, hold a clear error on screen for at least ten seconds and verify any reported evidence.
- [ ] Explain that the video is sampled for AI, while the full recording remains playable.

## Capture and controls

- [ ] Test screen, window, browser tab, camera only, and screen + camera.
- [ ] Confirm microphone audio and supported shared-source audio are audible.
- [ ] Cancel the source picker; deny microphone/camera permissions; verify actionable errors and released tracks.
- [ ] Confirm capture begins after permission approval and countdown.
- [ ] Move/resize the bubble; verify a single correctly positioned camera image in saved playback.
- [ ] Test browser chrome, different windows, multi-monitor layouts, and background tabs.
- [ ] Navigate normal sites and verify popup/recorder fallback on restricted Chrome pages.
- [ ] Test pause/resume and compare saved duration with pause time excluded.
- [ ] Stop from recorder, popup, toolbar, shortcut, and native Stop sharing; test duplicate Stop.
- [ ] Verify badge/timer after popup reopening and service-worker suspension.

## Upload, clipboard, and recovery

- [ ] Test less than 5 MiB, exactly 5 MiB, and multiple multipart parts.
- [ ] Open the share link immediately after Stop; verify automatic transition from saving to playback.
- [ ] Measure Stop-to-copy separately from Stop-to-playable; use under one second as a clipboard target, not a playback promise.
- [ ] Stop while unfocused and verify the clipboard; test manual Copy link fallback.
- [ ] Throttle/disconnect/reconnect, retry failed saving, and download retained data.
- [ ] Close the recorder during capture, reopen it, and recover persisted data; confirm camera tracks stop.
- [ ] Verify expired/canceled uploads give a download/recovery action.
- [ ] Cancel an unfinished upload and confirm its viewer state.
- [ ] Confirm completion recovery when S3 committed but the metadata update failed.

## Viewer and sharing

- [ ] Play, seek, refresh /v/:id directly, and recover from temporary playback/network errors.
- [ ] Verify AI metadata refresh leaves the player mounted and playback usable.
- [ ] Copy the share URL and open it without sign-in.
- [ ] Confirm the sharing explanation accurately says anyone with the link can view video and notes.
- [ ] Test narrow/mobile viewer layouts and keyboard focus on transcript/chapter/issue controls.

## AI behavior

- [ ] Narrated screen recording produces accurate combined-source notes and timed transcript.
- [ ] Silent shared-screen recording produces visual notes when snapshots contain useful evidence.
- [ ] Camera-only silence has an empty-input explanation and normal playback.
- [ ] Ordinary UI does not produce speculative bugs; validate every reported issue against the recording.
- [ ] Copy bug-report text and check timestamp/evidence/link formatting.
- [ ] Confirm snapshot-upload failures do not fail video saving and source labels reflect available evidence.
- [ ] Test missing/invalid Groq key, quota exhaustion, and video larger than 25 MB.
- [ ] Verify speech failure falls back to available snapshots with a missing-transcript explanation.
- [ ] Verify failed summary preserves playback/transcript and Retry AI reuses saved inputs.
- [ ] Verify Retry transcription after correcting a partial-result failure.
- [ ] Generate notes for an older recording; do not expect snapshots that were never captured.
- [ ] Test excerpt labeling for a long transcript and seeking/search within the supported payload.
- [ ] Validate silence handling; a plausible short phrase alone does not prove accurate capture.

## Authentication and access

- [ ] Sign up, verify email, sign in with username/password, refresh an expired session, and sign out.
- [ ] Ensure owner operations reject missing authentication and another user's recording.
- [ ] Confirm direct S3 access is denied while CloudFront video playback works.
- [ ] Confirm public responses exclude ownership/upload/internal job identifiers.
- [ ] Verify snapshot slots and size/timestamp limits; raw snapshots have no public route.
- [ ] Confirm Groq key is present only in server-side SSM, never public configuration or ZIP.
- [ ] Deploy without replacing the original Cognito pool or changing the extension key.

## Operations and submission

- [ ] Inspect AiStart/AiResults logs and the dead-letter queue; verify exhausted failures have a recovery path.
- [ ] Verify snapshot/raw-output expiry and incomplete multipart cleanup.
- [ ] Confirm current outputs and public app environment match the deployed stack.
- [ ] Run the checks in the root README; build and inspect the extension ZIP.
- [ ] Review the architecture, incident history, cost assumptions, and documented limitations.
- [ ] Record the submission demo with ScreenRec and verify the final shared link.
