export type AgentLlmResult = {
  text: string;
  usedLlm: boolean;
  model: string | null;
  usage: { prompt: number; completion: number; total: number } | null;
};

/** 保留既有调用接口，但只返回项目内规则算法生成的结果。 */
export async function optionalAgentLlm(opts: {
  systemPrompt: string;
  userContent: string;
  fallback: string;
  maxTokens?: number;
}): Promise<AgentLlmResult> {
  return { text: opts.fallback, usedLlm: false, model: null, usage: null };
}
