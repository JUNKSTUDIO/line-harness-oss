import { describe, expect, test } from 'vitest';
import { computeFormAnswerEffects } from './form-answer-effects.js';
import type { FormFieldDef } from './form-answer-effects.js';

describe('computeFormAnswerEffects', () => {
  test('rating type: adds the answer value directly as a score', () => {
    const fields: FormFieldDef[] = [{ name: 'satisfaction', label: '満足度', type: 'rating' }];
    const effects = computeFormAnswerEffects('満足度調査', fields, { satisfaction: 4 });
    expect(effects).toEqual([{ type: 'score', amount: 4, reason: 'アンケート「満足度調査」の「満足度」: 4点' }]);
  });

  test('rating type: ignores a zero or non-numeric answer', () => {
    const fields: FormFieldDef[] = [{ name: 'satisfaction', label: '満足度', type: 'rating' }];
    expect(computeFormAnswerEffects('調査', fields, { satisfaction: 0 })).toEqual([]);
    expect(computeFormAnswerEffects('調査', fields, { satisfaction: 'not-a-number' })).toEqual([]);
  });

  test('radio with rich options: applies tag, score, and scenario for the selected option', () => {
    const fields: FormFieldDef[] = [
      {
        name: 'plan',
        label: 'ご希望のプラン',
        type: 'radio',
        options: [
          { value: 'a', label: 'プランA', tagId: 'tag-a', scoreValue: 10, branchScenarioId: 'scenario-a' },
          { value: 'b', label: 'プランB', tagId: 'tag-b' },
        ],
      },
    ];
    const effects = computeFormAnswerEffects('プラン調査', fields, { plan: 'a' });
    expect(effects).toEqual([
      { type: 'tag', tagId: 'tag-a' },
      { type: 'score', amount: 10, reason: 'アンケート「プラン調査」の「ご希望のプラン」: プランA' },
      { type: 'scenario', scenarioId: 'scenario-a' },
    ]);
  });

  test('checkbox with rich options: applies effects for every selected option', () => {
    const fields: FormFieldDef[] = [
      {
        name: 'interests',
        label: '興味のある分野',
        type: 'checkbox',
        options: [
          { value: 'x', label: 'X', tagId: 'tag-x' },
          { value: 'y', label: 'Y', tagId: 'tag-y' },
          { value: 'z', label: 'Z', tagId: 'tag-z' },
        ],
      },
    ];
    const effects = computeFormAnswerEffects('興味調査', fields, { interests: ['x', 'z'] });
    expect(effects).toEqual([
      { type: 'tag', tagId: 'tag-x' },
      { type: 'tag', tagId: 'tag-z' },
    ]);
  });

  test('plain string options (legacy format) produce no effects', () => {
    const fields: FormFieldDef[] = [
      { name: 'plan', label: 'プラン', type: 'radio', options: ['プランA', 'プランB'] },
    ];
    expect(computeFormAnswerEffects('調査', fields, { plan: 'プランA' })).toEqual([]);
  });

  test('an answer that does not match any configured option produces no effects', () => {
    const fields: FormFieldDef[] = [
      { name: 'plan', label: 'プラン', type: 'radio', options: [{ value: 'a', tagId: 'tag-a' }] },
    ];
    expect(computeFormAnswerEffects('調査', fields, { plan: 'unmatched-value' })).toEqual([]);
  });

  test('unanswered (missing) fields are skipped entirely', () => {
    const fields: FormFieldDef[] = [
      { name: 'plan', label: 'プラン', type: 'radio', options: [{ value: 'a', tagId: 'tag-a' }] },
      { name: 'satisfaction', label: '満足度', type: 'rating' },
    ];
    expect(computeFormAnswerEffects('調査', fields, {})).toEqual([]);
  });

  test('free-text fields never produce effects, even if a same-named tag-like value is given', () => {
    const fields: FormFieldDef[] = [{ name: 'comment', label: 'ご意見', type: 'textarea' }];
    expect(computeFormAnswerEffects('調査', fields, { comment: 'great service' })).toEqual([]);
  });
});
