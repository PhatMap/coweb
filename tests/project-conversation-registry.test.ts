import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  ProjectConversationRegistry,
  type ProjectEpochIdentity,
  type RegistrySnapshot,
  type VerifiedConversationBinding,
} from "../src/project-conversation-registry";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixturePath(label: string): string {
  const root = join(tmpdir(), `coweb-project-registry-${label}-${process.pid}-${Date.now()}`);
  roots.push(root);
  mkdirSync(root, { recursive: true });
  const path = join(root, "runtime", "project-conversation-registry.json");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

function project(epoch = "epoch-a", configuredName = "CoWeb"): ProjectEpochIdentity {
  return {
    configuredName,
    projectId: "provider-project-a",
    projectUrl: "https://chatgpt.com/project/a",
    epoch,
  };
}

function binding(overrides: Partial<VerifiedConversationBinding> = {}): VerifiedConversationBinding {
  return {
    taskId: "task-1",
    conversationId: "conversation-1",
    conversationUrl: "https://chatgpt.com/c/conversation-1",
    surfaceKey: "surface-1",
    project: project(),
    verifiedConversationId: "conversation-1",
    verifiedProjectId: "provider-project-a",
    ...overrides,
  };
}

function registry(path = fixturePath("default"), now = "2026-09-12T00:00:00.000Z") {
  return {
    path,
    registry: new ProjectConversationRegistry({ path, now: () => now }),
  };
}

test("empty registry reads as versioned revision zero with no records", () => {
  const { registry: store } = registry();

  expect(store.read()).toEqual({ version: 1, revision: 0, records: [] });
});

test("verified activation persists an active record and increments revision", () => {
  const { registry: store } = registry();

  const record = store.activate(binding());

  expect(record).toMatchObject({
    taskId: "task-1",
    conversationId: "conversation-1",
    state: "active",
    ownershipProof: {
      createdByCoweb: true,
      verifiedConversationId: "conversation-1",
      verifiedProjectId: "provider-project-a",
    },
  });
  expect(store.read()).toMatchObject({ version: 1, revision: 1, records: [record] });
});

test.each([
  ["missing task", { taskId: "" }],
  ["missing conversation", { conversationId: "" }],
  ["missing conversation proof", { verifiedConversationId: "" }],
  ["missing surface", { surfaceKey: "" }],
  ["missing project epoch", { project: { ...project(), epoch: "" } }],
  ["missing project URL", { project: { ...project(), projectUrl: "" } }],
  ["name-only project input", { project: { configuredName: "CoWeb", epoch: "epoch-a", projectUrl: "" } }],
] as const)("rejects incomplete activation: %s", (_label, overrides) => {
  const { registry: store } = registry();

  expect(() => store.activate(binding(overrides))).toThrow();
  expect(store.read()).toEqual({ version: 1, revision: 0, records: [] });
});

test("rejects a binding whose verified IDs do not match the exact conversation/project", () => {
  const { registry: store } = registry();

  expect(() => store.activate(binding({ verifiedConversationId: "other-conversation" }))).toThrow(/conversation/i);
  expect(() => store.activate(binding({ verifiedProjectId: "other-project" }))).toThrow(/project/i);
  expect(store.read().records).toHaveLength(0);
});

test("findActive requires exact task, resolved project identity, epoch, and optional conversation", () => {
  const { registry: store } = registry();
  const record = store.activate(binding());

  expect(store.findActive("task-1", project(), "conversation-1")).toEqual(record);
  expect(store.findActive("task-2", project(), "conversation-1")).toBeUndefined();
  expect(store.findActive("task-1", project("epoch-b"), "conversation-1")).toBeUndefined();
  expect(store.findActive("task-1", project(), "conversation-2")).toBeUndefined();
  expect(store.findActive("task-1", project("epoch-a", "Other Name"), "conversation-1")).toBeUndefined();
});

test("same configured name with a different project epoch never matches", () => {
  const { registry: store } = registry();
  const record = store.activate(binding());

  expect(store.findActive("task-1", project("epoch-b", "CoWeb"), "conversation-1")).toBeUndefined();
  expect(store.findActive("task-1", project("epoch-a", "CoWeb"), "conversation-1")).toEqual(record);
});

test("duplicate active binding for one task and project epoch is rejected", () => {
  const { registry: store } = registry();
  store.activate(binding());

  expect(() => store.activate(binding({ conversationId: "conversation-2", verifiedConversationId: "conversation-2" })))
    .toThrow(/active/i);
  expect(store.read().records).toHaveLength(1);
});

test("a different task may bind the same project epoch but cannot reuse the active conversation", () => {
  const { registry: store } = registry();
  store.activate(binding());

  expect(() => store.activate(binding({ taskId: "task-2" }))).toThrow(/conversation/i);
  expect(() => store.activate(binding({ taskId: "task-2", conversationId: "conversation-2", verifiedConversationId: "conversation-2" })))
    .not.toThrow();
});

test("active transitions to completed and then archived", () => {
  const { registry: store } = registry();
  store.activate(binding());

  const completed = store.complete("task-1", "conversation-1");
  expect(completed.state).toBe("completed");
  expect(store.archive("task-1", "conversation-1").state).toBe("archived");
  expect(store.read().revision).toBe(3);
});

test("archiving an active record directly is rejected", () => {
  const { registry: store } = registry();
  store.activate(binding());

  expect(() => store.archive("task-1", "conversation-1")).toThrow(/completed/i);
  expect(store.read().records[0]?.state).toBe("active");
});

test("records not owned by CoWeb cannot transition", () => {
  const path = fixturePath("foreign");
  const snapshot: RegistrySnapshot = {
    version: 1,
    revision: 1,
    records: [{
      ...binding(),
      state: "completed",
      createdAt: "2026-09-12T00:00:00.000Z",
      lastUsedAt: "2026-09-12T00:00:00.000Z",
      ownershipProof: { createdByCoweb: false, verifiedConversationId: "conversation-1" },
    }],
  };
  writeFileSync(path, `${JSON.stringify(snapshot)}\n`);
  const { registry: store } = registry(path);

  expect(() => store.archive("task-1", "conversation-1")).toThrow(/owned/i);
});

test("active records cannot be archived by cleanup", () => {
  const { registry: store } = registry();
  store.activate(binding());

  expect(() => store.archive("task-1", "conversation-1")).toThrow();
  expect(store.findActive("task-1", project(), "conversation-1")?.state).toBe("active");
});

test("restart reads the persisted registry without changing revision", () => {
  const path = fixturePath("restart");
  const first = registry(path).registry;
  const record = first.activate(binding());
  const restarted = registry(path).registry;

  expect(restarted.read()).toEqual({ version: 1, revision: 1, records: [record] });
});

test("corrupt JSON fails safely instead of resetting to an empty registry", () => {
  const path = fixturePath("corrupt");
  writeFileSync(path, "{not-json\n");
  const { registry: store } = registry(path);

  expect(() => store.read()).toThrow(/invalid|corrupt|JSON/i);
});

test("unsupported schema version fails safely", () => {
  const path = fixturePath("schema");
  writeFileSync(path, `${JSON.stringify({ version: 99, revision: 10, records: [] })}\n`);
  const { registry: store } = registry(path);

  expect(() => store.read()).toThrow(/schema|version/i);
});

test("failed write preserves the previous valid state", () => {
  const path = fixturePath("failed-write");
  const first = registry(path).registry;
  first.activate(binding());
  const before = readFileSync(path, "utf8");
  const failing = new ProjectConversationRegistry({
    path,
    now: () => "2026-09-12T00:01:00.000Z",
    write: () => { throw new Error("simulated write failure"); },
  });

  expect(() => failing.complete("task-1", "conversation-1")).toThrow("simulated write failure");
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(first.read().records[0]?.state).toBe("active");
});

test("invalidating a project epoch marks its records stale without rebinding them", () => {
  const path = fixturePath("stale");
  const store = registry(path).registry;
  store.activate(binding());

  const stale = store.invalidateProjectEpoch(project());

  expect(stale).toBe(1);
  expect(store.read().records[0]?.state).toBe("stale");
  expect(store.findActive("task-1", project(), "conversation-1")).toBeUndefined();
  expect(store.findActive("task-1", project("epoch-b", "CoWeb"), "conversation-1")).toBeUndefined();
});

test("serialized registry contains only sanitized metadata", () => {
  const { path, registry: store } = registry();
  store.activate(binding());
  const serialized = readFileSync(path, "utf8");
  const forbidden = ["cookie", "token", "authorization", "prompt", "response", "tool", "header", "secret"];

  for (const field of forbidden) expect(serialized.toLowerCase()).not.toContain(field);
  expect(JSON.parse(serialized)).toMatchObject({ version: 1, revision: 1 });
});
