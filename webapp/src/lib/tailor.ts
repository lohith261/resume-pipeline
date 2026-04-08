import { groqFast, groqLarge, compressHtml } from './groq';
import fs from 'fs';
import path from 'path';

export interface CoverageResult {
  covered: string[];
  missing: string[];
  pct: number;
  total: number;
}

export interface BulletChange {
  type: 'modified' | 'added';
  before?: string;   // original bullet (for modified)
  after: string;     // new bullet text
}

export interface TailorResult {
  html: string;
  before: CoverageResult;
  after: CoverageResult;
  keywords: string[];
  company: string;
  role: string;
  research: string;
  changes: BulletChange[];
  classification: Classification;
}

/** Extract plain-text content of every <li> in an HTML string */
function extractBullets(html: string): string[] {
  return [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 15);
}

/** Jaccard word-level similarity between two strings (0–1) */
function wordSim(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  let inter = 0;
  wa.forEach(w => { if (wb.has(w)) inter++; });
  return inter / (wa.size + wb.size - inter || 1);
}

/** Diff base vs tailored bullets → list of changes */
function computeChanges(baseHtml: string, tailoredHtml: string): BulletChange[] {
  const baseBullets = extractBullets(baseHtml);
  const tailoredBullets = extractBullets(tailoredHtml);
  const baseSet = new Set(baseBullets);
  const changes: BulletChange[] = [];

  for (const tb of tailoredBullets) {
    if (baseSet.has(tb)) continue; // unchanged
    // Find best matching original bullet
    let bestScore = 0, bestMatch = '';
    for (const bb of baseBullets) {
      const s = wordSim(bb, tb);
      if (s > bestScore) { bestScore = s; bestMatch = bb; }
    }
    if (bestScore > 0.35) {
      changes.push({ type: 'modified', before: bestMatch, after: tb });
    } else {
      changes.push({ type: 'added', after: tb });
    }
  }
  return changes;
}

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '');
}

export type ResumeType = 'ai_engineer' | 'data_analyst' | 'hybrid';
export type CountryCode = 'de' | 'nl' | 'sg' | 'ae';

export interface Classification {
  type: ResumeType;
  confidence: number;
  reasoning: string;
  country: CountryCode | null;
}

const RESUME_FILES: Record<ResumeType, string> = {
  ai_engineer:  'resume_ai_engineer.html',
  data_analyst: 'resume_data_analyst.html',
  hybrid:       'resume_base.html',
};

const COUNTRY_RESUME_FILES: Record<CountryCode, Record<ResumeType, string>> = {
  de: { ai_engineer: 'resume_de_engineer.html', hybrid: 'resume_de_hybrid.html', data_analyst: 'resume_de_analyst.html' },
  nl: { ai_engineer: 'resume_nl_engineer.html', hybrid: 'resume_nl_hybrid.html', data_analyst: 'resume_nl_analyst.html' },
  sg: { ai_engineer: 'resume_sg_engineer.html', hybrid: 'resume_sg_hybrid.html', data_analyst: 'resume_sg_analyst.html' },
  ae: { ai_engineer: 'resume_ae_engineer.html', hybrid: 'resume_ae_hybrid.html', data_analyst: 'resume_ae_analyst.html' },
};

export function getBaseHtml(type: ResumeType = 'hybrid', country?: CountryCode | null): string {
  if (country && COUNTRY_RESUME_FILES[country]) {
    const file = COUNTRY_RESUME_FILES[country][type] ?? COUNTRY_RESUME_FILES[country]['hybrid'];
    const cp = path.join(process.cwd(), 'src', 'data', file);
    if (fs.existsSync(cp)) return fs.readFileSync(cp, 'utf8');
  }
  const file = RESUME_FILES[type] ?? RESUME_FILES.hybrid;
  const p = path.join(process.cwd(), 'src', 'data', file);
  return fs.readFileSync(p, 'utf8');
}

