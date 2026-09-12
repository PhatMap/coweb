# CoWeb Project Chat Mode Design

Status: design proposal, pending approval. This document does not implement
Project Chat.

## Scope and Goals

Project Chat adds a second browser execution surface while preserving the
existing Temporary Chat behavior. The canonical long-lived task remains the
Codex task/thread. ChatGPT conversations are execution surfaces selected and
owned by CoWeb; they are not the source of task continuity.

Required modes:

```ts
type ChatMode = "temporary" | "project";
```

Existing configurations with no `chatMode` continue to mean `temporary`. No
protocol-sensitive Codex, Responses, MCP, connector, tunnel, or loopback names
are changed by this design.

## Current Architecture

The current production path is:

```text
Codex POST /v1/responses
  -> src/server.ts responseRequest
  -> request parser/router
  -> ChatGPT adapter
  -> ChatGptBrowserWorker / LauncherBrowserHelperClient
  -> ChatGPT browser surface
  -> AdapterEvent -> src/bridge.ts Responses SSE
```

Important current ownership facts:

- `src/server.ts` owns the Responses and compaction HTTP boundaries,
  cancellation tracking, and native turn identity extraction.
- `src/bridge.ts` owns SSE translation, heartbeats, stall handling, and client
  cancellation. It must not own browser conversation selection.
- `src/adapters/chatgpt-web/index.ts` owns provider setup, retry orchestration,
  retained-session selection, compaction handoff, and broker integration.
- `src/adapters/chatgpt-web/browser-worker.ts` owns browser selectors,
  composer/submission evidence, response observation, connector setup, and
  physical browser work.
- `src/adapters/chatgpt-web/turn-execution.ts` owns process-local logical
  execution sessions, conversation heads, retry identity, thread ownership,
  and physical retirement. Its `conversationKey` is not a ChatGPT conversation
  ID and is not durable.
- `launcher/electron/browser-host.cjs` owns Electron partitions, browser
  surfaces, turn leases, retained tab selection, and physical destruction.
- `src/adapters/chatgpt-web/turn-broker.ts` and `mcp-server.ts` own active-turn
  tool capability, activity leases, completion fences, revocation, and
  compaction control. Full Harness semantics must remain unchanged.
- `src/config.ts` owns versioned local configuration under the isolated CoWeb
  home. `responses-state.ts` persists only local `previous_response_id`
  continuation state. There is currently no durable production conversation
  registry.

Temporary Chat is an explicit invariant today:

- `CHATGPT_TEMPORARY_CHAT_URL` is `https://chatgpt.com/?temporary-chat=true`.
- `prepareTemporaryChatSurface` navigates there and verifies authentication,
  composer readiness, onboarding, and the exact URL.
- No production code extracts or persists a ChatGPT `/c/<conversation-id>`.
- DOM `data-turn-id` values identify assistant turns, not conversations.

Compaction currently has explicit v1/v2 Responses boundaries and a retained
Full Harness handoff. A compaction handoff can require the retained physical
conversation, settle active MCP work, and preserve final response state while
browser teardown completes.

## Desired Architecture

Introduce a strategy boundary above browser selectors and below the existing
adapter/session orchestration:

```text
ChatGptWebAdapter
  -> ChatSurfaceStrategy
       -> TemporaryChatStrategy
       -> ProjectChatStrategy
            -> ProjectConversationRegistry
            -> Project identity resolver
            -> capability probe
  -> existing BrowserWorker / LauncherHost
  -> existing TurnBroker and compaction lifecycle
```

The strategy selects or provisions a browser surface. It does not duplicate
SSE, Responses parsing, MCP, tunnel, or cancellation logic. Both strategies
return the same internal surface/session contract to the existing turn
execution machinery.

Proposed internal contract:

```ts
type ChatSurfaceMode = "temporary" | "project";

type ChatSurfaceBinding = {
  taskId: string;
  mode: ChatSurfaceMode;
  surfaceKey: string;          // local CoWeb identity, never a URL alone
  conversationId?: string;     // provider identity, verified before use
  conversationUrl?: string;
  projectId?: string;
  capability: {
    projectOpened: "yes" | "no" | "unknown";
    appsOrTools: "yes" | "no" | "unknown";
    fullHarness: "yes" | "no";
  };
};
```

