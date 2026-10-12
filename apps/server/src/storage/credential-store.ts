import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';
import type { Storage } from './index.js';
import { SerialByKey } from '../lib/serial.js';

export class SqliteCredentialStore implements CredentialStore {
  private readonly serial = new SerialByKey();
  constructor(private readonly storage: Storage) {}
  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    const row = this.storage.database.prepare('SELECT credential_json FROM credentials WHERE provider_id=?').get(providerId);
    return row ? JSON.parse(String(row.credential_json)) as Credential : undefined;
  }
  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    return this.storage.database.prepare("SELECT provider_id, json_extract(credential_json, '$.type') AS type FROM credentials ORDER BY provider_id").all().map(row => ({providerId: String(row.provider_id), type: row.type as Credential['type']}));
  }
  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>, options?: AuthOperationOptions): Promise<Credential | undefined> {
    return this.serial.run(providerId, async () => {
      const current = await this.read(providerId, options);
      const next = await fn(current);
      options?.signal?.throwIfAborted();
      if (next !== undefined) this.storage.database.prepare('INSERT INTO credentials VALUES (?,?) ON CONFLICT(provider_id) DO UPDATE SET credential_json=excluded.credential_json').run(providerId, JSON.stringify(next));
      return next ?? current;
    });
  }
  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.serial.run(providerId, async () => {
      options?.signal?.throwIfAborted();
      this.storage.database.prepare('DELETE FROM credentials WHERE provider_id=?').run(providerId);
    });
  }
}
