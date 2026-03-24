const GROQ_API_KEY      = process.env.GROQ_API_KEY ?? '';
const OPENROUTER_KEY    = process.env.OPENROUTER_API_KEY ?? '';
const GROQ_URL          = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL        = 'llama-3.3-70b-versatile';
const OPENROUTER_URL    = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL  = 'meta-llama/llama-3.3-70b-instruct:free'; // free tier

async function callLLM(
  url: string,
  model: string,
  headers: Record<string, string>,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429) throw new Error('RATE_LIMIT');
    throw new Error(`LLM error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function callOpenRouter(system: string, user: string, maxTokens: number): Promise<string> {
  if (!OPENROUTER_KEY) throw new Error('Groq rate limited and OPENROUTER_API_KEY not set');
  console.warn('[groq] Falling back to OpenRouter');
  return callLLM(
    OPENROUTER_URL, OPENROUTER_MODEL,
    {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'HTTP-Referer': 'https://webapp-ten-beryl.vercel.app',
      'X-Title': 'Resume Tailor',
    },
    system, user, Math.min(maxTokens, 3000),
  );
}

export async function groq(system: string, user: string, maxTokens = 2000): Promise<string> {
  // Try Groq with one retry after a short wait on rate limit
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callLLM(
        GROQ_URL, GROQ_MODEL,
        { Authorization: `Bearer ${GROQ_API_KEY}` },
        system, user, maxTokens,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'RATE_LIMIT' || msg.includes('429')) {
        if (attempt === 0) {
          // Wait 3s then retry Groq once before falling back
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        // Second attempt also rate limited — use OpenRouter
        return callOpenRouter(system, user, maxTokens);
      }
      throw e;
    }
  }
  // Should never reach here but TypeScript needs it
  return callOpenRouter(system, user, maxTokens);
}
