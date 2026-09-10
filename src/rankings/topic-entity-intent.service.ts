import { BadRequestException, Injectable } from '@nestjs/common';

export type TopicEntityIntent = {
  category: string;
  membership: 'instance' | 'occupation' | 'both';
  constraints: Array<{ property: string; value: string }>;
  semantic: boolean;
};

type CandidateForReview = {
  externalId: string;
  name: string;
  description: string;
};

/** 本地解析可安全识别的对象类别，不猜测业务条件或调用收费模型。 */
@Injectable()
export class TopicEntityIntentService {
  async resolve(title: string): Promise<TopicEntityIntent> {
    const category = title.normalize('NFKC')
      .replace(/(?:排行榜|排名榜|榜单|排名|榜|\s+rankings?|\s+leaderboards?|\s+list)\s*$/iu, '')
      .trim();
    if (!category) {
      throw new BadRequestException('话题缺少对象类别，请补充明确名称。');
    }
    return { category, membership: 'both', constraints: [], semantic: false };
  }

  async review(_title: string, candidates: CandidateForReview[]): Promise<Set<string>> {
    // 候选已由 Wikidata 的类别/职业关系查询得到；本地只守住来源边界。
    return new Set(
      candidates
        .filter((candidate) => /^Q[1-9]\d*$/.test(candidate.externalId) && candidate.name.trim())
        .map((candidate) => candidate.externalId),
    );
  }
}
