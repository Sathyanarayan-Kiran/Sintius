import pg from "pg";
import type { CredentialStatusStore } from "../../application/authentication-ports.ts";

const { Pool } = pg;

/** Durable revocation list: checked on every authentication, so a revocation denies the next request. */
export class PostgresCredentialStatusStore implements CredentialStatusStore {
  readonly #pool;

  constructor(options: { readonly connectionString?: string; readonly maxConnections?: number } = {}) {
    this.#pool = new Pool({
      connectionString: options.connectionString ?? process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius",
      max: options.maxConnections ?? 5,
    });
  }

  async isRevoked(credential: { readonly issuer: string; readonly credentialId: string }): Promise<boolean> {
    const result = await this.#pool.query("SELECT 1 FROM credential_revocation WHERE issuer = $1 AND credential_id = $2", [credential.issuer, credential.credentialId]);
    return (result.rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
