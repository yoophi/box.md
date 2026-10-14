import type {
  AgentChatClient,
  AgentChatSnapshot,
  SessionOptions,
} from "@/entities/agent-chat";
import type {
  DocumentMcpGrant,
  DocumentMcpGrantApi,
} from "@/entities/document-mcp";

type Mode =
  | "preparing"
  | "enabled"
  | "unsupported"
  | "revoked"
  | "cleanupFailed";
interface Lease {
  released?: boolean;
  grant: DocumentMcpGrant;
  reason?: Mode;
  flight?: Promise<void>;
}
const unsupported =
  "agent does not advertise HTTP MCP support; skipping MCP server setup";
const unavailable =
  "문서 도구를 연결하지 못했습니다. 다시 연결하거나 일반 채팅을 선택해주세요.";
const changed = "작업 디렉터리가 변경되어 문서 도구 연결을 취소했습니다.";
const cleanupFailed =
  "문서 도구 연결 해제를 확인하지 못했습니다. 다시 연결해주세요.";

/** Box grant policy around the shared AW client; owns no ACP transport/process. */
export class DocumentChatSessions {
  #generation: string | undefined;
  #epoch = 0;
  #disposed = false;
  #leases = new Map<string, Lease>();
  #modes = new Map<string, Mode>();
  #secrets = new Set<string>();
  #notice: string | null = null;
  #unlisten: () => void;
  constructor(
    private readonly client: AgentChatClient,
    private readonly api: DocumentMcpGrantApi,
    private readonly changedState: () => void = () => {},
  ) {
    // This observer remains active while the panel is collapsed.
    this.#unlisten = client.subscribe((snapshot) => this.observe(snapshot));
  }
  setGeneration(generation: string | undefined) {
    if (generation === this.#generation) return;
    this.#generation = generation;
    this.#epoch++;
    this.#notice = null;
    for (const [id, lease] of this.#leases)
      void this.release(id, lease, "revoked");
    this.changedState();
  }
  getStatus() {
    return {
      notice: this.#notice,
      modes: Object.fromEntries(this.#modes),
      cleanupPending: [...this.#modes.values()].includes("cleanupFailed"),
    };
  }
  getSnapshot(): AgentChatSnapshot {
    return this.redact(this.client.getSnapshot());
  }
  subscribe(listener: (snapshot: AgentChatSnapshot) => void) {
    return this.client.subscribe((snapshot) => listener(this.redact(snapshot)));
  }
  safeMessage(cause: unknown) {
    return this.mask(
      cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다.",
    );
  }
  async createSession(options: SessionOptions, documents: boolean) {
    if (this.#disposed) throw new Error(changed);
    if (!documents)
      return this.redact(await this.client.createSession(options));
    const generation = this.#generation,
      epoch = this.#epoch;
    const runId = options.runId ?? crypto.randomUUID();
    if (!generation) throw new Error("먼저 작업 디렉터리를 선택해주세요.");
    if (
      this.#modes.get(runId) === "preparing" ||
      this.#leases.has(runId) ||
      this.client.getSnapshot().sessions.some((session) => session.id === runId)
    )
      throw new Error("이미 사용한 세션입니다. 새 세션을 만들어주세요.");
    this.#modes.set(runId, "preparing");
    this.changedState();
    let grant: DocumentMcpGrant;
    try {
      grant = await this.api.issue(generation, runId);
    } catch {
      this.#modes.set(runId, "revoked");
      if (this.#disposed || epoch !== this.#epoch) throw new Error(changed);
      this.#notice = unavailable;
      this.changedState();
      throw new Error(unavailable);
    }
    for (const header of grant.server?.headers ?? []) {
      if (header.name.toLowerCase() === "authorization" && header.value) {
        this.#secrets.add(header.value);
        this.#secrets.add(header.value.replace(/^Bearer\s+/i, ""));
      }
    }
    const lease: Lease = { grant };
    this.#leases.set(runId, lease);
    if (
      this.#disposed ||
      epoch !== this.#epoch ||
      generation !== this.#generation
    ) {
      await this.release(runId, lease, "revoked");
      throw new Error(changed);
    }
    if (
      grant.generation !== generation ||
      grant.runId !== runId ||
      !grant.grantId ||
      grant.server?.type !== "http" ||
      (options.mcpServers ?? []).some(
        (server) => server.name === grant.server.name,
      )
    ) {
      await this.release(runId, lease, "revoked");
      this.#notice = unavailable;
      this.changedState();
      throw new Error(unavailable);
    }
    this.#modes.set(runId, "enabled");
    this.changedState();
    try {
      const result = await this.client.createSession({
        ...options,
        runId,
        mcpServers: [...(options.mcpServers ?? []), grant.server],
      });
      if (result.kind !== "ok" || this.#disposed || epoch !== this.#epoch)
        await this.release(runId, lease, "revoked");
      if (this.#disposed || epoch !== this.#epoch) throw new Error(changed);
      return this.redact(result);
    } catch (cause) {
      await this.release(runId, lease, "revoked");
      throw new Error(this.safeMessage(cause));
    }
  }
  async closeSession(id: string) {
    const lease = this.#leases.get(id);
    if (lease) await this.release(id, lease, "revoked");
    return this.redact(await this.client.closeSession(id));
  }
  async retryCleanup() {
    await Promise.all(
      [...this.#leases].map(([id, lease]) =>
        lease.reason
          ? this.release(id, lease, lease.reason)
          : Promise.resolve(),
      ),
    );
  }
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#epoch++;
    this.#generation = undefined;
    this.#unlisten();
    await Promise.all(
      [...this.#leases].map(([id, lease]) =>
        this.release(id, lease, "revoked"),
      ),
    );
  }
  private observe(snapshot: AgentChatSnapshot) {
    for (const [id, lease] of this.#leases) {
      const session = snapshot.sessions.find((session) => session.id === id);
      if (
        session?.events.some(
          ({ event }) =>
            event.type === "diagnostic" && event.message === unsupported,
        )
      ) {
        this.#notice =
          "이 에이전트는 문서 도구 연결을 지원하지 않습니다. 일반 채팅은 계속 사용할 수 있습니다.";
        void this.release(id, lease, "unsupported");
      } else if (
        snapshot.disposed ||
        (session && ["closed", "lost", "failed"].includes(session.status))
      )
        void this.release(id, lease, "revoked");
    }
  }
  private release(id: string, lease: Lease, reason: Mode): Promise<void> {
    if (lease.released) return Promise.resolve();
    lease.reason ??= reason;
    if (lease.flight) return lease.flight;
    const flight = Promise.resolve()
      .then(() => this.api.revoke(lease.grant.grantId))
      .then(() => {
        lease.released = true;
        if (this.#leases.get(id) === lease) this.#leases.delete(id);
        this.#modes.set(id, lease.reason!);
      })
      .catch(() => {
        this.#modes.set(id, "cleanupFailed");
        this.#notice = cleanupFailed;
      })
      .finally(() => {
        lease.flight = undefined;
        if (
          this.#notice === cleanupFailed &&
          ![...this.#modes.values()].includes("cleanupFailed")
        )
          this.#notice = null;
        this.changedState();
      });
    lease.flight = flight;
    return flight;
  }
  private mask(value: string) {
    for (const secret of this.#secrets)
      if (secret) value = value.replaceAll(secret, "[비공개]");
    return value;
  }
  private redact<T>(value: T): T {
    const visit = (item: unknown): unknown => {
      if (typeof item === "string") return this.mask(item);
      if (Array.isArray(item)) return item.map(visit);
      if (item && typeof item === "object")
        return Object.fromEntries(
          Object.entries(item).map(([key, value]) => [
            this.mask(key),
            visit(value),
          ]),
        );
      return item;
    };
    return visit(value) as T;
  }
}
