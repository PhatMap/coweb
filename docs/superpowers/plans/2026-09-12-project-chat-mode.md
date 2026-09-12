# Project Chat Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independently testable Project Chat execution surface while preserving Temporary Chat, the canonical Codex task/thread, and existing Responses/SSE/MCP/tunnel/cancellation contracts. The user configures only a Project name; provider identity is discovered and verified in the authenticated browser.

**Architecture:** Add a `ChatSurfaceStrategy` boundary between `ChatGptWebAdapter`/turn execution and browser selectors. `TemporaryChatStrategy` owns the existing Temporary Chat flow without observable changes; `ProjectChatStrategy` owns verified project/conversation selection and the CoWeb registry. The registry stores recovery metadata only, and becomes authoritative only after configured project identity, exact conversation identity, project membership, composer/session readiness, and task ownership all succeed.

**Tech Stack:** TypeScript, Bun 1.4.0, `bun:test`, existing Playwright browser worker and Electron launcher, atomic CoWeb config/state file helpers, Responses/SSE bridge, `TurnBroker`, MCP, OpenAI tunnel.

**Spec:** `docs/superpowers/specs/2026-09-12-project-chat-mode-design.md`

## Global Constraints

- Existing configurations with no `chatMode` continue to mean `temporary`.
- Codex task/thread remains the canonical source of truth; ChatGPT conversations are execution surfaces and recovery metadata.
- Do not use URL, title, or configured name alone as project/conversation ownership proof.
- Project name is a discovery key only. Require one unique candidate, fail closed on duplicate names, and never choose the first or most recent project.
- Persist resolved project identity separately from config: configured name, optional provider ID, canonical URL, verification time, and a new epoch.
- Conversation records bind to the resolved project identity and epoch; same-name replacement never reuses an old epoch.
- Do not persist a partially provisioned Project conversation as an `active` durable registry record.
- A durable `active` binding requires, in order: configured project identity verified; exact normal conversation identity verified; conversation membership in the requested project verified; composer/session readiness verified; task ownership check passed.
- Any unverified provisioning attempt is transient. If bounded recovery metadata is needed, use a separate pending/submission journal with explicit state and no secret payload.
- Preserve the existing Responses fields, SSE events, MCP protocol, connector names, tunnel protocol, loopback paths, cancellation, completion fences, and compaction contracts.
- Temporary mode must remain behaviorally unchanged and its existing tests must stay green.
- Registry files contain no cookies, storage state, tokens, tunnel keys, prompts, tool results, authorization headers, or credentials.
- Manual deletion of the whole ChatGPT Project is the initial bulk-cleanup workflow. Managed per-chat archive/delete is optional future work and never a prerequisite for Project mode.
- No timer is a correctness mechanism for rollover or recovery.
- Do not invent selectors, project IDs, undocumented APIs, or provider behavior. Mark them `Unknown — requires authenticated browser verification`.
- Use the repository-pinned Bun version, frozen lockfiles, native `git`, and the existing GitHub remote. Do not use GitKraken.

## Repository Map and Ownership

The implementation worker must inspect the current symbols before editing because the local worktree may contain unrelated changes.

- `src/config.ts`: versioned `AppConfig`, defaults, parsing, migration, config path helpers, restrictive atomic config writes.
- `src/adapters/chatgpt-web/index.ts`: provider setup, strategy construction, retained-session selection, compaction handoff, broker integration.
- `src/adapters/chatgpt-web/browser-worker.ts`: browser selectors and physical project/conversation evidence; it must not own registry transitions.
- `src/adapters/chatgpt-web/turn-execution.ts`: process-local task/turn ownership, logical conversation heads, retry identity, compaction and retirement.
- `src/adapters/chatgpt-web/turn-broker.ts` and `src/adapters/chatgpt-web/mcp-server.ts`: MCP binding, activity leases, completion fences, revocation and compaction control; reuse them.
- `src/launcher-browser-host.ts` and `launcher/electron/browser-host.cjs`: launcher surface contract, CDP/Electron lifecycle, retained surface selection and physical settlement.
- `src/responses/state.ts`: existing `previous_response_id` continuation state; do not replace it with the registry.
- Existing tests under `tests/` and `launcher/tests/`: preserve current fixtures and add focused tests beside their owners.

Expected new modules are deliberately small and may be placed as follows after symbol inspection:

