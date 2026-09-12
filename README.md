# CoWeb

Use ChatGPT Web as a Codex model bridge with local tooling and extensible chat workflows.
CoWeb provides a local Responses/SSE bridge and an Electron launcher with a private
ChatGPT browser session. Browser-only mode handles model responses; Full Harness
connects the active Codex turn's tools through MCP and an OpenAI tunnel.

## Status

An independent derivative under active development. This baseline establishes CoWeb
identity and isolated local state. Project Chat is not implemented. There is no CoWeb
release repository, automatic update source or public download configured.
The inherited source version remains 5.0.6; it does not denote a published CoWeb release.

## Architecture

```text
Codex → CoWeb local bridge → ChatGPT Web
  ↑                            ↓
  └─ active-turn tools ← MCP ← OpenAI tunnel   (Full Harness)
```

The launcher owns the browser and runtime lifecycle. Production state defaults to
`~/.coweb` plus Electron's `CoWeb` application-data directory; development state uses
`~/.coweb-dev`. See [Architecture](docs/architecture.md) and
[Identity and compatibility](docs/COWEB-MIGRATION.md).

## Development

This repository requires Bun 1.4.0. Use the exact version pinned in `package.json`;
installing with a newer Bun is not the supported verification workflow. Node.js is
also required for launcher tests and tooling (validation host: Node.js 25.9.0).
A desktop session is needed for Electron. Authenticated model requests additionally
require ChatGPT access; production routing requires Codex, and Full Harness requires
an OpenAI tunnel and its runtime key.

Install both lockfiles and launch the current source in an isolated DEV profile:

```bash
bun install --frozen-lockfile
bun install --cwd launcher --frozen-lockfile
bun run launcher
```

```bash
bun run typecheck
bun run launcher:test
bun run verify
```

`verify` checks version pins, dependency audits, both typechecks and test suites,
renderer build, runtime bundling, dependency notices and a local runtime smoke test.
No separate lint script is defined. Live ChatGPT/MCP tests need your own account and
are separate from the local baseline checks. See [Release validation](docs/release-validation.md).

The existing package entry point is `bun run app:package`; Windows, macOS and Linux
release verification are separate gates. Packaging output belongs in ignored directories.
The existing installed-launcher DEV commands are described in [DEV harness](docs/dev-chat.md).

## Security

The Responses bridge and launcher control listeners bind to loopback; the local bridge
is not an offline model. ChatGPT/OpenAI still processes model requests, and Full Harness
uses an external tunnel. Full Harness can request tools, including file writes and
commands, through the active Codex turn: review sandbox and approval settings first.

Never commit credentials, cookies, browser profiles, tunnel keys, environment secrets
or generated diagnostics. Do not point CoWeb storage overrides at another application's
profile. See [Security model](docs/security-model.md).

## License

CoWeb includes MIT-licensed upstream code. See [LICENSE](LICENSE), [NOTICE](NOTICE.md)
and retained [third-party licenses](LICENSES/).
