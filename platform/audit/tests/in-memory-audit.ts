import type { AuditEvent, AuditPage, AuditReadStore, AuditWriter, NormalizedAuditQuery } from "../src/index.ts";
import type { TenantId } from "../../tenant-context/src/index.ts";

/**
 * TEST DOUBLE ONLY. Models append-only rows, staged commit or rollback and tenant-filtered reads.
 * It is NOT evidence of database-privilege immutability (no UPDATE/DELETE grant), RLS, or real
 * transactional atomicity; those need the PostgreSQL adapter.
 */
export interface TestAuditUnitOfWork {
  readonly domain: { write(row: string): void };
  readonly audit: AuditWriter;
  readonly reads: AuditReadStore;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export class InMemoryAuditStore {
  domainRows: string[] = [];
  rows: Array<{ sequence: number; event: Readonly<AuditEvent> }> = [];
  transactionsStarted = 0;
  #sequence = 0;

  async runInTransaction<T>(_scope: unknown, work: (unitOfWork: TestAuditUnitOfWork) => Promise<T>): Promise<T> {
    this.transactionsStarted += 1;
    const domain: string[] = [];
    const staged: Array<Readonly<AuditEvent>> = [];
    const known = () => new Set([...this.rows.map((row) => row.event.auditEventId), ...staged.map((event) => event.auditEventId)]);
    const result = await work({
      domain: { write: (row) => void domain.push(row) },
      audit: {
        append: async (event) => {
          if (known().has(event.auditEventId)) throw new Error("audit rows are append-only; duplicate id rejected");
          staged.push(deepFreeze(structuredClone(event)));
        },
      },
      reads: {
        query: async (tenantId: TenantId, query: Readonly<NormalizedAuditQuery>): Promise<AuditPage> => {
          const matches = this.rows
            .filter(({ event, sequence }) => {
              if (event.tenantId !== tenantId) return false;
              if (query.cursor !== undefined && sequence <= query.cursor) return false;
              if (query.action !== undefined && event.action !== query.action) return false;
              if (query.targetType !== undefined && event.target.type !== query.targetType) return false;
              if (query.targetId !== undefined && event.target.id !== query.targetId) return false;
              if (query.actorId !== undefined && event.actor.id !== query.actorId) return false;
              if (query.correlationId !== undefined && event.correlationId !== query.correlationId) return false;
              if (query.from !== undefined && Date.parse(event.occurredAt) < Date.parse(query.from)) return false;
              if (query.to !== undefined && Date.parse(event.occurredAt) >= Date.parse(query.to)) return false;
              return true;
            })
            .slice(0, query.limit + 1);
          const page = matches.slice(0, query.limit);
          return {
            events: page.map((row) => row.event),
            ...(matches.length > query.limit ? { nextCursor: page[page.length - 1]!.sequence } : {}),
          };
        },
      },
    });
    this.domainRows.push(...domain);
    for (const event of staged) {
      this.#sequence += 1;
      this.rows.push({ sequence: this.#sequence, event });
    }
    return result;
  }

  events(): Array<Readonly<AuditEvent>> {
    return this.rows.map((row) => row.event);
  }
}