- `src/chat-surface-strategy.ts`: shared `ChatSurfaceStrategy`, `ChatSurfaceBinding`, mode and capability types.
- `src/temporary-chat-strategy.ts`: adapter around the existing Temporary Chat preparation/retention behavior.
- `src/project-chat-strategy.ts`: project provisioning, verified binding, bounded reconciliation and rollover orchestration.
- `src/project-conversation-registry.ts`: pure durable registry and transition validation, disconnected from browser selectors.
- `src/project-identity-state.ts`: CoWeb-owned resolved Project identity and epoch persistence, separate from user config and conversation records.
- `src/project-capability.ts`: provider evidence types and pure tri-state capability aggregation, with browser adapters kept elsewhere.

If current conventions place these responsibilities in an existing module, retain the same boundaries and record the chosen paths in the implementation PR. Do not grow `browser-worker.ts` into a registry or state machine.

---

### Phase 1: Config contract

**Dependency:** None. **Browser/account access:** No.

**Files:**

- Modify: `src/config.ts` (`AppConfig`, `defaultConfig`, `parseConfig`, migration/normalization helpers).
- Test: `tests/runtime-layout.test.ts` for `defaultConfig`, `parseConfig`, `loadConfig` and existing config migration coverage.
- Test: `tests/setup-lifecycle.test.ts` for setup serialization only where it exercises the shared config parser.
- Do not modify browser selectors or adapter behavior in this phase.

**Interfaces and invariants:**

```ts
type ChatMode = "temporary" | "project";

type ProjectChatConfig = {
  name: string;
};

type AppConfig = ExistingAppConfig & {
  chatMode: ChatMode;
  projectChat?: ProjectChatConfig;
};
```

The parsed runtime config must always expose `chatMode`; absent input maps to `temporary`. `temporary` must remove or ignore Project settings at the same normalization boundary used by existing config migrations. `project` requires only a non-empty, trimmed `projectChat.name`; it must not require a provider URL or provider ID. Validate the name using the smallest generic constraints supported by current config conventions. Provider URL/ID resolution belongs to the authenticated browser identity-probe phase. Document provider-specific identity details as `Unknown — requires authenticated browser verification`.

- [ ] Write failing tests for absent `chatMode` defaulting to `temporary`, explicit temporary config, valid configured Project name, empty/whitespace/invalid name, and legacy config round-trip.
- [ ] Run the focused config tests and confirm failures are caused by the missing contract, not fixture setup.
- [ ] Implement the smallest parser/default/migration change in `src/config.ts`; do not navigate a browser or choose a conversation.
- [ ] Run focused config/setup tests, `bun run typecheck`, and the existing Temporary-related tests.
- [ ] Confirm serialized config contains no browser identity or secret fields introduced by this phase.
- [ ] Commit only if execution workflow requires phase commits: `feat: add Project Chat config contract`.

**Rollback/failure boundary:** If config migration fails, reject the new config and retain the prior config file through the existing atomic write path. No browser operation is allowed to start from a partially parsed Project config. Rollback is deleting only this phase's config changes while retaining tests; unrelated local edits stay untouched.

**Validation command:** `bun test tests/runtime-layout.test.ts tests/setup-lifecycle.test.ts`; `bun run typecheck`.

---

### Phase 2: Pure durable registry

**Dependency:** Phase 1 types and CoWeb config home. **Browser/account access:** No.

**Files:**

- Create: `src/project-conversation-registry.ts`.
- Create: `src/project-identity-state.ts` for the verified resolved Project identity/epoch state.
- Modify: `src/config.ts` only if it needs an exported CoWeb state-path helper; use existing atomic/private-file helpers rather than a second persistence mechanism.
- Test: `tests/project-conversation-registry.test.ts`.
- Test: existing atomic-file/config tests only when sharing helpers.

**Interfaces and invariants:**

```ts
type ManagedConversationState = "active" | "completed" | "archived";

type ResolvedProjectIdentity = {
  configuredName: string;
  projectId?: string;
  projectUrl: string;
  verifiedAt: string;
  epoch: string;
};

type VerifiedConversationBinding = {
  taskId: string;
  conversationId: string;
  conversationUrl: string;
  configuredProjectName: string;
  projectEpoch: string;
  projectUrl: string;
  projectId?: string;
  surfaceKey: string;
  verifiedProjectId?: string;
  verifiedConversationId: string;
};

type ManagedConversation = VerifiedConversationBinding & {
  createdAt: string;
  lastUsedAt: string;
  state: ManagedConversationState;
  ownershipProof: { createdByCoweb: true; verifiedConversationId: string; verifiedProjectId?: string };
};

type ProjectConversationRegistry = {
  read(): RegistrySnapshot;
  findActive(taskId: string, projectIdentity: ResolvedProjectIdentity): ManagedConversation | undefined;
  activate(binding: VerifiedConversationBinding): ManagedConversation;
  complete(taskId: string, conversationId: string): ManagedConversation;
  archive(taskId: string, conversationId: string): ManagedConversation;
};
```

