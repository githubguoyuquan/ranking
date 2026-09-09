ALTER TABLE "TopicEntityAutofill"
  DROP CONSTRAINT IF EXISTS "TopicEntityAutofill_count_check";

ALTER TABLE "TopicEntityAutofill"
  ADD CONSTRAINT "TopicEntityAutofill_count_positive_check"
  CHECK ("requestedCount" > 0);
