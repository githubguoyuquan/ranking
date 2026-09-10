import { Injectable } from '@nestjs/common';
import type { TopicKind } from '@prisma/client';

export type TopicMetricDefinition = {
  key: string;
  label: string;
  description: string;
  normalizationGuide: string;
  sourceHints: string[];
  weight: number;
  required: boolean;
};

export type TopicMetricPlan = {
  generatedBy: 'local_algorithm';
  rationale: string;
  metrics: TopicMetricDefinition[];
};

type MetricTemplate = TopicMetricDefinition;

const ZH_PLANS: Record<TopicKind, MetricTemplate[]> = {
  OBJECTIVE: [
    { key: 'verified_outcome', label: '可核验结果', description: '衡量对象在本话题范围内可由公开记录核验的结果。', normalizationGuide: '限定同一统计周期和候选范围，按结果值做百分位换算；缺失记 0 分。', sourceHints: ['Wikidata 条目所列权威来源', '主管机构或主办方公开记录'], weight: 0.6, required: true },
    { key: 'record_completeness', label: '记录完整度', description: '衡量用于比较的公开记录是否完整、口径是否一致。', normalizationGuide: '按必需字段完整率换算为 0–100 分；无法交叉核验的字段不计入。', sourceHints: ['Wikidata 引用信息', '公开原始记录'], weight: 0.25, required: true },
    { key: 'source_consistency', label: '来源一致性', description: '衡量不同公开来源对关键结果的相互印证程度。', normalizationGuide: '按一致来源数及冲突比例换算；存在未解决冲突时扣分。', sourceHints: ['Wikidata 引用信息', '至少两个相互独立的公开来源'], weight: 0.15, required: false },
  ],
  SEMI_OBJECTIVE: [
    { key: 'documented_achievement', label: '有据成果', description: '衡量对象与本话题直接相关且有公开资料支持的成果。', normalizationGuide: '先定义同一成果口径和时间窗，再按候选内百分位换算；缺失记 0 分。', sourceHints: ['Wikidata 条目所列权威来源', '相关机构公开档案'], weight: 0.5, required: true },
    { key: 'independent_recognition', label: '独立认可', description: '衡量相互独立的可靠来源对相关成果的认可程度。', normalizationGuide: '按符合事先标准的独立记录数量和级别换算，重复转载只算一次。', sourceHints: ['权威机构公开记录', '可核验的专业组织资料'], weight: 0.3, required: false },
    { key: 'evidence_quality', label: '证据质量', description: '衡量本话题所用资料的来源等级、完整度和可追溯性。', normalizationGuide: '按有原始出处的必需字段占比换算；匿名或不可追溯资料不计分。', sourceHints: ['Wikidata 引用信息', '公开原始资料'], weight: 0.2, required: true },
  ],
  SUBJECTIVE_TREND: [
    { key: 'current_attention', label: '当前关注度', description: '衡量对象在约定时间窗内与本话题直接相关的公开关注。', normalizationGuide: '固定平台、时间窗和去重规则，按候选内百分位换算；不得混用不同口径。', sourceHints: ['公开趋势数据', '公开站点统计页'], weight: 0.45, required: true },
    { key: 'attention_momentum', label: '关注增势', description: '衡量当前时间窗相对上一等长时间窗的关注变化。', normalizationGuide: '用环比变化率进行缩尾后映射到 0–100 分；基期过小时标记低置信。', sourceHints: ['公开趋势数据', '可重复采集的公开统计'], weight: 0.35, required: false },
    { key: 'source_diversity', label: '来源多样性', description: '衡量关注是否来自多个相互独立的公开渠道。', normalizationGuide: '按有效独立来源覆盖率换算，转载和镜像站合并计算。', sourceHints: ['多个公开数据源', 'Wikidata 引用信息'], weight: 0.2, required: false },
  ],
};

const EN_PLANS: Record<TopicKind, MetricTemplate[]> = {
  OBJECTIVE: [
    { key: 'verified_outcome', label: 'Verified outcome', description: 'Publicly verifiable outcomes within this topic.', normalizationGuide: 'Use one period and comparison set; convert values to percentiles and score missing data as zero.', sourceHints: ['Authoritative sources cited by Wikidata', 'Official public records'], weight: 0.6, required: true },
    { key: 'record_completeness', label: 'Record completeness', description: 'Completeness and comparability of public records.', normalizationGuide: 'Convert required-field coverage to 0–100; exclude fields that cannot be cross-checked.', sourceHints: ['Wikidata references', 'Public primary records'], weight: 0.25, required: true },
    { key: 'source_consistency', label: 'Source consistency', description: 'Agreement among public sources on key outcomes.', normalizationGuide: 'Score by independent corroboration and unresolved conflict rate.', sourceHints: ['Wikidata references', 'Two or more independent public sources'], weight: 0.15, required: false },
  ],
  SEMI_OBJECTIVE: [
    { key: 'documented_achievement', label: 'Documented achievement', description: 'Topic-relevant achievements supported by public evidence.', normalizationGuide: 'Define one outcome scope and period, then convert within-set values to percentiles; missing is zero.', sourceHints: ['Authoritative sources cited by Wikidata', 'Relevant institution archives'], weight: 0.5, required: true },
    { key: 'independent_recognition', label: 'Independent recognition', description: 'Recognition from independent reliable sources.', normalizationGuide: 'Score qualifying records by count and level; count syndicated copies once.', sourceHints: ['Authoritative institution records', 'Verifiable professional organization data'], weight: 0.3, required: false },
    { key: 'evidence_quality', label: 'Evidence quality', description: 'Traceability and completeness of topic evidence.', normalizationGuide: 'Score the share of required fields backed by primary sources; exclude anonymous evidence.', sourceHints: ['Wikidata references', 'Public primary sources'], weight: 0.2, required: true },
  ],
  SUBJECTIVE_TREND: [
    { key: 'current_attention', label: 'Current attention', description: 'Public topic-relevant attention in a fixed window.', normalizationGuide: 'Fix platforms, period, and deduplication rules, then convert within-set values to percentiles.', sourceHints: ['Public trend data', 'Public site statistics'], weight: 0.45, required: true },
    { key: 'attention_momentum', label: 'Attention momentum', description: 'Change against the preceding equal-length window.', normalizationGuide: 'Winsorize period-over-period change and map it to 0–100; flag tiny baselines as low confidence.', sourceHints: ['Public trend data', 'Repeatable public statistics'], weight: 0.35, required: false },
    { key: 'source_diversity', label: 'Source diversity', description: 'Attention distributed across independent public channels.', normalizationGuide: 'Score independent-source coverage; merge syndication and mirrors.', sourceHints: ['Multiple public data sources', 'Wikidata references'], weight: 0.2, required: false },
  ],
};

/** 根据证据类型在项目内创建可复现指标方案。 */
@Injectable()
export class TopicMetricPlanService {
  async suggest(args: { title: string; kind: TopicKind; locale: string }): Promise<TopicMetricPlan> {
    const zh = args.locale.toLowerCase().startsWith('zh');
    const metrics = (zh ? ZH_PLANS : EN_PLANS)[args.kind].map((metric) => ({
      ...metric,
      sourceHints: [...metric.sourceHints],
    }));
    return {
      generatedBy: 'local_algorithm',
      rationale: zh
        ? `“${args.title}”按所选证据类型生成本地可复现指标；不调用收费 AI，也不把播放量等行业指标强加给所有话题。`
        : `A reproducible local evidence plan for “${args.title}”; no paid AI call or universal industry metric is used.`,
      metrics,
    };
  }
}