Add a registry schema version and monotonic revision. Persist a separate resolved-project identity with configured name, optional provider ID, canonical project URL, `verifiedAt`, and epoch. `activate` accepts only a fully verified binding for the current resolved identity/epoch; it must not accept a URL/title/name-only candidate, a missing conversation ID, a missing project proof, or an unverified pending attempt. Task ID and resolved project identity/epoch must match for lookup. If the provider project disappears or is replaced, mark the old identity/epoch stale/orphaned and never recover its conversations under a same-name replacement. Only CoWeb-owned records can transition. Active records cannot be archived or deleted. Atomic writes use restrictive permissions and preserve the previous file if serialization or rename fails. Corrupt/unknown-schema files return a safe degraded result with an actionable error and never become active records. A separate bounded `PendingProvisioning`/submission journal may contain task ID, surface key, provider IDs already observed, prompt fingerprint and attempt state, but no prompt body or secret; it must never be read as an active binding.

- [ ] Write failing tests for schema/revision, atomic write/readback, task/resolved-project/epoch matching, exact conversation matching, active/completed/archived transitions, ownership rejection, stale-epoch invalidation, active cleanup protection, no-secret serialization, corrupt JSON, unknown schema, and failed-write recovery.
- [ ] Run `bun test tests/project-conversation-registry.test.ts` and verify the tests fail before implementation.
- [ ] Implement the pure registry with dependency-injected clock/path/write seams only where existing tests need them; do not import Playwright, Electron, browser selectors, MCP, or tunnel code.
- [ ] Run the registry tests and inspect the written fixture JSON to prove it contains IDs and timestamps only, never cookies/tokens/prompts/headers.
- [ ] Run `bun run typecheck` and the existing config/state tests.
- [ ] Commit only if execution workflow requires phase commits: `feat: add verified Project Chat registry`.

**Rollback/failure boundary:** A failed atomic write leaves the last valid registry intact. An invalid transition returns an error without changing state. A restart may recover an `active` record only as a candidate for later browser verification; registry readback alone cannot lease or authorize it.

**Validation command:** `bun test tests/project-conversation-registry.test.ts tests/runtime-layout.test.ts`; `bun run typecheck`.

---

### Phase 3: Strategy boundary with Temporary compatibility

**Dependency:** Phase 1; registry remains unused by Temporary strategy. **Browser/account access:** No for unit tests; existing local browser contract tests only if required.

**Files:**

- Create: `src/chat-surface-strategy.ts`.
- Create: `src/temporary-chat-strategy.ts`.
- Modify: `src/adapters/chatgpt-web/index.ts` at provider strategy construction and surface selection.
- Modify: `src/adapters/chatgpt-web/turn-execution.ts` only at the existing surface/session seam; keep logical task/turn ownership intact.
- Modify: `src/adapters/chatgpt-web/browser-worker.ts` only to expose the existing Temporary preparation through a narrow owned interface if needed.
- Test: `tests/chat-surface-strategy.test.ts` and existing Temporary adapter/browser tests.

**Interfaces and invariants:**

```ts
interface ChatSurfaceStrategy {
  readonly mode: "temporary" | "project";
  acquireSurface(input: SurfaceRequest): Promise<ChatSurfaceBinding>;
  releaseSurface(binding: ChatSurfaceBinding, reason: ReleaseReason): Promise<void>;
}
```

The shared binding must carry local `surfaceKey`, canonical task ID, mode, and capability facts. `TemporaryChatStrategy` delegates to the exact current navigation, URL, authentication, composer and retained-session logic and does not create registry entries. Existing response parsing, SSE, retry, cancellation, compaction and MCP calls remain outside the strategy.

