export const TOPIC_ENTITY_AUTOFILL_QUEUE = 'topic-entity-autofill';
export const TOPIC_ENTITY_AUTOFILL_JOB = 'collect-topic-entities';

export type TopicEntityAutofillJob = { topicId: string; runToken: string };

export function topicEntityAutofillJobId(data: TopicEntityAutofillJob): string {
  return `topic-entities-${data.topicId}-${data.runToken}`;
}
