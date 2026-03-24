const GROQ_API_KEY      = process.env.GROQ_API_KEY ?? '';
const OPENROUTER_KEY    = process.env.OPENROUTER_API_KEY ?? '';
const GROQ_URL          = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL_FAST   = 'llama-3.1-8b-instant';    // 131K TPM — for small tasks
const GROQ_MODEL_SMART  = 'llama-3.3-70b-versatile'; // 6K TPM  — for tailoring only
const OPENROUTER_URL    = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL  = 'google/gemini-2.0-flash-001'; // fast, cheap, high quality via Google AI Studio

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
    signal: AbortSignal.timeout(90000),
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
  // Retry OpenRouter once on 429 with a short wait
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callLLM(
        OPENROUTER_URL, OPENROUTER_MODEL,
        {
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          'HTTP-Referer': 'https://webapp-ten-beryl.vercel.app',
          'X-Title': 'Resume Tailor',
        },
        system, user, Math.min(maxTokens, 8000),
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'RATE_LIMIT' || msg.includes('429')) {
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        throw new Error('Rate limited on all providers — please wait a minute and try again');
      }
      throw e;
    }
  }
  throw new Error('Rate limited on all providers — please wait a minute and try again');
}

async function callGroq(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callLLM(
        GROQ_URL, model,
        { Authorization: `Bearer ${GROQ_API_KEY}` },
        system, user, maxTokens,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'RATE_LIMIT' || msg.includes('429')) {
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        return callOpenRouter(system, user, maxTokens);
      }
      throw e;
    }
  }
  return callOpenRouter(system, user, maxTokens);
}

/** Fast model (llama-3.1-8b-instant, 131K TPM) — use for keyword extraction, research, etc. */
export async function groqFast(system: string, user: string, maxTokens = 1000): Promise<string> {
  return callGroq(GROQ_MODEL_FAST, system, user, maxTokens);
}

/** Smart model (llama-3.3-70b-versatile, 6K TPM) — use only for resume tailoring. */
export async function groq(system: string, user: string, maxTokens = 2000): Promise<string> {
  return callGroq(GROQ_MODEL_SMART, system, user, maxTokens);
}
