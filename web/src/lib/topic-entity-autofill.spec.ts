import { describe, expect, it } from "vitest";
import {
  entityAutofillSelection,
  parseTopicEntityAutofill,
  safeEntitySourceUrl,
  type TopicEntityAutofill,
} from "./topic-entity-autofill";

const population: TopicEntityAutofill = {
  requestedCount: 2,
  status: "completed",
  strategy: "wikidata",
  message: null,
  updatedAt: "2026-09-08T10:00:00Z",
  entities: [
    { id: "12", name: "A", type: "person", description: "", externalId: "Q1", sourceUrl: "https://www.wikidata.org/wiki/Q1" },
    { id: "18", name: "B", type: "person", description: "", externalId: "Q2", sourceUrl: "https://www.wikidata.org/wiki/Q2" },
  ],
};

describe("topic entity autofill", () => {
  it("only auto-selects complete results; a partial roster requires acceptance", () => {
    expect(entityAutofillSelection(population)).toBe("12, 18");
    const partial = { ...population, status: "partial" as const, entities: population.entities.slice(0, 1) };
    expect(entityAutofillSelection(partial)).toBeNull();
    expect(entityAutofillSelection(partial, true)).toBe("12");
    expect(entityAutofillSelection({ ...partial, status: "running" }, true)).toBeNull();
    expect(entityAutofillSelection({ ...population, entities: [] })).toBeNull();
  });

  it("rejects untrusted links while preserving verified identity sources", () => {
    expect(safeEntitySourceUrl("https://www.wikidata.org/wiki/Q615")).toBe("https://www.wikidata.org/wiki/Q615");
    for (const url of ["javascript:alert(1)", "https://www.wikidata.org.evil.test/wiki/Q1", "http://www.wikidata.org/wiki/Q1", "https://evil.test", "https://user@www.wikidata.org/wiki/Q1", "https://www.wikidata.org/wiki/Q1?redirect=evil", "https://www.wikidata.org:444/wiki/Q1"]) {
      expect(safeEntitySourceUrl(url)).toBeNull();
    }
  });

  it("keeps only valid unique entity ids without fabricating missing identities", () => {
    expect(parseTopicEntityAutofill({
      ...population,
      entities: [population.entities[0], population.entities[0], { ...population.entities[1], sourceUrl: "javascript:alert(1)" }, { id: "bad", name: "C" }, { id: "20" }],
    })?.entities).toEqual([population.entities[0], { ...population.entities[1], sourceUrl: "" }]);
    expect(parseTopicEntityAutofill(null)).toBeNull();
    expect(parseTopicEntityAutofill({ ...population, status: "invented" })).toBeNull();
    expect(parseTopicEntityAutofill({ ...population, requestedCount: 0 })).toBeNull();
  });
});
