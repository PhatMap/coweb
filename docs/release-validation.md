# CoWeb release validation

Local baseline verification is not a published-release certification. No publishing
workflow is configured. Keep account-bound checks separate from automated tests.

Before distributing a release, record the version, platform, install/upgrade mode and
sanitized results for each gate:

1. `bun run verify` with pinned Bun and frozen dependencies.
2. `bun run app:package` and `bun run app:smoke` on every target desktop platform.
3. Launch CoWeb and CoWeb DEV; confirm their state stays separate from each other and upstream.
4. Sign in to ChatGPT, verify the browser, connect Codex and complete a Browser-only turn.
5. Set up the exact displayed connector and tunnel; complete a Full Harness tool turn.
6. Verify cancellation, compaction, restart/session reuse, route disconnect and restoration.
7. Verify Zero Risk/manual mode and account-available model catalog entries.
8. Configure and validate CoWeb signing and a verified release source before enabling updates.

Never record cookies, bearer tokens, tunnel keys or private prompt contents. Windows
validation cannot establish macOS/Linux support. No historical upstream validation
result is presented as CoWeb evidence.