`TemporaryChatStrategy` preserves current navigation and URL assertions. It
does not create registry entries. `ProjectChatStrategy` owns project
navigation, normal-conversation provisioning, identity verification, and
registry transitions. Browser selectors remain in browser-worker/browser-host
contracts, with strategy-level state transitions tested independently.

## Configuration and Identity

Add the smallest versioned configuration owned by `src/config.ts`:

```ts
type ChatMode = "temporary" | "project";

type ProjectChatConfig = {
  mode: "project";
  projectUrl: string;
  projectId?: string;
};

// AppConfig addition
chatMode?: ChatMode;
projectChat?: ProjectChatConfig;
```

The exact schema should be finalized during implementation after checking the
existing config migration conventions. The default is `temporary` when
`chatMode` is absent. Project mode requires a configured absolute HTTPS
`projectUrl`; an optional stable `projectId` is a verified identity hint, not
an unchecked caller assertion.

Resolution order:

1. Use a verified stable provider project ID if the page exposes one.
2. Otherwise canonicalize and retain the configured project URL as the project
   identity input.
3. Never select a project by title matching when a stable identity is absent.
4. If identity cannot be proven, fail closed with an actionable capability
   report rather than opening an arbitrary project.

No personal project URL or ID is hardcoded.

## Durable Conversation Registry

CoWeb should own a separate atomic JSON registry under the existing CoWeb home,
for example `~/.coweb/chat-projects.json`; DEV uses the already isolated DEV
home. The registry contains no cookies, tokens, prompts, tool results, or
authorization headers.

Proposed records:

```ts
type ManagedConversation = {
  taskId: string;
  conversationId: string;
  conversationUrl: string;
  projectId?: string;
  projectUrl: string;
  createdAt: string;
  lastUsedAt: string;
  state: "active" | "completed" | "archived";
  ownershipProof: {
    createdByCoweb: true;
    verifiedProjectId?: string;
    verifiedConversationId: string;
  };
};
```

The implementation may add schema version and a registry revision for atomic
updates. One task may have one active record per project/mode epoch. A registry
lookup must match the canonical Codex task identity and verified project
identity; it must never fall back to the most recent chat or a URL currently
visible in the browser.

On startup, records in `active` state are recoverable candidates, not proof that
the browser surface is usable. Recovery must reopen the configured project,
locate the exact verified conversation identity, verify composer/session state,
then lease the record. A URL alone is insufficient. If recovery cannot prove
identity, keep the record and mark the surface degraded rather than binding a
different chat.

## Data Flow and Task Binding

```text
Codex thread/task identity
  -> parsed native identity in responseRequest
  -> strategy receives task identity + compaction epoch
  -> registry lookup by taskId + project identity
  -> verified browser surface binding
  -> existing turn session/conversation head
  -> existing broker binding (Full Harness only)
  -> SSE response and canonical Codex continuation
```

The registry binds task identity to a provider conversation. It does not replace
`previous_response_id`, compaction summaries, native turn IDs, or MCP tokens.
The existing process-local execution keys remain authoritative for a live turn.
The registry is recovery metadata, not permission to replay a mutation.

## Lifecycle and Safe Boundaries

Project conversation states are:

```text
active -> completed -> archived -> optionally deleted
```

Only CoWeb-created records with an ownership proof may transition through this
lifecycle. Active records are never cleaned up. Archive precedes any future
permanent deletion, and deletion is opt-in and must use a provider-supported
operation, never DOM removal.

An active turn owns its surface until all existing completion conditions hold:

1. no active MCP activities or pending tool invocations;
2. completion fence is committed;
3. browser/helper has reported terminal completion;
4. canonical response/compaction state is available to Codex;
5. physical browser settlement is complete.

Only then may the registry mark the conversation completed or begin rollover.
No rollover occurs in the middle of an active tool round.

## Rollover

Supported triggers:

- explicit user/operator rollover;
- a compaction boundary after the canonical checkpoint is committed;
- recoverable browser degradation after the current turn reaches a safe
  terminal boundary.

Safe flow:

```text
active project conversation
  -> current turn settles and checkpoint is canonical
  -> provision successor in the same verified project
  -> verify project identity, conversation identity, and composer
  -> atomically bind successor to the task
  -> mark old record completed, then archive candidate
```

If successor provisioning or verification fails, retain the old completed
record and canonical Codex state; do not silently switch to an unrelated chat.
An explicit rollover request can remain pending for retry. A soft turn-count or
age policy may trigger a request later, but correctness must depend on the safe
boundary, not an arbitrary timer.

