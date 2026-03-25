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

export function getBaseHtml(): string {
  const p = path.join(process.cwd(), 'src', 'data', 'resume_base.html');
  return fs.readFileSync(p, 'utf8');
}

export function scoreCoverage(keywords: string[], html: string): CoverageResult {
  const covered: string[] = [];
  const missing: string[] = [];
  for (const kw of keywords) {
    const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    (regex.test(html) ? covered : missing).push(kw);
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
  try {
    const clean = res.replace(/```(?:json)?|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch { /* fallthrough */ }
  return (res.match(/"([^"]+)"/g) ?? []).map(s => s.replace(/"/g, ''));
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
1. Each keyword phrase above MUST appear verbatim (exact spelling, exact capitalisation) somewhere in the resume
2. Weave keywords naturally into EXISTING bullet points by editing them — this is strongly preferred
3. ⛔ HARD LIMIT: Add AT MOST 2 new <li> bullet points to the ENTIRE resume across all sections combined. No more.
4. Page 1 is space-constrained — if you add any text, shorten another bullet to compensate
5. NEVER fabricate experience — only enhance what already exists
6. Write natural human English — no buzzword soup
7. Do NOT change HTML structure, CSS, or section headings
8. Return the COMPLETE modified HTML — nothing else

${compressHtml(baseHtml)}`,
    6000,
  );

  return tailored.replace(/^```(?:html)?\s*/m, '').replace(/\s*```$/m, '').trim();
}

export async function runPipeline(
  jd: string,
  company: string,
  role: string,
  onStep: (step: string, data?: unknown) => void,
): Promise<TailorResult> {
  onStep('extracting');
  const keywords = await extractKeywords(jd);
  onStep('keywords', { count: keywords.length, keywords });

  const baseHtml = getBaseHtml();
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
    html = await tailorHtml(baseHtml, before.missing, company, role, research, false);
    after = scoreCoverage(keywords, html);
    onStep('tailored', { pct: after.pct });

    // Second pass if still below 90% and meaningful keywords remain
    if (after.pct < 90 && after.missing.length > 0) {
      onStep('tailoring2', { missing: after.missing.length });
      html = await tailorHtml(html, after.missing, company, role, research, true);
      after = scoreCoverage(keywords, html);
      onStep('tailored', { pct: after.pct });
    }
  } else {
    onStep('tailored', { pct: before.pct, skipped: true });
  }

  const changes = computeChanges(baseHtml, html);
  return { html, before, after, keywords, company, role, research, changes };
}

export { slugify };
