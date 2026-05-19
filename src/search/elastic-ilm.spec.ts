import { describe, expect, it } from 'vitest';
import {
  buildIlmPolicyBody,
  elasticIlmPolicyName,
  elasticIlmRolloverConditions,
} from './elastic-ilm.config';

describe('elastic-ilm.config', () => {
  it('builds hot rollover policy', () => {
    const body = buildIlmPolicyBody('ranking_entities') as {
      policy: { phases: { hot: { actions: { rollover: { max_docs: number } } } } };
    };
    expect(elasticIlmPolicyName('ranking_entities')).toBe('ranking-entities-ilm');
    expect(body.policy.phases.hot.actions.rollover.max_docs).toBe(
      elasticIlmRolloverConditions().maxDocs,
    );
  });
});
