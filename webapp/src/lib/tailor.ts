import { groq, groqFast } from './groq';
import fs from 'fs';
import path from 'path';

export interface CoverageResult {
  covered: string[];
  missing: string[];
  pct: number;
  total: number;
}

export interface TailorResult {
  html: string;
  before: CoverageResult;
  after: CoverageResult;
  keywords: string[];
  company: string;
  role: string;
  research: string;
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
): Promise<string> {
  if (!missing.length) return baseHtml;

  const tailored = await groqFast(
    'You are a professional resume tailoring assistant. Return ONLY the complete HTML — no explanation, no markdown fences.',
    `You are tailoring an HTML resume for a job application.

Company: ${company}
Role: ${role}
Company context: ${research}

Missing keywords to weave in: ${missing.slice(0, 40).join(', ')}

Rules:
- Edit existing bullet points to naturally incorporate missing keywords where they fit
- If >10% of important keywords cannot fit in existing bullets, add 1-2 new bullets max
- CRITICAL: Page 1 is space-constrained. If you add text, condense or remove a less important bullet to keep 2-page layout
- NEVER fabricate experience — only enhance what already exists
- Write natural human English — no buzzword soup
- Do NOT change HTML structure, CSS, or section headings
- Return the COMPLETE modified HTML — nothing else

${baseHtml}`,
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
    onStep('tailoring', { missing: before.missing.length });
    html = await tailorHtml(baseHtml, before.missing, company, role, research);
    after = scoreCoverage(keywords, html);
    onStep('tailored', { pct: after.pct });
  } else {
    onStep('tailored', { pct: before.pct, skipped: true });
  }

  return { html, before, after, keywords, company, role, research };
}

export { slugify };
