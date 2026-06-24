import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getScenarioStepMessages,
  getScenarioStepMessagesByStepIds,
  replaceScenarioStepMessages,
  MAX_SCENARIO_STEP_MESSAGES,
} from '../src/scenarios.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

interface BoundStatement {
  _sql: string;
  _args: unknown[];
  bind(...args: unknown[]): BoundStatement;
  run(): Promise<{ meta: { changes: number } }>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}

function wrapD1(db: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      const built: Partial<BoundStatement> = {
        bind(...args: unknown[]) {
          return {
            _sql: sql,
            _args: args,
            async run() {
              const info = stmt.run(...args);
              return { meta: { changes: info.changes } };
            },
            async first<T>() {
              return (stmt.get(...args) as T) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...args) as T[] };
            },
          } as BoundStatement;
        },
        async first<T>() {
          return (stmt.get() as T) ?? null;
        },
        async all<T>() {
          return { results: stmt.all() as T[] };
        },
      };
      return built;
    },
    async batch(statements: BoundStatement[]) {
      const tx = db.transaction(() => {
        for (const s of statements) db.prepare(s._sql).run(...s._args);
      });
      tx();
      return statements.map(() => ({ meta: { changes: 0 } }));
    },
  } as unknown as D1Database;
}

function loadDb(): D1Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  return wrapD1(sqlite);
}

async function seedScenarioStep(db: D1Database): Promise<string> {
  const scenarioId = 'scenario-1';
  const stepId = 'step-1';
  await db
    .prepare(`INSERT INTO scenarios (id, name, trigger_type, is_active, delivery_mode, created_at, updated_at) VALUES (?, 'テスト', 'manual', 1, 'relative', datetime('now'), datetime('now'))`)
    .bind(scenarioId)
    .run();
  await db
    .prepare(`INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, created_at) VALUES (?, ?, 1, 0, 'text', '旧フキダシ', datetime('now'))`)
    .bind(stepId, scenarioId)
    .run();
  return stepId;
}

describe('scenario_step_messages', () => {
  it('replaceScenarioStepMessages inserts messages in order and getScenarioStepMessages reads them back', async () => {
    const db = loadDb();
    const stepId = await seedScenarioStep(db);

    const result = await replaceScenarioStepMessages(db, stepId, [
      { messageType: 'text', messageContent: 'フキダシ1' },
      { messageType: 'flex', messageContent: '{"type":"bubble"}', templateId: null },
    ]);

    expect(result.map((m) => m.message_content)).toEqual(['フキダシ1', '{"type":"bubble"}']);
    expect(result.map((m) => m.order_index)).toEqual([0, 1]);

    const reread = await getScenarioStepMessages(db, stepId);
    expect(reread.map((m) => m.message_content)).toEqual(['フキダシ1', '{"type":"bubble"}']);
  });

  it('replaceScenarioStepMessages replaces (not appends) the previous list', async () => {
    const db = loadDb();
    const stepId = await seedScenarioStep(db);

    await replaceScenarioStepMessages(db, stepId, [
      { messageType: 'text', messageContent: 'A' },
      { messageType: 'text', messageContent: 'B' },
    ]);
    await replaceScenarioStepMessages(db, stepId, [{ messageType: 'text', messageContent: 'C' }]);

    const final = await getScenarioStepMessages(db, stepId);
    expect(final.map((m) => m.message_content)).toEqual(['C']);
  });

  it('rejects more than the LINE push limit (5) messages', async () => {
    const db = loadDb();
    const stepId = await seedScenarioStep(db);

    const tooMany = Array.from({ length: MAX_SCENARIO_STEP_MESSAGES + 1 }, (_, i) => ({
      messageType: 'text' as const,
      messageContent: `m${i}`,
    }));

    await expect(replaceScenarioStepMessages(db, stepId, tooMany)).rejects.toThrow();
  });

  it('rejects an empty message list', async () => {
    const db = loadDb();
    const stepId = await seedScenarioStep(db);
    await expect(replaceScenarioStepMessages(db, stepId, [])).rejects.toThrow();
  });

  it('cascades delete when the parent scenario_step is deleted', async () => {
    const db = loadDb();
    const stepId = await seedScenarioStep(db);
    await replaceScenarioStepMessages(db, stepId, [{ messageType: 'text', messageContent: 'X' }]);

    await db.prepare(`DELETE FROM scenario_steps WHERE id = ?`).bind(stepId).run();

    const remaining = await getScenarioStepMessages(db, stepId);
    expect(remaining).toEqual([]);
  });

  it('getScenarioStepMessagesByStepIds bulk-fetches messages for multiple steps at once', async () => {
    const db = loadDb();
    const stepId1 = await seedScenarioStep(db);
    await db
      .prepare(`INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, created_at) VALUES ('step-2', 'scenario-1', 2, 0, 'text', '旧', datetime('now'))`)
      .bind()
      .run();

    await replaceScenarioStepMessages(db, stepId1, [{ messageType: 'text', messageContent: 'S1-M1' }]);
    await replaceScenarioStepMessages(db, 'step-2', [
      { messageType: 'text', messageContent: 'S2-M1' },
      { messageType: 'text', messageContent: 'S2-M2' },
    ]);

    const map = await getScenarioStepMessagesByStepIds(db, [stepId1, 'step-2']);
    expect(map.get(stepId1)?.map((m) => m.message_content)).toEqual(['S1-M1']);
    expect(map.get('step-2')?.map((m) => m.message_content)).toEqual(['S2-M1', 'S2-M2']);
  });

  it('getScenarioStepMessagesByStepIds returns an empty map for an empty input', async () => {
    const db = loadDb();
    const map = await getScenarioStepMessagesByStepIds(db, []);
    expect(map.size).toBe(0);
  });
});
