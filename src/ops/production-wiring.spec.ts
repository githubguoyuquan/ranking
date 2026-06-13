import { describe, expect, it } from 'vitest';
import {
  evaluateProductionWiring,
  productionWiringEnvFromProcess,
  worstDrStatus,
} from './production-wiring';

describe('production-wiring', () => {
  it('skips checks when PRODUCTION_WIRING_REQUIRED is false', () => {
    expect(
      evaluateProductionWiring(
        productionWiringEnvFromProcess({ PRODUCTION_WIRING_REQUIRED: 'false' }),
      ),
    ).toEqual([]);
  });

  it('flags missing read replica and MSK when production required', () => {
    const checks = evaluateProductionWiring({
      productionWiringRequired: true,
      databaseUrl:
        'postgresql://u:p@ranking.cluster-abc.ap-southeast-1.rds.amazonaws.com:5432/ranking?sslmode=require',
      databaseReadUrl: '',
      redisUrl: 'rediss://ranking.xxxxx.ng.0001.apse1.cache.amazonaws.com:6379',
      kafkaBrokers: '',
      kafkaSchemaRegistryUrl: '',
    });
    expect(checks.some((c) => c.code === 'prod_rds_reader' && c.severity === 'critical')).toBe(
      true,
    );
    expect(checks.some((c) => c.code === 'prod_msk' && c.severity === 'critical')).toBe(true);
    expect(worstDrStatus(checks)).toBe('critical');
  });

  it('passes when AWS-style endpoints are set', () => {
    const checks = evaluateProductionWiring({
      productionWiringRequired: true,
      databaseUrl:
        'postgresql://u:p@ranking.cluster-abc.ap-southeast-1.rds.amazonaws.com:5432/ranking?sslmode=require',
      databaseReadUrl:
        'postgresql://u:p@ranking.cluster-ro-abc.ap-southeast-1.rds.amazonaws.com:5432/ranking?sslmode=require',
      redisUrl: 'rediss://ranking.xxxxx.ng.0001.apse1.cache.amazonaws.com:6379',
      kafkaBrokers:
        'b-1.ranking.abc123.c2.kafka.ap-southeast-1.amazonaws.com:9098,b-2.ranking.abc123.c2.kafka.ap-southeast-1.amazonaws.com:9098',
      kafkaSchemaRegistryUrl: 'https://glue-schema-registry.example',
    });
    expect(worstDrStatus(checks)).toBe('ok');
  });
});
