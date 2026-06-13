import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
  type KafkaEnvelopeV1,
} from './config';

const SCHEMA_DIR = join(__dirname, '..', 'schemas');

let envelopeValidate: ReturnType<Ajv['compile']> | null = null;
let payloadValidate: ReturnType<Ajv['compile']> | null = null;

function getValidators() {
  if (!envelopeValidate || !payloadValidate) {
    const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(ajv);
    envelopeValidate = ajv.compile(
      JSON.parse(
        readFileSync(join(SCHEMA_DIR, 'event-envelope-v1.schema.json'), 'utf8'),
      ) as object,
    );
    payloadValidate = ajv.compile(
      JSON.parse(
        readFileSync(
          join(SCHEMA_DIR, 'ranking-snapshot-completed-payload-v1.schema.json'),
          'utf8',
        ),
      ) as object,
    );
  }
  return { envelopeValidate, payloadValidate };
}

export type ParseResult =
  | { ok: true; envelope: KafkaEnvelopeV1 }
  | { ok: false; reason: string };

export function parseRankingSnapshotCompletedMessage(
  raw: string,
): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  const { envelopeValidate: ev, payloadValidate: pv } = getValidators();
  if (!ev(parsed)) {
    return { ok: false, reason: `envelope_schema: ${ev.errors?.[0]?.message ?? 'invalid'}` };
  }

  const envelope = parsed as KafkaEnvelopeV1;
  if (envelope.type !== OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED) {
    return { ok: false, reason: `unexpected_type:${envelope.type}` };
  }

  if (!pv(envelope.payload)) {
    return { ok: false, reason: `payload_schema: ${pv.errors?.[0]?.message ?? 'invalid'}` };
  }

  return { ok: true, envelope };
}
