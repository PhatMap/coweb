# CoWeb

CoWeb 是独立维护的衍生项目，目前处于开发阶段。它提供本地 Codex Responses 桥接和独立的 ChatGPT 浏览器会话。Full Harness 通过 MCP 与 OpenAI tunnel 使用当前 Codex 回合的工具。尚未提供 CoWeb 下载或自动更新，也未实现 Project Chat。

Bun 1.4.0 / Node.js 25.9.0

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

Codex → CoWeb local bridge → ChatGPT Web

ChatGPT/OpenAI processes model requests. Full Harness can execute local tools. Never commit cookies, credentials or diagnostics.

- [Architecture](docs/architecture.md)
- [Identity and compatibility](docs/COWEB-MIGRATION.md)
- [Release validation](docs/release-validation.md)
- [DEV harness](docs/dev-chat.md)
- [Security model](docs/security-model.md)
- [LICENSE](LICENSE)
- [NOTICE](NOTICE.md)
- [third-party licenses](LICENSES/)