- [ ] Write characterization tests around the current Temporary navigation URL, session readiness, release behavior, and no-registry-side-effect guarantee.
- [ ] Run the focused tests before introducing the abstraction and record the baseline output.
- [ ] Add the strategy interface and route current Temporary behavior through it without changing selectors or timing contracts.
- [ ] Run all existing Temporary adapter, browser, cancellation and compaction tests plus the new strategy tests.
- [ ] Confirm no Project code path is reachable merely because a registry file exists.
- [ ] Commit only if execution workflow requires phase commits: `refactor: route Temporary Chat through surface strategy`.

**Rollback/failure boundary:** If strategy construction fails, use the existing Temporary failure path. No registry write, project navigation, or alternate browser surface is attempted by the Temporary strategy.

**Validation command:** `bun test tests/chat-surface-strategy.test.ts tests/chatgpt-web-harness.test.ts tests/chatgpt-session.test.ts tests/bridge-stall-timeout.test.ts`; `bun run typecheck`.

---

### Phase 4: Provider/browser identity probe

**Dependency:** Phase 3 strategy contract. **Browser/account access:** Yes for authenticated verification; pure evidence parsing tests do not require it.

**Files:**

- Create: `src/project-capability.ts` for pure evidence/report types and validation.
- Modify: `src/adapters/chatgpt-web/browser-worker.ts` for focused read-only probe methods and exact evidence extraction.
- Modify: `launcher/electron/browser-host.cjs` and/or `src/launcher-browser-host.ts` only where the existing managed surface needs to expose the same read-only probe through the launcher contract.
- Modify: `src/project-identity-state.ts` to commit a verified identity and new epoch only after the probe's evidence gate.
- Modify: `src/adapters/chatgpt-web/index.ts` to expose the probe through the strategy boundary.
- Test: `tests/project-capability.test.ts`, `tests/project-browser-probe.test.ts`, and launcher/browser contract tests where the existing ownership belongs.

**Interfaces and invariants:**

```ts
type ProjectCapabilityReport = {
  projectOpened: "yes" | "no" | "unknown";
  appsOrToolsAvailable: "yes" | "no" | "unknown";
  fullHarnessAvailable: "yes" | "no";
  verifiedProjectId?: string;
  canonicalProjectUrl?: string;
  projectEpoch?: string;
  verifiedConversationId?: string;
};

type ProjectIdentityEvidence = {
  verifiedProjectId?: string;
  canonicalProjectUrl?: string;
  evidenceKind: "provider-id" | "canonical-url";
};
```

Probe sequence: discover projects by the configured name; require exactly one candidate; fail closed on duplicate names; verify stable project identity; resolve a stable provider ID when available and canonical project URL; persist a new resolved identity/epoch only after verification; then extract a normal conversation ID only from provider evidence, verify project membership, verify composer/session readiness, and report apps/tools capability. A title, configured name, or visible URL alone is insufficient. Probe is read-only: it must not create a conversation, send a prompt, mutate project settings, change connector configuration, or write an active conversation registry record. `fullHarnessAvailable` is `yes` only when the existing tunnel/broker/connector checks pass.

- [ ] Write pure tests for tri-state capability aggregation, unique-name discovery, duplicate-name ambiguity, canonical URL handling, project-ID mismatch, absent stable identity, conversation-ID shape, deleted-project detection, epoch replacement, and safe diagnostic redaction.
- [ ] Add authenticated browser contract fixtures or a manual verification script only after identifying selectors from the live provider; mark every unverified selector `Unknown — requires authenticated browser verification`.
- [ ] Run pure tests and a read-only authenticated probe, confirming failures are fail-closed and do not mutate the account.
- [ ] Run existing browser/launcher typecheck and contract tests.

**Rollback/failure boundary:** Any missing or contradictory evidence returns `unknown`/error and leaves the browser surface available for caller-controlled cleanup. No guessed project/conversation ID is passed to later phases.

**Validation command:** `bun test tests/project-capability.test.ts tests/project-browser-probe.test.ts`; `bun run typecheck`; authenticated probe/manual evidence required.

---

### Phase 5: Browser-only Project binding

**Dependency:** Phases 1–4. **Browser/account access:** Yes.

**Files:**

- Create/modify: `src/project-chat-strategy.ts` for provisioning and task-owned selection.
- Modify: `src/adapters/chatgpt-web/index.ts` for Project strategy construction and binding input.
- Modify: `src/adapters/chatgpt-web/turn-execution.ts` for task/compaction-epoch binding handoff while keeping its process-local ownership authoritative.
- Modify: `src/adapters/chatgpt-web/browser-worker.ts` for provider actions required to create a normal conversation inside the verified project and extract exact IDs.
- Modify: `launcher/electron/browser-host.cjs` only for the existing physical surface selection contract; no registry persistence in Electron/browser storage.
- Test: `tests/project-chat-strategy.test.ts`, `tests/project-browser-binding.test.ts`, `tests/turn-broker-lifecycle.test.ts` only for unchanged integration assertions.

