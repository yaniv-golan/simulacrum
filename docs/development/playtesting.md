# Playtests and recordings

Use `npm run build` followed by `npm run preview` for a frozen local playtest. Record the page’s build identifier and follow the versioned [assessment protocols](../../assessments/protocol/F1.md). Automated and AI reviews are not human acceptance.

For an interaction report, use **Record an issue** in the left sidebar, then Start recording, reproduce, Stop recording and Save recording. The local JSON records build, checkpoint, timed actions and command results. It is a diagnostic timeline, not qualification replay. Nothing is uploaded by this local recorder.

## Remote setup

Remote playtests can use `node scripts/playtest-server.mjs` with `PLAYTEST_PUBLIC_DIR` pointing at a frozen build, a separate private `PLAYTEST_DATA_DIR`, and a random `PLAYTEST_TOKEN` of at least 32 characters. The server binds loopback port 4180; expose it through an HTTPS tunnel and share `/join?token=...`. The invitation grants access to the workshop, not stored sessions. The player explicitly starts tab capture and can send text or microphone feedback tied to a view/state anchor. Pending uploads persist in IndexedDB and retry; keep the tab open until all are received. Tab capture requires a desktop browser supporting screen sharing; choose the workshop tab. Microphone use is optional. Server limits are 2 MB/event, 10 MB/media chunk and 1 GB/session; the browser stops capture if its offline queue reaches 100 MB. To review received evidence locally, run `node scripts/export-playtest.mjs <private-session-directory>` and open the resulting `review.html`. Remote usability recordings do not replace qualification evidence.

Remote playtests show a receipt beside each submitted comment after the server acknowledges it. Finishing stops capture and waits for the final recording uploads before confirming that the session is saved and the tab can be closed.

The remote feedback bar stays the same size while recording. Video and action uploads run automatically; routine queue counts are hidden. Upload problems remain visible, and Finish session confirms success only after all recording data is received.

The [server](../../scripts/playtest-server.mjs), [browser client](../../src/application/remote-playtest.mjs) and [exporter](../../scripts/export-playtest.mjs) own admission, upload and review behavior. Keep the data directory outside the served public directory. Do not commit invitation tokens or recordings.
