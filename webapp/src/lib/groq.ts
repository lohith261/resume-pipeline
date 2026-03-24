const GROQ_API_KEY      = process.env.GROQ_API_KEY ?? '';
const OPENROUTER_KEY    = process.env.OPENROUTER_API_KEY ?? '';
const GROQ_URL          = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL        = 'llama-3.3-70b-versatile';
const OPENROUTER_URL    = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL  = 'google/gemini-2.5-flash';

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

export async function groq(system: string, user: string, maxTokens = 2000): Promise<string> {
  try {
    return await callLLM(
      GROQ_URL, GROQ_MODEL,
      { Authorization: `Bearer ${GROQ_API_KEY}` },
      system, user, maxTokens,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'RATE_LIMIT' || msg.includes('429')) {
      if (!OPENROUTER_KEY) throw new Error('Groq rate limited and OPENROUTER_API_KEY not set');
      console.warn('[groq] Rate limit — falling back to OpenRouter');
      return await callLLM(
        OPENROUTER_URL, OPENROUTER_MODEL,
        {
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          'HTTP-Referer': 'https://resume-tailor.vercel.app',
          'X-Title': 'Resume Tailor',
        },
        system, user, 8000,
      );
    }
    throw e;
  }
}