**Binding invariant:** Provisioning remains transient until all five pieces of evidence pass: uniquely discovered and verified project identity, exact normal conversation identity, requested project membership, composer/session readiness, and task ownership. Only then persist the resolved identity/epoch and call `registry.activate`. A restart sees an active record as a recoverable candidate and must reopen/verify the exact project epoch and conversation before lease. Never select the most recent chat, a title match, configured-name match, or visible URL.

- [ ] Write failing state-machine tests for unique discovery, duplicate-name ambiguity, provision success, each missing-evidence failure, task collision, exact task/project/epoch reuse, restart candidate recovery, deleted-project invalidation, replacement with a new epoch, and no active record before verification.
- [ ] Run those tests red.
- [ ] Implement transient provisioning and verified activation; pass the resulting binding into existing turn execution for Browser-only mode.
- [ ] Add authenticated browser tests/manual evidence for project navigation, conversation creation, exact ID extraction, membership, composer readiness, reuse and restart recovery.
- [ ] Run all Temporary regressions and Project Browser-only tests.

**Rollback/failure boundary:** On any provisioning failure, close/retire only the transient surface and preserve canonical Codex state. If ambiguous metadata is needed, write a bounded pending journal; never promote it to `active`. A task collision or duplicate project name fails closed and never touches another task/project. When a prior project is deleted or replaced, invalidate its epoch and start a new one without attempting conversation recovery across epochs.

**Validation command:** `bun test tests/project-chat-strategy.test.ts tests/project-browser-binding.test.ts tests/chatgpt-web-harness.test.ts`; `bun run typecheck`; authenticated browser verification required.

---

### Phase 6: Recovery semantics

**Dependency:** Phase 5 Browser-only binding. **Browser/account access:** Pure recovery tests no; live reconciliation yes.

**Files:**

- Modify: `src/project-chat-strategy.ts` for bounded recovery classification and reconciliation.
- Create or modify: `src/project-submission-journal.ts` if the existing registry module would mix pending attempts with durable bindings.
- Modify: `src/adapters/chatgpt-web/turn-execution.ts` to preserve existing retry budget and logical turn identity.
- Modify: `src/adapters/chatgpt-web/browser-worker.ts` only for exact same-surface turn evidence reads.
- Test: `tests/project-recovery.test.ts`, `tests/project-submission-journal.test.ts`.

**Required states:** `submission-not-confirmed`, `accepted-send-response-lost`, `stale-surface`, and `terminal-failure`. After composer mutation or Send activation, lost acknowledgement is ambiguous, not a send failure. Reconcile on the same verified surface using exact turn evidence; never blindly send again. Accepted-send recovery observes the existing turn and retains canonical Codex state. A successor is forbidden until the old turn is terminal or policy explicitly marks it unrecoverable.

- [ ] Write failing tests for pre-send failure, post-activation ambiguity, accepted send with lost response, stale project/conversation, terminal provider failure, bounded retry exhaustion, and no duplicate mutation.
- [ ] Run tests red.
- [ ] Implement journal/recovery transitions with bounded attempts and secret-free fingerprints.
- [ ] Verify old temporary retry/cancellation behavior remains unchanged.
- [ ] Run focused recovery tests and the full adapter test set.

**Rollback/failure boundary:** If reconciliation cannot prove acceptance or terminality, return a recoverable ambiguous result and keep the canonical task state. Do not convert uncertainty into a new send or unrelated conversation.

**Validation command:** `bun test tests/project-recovery.test.ts tests/project-submission-journal.test.ts tests/chatgpt-web-harness.test.ts tests/bridge-stall-timeout.test.ts`; authenticated browser verification for provider evidence.

---

### Phase 7: Safe rollover

**Dependency:** Phases 2, 5 and 6; Full Harness remains out of scope for the first implementation of rollover. **Browser/account access:** Yes for successor verification.

**Files:**

