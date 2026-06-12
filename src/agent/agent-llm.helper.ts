export type AgentLlmResult = {
  text: string;
  usedLlm: boolean;
  model: string | null;
  usage: { prompt: number; completion: number; total: number } | null;
};

/** 可选 OpenAI 润色；无 key 或失败时返回 fallback */
export async function optionalAgentLlm(opts: {
  systemPrompt: string;
  userContent: string;
  fallback: string;
  maxTokens?: number;
}): Promise<AgentLlmResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  if (!key) {
    return { text: opts.fallback, usedLlm: false, model: null, usage: null };
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userContent },
        ],
        max_tokens: opts.maxTokens ?? 300,
        temperature: 0.4,
      }),
    });
    if (!res.ok) {
      return { text: opts.fallback, usedLlm: false, model, usage: null };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    const u = data.usage;
    const usage =
      u &&
      typeof u.prompt_tokens === 'number' &&
      typeof u.completion_tokens === 'number' &&
      typeof u.total_tokens === 'number'
        ? {
            prompt: u.prompt_tokens,
            completion: u.completion_tokens,
            total: u.total_tokens,
          }
        : null;
    return {
      text: text && text.length > 0 ? text : opts.fallback,
      usedLlm: Boolean(text && text.length > 0),
      model,
      usage,
    };
  } catch {
    return { text: opts.fallback, usedLlm: false, model, usage: null };
  }
}
