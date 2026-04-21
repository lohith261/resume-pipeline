const GROQ_API_KEY      = process.env.GROQ_API_KEY ?? '';
const OPENROUTER_KEY    = process.env.OPENROUTER_API_KEY ?? '';
const GROQ_URL          = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL_FAST   = 'llama-3.1-8b-instant';    // 131K TPM — for small tasks
const GROQ_MODEL_SMART  = 'llama-3.3-70b-versatile'; // 6K TPM  — for tailoring only
const OPENROUTER_URL    = 'https://openrouter.ai/api/v1/chat/completions';
// Cascade of OR models tried in order — each has independent rate limits
const OPENROUTER_MODELS = [
  'google/gemini-2.0-flash-001',      // primary — fast, high quality
  'google/gemini-flash-1.5',          // fallback 1 — older but separate quota
  'meta-llama/llama-3.1-8b-instruct:free', // fallback 2 — always free, no quota
];

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
  const orHeaders = {
    Authorization: `Bearer ${OPENROUTER_KEY}`,
    'HTTP-Referer': process.env.SITE_URL ?? 'https://jobtailor.in',
    'X-Title': 'Resume Tailor',
  };
  const cap = Math.min(maxTokens, 8000);

  // Try each model in cascade — independent quotas, so one will almost always work
  for (const model of OPENROUTER_MODELS) {
    console.warn('[groq] Falling back to OpenRouter model:', model);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callLLM(OPENROUTER_URL, model, orHeaders, system, user, cap);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'RATE_LIMIT' || msg.includes('429')) {
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 4000));
            continue;
          }
          // This model is exhausted → try the next one
          console.warn('[groq] OpenRouter model rate-limited, trying next:', model);
          break;
        }
        throw e; // non-429 error — propagate
      }
    }
  }

  // All OpenRouter models exhausted — last resort: Groq fast model (131K TPM, almost never limited)
  console.warn('[groq] All OpenRouter models rate-limited — falling back to Groq fast model');
  return callLLM(
    GROQ_URL, GROQ_MODEL_FAST,
    { Authorization: `Bearer ${GROQ_API_KEY}` },
    system, user, Math.min(maxTokens, 8000),
  );
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

/** Fast model (llama-3.1-8b-instant) — keyword extraction, research, small tasks. */
export async function groqFast(system: string, user: string, maxTokens = 1000): Promise<string> {
  return callGroq(GROQ_MODEL_FAST, system, user, maxTokens);
}

/** Smart model (llama-3.3-70b-versatile) — use for tailoring. */
export async function groq(system: string, user: string, maxTokens = 2000): Promise<string> {
  return callGroq(GROQ_MODEL_SMART, system, user, maxTokens);
}

/**
 * Large-input tasks (HTML editing, cover letters).
 * Routes directly to OpenRouter cascade, falls back to Groq smart → fast.
 */
export async function groqLarge(system: string, user: string, maxTokens = 6000): Promise<string> {
  if (OPENROUTER_KEY) return callOpenRouter(system, user, maxTokens);
  return callGroq(GROQ_MODEL_SMART, system, user, maxTokens);
}

/** Strip HTML comments + collapse whitespace to shrink token count ~25% */
export function compressHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')   // remove HTML comments
    .replace(/\s{2,}/g, ' ')           // collapse whitespace runs
    .replace(/>\s+</g, '><')           // remove space between tags
    .trim();
}