- Modify: `src/project-chat-strategy.ts` for explicit/post-completion/compaction-boundary rollover.
- Modify: `src/project-conversation-registry.ts` for atomic successor activation plus predecessor transition.
- Modify: `src/adapters/chatgpt-web/turn-execution.ts` and existing compaction handoff owner for safe-boundary hooks.
- Modify: `src/adapters/chatgpt-web/browser-worker.ts` for same-project successor provisioning and verification.
- Test: `tests/project-rollover.test.ts`, `tests/project-conversation-registry.test.ts`, existing compaction tests.

**Safe flow:** require current turn settlement, canonical checkpoint/response state, no active MCP work when applicable, committed completion fence, terminal browser/helper evidence and physical settlement; provision successor in the same verified project epoch; verify successor project/conversation/composer; atomically activate successor; then mark predecessor completed. Explicit rollover, post-completion rollover and compaction-safe rollover use the same invariant. A soft age/count request may suggest rollover but cannot establish correctness. A project replacement always starts a new epoch and is not a rollover path for old conversations.

- [ ] Write failing tests for explicit rollover, post-completion rollover, compaction boundary, active-tool refusal, failed successor, successor identity mismatch, atomic predecessor/successor update, and canonical Codex-state preservation.
- [ ] Run tests red.
- [ ] Implement successor verification and atomic registry transition.
- [ ] Run existing compaction/cancellation tests plus Project rollover tests and authenticated browser validation.

**Rollback/failure boundary:** Failed successor creation leaves the predecessor completed record and canonical Codex state intact; no switch to a guessed chat occurs. If the current turn is active or tool work is unresolved, rollover returns pending/refused without changing the active binding.

**Validation command:** `bun test tests/project-rollover.test.ts tests/compaction-browser-recovery.test.ts tests/turn-broker-lifecycle.test.ts`; authenticated browser verification required.

---

### Phase 8: Full Harness integration

**Dependency:** Phase 7 and all existing broker/completion/cancellation semantics. **Browser/account access:** Yes for authenticated Full Harness verification.

**Files:**

- Modify: `src/project-chat-strategy.ts` at Full-mode binding and compaction handoff only.
- Modify: `src/adapters/chatgpt-web/index.ts` for Project mode's existing broker integration.
- Modify: `src/adapters/chatgpt-web/turn-broker.ts` only if a narrow surface identity field is needed; do not duplicate claims, leases, invoke, revoke or fences.
- Modify: `src/adapters/chatgpt-web/mcp-server.ts` only if the existing binding schema needs a verified local surface key; never expose registry IDs as capabilities.
- Modify: `src/adapters/chatgpt-web/browser-worker.ts` for existing connector/approval evidence only.
- Modify: `src/tunnel-service.ts`, launcher runtime modules only if existing lifecycle APIs need Project mode routing; tunnel ownership remains where it is.
- Test: `tests/project-full-harness.test.ts`, existing MCP/broker/approval/cancellation/compaction tests, launcher runtime tests where touched.

**Invariants:** The exact native task/turn and verified project surface scope one active MCP binding. Cancellation revokes the existing binding; completion waits for existing tool quiescence/fence/physical settlement; compaction uses existing handoff; tunnel start/stop remains existing supervisor ownership. Project metadata never becomes an MCP token and never authorizes a tool.

- [ ] Write failing matrix tests for Temporary/Project × Browser-only/Full Harness, tool approval, completion fence, cancellation, compaction, tunnel teardown, task collision and stale binding.
- [ ] Run tests red.
- [ ] Thread Project binding through existing broker APIs without adding a second lifecycle.
- [ ] Run the full local matrix and authenticated Full Harness turns with redacted evidence.

**Rollback/failure boundary:** If Full Harness capability is unavailable, report `fullHarnessAvailable: "no"` and keep Browser-only behavior. Broker/tunnel failure releases the existing lease and preserves registry state; it cannot archive/delete a conversation by itself.

**Validation command:** `bun test tests/project-full-harness.test.ts tests/zero-risk-mcp-lifecycle.test.ts tests/turn-broker-lifecycle.test.ts tests/tunnel-service.test.ts`; `bun run typecheck`; authenticated Full Harness verification required.

---

### Phase 9: Project replacement and optional managed cleanup

**Dependency:** Verified ownership and stable lifecycle from Phases 2, 4, 5, 7 and 8. **Browser/account access:** Yes for deleted-project detection and replacement verification; per-chat archive/delete is optional and may remain deferred.

**Files:**

