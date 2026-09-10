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

    expect(result).toMatchObject({
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
    if (result.ok) {
      expect(result.policyJson.metricDefinitions).toHaveLength(4);
    }
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

  it("builds fields from a dynamic topic metric plan without fixed keys", () => {
    const form = defaultTopicVersionPolicyForm("SEMI_OBJECTIVE", {
      generatedBy: "local_algorithm",
      rationale: "按当前话题选择。",
      metrics: [
        {
          key: "result_quality",
          label: "结果质量",
          description: "衡量结果。",
          normalizationGuide: "同批百分位换算为 0–100。",
          sourceHints: ["公开记录"],
          weight: 0.7,
          required: true,
        },
        {
          key: "peer_recognition",
          label: "同行认可",
          description: "衡量认可。",
          normalizationGuide: "同一时间窗换算为 0–100。",
          sourceHints: ["权威档案"],
          weight: 0.3,
          required: false,
        },
      ],
    });
    const result = buildTopicVersionPolicy({ ...form, entityIdsInput: "8, 9" });

    expect(form.usesLegacyFallback).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      policyJson: {
        weights: { result_quality: 0.7, peer_recognition: 0.3 },
        requiredSignalKeys: ["result_quality"],
        entityIds: ["8", "9"],
      },
    });
    if (result.ok) {
      expect(JSON.stringify(result.policyJson)).not.toContain("streams");
    }
  });

  it("converts a browser-local date value to ISO", () => {
    expect(localDateTimeInputToIso("not-a-date")).toBeNull();
    expect(localDateTimeInputToIso("2026-09-07T09:30")).toBe(
      new Date("2026-09-07T09:30").toISOString(),
    );
  });
});
