/** 托管 ES ILM：热阶段 rollover + 可选 warm/delete（见 `docs/ops/SCALE_VALIDATION.md`） */

export function elasticIlmEnabled(): boolean {
  return process.env.ELASTICSEARCH_ILM_ENABLED === 'true';
}

export function elasticIlmPolicyName(baseIndex: string): string {
  const suffix = baseIndex.replace(/^ranking_/, '');
  return `ranking-${suffix}-ilm`;
}

export function elasticIlmRolloverConditions(): { maxDocs: number; maxAge: string } {
  const maxDocs = Number(process.env.ELASTICSEARCH_ROLLOVER_MAX_DOCS ?? '50000000') || 50_000_000;
  const maxAge = process.env.ELASTICSEARCH_ROLLOVER_MAX_AGE?.trim() || '30d';
  return { maxDocs, maxAge };
}

export function elasticIlmDeleteAfterDays(): number | null {
  const raw = process.env.ELASTICSEARCH_ILM_DELETE_AFTER_DAYS?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function buildIlmPolicyBody(baseIndex: string): Record<string, unknown> {
  const { maxDocs, maxAge } = elasticIlmRolloverConditions();
  const deleteDays = elasticIlmDeleteAfterDays();
  const phases: Record<string, unknown> = {
    hot: {
      min_age: '0ms',
      actions: {
        rollover: {
          max_docs: maxDocs,
          max_age: maxAge,
        },
        set_priority: { priority: 100 },
      },
    },
  };
  if (deleteDays !== null) {
    phases.delete = {
      min_age: `${deleteDays}d`,
      actions: { delete: {} },
    };
  }
  return {
    policy: {
      phases,
      _meta: { baseIndex, managedBy: 'ranking-platform' },
    },
  };
}