- Modify: `src/project-conversation-registry.ts` for resolved-identity/epoch invalidation and ownership-gated local lifecycle methods.
- Modify: `src/project-chat-strategy.ts` for deleted-project detection, replacement discovery, and new-epoch binding.
- Modify: `src/adapters/chatgpt-web/browser-worker.ts` only for provider identity evidence; do not add bulk deletion as a prerequisite.
- Modify: launcher/UI diagnostics modules only to display owned identity/epoch state; never expose private URLs beyond configured identity.
- Test: `tests/project-replacement.test.ts`, `tests/project-cleanup.test.ts` only for optional future cleanup gates.

**Lifecycle:** manual deletion of the whole ChatGPT Project is the preferred initial bulk-cleanup workflow. When the verified project disappears or mismatches, mark its identity/epoch and conversation records stale/orphaned, then discover and verify a unique replacement by configured name and persist a new epoch. Never recover old conversations across epochs. Per-chat `active → completed → archived` and permanent deletion are optional future functionality, disabled by default until provider semantics are verified. Unrelated conversations/projects, title matches and provider-wide cleanup are forbidden.

- [ ] Write failing tests for deleted-project detection, same-name replacement, duplicate-name ambiguity, stale-epoch invalidation, no cross-epoch recovery, ownership protection, and unrelated-project non-interaction. Add per-chat cleanup tests only if that optional capability is explicitly enabled later.
- [ ] Run tests red.
- [ ] Implement local invalidation/rebind and new-epoch persistence; do not add remote per-chat cleanup as a prerequisite.
- [ ] Run focused replacement tests and authenticated provider verification.
- [ ] Confirm cleanup has no dependency on tunnel teardown or process exit alone.

**Rollback/failure boundary:** If replacement discovery is ambiguous or verification fails, keep the old epoch stale/orphaned and do not bind a new conversation. If provider deletion semantics are unknown, stop at local invalidation and leave remote cleanup to the user's manual Project deletion workflow.

**Validation command:** `bun test tests/project-cleanup.test.ts tests/project-conversation-registry.test.ts`; authenticated browser/provider verification required.

---

## Final validation matrix

Run after all phases that are actually implemented:

```powershell
$env:PATH = "D:\Code\Personal\coweb-tools\bun-1.4.0;$env:PATH"
bun install --frozen-lockfile
bun install --cwd launcher --frozen-lockfile
bun run typecheck
bun run launcher:typecheck
bun run test
bun run launcher:test
bun run launcher:build
bun run build
bun run smoke
```

Run `bun run verify` only when both audit gates are clean; its audit step is a release gate. Capture exact output and report any platform/account checks as unexecuted rather than inferring support. The cross-product matrix must show Temporary regression, Project Browser-only, Project Full Harness, ambiguous submission, lost response, stale surface, task isolation, failed successor, no-replay and cleanup protection.

Before claiming completion, run `git diff --check`, inspect the complete diff, search remaining old identifiers, and verify no registry fixture contains credential-like fields. Preserve all unrelated local edits and do not reset/restore them.

## Unknowns requiring authenticated browser verification

- `Unknown — requires authenticated browser verification`: current ChatGPT project navigation control and stable project identity evidence.
- `Unknown — requires authenticated browser verification`: current normal-conversation creation flow inside an exact project.
- `Unknown — requires authenticated browser verification`: provider conversation ID extraction and proof that the conversation belongs to the requested project.
- `Unknown — requires authenticated browser verification`: composer/session readiness evidence after project conversation creation and after restart.
- `Unknown — requires authenticated browser verification`: apps/tools capability surface and its account/project variation.
- `Unknown — requires authenticated browser verification`: reconciliation evidence after Send activation when the response stream is lost.
- `Unknown — requires authenticated browser verification`: provider-supported archive operation and whether archive is reversible.
- `Unknown — requires authenticated browser verification`: provider-supported permanent deletion semantics; keep deletion disabled until verified.
- `Unknown — requires authenticated browser verification`: whether more than one CoWeb process can share a home safely; add a registry lock or fail closed before enabling concurrent use.

## Rollback and release gates

Each phase must be independently revertible by reverting only its owned files and preserving the prior phase's tests. Never roll back by deleting or resetting the user's registry/config/browser state. Do not enable Project mode by default until the complete Browser-only path is verified. Do not enable Full Harness Project mode or cleanup deletion until their authenticated gates pass. Temporary mode remains the safe fallback for missing, invalid, degraded or unknown Project capability.
