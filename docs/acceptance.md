# Core acceptance checklist

Automated checks do not replace a loaded-extension test.

- [ ] Load production extension, confirm ID matches config/extension.json.
- [ ] Sign up, verify email, sign in, refresh an expired session, sign out.
- [ ] Record screen, browser tab, application window, camera only, and screen+camera.
- [ ] Confirm microphone and available system audio are both audible.
- [ ] Cancel source selection; deny camera/mic; confirm an actionable error and released tracks.
- [ ] Capture starts after the countdown, not before permission approval.
- [ ] Drag and resize the camera bubble. Confirm exactly one correctly positioned camera image in the saved video, including browser chrome and multiple monitors.
- [ ] Navigate between sites; verify controls on normal pages and popup fallback on restricted pages.
- [ ] Pause/resume; native Stop sharing; duplicate Stop; stop from keyboard, popup, recorder, and toolbar.
- [ ] Confirm badge and timer after service-worker suspension and reopening the popup.
- [ ] Record less than 5 MiB, exactly 5 MiB, and multiple upload parts.
- [ ] Throttle network, disconnect, reconnect, retry upload, and download retained data.
- [ ] Close recorder during capture, reopen, recover persisted data. Confirm old camera tracks no longer run.
- [ ] Stop while the recorder is unfocused; verify clipboard actually contains the shared URL.
- [ ] Open the link immediately in a signed-out browser; finalization transitions automatically to playback.
- [ ] Play, seek, refresh the viewer route, and recover from temporary playback/network errors.
- [ ] Compare source duration and saved duration with pause time excluded.
- [ ] Measure Stop-to-copy (target <1s normally) separately from Stop-to-playable.
- [ ] Confirm foreign users cannot sign parts, complete, cancel, or list another owner's recordings.
- [ ] Confirm direct S3 access is denied while CloudFront playback works.
- [ ] Cancel unfinished upload and verify failed viewer state.
- [ ] Inspect production environment configuration, zip extension, record demo, and update README verification status.

Deployment is currently blocked by missing AWS CLI credentials. Native capture and clipboard checks require an interactive Chrome session.
