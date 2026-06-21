import { describe, it, expect } from 'vitest';
import { resolveActiveMultiplier, type PointMultiplierRuleRow } from '../src/stamp-cards.js';

function makeRule(overrides: Partial<PointMultiplierRuleRow>): PointMultiplierRuleRow {
  return {
    id: 'rule', line_account_id: 'acc-1', name: 'rule', multiplier: 1, condition_type: 'manual',
    weekday: null, day_of_month: null, time_start: null, time_end: null, starts_at: null, ends_at: null,
    weather_condition: null, is_active: 1, priority: 0, created_at: '', updated_at: '',
    ...overrides,
  };
}

describe('resolveActiveMultiplier: combination modes', () => {
  const now = new Date('2026-06-21T03:00:00.000Z'); // JST正午

  it('highest_priority_only (default): only the highest-priority matching rule applies', () => {
    const rules = [
      makeRule({ id: 'rain', name: '雨の日2倍', multiplier: 2, priority: 10 }),
      makeRule({ id: 'test', name: 'テスト1.5倍', multiplier: 1.5, priority: 5 }),
    ];
    const result = resolveActiveMultiplier(rules, now, 'highest_priority_only');
    expect(result.multiplier).toBe(2);
    expect(result.ruleId).toBe('rain');
    expect(result.appliedRules).toHaveLength(2); // 判定対象としては両方マッチしているが、適用は1件のみ
  });

  it('multiply_all: matching rules multiply together (2 * 1.5 = 3)', () => {
    const rules = [
      makeRule({ id: 'rain', name: '雨の日2倍', multiplier: 2, priority: 10 }),
      makeRule({ id: 'test', name: 'テスト1.5倍', multiplier: 1.5, priority: 5 }),
    ];
    const result = resolveActiveMultiplier(rules, now, 'multiply_all');
    expect(result.multiplier).toBe(3);
    expect(result.ruleId).toBeNull(); // 複数ルール合算時は単一IDに紐付けない
  });

  it('sum_all: matching rules sum together (2 + 1.5 = 3.5)', () => {
    const rules = [
      makeRule({ id: 'rain', name: '雨の日2倍', multiplier: 2, priority: 10 }),
      makeRule({ id: 'test', name: 'テスト1.5倍', multiplier: 1.5, priority: 5 }),
    ];
    const result = resolveActiveMultiplier(rules, now, 'sum_all');
    expect(result.multiplier).toBe(3.5);
    expect(result.ruleId).toBeNull();
  });

  it('a single matching rule behaves identically regardless of combination mode', () => {
    const rules = [makeRule({ id: 'rain', name: '雨の日2倍', multiplier: 2 })];
    for (const mode of ['highest_priority_only', 'multiply_all', 'sum_all'] as const) {
      const result = resolveActiveMultiplier(rules, now, mode);
      expect(result.multiplier).toBe(2);
      expect(result.ruleId).toBe('rain');
    }
  });

  it('no matching rules: multiplier is 1 regardless of mode', () => {
    const rules = [makeRule({ id: 'inactive', is_active: 0 })];
    const result = resolveActiveMultiplier(rules, now, 'multiply_all');
    expect(result.multiplier).toBe(1);
    expect(result.ruleId).toBeNull();
    expect(result.appliedRules).toEqual([]);
  });
});
