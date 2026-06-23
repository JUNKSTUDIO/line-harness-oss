// アンケート (フォーム) の回答内容から、設問・選択肢ごとに発生させるべき副作用を計算する。
// 既存の forms.ts の DB 操作からあえて純粋関数として切り出してある — ここではDBに触らず、
// 「何をすべきか」だけを返す。実際の実行 (タグ付与・スコア加算・シナリオ登録) は呼び出し側で行う。

// 選択肢ごとの回答時アクション (任意)。プレーン文字列の選択肢 (旧形式) と共存する —
// 文字列のままなら従来通りタグ/点数/シナリオ分岐は発生しない。
export interface FormFieldOption {
  value: string;
  label?: string;
  tagId?: string | null;
  scoreValue?: number | null;
  branchScenarioId?: string | null;
}

export interface FormFieldDef {
  name: string;
  label: string;
  type: string;
  options?: Array<string | FormFieldOption>;
}

export type FormAnswerEffect =
  | { type: 'tag'; tagId: string }
  | { type: 'score'; amount: number; reason: string }
  | { type: 'scenario'; scenarioId: string };

export function computeFormAnswerEffects(
  formName: string,
  fields: FormFieldDef[],
  submissionData: Record<string, unknown>,
): FormAnswerEffect[] {
  const effects: FormAnswerEffect[] = [];

  for (const field of fields) {
    const answer = submissionData[field.name];
    if (answer === undefined || answer === null) continue;

    // rating型: 回答値そのもの (例: 1〜5) を点数としてそのまま加算する。
    if (field.type === 'rating') {
      const num = Number(answer);
      if (Number.isFinite(num) && num !== 0) {
        effects.push({ type: 'score', amount: num, reason: `アンケート「${formName}」の「${field.label}」: ${num}点` });
      }
      continue;
    }

    // radio/select/checkbox: rich形式 ({value, tagId?, scoreValue?, branchScenarioId?}) の
    // 選択肢が無ければ何もしない (従来のプレーン文字列選択肢はそのまま無視される)。
    const richOptions = (field.options ?? []).filter(
      (o): o is FormFieldOption => typeof o === 'object' && o !== null,
    );
    if (richOptions.length === 0) continue;

    const answeredValues = Array.isArray(answer) ? answer.map(String) : [String(answer)];
    for (const value of answeredValues) {
      const option = richOptions.find((o) => o.value === value);
      if (!option) continue;
      if (option.tagId) effects.push({ type: 'tag', tagId: option.tagId });
      if (option.scoreValue) {
        effects.push({
          type: 'score',
          amount: option.scoreValue,
          reason: `アンケート「${formName}」の「${field.label}」: ${option.label ?? option.value}`,
        });
      }
      if (option.branchScenarioId) effects.push({ type: 'scenario', scenarioId: option.branchScenarioId });
    }
  }

  return effects;
}