export async function classifyJd(jd: string): Promise<Classification> {
  const res = await groqFast(
    `Classify this job description. Return ONLY valid JSON (no markdown):
{"type":"ai_engineer|data_analyst|hybrid","confidence":0.0-1.0,"reasoning":"one sentence","country":"de|nl|sg|ae|null"}

type rules:
- "ai_engineer" → primary focus on LLMs, RAG, LangChain, agents, GenAI, prompt engineering, inference
- "data_analyst" → primary focus on SQL, Tableau, analytics, dashboards, BI, ETL, statistics, Python data science
- "hybrid" → requires both AI engineering AND strong data/analytics skills equally

country rules (detect from location, company HQ, currency, office city, visa mentions):
- "de" → Germany (Berlin, Munich, Hamburg, Frankfurt, GmbH, EUR salary, Blue Card mentioned)
- "nl" → Netherlands (Amsterdam, Rotterdam, Eindhoven, B.V., EUR, IND, HSM/Kennismigrant)
- "sg" → Singapore (Singapore, SGD, Pte Ltd, MOM, EP/Employment Pass, COMPASS)
- "ae" → UAE/Dubai (Dubai, Abu Dhabi, AED, UAE, DIFC, free zone, LLC)
- null → country unclear or not one of the above`,
    jd.slice(0, 3000),
    350,
  );
  try {
    const clean = res.replace(/```(?:json)?|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const type = (['ai_engineer', 'data_analyst', 'hybrid'] as ResumeType[]).includes(parsed.type)
      ? parsed.type as ResumeType
      : 'hybrid';
    const validCountries: CountryCode[] = ['de', 'nl', 'sg', 'ae'];
    const country = validCountries.includes(parsed.country) ? parsed.country as CountryCode : null;
    return { type, confidence: parsed.confidence ?? 0.7, reasoning: parsed.reasoning ?? '', country };
  } catch {
    return { type: 'hybrid', confidence: 0.5, reasoning: 'classification parse error — using hybrid', country: null };
  }
}

/** Normalize a string into a set of meaningful word tokens */
function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
     .replace(/[()[\]]/g, ' ')   // strip brackets so "(RAG)" → "RAG"
     .split(/\W+/)
     .filter(w => w.length > 1), // drop single-char noise
  );
}

function kwMatches(kw: string, html: string): boolean {
  // Fast path: direct substring match (handles the majority of cases instantly)
  if (new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(html)) return true;

  // Token overlap: if ≥60% of the keyword's tokens appear anywhere in the resume,
  // count it as covered. Handles word-order differences, acronym/expansion pairs,
  // and partial phrase matches without any extra API calls.
  const kwTokens = tokenize(kw);
  if (kwTokens.size === 0) return false;
  const resumeTokens = tokenize(html);
  let hits = 0;
  kwTokens.forEach(t => { if (resumeTokens.has(t)) hits++; });
  return hits / kwTokens.size >= 0.6;
}

export function scoreCoverage(keywords: string[], html: string): CoverageResult {
  const covered: string[] = [];
  const missing: string[] = [];
  for (const kw of keywords) {
    (kwMatches(kw, html) ? covered : missing).push(kw);
  }
  const pct = keywords.length ? Math.round((covered.length / keywords.length) * 1000) / 10 : 100;
  return { covered, missing, pct, total: keywords.length };
}

export async function extractKeywords(jd: string): Promise<string[]> {
  const res = await groqFast(
    'You are an ATS keyword extraction engine. Extract ONLY technical skills, programming languages, tools, frameworks, platforms, and methodologies from the job description. Do NOT include job titles, seniority levels (Mid-Sr, Senior, Junior), locations, work types (Full-time, Remote), or company names. Return ONLY a JSON array of strings. No explanation. No markdown.',
    `Extract technical keywords only:\n\n${jd.slice(0, 4000)}`,
    1000,
  );
  let raw: string[] = [];
  try {
    const clean = res.replace(/```(?:json)?|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) raw = parsed.map(String).filter(Boolean);
    else raw = (res.match(/"([^"]+)"/g) ?? []).map(s => s.replace(/"/g, ''));
  } catch {
    raw = (res.match(/"([^"]+)"/g) ?? []).map(s => s.replace(/"/g, ''));
  }
  return deduplicateKeywords(raw);
}

/** Remove near-duplicate keywords (e.g. "React" + "ReactJS") using 80% token overlap. */
function deduplicateKeywords(keywords: string[]): string[] {
  const kept: string[] = [];
  for (const kw of keywords) {
    const kwToks = tokenize(kw);
    const isDuplicate = kept.some(existing => {
      const exToks = tokenize(existing);
      const smaller = Math.min(kwToks.size, exToks.size);
      if (smaller === 0) return false;
      let overlap = 0;
      kwToks.forEach(t => { if (exToks.has(t)) overlap++; });
      return overlap / smaller >= 0.8;
    });
    if (!isDuplicate) kept.push(kw);
  }
  return kept;
}

