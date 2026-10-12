import type { DatabaseSync } from 'node:sqlite';
import type { CrewEvent, EventData } from '@crewbus/contracts';
import { transaction } from '../storage/database.js';
import { missing, invalid } from '../lib/error.js';
export class EventRepository {
  constructor(private db: DatabaseSync) {
  }
  private chat(runId: string): string {
    const row = this.db.prepare('SELECT chat_id FROM runs WHERE id=?').get(runId);
    if (!row)
      return missing();
    return String(row.chat_id);
  }
  cursor(runId: string): number {
    this.chat(runId);
    return Number(this.db.prepare('SELECT MAX(id) AS n FROM events WHERE run_id=?').get(runId)?.n ?? 0);
  }
  append(runId: string, data: EventData): CrewEvent {
    return transaction(this.db, () => {
      const chatId = this.chat(runId), id = this.cursor(runId) + 1;
      this.db.prepare('INSERT INTO events VALUES (?,?,?)').run(runId, id, JSON.stringify(data));
      return {
        id, runId, chatId, data
      };
    });
  }
  since(runId: string, after: number): CrewEvent[] {
    if (!Number.isSafeInteger(after) || after < 0)
      invalid();
    const chatId = this.chat(runId);
    return this.db.prepare('SELECT * FROM events WHERE run_id=? AND id>? ORDER BY id').all(runId, after).map(r => ({
      id: Number(r.id), runId, chatId, data: JSON.parse(String(r.data_json)) as EventData
    }));
  }
}
