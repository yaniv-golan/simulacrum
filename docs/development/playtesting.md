# Playtests and recordings

<!-- doc-review {"version":1,"fingerprint":"bcb55bf2112a4bfd0d83cccc9504e0a709ba17ad86e60b1e19dfbf1ed6da5698","dependencies":"docs/development/.reviews/playtesting/playtests-and-recordings.json","dependencyDigest":"ebde42b806d97dfec406edcce59871d97d88840ee054a028881926d2d4d0059a","disposition":"still accurate","rationale":"Formatting adds heading spacing only. The local issue recorder and designated-player protocol are unchanged; automated checks still do not provide human acceptance."} -->

Use `npm run build` followed by `npm run preview` for a frozen local playtest. Record the page’s build identifier and follow the versioned [assessment protocols](../../assessments/protocol/F1.md). Automated and AI reviews are not human acceptance.

For an interaction report, use **Record an issue** in the left sidebar, then Start recording, reproduce, Stop recording and Save recording. The local JSON records build, checkpoint, timed actions and command results. It is a diagnostic timeline, not qualification replay. Nothing is uploaded by this local recorder.

## Remote setup

<!-- doc-review {"version":1,"fingerprint":"44b224da768fcec7d95b68ce7eba6cb0f1042b8a49d71d53873666afdeee9244","dependencies":"docs/development/.reviews/playtesting/remote-setup.json","dependencyDigest":"31b27469ccd6c6eb1f5301d3e1a1119b5822ab35f1e0e551088478b743b7138f","disposition":"updated","rationale":"Server, capture client and exporter are unchanged. Their implementation-scoped links bind admission and recording algorithms while served build and submitted session contents require their own identities."} -->

Remote playtests can use `node scripts/playtest-server.mjs` with `PLAYTEST_PUBLIC_DIR` pointing at a frozen build, a separate private `PLAYTEST_DATA_DIR`, and a random `PLAYTEST_TOKEN` of at least 32 characters. The server binds loopback port 4180; expose it through an HTTPS tunnel and share `/join?token=...`. The invitation grants access to the workshop, not stored sessions. The player explicitly starts tab capture and can send text or microphone feedback tied to a view/state anchor. Pending uploads persist in IndexedDB and retry; keep the tab open until all are received. Tab capture requires a desktop browser supporting screen sharing; choose the workshop tab. Microphone use is optional. Server limits are 2 MB/event, 10 MB/media chunk and 1 GB/session; the browser stops capture if its offline queue reaches 100 MB. To review received evidence locally, run `node scripts/export-playtest.mjs <private-session-directory>` and open the resulting `review.html`. Remote usability recordings do not replace qualification evidence.

Remote playtests show a receipt beside each submitted comment after the server acknowledges it. Finishing stops capture and waits for the final recording uploads before confirming that the session is saved and the tab can be closed.

The remote feedback bar stays the same size while recording. Video and action uploads run automatically; routine queue counts are hidden. Upload problems remain visible, and Finish session confirms success only after all recording data is received.

The [server](../../scripts/playtest-server.mjs#implementation), [browser client](../../src/application/remote-playtest.mjs#implementation) and [exporter](../../scripts/export-playtest.mjs#implementation) own admission, upload and review behavior. Keep the data directory outside the served public directory. Do not commit invitation tokens or recordings.

These implementation links cover admission, capture and export code plus declared dependencies. They do not assert the contents of a served workshop build or a player’s uploaded recording; identify those separately for each playtest.