export async function detectCompanyRole(jd: string): Promise<{ company: string; role: string }> {
  const res = await groqFast(
    'Extract the company name and job role title from this job description. Return ONLY valid JSON: {"company":"...","role":"..."}',
    jd.slice(0, 2000),
    200,
  );
  try {
    const clean = res.replace(/```(?:json)?|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (parsed.company && parsed.role) return parsed;
  } catch { /* fallthrough */ }
  return { company: 'Company', role: 'Engineer' };
}

export async function researchCompany(company: string, role: string): Promise<string> {
  return groqFast(
    'You are a job application research assistant. Give a concise 3-5 sentence summary of the company\'s tech focus, culture, and what they value in engineers. Be factual and brief.',
    `Company: ${company}\nRole: ${role}`,
    400,
  );
}

export async function tailorHtml(
  baseHtml: string,
  missing: string[],
  company: string,
  role: string,
  research: string,
  isSecondPass = false,
  country?: CountryCode | null,
): Promise<string> {
  if (!missing.length) return baseHtml;

  const tailored = await groqLarge(
    'You are a professional resume tailoring assistant. Return ONLY the complete HTML — no explanation, no markdown fences.',
    `You are tailoring an HTML resume for a job application.

Company: ${company}
Role: ${role}
Company context: ${research}

${isSecondPass ? '⚠️ SECOND PASS — these keywords were STILL MISSING after the first edit. You MUST include each one.' : 'Keywords to weave in:'}
${missing.slice(0, 40).map(k => `• "${k}"`).join('\n')}

CRITICAL RULES:
1. Weave keywords naturally into EXISTING bullet points by editing them — always prefer this
2. If a keyword truly cannot fit any existing bullet naturally, SKIP IT — do not create a keyword-dump bullet
3. ⛔ HARD LIMIT: Add AT MOST 1 new <li> bullet point to the ENTIRE resume. Only if there is genuine experience behind it.
4. Page 1 is space-constrained — if you add any text, shorten another bullet to compensate
5. NEVER fabricate experience — only enhance what already exists
6. Write natural human English — each bullet should read like a real sentence, not a keyword list
7. ⛔ Do NOT wrap keywords in <strong> or <b> tags — no bolding of any words
8. Do NOT change HTML structure, CSS, or section headings
9. Return the COMPLETE modified HTML — nothing else
10. Every bullet MUST start with a strong past-tense action verb (Architected, Engineered, Built, Designed, Deployed, Integrated, Spearheaded, Streamlined, Delivered, Surfaced, Automated) — never start with "Responsible for", "Worked on", "Helped", or passive phrasing
11. If you edit a bullet, verify it still contains at least one quantified outcome (%, number, time saved, scale) — if the original had one, preserve or strengthen it; never edit it out
12. On the second pass, prioritise placing keywords in the top 2–3 bullets of the most recent role, as recruiters spend the first 7 seconds scanning that zone
${country === 'de' ? `
13. GERMANY MARKET: Keep formal tone. Ensure every metric is precise. Do not remove the photo placeholder box or the Anabin degree note.` : ''}
${country === 'nl' ? `
13. NETHERLANDS MARKET: Keep the Profile section to 2 sentences max. Maintain clean, direct English. No fluff phrases.` : ''}
${country === 'sg' ? `
13. SINGAPORE MARKET: Keep "Employment Pass (shortage occupation — AI/ML)" phrase in the summary. Preserve the COMPASS qualification note in Education. Prioritise AI/ML keywords in top bullets.` : ''}
${country === 'ae' ? `
13. UAE MARKET: Keep "AWS-certified" or cloud certification keywords prominent. Preserve the Languages section. Keep nationality/visa line in header.` : ''}

${compressHtml(baseHtml)}`,
    6000,
  );

  return tailored
    .replace(/^```(?:html)?\s*/m, '').replace(/\s*```$/m, '').trim()
    // Strip any <strong>/<b> tags the LLM added around keywords
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '$1')
    .replace(/<b>([\s\S]*?)<\/b>/gi, '$1');
}

export async function runPipeline(
  jd: string,
  company: string,
  role: string,
  onStep: (step: string, data?: unknown) => void,
): Promise<TailorResult> {
  onStep('classifying');
  const classification = await classifyJd(jd);
  onStep('classified', classification);
  // confidence ≤ 0.5 means the LLM response failed to parse and we fell back to hybrid
  if (classification.confidence <= 0.5) {
    onStep('warn', { id: 'warn_classify', message: '⚠ Classification uncertain — using Hybrid base as fallback' });
  }

  onStep('extracting');
  const keywords = await extractKeywords(jd);
  onStep('keywords', { count: keywords.length, keywords });
  if (keywords.length === 0) {
    onStep('warn', { id: 'warn_keywords', message: '⚠ No keywords extracted — JD may be too short or in an unexpected format' });
  }

  const baseHtml = getBaseHtml(classification.type, classification.country);
  const before = scoreCoverage(keywords, baseHtml);
  onStep('coverage_before', { pct: before.pct, missing: before.missing.length });

  onStep('researching');
  const research = await researchCompany(company, role);
  onStep('researched', { research });

  let html = baseHtml;
  let after = before;

  if (before.pct < 90 && before.missing.length) {
    // First pass
    onStep('tailoring', { missing: before.missing.length });
    html = await tailorHtml(baseHtml, before.missing, company, role, research, false, classification.country);
    after = scoreCoverage(keywords, html);
    onStep('tailored', { pct: after.pct });

    // Second pass if still below 90% and meaningful keywords remain
    if (after.pct < 90 && after.missing.length > 0) {
      onStep('tailoring2', { missing: after.missing.length });
      html = await tailorHtml(html, after.missing, company, role, research, true, classification.country);
      after = scoreCoverage(keywords, html);
      onStep('tailored', { pct: after.pct });
    }
  } else {
    onStep('tailored', { pct: before.pct, skipped: true });
  }

  const changes = computeChanges(baseHtml, html);
  return { html, before, after, keywords, company, role, research, changes, classification };
}

export { slugify };
