import { describe, expect, it } from "vitest";
import {
  buildTopicVersionPolicy,
  defaultTopicVersionPolicyForm,
  localDateTimeInputToIso,
  topicVersionPolicyFormFromTemplate,
} from "./topic-admin-create";

describe("topic admin create helpers", () => {
  it("builds an explicit, de-duplicated entity scope", () => {
    const form = defaultTopicVersionPolicyForm("SEMI_OBJECTIVE");
    const result = buildTopicVersionPolicy({
      ...form,
      entityIdsInput: "12, 7，12",
    });

    expect(result).toEqual({
      ok: true,
      policyJson: {
        weights: {
          streams: 0.35,
          mentions: 0.25,
          social: 0.2,
          news: 0.2,
        },
        entityIds: ["12", "7"],
        requiredSignalKeys: ["streams", "mentions", "news"],
      },
    });
  });

  it("rejects an empty or invalid entity scope", () => {
    const form = defaultTopicVersionPolicyForm("OBJECTIVE");
    expect(
      buildTopicVersionPolicy({ ...form, entityIdsInput: "" }),
    ).toMatchObject({ ok: false });
    expect(
      buildTopicVersionPolicy({ ...form, entityIdsInput: "1,abc" }),
    ).toMatchObject({ ok: false });
  });

  it("preserves custom policy fields when cloning a version", () => {
    const form = topicVersionPolicyFormFromTemplate(
      {
        weights: { streams: 0.6, custom: 0.4 },
        requiredSignalKeys: ["streams", "custom"],
        entityIds: ["3"],
        decay: { halfLifeDays: 4 },
      },
      "SEMI_OBJECTIVE",
    );
    const result = buildTopicVersionPolicy(form);

    expect(result).toMatchObject({
      ok: true,
      policyJson: {
        entityIds: ["3"],
        decay: { halfLifeDays: 4 },
        requiredSignalKeys: ["streams", "custom"],
        weights: { streams: 0.6, custom: 0.4 },
      },
    });
  });

  it("converts a browser-local date value to ISO", () => {
    expect(localDateTimeInputToIso("not-a-date")).toBeNull();
    expect(localDateTimeInputToIso("2026-09-07T09:30")).toBe(
      new Date("2026-09-07T09:30").toISOString(),
    );
  });
});
