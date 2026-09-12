# CoWeb troubleshooting

- Use Bun 1.4.0 and install both lockfiles before running `bun run launcher`.
- The source launcher runs as CoWeb DEV. It uses `.coweb-dev`, not production state.
- Sign in within the selected CoWeb profile. No upstream cookies or configuration are imported.
- Use the launcher's verification steps before connecting Codex. Full Harness additionally
  needs a tunnel, a private runtime key and the exact connector name shown by the launcher.
- If another bridge owns the Codex route or port 17841, disconnect it first. CoWeb's
  separate storage does not permit simultaneous ownership of the same external route.
- Do not use an old upstream installer to repair CoWeb. Automatic updates are disabled;
  build from this source until a verified CoWeb release channel is configured.
- Diagnostics can contain prompts and filesystem paths. Redact them before sharing.

See [migration notes](docs/COWEB-MIGRATION.md), [security model](docs/security-model.md)
and [release validation](docs/release-validation.md).
