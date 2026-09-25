import pg from "pg";
import type { EventEnvelope } from "../../../event-envelope/src/index.ts";
import type { EventPublisher } from "../../src/ports.ts";

const { Client, Pool } = pg;

const DISPATCHER_URL = "postgresql://sintius_dispatcher@127.0.0.1:54329/sintius";
const CONSUMER_PATTERN = /^[a-z][a-z0-9_.:-]{0,63}$/;

/** Wakes idle delivery workers; the payload is the consumer name. */
export const DELIVERY_CHANNEL = "sintius_event_delivery";

/** Which consumer receives which event types (the full CloudEvents `type`, for example `com.subrevos.tenant.activated.v1`). */
export interface EventRoute {
  readonly consumer: string;
  readonly eventTypes: readonly string[];
}

function validatedRoutes(routes: readonly EventRoute[]): ReadonlyMap<string, readonly string[]> {
  const byType = new Map<string, string[]>();
  const consumers = new Set<string>();
  for (const route of routes) {
    if (!CONSUMER_PATTERN.test(route.consumer)) throw new TypeError(`Invalid consumer name "${route.consumer}".`);
    if (consumers.has(route.consumer)) throw new TypeError(`Consumer "${route.consumer}" is routed twice.`);
    consumers.add(route.consumer);
    if (route.eventTypes.length === 0) throw new TypeError(`Consumer "${route.consumer}" subscribes to no event types.`);
    for (const type of route.eventTypes) {
      if (typeof type !== "string" || type.trim() === "" || type.includes("*")) throw new TypeError("Event types must be exact, non-empty type names.");
      byType.set(type, [...(byType.get(type) ?? []), route.consumer]);
    }
  }
  return byType;
}

/**
 * The interim transport's publisher (decision D14): used by the outbox dispatcher as its
 * `EventPublisher`. One statement inserts a delivery per subscribed consumer and notifies the
 * workers, so publishing is atomic. A republish of the same event (at-least-once dispatch) inserts
 * nothing thanks to the (consumer, tenant, event) key. Routes are explicit exact event types, so a
 * new consumer or event is a reviewed code change rather than an accidental wildcard match.
 */
export class PostgresEventPublisher implements EventPublisher {
  readonly #pool;
  readonly #routes: ReadonlyMap<string, readonly string[]>;
  readonly #clock: () => Date;

  constructor(options: { readonly routes: readonly EventRoute[]; readonly clock?: () => Date; readonly connectionString?: string; readonly maxConnections?: number }) {
    this.#routes = validatedRoutes(options.routes);
    this.#clock = options.clock ?? (() => new Date());
    this.#pool = new Pool({
      connectionString: options.connectionString ?? process.env.SINTIUS_DISPATCHER_DATABASE_URL ?? DISPATCHER_URL,
      max: options.maxConnections ?? 3,
    });
  }

  /** Consumers subscribed to an event type; empty when nobody listens (the event is then only in the outbox). */
  consumersFor(eventType: string): readonly string[] {
    return this.#routes.get(eventType) ?? [];
  }

  async publish(envelope: Readonly<EventEnvelope>): Promise<void> {
    const consumers = this.consumersFor(envelope.type);
    if (consumers.length === 0) return;
    const now = this.#clock().toISOString();
    await this.#pool.query(
      `WITH inserted AS (
         INSERT INTO event_delivery (
           consumer, tenant_id, event_id, event_type, aggregate_type, aggregate_id, aggregate_version,
           envelope, next_attempt_at, enqueued_at
         )
         SELECT consumer, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $9
           FROM unnest($1::text[]) AS consumer
         ON CONFLICT (consumer, tenant_id, event_id) DO NOTHING
         RETURNING consumer
       )
       SELECT pg_notify('${DELIVERY_CHANNEL}', consumer) FROM inserted`,
      [
        consumers, envelope.tenant_id, envelope.id, envelope.type, envelope.aggregate_type, envelope.aggregate_id,
        envelope.aggregate_version, JSON.stringify(envelope), now,
      ],
    );
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

/**
 * Lets an idle delivery worker sleep until a delivery for its consumer is committed instead of
 * polling tightly. A timeout still returns, so a missed notification only delays work until the
 * next poll; notifications are a latency optimization, never the source of truth.
 */
export class PostgresDeliveryListener {
  readonly #client;
  readonly #waiters = new Set<{ readonly consumer: string; readonly wake: () => void }>();
  #started: Promise<void> | undefined;

  constructor(options: { readonly connectionString?: string } = {}) {
    this.#client = new Client({ connectionString: options.connectionString ?? process.env.SINTIUS_DISPATCHER_DATABASE_URL ?? DISPATCHER_URL });
    this.#client.on("notification", (message) => {
      if (message.channel !== DELIVERY_CHANNEL) return;
      for (const waiter of [...this.#waiters]) if (waiter.consumer === message.payload) waiter.wake();
    });
  }

  start(): Promise<void> {
    this.#started ??= (async () => {
      await this.#client.connect();
      await this.#client.query(`LISTEN ${DELIVERY_CHANNEL}`);
    })();
    return this.#started;
  }

  /** Resolves `true` when a delivery for `consumer` is committed, `false` after `timeoutMs`. */
  async waitFor(consumer: string, timeoutMs: number): Promise<boolean> {
    await this.start();
    return new Promise((resolve) => {
      const waiter = {
        consumer,
        wake: () => {
          clearTimeout(timer);
          this.#waiters.delete(waiter);
          resolve(true);
        },
      };
      const timer = setTimeout(() => {
        this.#waiters.delete(waiter);
        resolve(false);
      }, timeoutMs);
      this.#waiters.add(waiter);
    });
  }

  async close(): Promise<void> {
    for (const waiter of [...this.#waiters]) waiter.wake();
    if (this.#started !== undefined) await this.#client.end();
  }
}
