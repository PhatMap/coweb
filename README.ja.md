# CoWeb

CoWeb は独立した派生プロジェクトで、現在開発中です。ローカルの Codex Responses ブリッジと専用の ChatGPT ブラウザーセッションを提供します。Full Harness は MCP と OpenAI tunnel を介して現在の Codex ターンのツールを使用します。CoWeb の配布先と自動更新は未設定で、Project Chat は未実装です。

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
