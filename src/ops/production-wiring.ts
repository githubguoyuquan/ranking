import type { DrCheckItem, DrCheckSeverity } from './dr-readiness.types';

export type ProductionWiringEnv = {
  productionWiringRequired: boolean;
  databaseUrl: string;
  databaseReadUrl: string;
  redisUrl: string;
  kafkaBrokers: string;
  kafkaSchemaRegistryUrl: string;
};

export function productionWiringEnvFromProcess(
  env: NodeJS.ProcessEnv = process.env,
): ProductionWiringEnv {
  return {
    productionWiringRequired: env.PRODUCTION_WIRING_REQUIRED === 'true',
    databaseUrl: env.DATABASE_URL?.trim() ?? '',
    databaseReadUrl: env.DATABASE_READ_URL?.trim() ?? '',
    redisUrl: env.REDIS_URL?.trim() ?? '',
    kafkaBrokers: env.KAFKA_BROKERS?.trim() ?? '',
    kafkaSchemaRegistryUrl: env.KAFKA_SCHEMA_REGISTRY_URL?.trim() ?? '',
  };
}

/** 静态配置检查（RDS Multi-AZ writer/reader、MSK、ElastiCache），不替代连通性探测。 */
export function evaluateProductionWiring(
  cfg: ProductionWiringEnv,
): DrCheckItem[] {
  if (!cfg.productionWiringRequired) return [];

  const checks: DrCheckItem[] = [];
  const fail = cfg.productionWiringRequired ? 'critical' : 'warn';

  if (!cfg.databaseUrl) {
    checks.push({
      code: 'prod_rds_writer',
      severity: 'critical',
      message: 'DATABASE_URL not set (RDS writer required in production)',
    });
  } else {
    const rdsLike =
      cfg.databaseUrl.includes('amazonaws.com') ||
      cfg.databaseUrl.includes('sslmode=require');
    checks.push({
      code: 'prod_rds_writer',
      severity: rdsLike ? 'ok' : 'warn',
      message: rdsLike
        ? 'DATABASE_URL looks like managed RDS (writer)'
        : 'DATABASE_URL set but missing amazonaws.com / sslmode=require',
      hint: 'Use RDS Multi-AZ cluster writer endpoint with TLS',
    });
  }

  if (!cfg.databaseReadUrl) {
    checks.push({
      code: 'prod_rds_reader',
      severity: fail,
      message: 'DATABASE_READ_URL not set — production requires RDS read replica',
      hint: 'Point to RDS reader endpoint (or Aurora reader)',
    });
  } else if (
    cfg.databaseUrl &&
    cfg.databaseReadUrl === cfg.databaseUrl
  ) {
    checks.push({
      code: 'prod_rds_reader',
      severity: 'warn',
      message: 'DATABASE_READ_URL equals DATABASE_URL — use dedicated reader endpoint',
    });
  } else {
    const readerOk =
      cfg.databaseReadUrl.includes('amazonaws.com') ||
      cfg.databaseReadUrl.includes('-ro-') ||
      cfg.databaseReadUrl.includes('reader');
    checks.push({
      code: 'prod_rds_reader',
      severity: readerOk ? 'ok' : 'warn',
      message: readerOk
        ? 'DATABASE_READ_URL configured for read replica'
        : 'DATABASE_READ_URL set; verify RDS reader / Aurora replica endpoint',
    });
  }

  if (!cfg.redisUrl) {
    checks.push({
      code: 'prod_elasticache',
      severity: 'critical',
      message: 'REDIS_URL not set (ElastiCache required in production)',
    });
  } else {
    const cacheLike =
      cfg.redisUrl.startsWith('rediss://') ||
      cfg.redisUrl.includes('amazonaws.com') ||
      cfg.redisUrl.includes('cache.amazonaws.com');
    checks.push({
      code: 'prod_elasticache',
      severity: cacheLike ? 'ok' : 'warn',
      message: cacheLike
        ? 'REDIS_URL looks like ElastiCache (TLS or AWS host)'
        : 'REDIS_URL set; use rediss:// or *.cache.amazonaws.com for ElastiCache',
      hint: 'Enable in-transit encryption; replication group across AZs',
    });
  }

  if (!cfg.kafkaBrokers) {
    checks.push({
      code: 'prod_msk',
      severity: 'critical',
      message: 'KAFKA_BROKERS not set (MSK required in production)',
    });
  } else {
    const mskLike =
      cfg.kafkaBrokers.includes('amazonaws.com') ||
      cfg.kafkaBrokers.split(',').length >= 2;
    checks.push({
      code: 'prod_msk',
      severity: mskLike ? 'ok' : 'warn',
      message: mskLike
        ? 'KAFKA_BROKERS configured (multi-broker or MSK bootstrap)'
        : 'KAFKA_BROKERS set; prefer MSK bootstrap brokers (3+ AZ)',
      hint: 'Use MSK IAM or TLS bootstrap string from AWS console',
    });
  }

  if (!cfg.kafkaSchemaRegistryUrl) {
    checks.push({
      code: 'prod_schema_registry',
      severity: 'warn',
      message: 'KAFKA_SCHEMA_REGISTRY_URL not set',
      hint: 'MSK + Glue Schema Registry or Confluent Cloud SR URL',
    });
  } else {
    checks.push({
      code: 'prod_schema_registry',
      severity: 'ok',
      message: 'KAFKA_SCHEMA_REGISTRY_URL configured',
    });
  }

  return checks;
}

export function mergeDrChecks(
  checks: DrCheckItem[],
  wiring: DrCheckItem[],
): DrCheckItem[] {
  return [...checks, ...wiring];
}

export function worstDrStatus(checks: DrCheckItem[]): DrCheckSeverity {
  if (checks.some((c) => c.severity === 'critical')) return 'critical';
  if (checks.some((c) => c.severity === 'warn')) return 'warn';
  return 'ok';
}
