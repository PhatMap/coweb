import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile, getConfigDir, stripUtf8Bom } from "./config";

export type ProjectEpochIdentity = {
  configuredName: string;
  projectId?: string;
  projectUrl: string;
  epoch: string;
};

export type VerifiedConversationBinding = {
  taskId: string;
  conversationId: string;
  conversationUrl: string;
  surfaceKey: string;
  project: ProjectEpochIdentity;
  verifiedConversationId: string;
  verifiedProjectId?: string;
};

export type ManagedConversationState = "active" | "completed" | "archived" | "stale";

export type OwnershipProof = {
  createdByCoweb: boolean;
  verifiedConversationId: string;
  verifiedProjectId?: string;
};

export type ManagedConversation = VerifiedConversationBinding & {
  state: ManagedConversationState;
  createdAt: string;
  lastUsedAt: string;
  ownershipProof: OwnershipProof;
};

export type RegistrySnapshot = {
  version: 1;
  revision: number;
  records: ManagedConversation[];
};

type RegistryOptions = {
  path?: string;
  now?: () => string;
  write?: (path: string, data: string) => void;
};

const REGISTRY_VERSION = 1 as const;

export function getProjectConversationRegistryPath(): string {
  return join(getConfigDir(), "runtime", "project-conversation-registry.json");
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${label}: expected a non-empty string`);
  }
}

function sameProject(left: ProjectEpochIdentity, right: ProjectEpochIdentity): boolean {
  return left.configuredName === right.configuredName
    && left.projectId === right.projectId
    && left.projectUrl === right.projectUrl
    && left.epoch === right.epoch;
}

function validateProject(project: unknown): asserts project is ProjectEpochIdentity {
  if (typeof project !== "object" || project === null) throw new Error("Invalid project identity");
  const candidate = project as Record<string, unknown>;
  requireNonEmptyString(candidate.configuredName, "project configured name");
  requireNonEmptyString(candidate.projectUrl, "project URL");
  requireNonEmptyString(candidate.epoch, "project epoch");
  if (candidate.projectId !== undefined) requireNonEmptyString(candidate.projectId, "project ID");
}

function validateBinding(binding: unknown): asserts binding is VerifiedConversationBinding {
  if (typeof binding !== "object" || binding === null) throw new Error("Invalid verified conversation binding");
  const candidate = binding as Record<string, unknown>;
  requireNonEmptyString(candidate.taskId, "task ID");
  requireNonEmptyString(candidate.conversationId, "conversation ID");
  requireNonEmptyString(candidate.conversationUrl, "conversation URL");
  requireNonEmptyString(candidate.surfaceKey, "surface key");
  requireNonEmptyString(candidate.verifiedConversationId, "verified conversation ID");
  validateProject(candidate.project);
  if (candidate.verifiedProjectId !== undefined) requireNonEmptyString(candidate.verifiedProjectId, "verified project ID");
  if (candidate.verifiedConversationId !== candidate.conversationId) {
    throw new Error("Verified conversation ID does not match conversation ID");
  }
  if (candidate.verifiedProjectId !== undefined && candidate.verifiedProjectId !== (candidate.project as ProjectEpochIdentity).projectId) {
    throw new Error("Verified project ID does not match project identity");
  }
}

function validateRecord(record: unknown): asserts record is ManagedConversation {
  validateBinding(record);
  const candidate = record as ManagedConversation;
  if (!["active", "completed", "archived", "stale"].includes(candidate.state)) {
    throw new Error("Invalid conversation registry state");
  }
  requireNonEmptyString(candidate.createdAt, "created timestamp");
  requireNonEmptyString(candidate.lastUsedAt, "last-used timestamp");
  if (typeof candidate.ownershipProof !== "object" || candidate.ownershipProof === null) {
    throw new Error("Invalid conversation ownership proof");
  }
  const proof = candidate.ownershipProof as OwnershipProof;
  if (typeof proof.createdByCoweb !== "boolean") throw new Error("Invalid ownership proof owner");
  requireNonEmptyString(proof.verifiedConversationId, "ownership proof conversation ID");
  if (proof.verifiedProjectId !== undefined) requireNonEmptyString(proof.verifiedProjectId, "ownership proof project ID");
}

function validateSnapshot(value: unknown): asserts value is RegistrySnapshot {
  if (typeof value !== "object" || value === null) throw new Error("Invalid Project conversation registry");
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== REGISTRY_VERSION) throw new Error(`Unsupported Project conversation registry schema version: ${String(candidate.version)}`);
  if (typeof candidate.revision !== "number" || !Number.isSafeInteger(candidate.revision) || candidate.revision < 0) {
    throw new Error("Invalid Project conversation registry revision");
  }
  if (!Array.isArray(candidate.records)) throw new Error("Invalid Project conversation registry records");
  for (const record of candidate.records) validateRecord(record);
}

export class ProjectConversationRegistry {
  private readonly path: string;
  private readonly now: () => string;
  private readonly write: (path: string, data: string) => void;

  constructor(options: RegistryOptions = {}) {
    this.path = options.path ?? getProjectConversationRegistryPath();
    this.now = options.now ?? (() => new Date().toISOString());
    this.write = options.write ?? ((path, data) => { void atomicWriteFile(path, data); });
  }

  read(): RegistrySnapshot {
    if (!existsSync(this.path)) return { version: REGISTRY_VERSION, revision: 0, records: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripUtf8Bom(readFileSync(this.path, "utf8")));
    } catch (error) {
      throw new Error(`Invalid Project conversation registry JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    validateSnapshot(parsed);
    return parsed;
  }

  findActive(taskId: string, project: ProjectEpochIdentity, conversationId?: string): ManagedConversation | undefined {
    if (typeof taskId !== "string" || taskId.length === 0) return undefined;
    validateProject(project);
    return this.read().records.find((record) => record.state === "active"
      && record.taskId === taskId
      && sameProject(record.project, project)
      && (conversationId === undefined || record.conversationId === conversationId));
  }

  activate(binding: VerifiedConversationBinding): ManagedConversation {
    validateBinding(binding);
    const snapshot = this.read();
    if (snapshot.records.some((record) => record.state === "active"
      && record.taskId === binding.taskId
      && sameProject(record.project, binding.project))) {
      throw new Error("An active conversation already exists for this task and project epoch");
    }
    if (snapshot.records.some((record) => record.state === "active" && record.conversationId === binding.conversationId)) {
      throw new Error("Conversation is already actively owned by another task");
    }
    const timestamp = this.now();
    const record: ManagedConversation = {
      taskId: binding.taskId,
      conversationId: binding.conversationId,
      conversationUrl: binding.conversationUrl,
      surfaceKey: binding.surfaceKey,
      project: { ...binding.project },
      verifiedConversationId: binding.verifiedConversationId,
      ...(binding.verifiedProjectId === undefined ? {} : { verifiedProjectId: binding.verifiedProjectId }),
      state: "active",
      createdAt: timestamp,
      lastUsedAt: timestamp,
      ownershipProof: {
        createdByCoweb: true,
        verifiedConversationId: binding.verifiedConversationId,
        ...(binding.verifiedProjectId === undefined ? {} : { verifiedProjectId: binding.verifiedProjectId }),
      },
    };
    this.persist({ version: REGISTRY_VERSION, revision: snapshot.revision + 1, records: [...snapshot.records, record] });
    return record;
  }

  complete(taskId: string, conversationId: string): ManagedConversation {
    return this.transition(taskId, conversationId, "active", "completed");
  }

  archive(taskId: string, conversationId: string): ManagedConversation {
    return this.transition(taskId, conversationId, "completed", "archived");
  }

  invalidateProjectEpoch(project: ProjectEpochIdentity): number {
    validateProject(project);
    const snapshot = this.read();
    let changed = 0;
    const records = snapshot.records.map((record) => {
      if (sameProject(record.project, project) && (record.state === "active" || record.state === "completed")) {
        changed += 1;
        return { ...record, state: "stale" as const, lastUsedAt: this.now() };
      }
      return record;
    });
    if (changed > 0) this.persist({ version: REGISTRY_VERSION, revision: snapshot.revision + 1, records });
    return changed;
  }

  private transition(taskId: string, conversationId: string, from: ManagedConversationState, to: ManagedConversationState): ManagedConversation {
    const snapshot = this.read();
    const index = snapshot.records.findIndex((record) => record.taskId === taskId && record.conversationId === conversationId);
    if (index < 0) throw new Error("Conversation binding was not found");
    const current = snapshot.records[index]!;
    if (!current.ownershipProof.createdByCoweb) throw new Error("Conversation binding is not owned by CoWeb");
    if (current.state !== from) throw new Error(`Conversation must be ${from} before it can become ${to}`);
    const updated = { ...current, state: to, lastUsedAt: this.now() };
    const records = [...snapshot.records];
    records[index] = updated;
    this.persist({ version: REGISTRY_VERSION, revision: snapshot.revision + 1, records });
    return updated;
  }

  private persist(snapshot: RegistrySnapshot): void {
    this.write(this.path, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
}