Compaction is a special boundary, not a reason to interrupt tools. The current
Full Harness compaction handoff must settle or revoke active MCP work before a
successor is created. The successor receives the canonical compaction result
through the existing Codex continuation path.

## Recovery and Ambiguous Submission

The strategy must distinguish these cases:

### Submission ambiguous

After composer mutation or Send activation, a lost acknowledgement is not a
send failure. Persist an in-memory/persisted-at-boundary submission journal with
task identity, surface identity, prompt fingerprint, and attempt state, but no
secret payload. Reconnect and inspect exact turn evidence on the same verified
surface. Do not blindly send again. If evidence cannot prove whether the prompt
was accepted, return a recoverable ambiguous result and require a bounded
reconciliation path.

### Response lost after task start

Once accepted-send evidence exists, classify browser/stream loss as an active
task recovery problem, not a safe-to-replay submission. Rebind the exact task
and conversation, observe existing turn identity, and recover terminal output
or fail with canonical task state preserved. A successor may be provisioned only
after the old turn is known terminal or explicitly unrecoverable under policy.

### Stale browser or chat

Revalidate project, conversation, composer, and connector/session evidence. If
the surface is stale, retire only CoWeb's lease and provision a successor at a
safe boundary. Never erase Codex state and never reuse a record belonging to a
different task.

The existing retry budget and logical turn keys remain in force. Project mode
must plug into them rather than add an independent replay loop.

## Full Harness and Tunnel Compatibility

Project mode uses the same `TurnBroker` registration, claim, invoke,
completion-fence, revoke, cancellation, and compaction APIs as Temporary mode.
The conversation binding is additional routing metadata; it is not an MCP
capability token.

Required invariants:

- one active tool binding is scoped to the exact native task/turn and verified
  surface;
- task isolation rejects a project conversation leased by another task;
- cancellation revokes the exact binding and releases the surface;
- completion waits for tool quiescence and physical settlement;
- tunnel lifecycle remains owned by existing runtime/supervisor code;
- tunnel teardown never archives or deletes a conversation by itself.

The matrix must cover both Browser-only and Full Harness for both chat modes.

## Capability Probe

Project setup must report facts, not assumptions:

```ts
type ProjectCapabilityReport = {
  projectOpened: "yes" | "no" | "unknown";
  appsOrToolsAvailable: "yes" | "no" | "unknown";
  fullHarnessAvailable: "yes" | "no";
  verifiedProjectId?: string;
  verifiedConversationId?: string;
};
```

`projectOpened` requires exact project identity evidence. Apps/tools are `yes`
only when a focused probe observes the expected capability surface; absence or
UI variation is `no` or `unknown`, not an inferred success. Full Harness is
`yes` only when the existing tunnel, broker, connector, and active-turn checks
pass. The report must be safe to show in diagnostics without exposing cookies,
tokens, prompts, or private URLs beyond the configured project identity.

## Browser and Launcher Ownership

The managed-Chrome and Electron launcher paths must share the strategy contract,
but retain their current ownership:

- browser worker owns selectors and exact DOM evidence;
- launcher owns Electron partition, CDP targets, authenticated control, and
  physical surface lifecycle;
- strategy owns project/conversation identity and registry transitions;
- adapter/session layer owns task/turn/retry/compaction semantics.

Project conversations must use the existing isolated production/DEV browser
partitions. No old upstream profile is imported and no registry state is stored
in browser storage.

## Security and Cleanup

- Registry files are local CoWeb state with restrictive file permissions and
  atomic writes, matching existing config/state conventions.
- Never persist cookies, storage state, bearer credentials, tunnel keys, raw
  prompts, tool results, or authorization headers in the registry.
- Project identity and conversation identity are untrusted browser data until
  verified against the requested project and task-owned registry record.
- Cleanup is ownership-gated, active-safe, archive-first, and opt-in for any
  permanent deletion.
- Unrelated user conversations and projects are never modified.
- Full Harness tool execution remains subject to existing Codex sandbox and
  approval controls.

## Approaches Considered

### 1. Strategy abstraction (recommended)

Add `TemporaryChatStrategy` and `ProjectChatStrategy` behind one surface
contract, with a durable registry owned by the adapter/config layer.

Pros: preserves current Temporary behavior, isolates browser selectors, reuses
existing turn/MCP/compaction lifecycle, enables pure state-machine tests.
Cons: requires a clear contract between strategy, turn execution, and launcher;
provider identity verification is new work.

