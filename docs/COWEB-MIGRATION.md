# CoWeb baseline migration

CoWeb is an independent derivative; see [NOTICE](../NOTICE.md) and the unchanged
[MIT license](../LICENSE). No upstream Git history is included in the new repository.

## Identifier classification

The source was inspected before editing. These application-owned identities move together:

| Area | Previous identity | CoWeb identity and ownership |
| --- | --- | --- |
| Product / package | Codex Web GPT / codex-chatgpt-web | CoWeb / coweb; package metadata, UI, CLI and bundle scripts |
| Desktop package | codex-web-gpt-launcher | coweb-launcher; Electron package and runtime descriptor reader/writer |
| App ID | dev.codexwebgpt.launcher | dev.coweb.launcher; Electron, autostart and packaging |
| State | .codex-chatgpt-web / .codex-chatgpt-web-dev | .coweb / .coweb-dev; core config, launcher and DEV profile resolvers |
| Browser partitions | persist:codex-web-gpt[-dev]-chatgpt | persist:coweb[-dev]-chatgpt; Electron host and descriptor validation |
| Services | io.github.codex-chatgpt-web.daemon / .tunnel | dev.coweb.daemon / .tunnel; service definitions and launcher cleanup/checkpoints |
| Runtime health | codex-chatgpt-web | coweb; server, doctor, setup and launcher supervisor |
| Local artifacts | CLI bundle, pipe prefix, diagnostics, tunnel profile/alias | coweb names; in-repository producers and consumers updated together |
| Codex integration markers | Managed by codex-chatgpt-web | Managed by coweb; journal, installer and uninstaller own these markers; Codex TOML keys stay unchanged |
| Windows install GUID | d1a6026a-6210-588e-9a2b-da3936f94e02 | New CoWeb GUID shared by package, installer and DEV executable discovery |

Storage and executable-selection overrides also move to CoWeb names: `COWEB_HOME`,
`COWEB_DEV_HOME`, `COWEB_LAUNCHER_DATA_DIR`, `COWEB_LAUNCHER_EXECUTABLE`,
`COWEB_APPIMAGE`, `COWEB_BROWSER_HOST_DESCRIPTOR`, and `COWEB_CLI_LAUNCHER`.
Their producers and consumers are the CLI, profile resolver, launcher subprocesses,
bundle wrappers and installer scripts in this repository. Inherited upstream overrides
must not select upstream state. No upstream cookies, config or profile are imported.

## Compatibility identifiers intentionally retained

| Identifier | Why retained / producer and consumer | Future migration requirement |
| --- | --- | --- |
| Codex Native2, Codex Native2 DEV, Codex Zero Risk; legacy Codex Native | ChatGPT caches connector identity and MCP schemas; config/connector-identity and browser selection interact with user-created ChatGPT connectors | Create and validate distinct remote connectors; never silently rename a cached connector |
| OpenAI/Codex/ChatGPT model and provider identifiers | Codex configuration and upstream APIs select models/providers using these values | Prove compatibility against actual Codex and ChatGPT versions |
| Responses fields, SSE events, MCP tool/schema names, turn tokens, tunnel protocol, loopback API paths | Codex, MCP clients and OpenAI tunnel service consume these contracts | End-to-end protocol validation before any change |
| CODEX_HOME and Codex configuration schema | Owned by the external Codex application; production integration edits the user's selected Codex configuration | Explicit routing choice; two bridges cannot own the same Codex route concurrently |
| Remaining CODEX_CHATGPT_WEB_* and CODEX_WEB_GPT_* build/diagnostic/helper controls | Existing build tooling and helper processes consume these names; they do not choose the default CoWeb storage namespace | Coordinate callers and helper versions before renaming; inventory below |
| Internal __CODEX_WEB_GPT_* browser observer keys | Browser host injects these keys and helper/browser worker code reads them | Migrate both sides and validate real browser interaction |
| Ports 17841 and 4178 | Existing bridge and Vite contracts | Separate configured bridge ports for simultaneous operation; defaults are not changed for branding |

The retained environment controls cover Bun executable selection, embedded Bun, browser
diagnostics/helper mode, launcher control token, smoke marker, and Linux packaging tools.
They remain explicit compatibility controls, not permission to reuse upstream storage.

## Releases and repository automation

The baseline has no remote or release source. The packaged updater is disabled by default.
Installer scripts require an explicit `COWEB_RELEASE_REPOSITORY`; no release repository is
inferred and no upstream package is downloaded. A future release setup must configure a
verified owner/repository, signing and package validation before enabling updates.

The seven pre-existing `.github/` deletions are preserved. No deleted workflow is restored.
Consequently no CI/release workflow runs or publishes anything in this baseline; the
local `verify` command is the validation entry point. Tests/version checks tied to the
removed publishing workflows are adapted to this source-only baseline.

## Coexistence limits

CoWeb uses separate Electron userData, cookies, config, logs, runtime and DEV state.
The external Codex route, fixed default bridge port and ChatGPT connector names remain
shared contracts. Installation isolation does not imply simultaneous ownership of those
external resources. Disconnect an existing bridge before assigning its Codex route to CoWeb.

## Retained controls: exact inventory

- `CODEX_CHATGPT_WEB_BUN`, `CODEX_WEB_GPT_BUN`: explicit Bun executable selection.
- `CODEX_CHATGPT_WEB_EMBEDDED_BUN`: package builder's pinned embedded runtime.
- `CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTICS`: opt-in browser screenshots.
- `CODEX_CHATGPT_WEB_BROWSER_HELPER_PROCESS`: helper-process mode.
- `CODEX_WEB_GPT_LAUNCHER_CONTROL_TOKEN`: helper-to-launcher authentication.
- `CODEX_WEB_GPT_SMOKE_FILE`: test readiness marker supplied by the smoke runner.
- `CODEX_WEB_GPT_LINUX_LIBNOTIFY`, `CODEX_WEB_GPT_LINUX_LIBNOTIFY_OUTPUT`,
  `CODEX_WEB_GPT_APPIMAGE_TOOLS_OUTPUT`: Linux packaging tool inputs/outputs.
- `__CODEX_WEB_GPT_SURFACE_ID__`, `__CODEX_WEB_GPT_TURN_OBSERVER__`,
  `__CODEX_WEB_GPT_RESPONSE_OBSERVERS__`: browser-host injected observer keys.
- `window.codexWebLauncher`: existing private preload/renderer IPC surface. Its
  channels and API shapes remain compatible; it does not select filesystem state.

Upstream tutorial/marketing recordings remain on the local disk but are ignored by
Git and no longer loaded by the UI. CoWeb's own SVG/PNG/ICO monogram replaces the
previous ChatGPT app icon. Existing connector instructions remain as text.

## Validation environment

Bun must be installed in a durable directory, not a temporary extraction path: the
runtime intentionally rejects ephemeral executables. Windows symlink fixtures need
an elevated test process or an already-enabled Developer Mode. The large-context
fixture now allows 60 seconds for real tokenization; its assertions are unchanged.