### 2. Project mode inside `browser-worker.ts`

Add project branching directly to `prepareTemporaryChatSurface` and related
browser methods.

Pros: smallest first diff and direct selector access.
Cons: mixes navigation, identity, registry, and recovery with DOM mechanics;
high risk of duplicate retry/rollover logic and difficult task isolation tests.

### 3. Separate ProjectChat adapter/server path

Create a second adapter or endpoint dedicated to Project Chat.

Pros: strong compile-time separation initially.
Cons: duplicates Responses/SSE, cancellation, MCP, compaction, and tunnel
semantics; likely behavioral drift and broken backward compatibility.

Recommendation: approach 1, introduced incrementally with pure state-machine
and registry tests before browser selectors.

## Testing Strategy and Matrix

Pure tests first:

- config default/migration: absent `chatMode` equals `temporary`;
- registry atomic persistence, schema validation, task isolation, project
  identity matching, restart recovery, active-record protection, archive-first
  transitions, and no-secret fields;
- strategy state machine for provision, bind, complete, rollover, stale
  recovery, ambiguous submission, and failed successor creation;
- capability report tri-state behavior;
- no replay after accepted-send ambiguity.

Browser/launcher contracts:

- project navigation and stable identity verification;
- normal conversation creation and exact conversation ID extraction;
- composer/session verification after creation and recovery;
- retained surface selection by task-owned binding;
- no title-only matching and no URL-only proof.

Cross-product matrix:

| Mode | Browser-only | Full Harness |
| --- | --- | --- |
| Temporary | existing regression suite; onboarding; cancellation; compaction | existing MCP binding; tool completion; cancellation; tunnel teardown |
| Project | project navigation; registry binding; restart; rollover; stale recovery | all Browser-only cases plus tool binding, approval, cancellation, completion, compaction, and tunnel teardown |

Failure cases required in every applicable project column:

- submission ambiguous;
- accepted task with disconnected response;
- stale browser surface;
- duplicate task does not reuse another task's chat;
- failed successor creation preserves canonical Codex state;
- no duplicate mutation after recovery;
- cleanup never touches active or unrelated chats.

Temporary-mode regression tests must remain unchanged except for shared test
helpers and must continue to pass without a project configuration.

## Staged Implementation Plan

1. Approve this design and settle provider-specific identity/capability
   unknowns.
2. Add versioned config parsing with `temporary` default and no browser change.
3. Add pure registry module and state-machine tests; keep it disconnected from
   browser selectors.
4. Add a strategy contract and adapt Temporary mode without behavior change.
5. Add Project navigation/identity probes and focused browser-host contracts.
6. Add project provisioning and task-owned binding for Browser-only mode.
7. Add restart recovery and bounded rollover at safe completion/compaction
   boundaries.
8. Integrate Full Harness broker binding, cancellation, completion fence, and
   compaction handoff.
9. Add capability diagnostics, archive lifecycle, and opt-in cleanup only after
   ownership evidence is stable.
10. Run the full CI matrix and authenticated/manual browser validation; do not
    enable permanent deletion in the first release.

## Risks and Unknowns

- ChatGPT's current UI/API may not expose a stable project or conversation ID
  through the available browser surface. The implementation must stop or remain
  `unknown` rather than title-match or infer identity.
- Normal conversation creation and project assignment selectors are not yet
  verified in this repository's browser contracts.
- Conversation URL shape and navigation behavior may change; selector contracts
  need authenticated browser fixtures or manual validation.
- Apps/tools availability is account, project, and UI dependent; capability must
  remain tri-state.
- A provider-side conversation may become inaccessible or be moved between
  projects; registry ownership does not grant provider control.
- Rollover after a disconnected accepted send needs a provider-specific
  reconciliation proof before successor creation.
- Multiple CoWeb processes sharing one CoWeb home would need registry locking;
  the first implementation should either add a lock or fail closed.
- Existing launcher retention is process-local, so restart recovery requires a
  new verified surface lookup rather than relying on retained tabs.

## Approval Gate

This is a design-only deliverable. No Project Chat implementation should begin
until the user approves:

1. the strategy boundary and registry ownership;
2. the proposed configuration shape and `temporary` default;
3. the stable project/conversation identity requirements;
4. safe-boundary rollover and no-replay recovery rules;
5. the staged implementation plan and testing matrix.
