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

export interface TaggedKeyword {
  kw: string;
  niche: boolean; // true = rare/specialised (high ATS signal); false = common/ubiquitous
}

export interface TailorResult {
  html: string;
  before: CoverageResult;
  after: CoverageResult;
  keywords: TaggedKeyword[];
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
export function computeChanges(baseHtml: string, tailoredHtml: string): BulletChange[] {
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
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export type ResumeType = 'ai_engineer' | 'data_analyst' | 'data_engineer' | 'hybrid' | 'universal';
export type CountryCode = 'de' | 'nl' | 'sg' | 'ae' | 'jp' | 'lu' | 'ie';

export interface Classification {
  type: ResumeType;
  confidence: number;
  reasoning: string;
  country: CountryCode | null;
}

const RESUME_FILES: Record<ResumeType, string> = {
  ai_engineer:   'resume_ai_engineer.html',
  data_analyst:  'resume_data_analyst.html',
  data_engineer: 'resume_data_engineer.html',
  hybrid:        'resume_base.html',
  universal:     'resume_base.html',  // reuse hybrid base — tailorUniversal rewrites everything
};

const COUNTRY_RESUME_FILES: Record<CountryCode, Record<ResumeType, string>> = {
  de: { ai_engineer: 'resume_de_engineer.html', hybrid: 'resume_de_hybrid.html', data_analyst: 'resume_de_analyst.html', data_engineer: 'resume_de_data_engineer.html', universal: 'resume_de_hybrid.html' },
  nl: { ai_engineer: 'resume_nl_engineer.html', hybrid: 'resume_nl_hybrid.html', data_analyst: 'resume_nl_analyst.html', data_engineer: 'resume_nl_data_engineer.html', universal: 'resume_nl_hybrid.html' },
  sg: { ai_engineer: 'resume_sg_engineer.html', hybrid: 'resume_sg_hybrid.html', data_analyst: 'resume_sg_analyst.html', data_engineer: 'resume_sg_data_engineer.html', universal: 'resume_sg_hybrid.html' },
  ae: { ai_engineer: 'resume_ae_engineer.html', hybrid: 'resume_ae_hybrid.html', data_analyst: 'resume_ae_analyst.html', data_engineer: 'resume_ae_data_engineer.html', universal: 'resume_ae_hybrid.html' },
  jp: { ai_engineer: 'resume_jp_engineer.html', hybrid: 'resume_jp_hybrid.html', data_analyst: 'resume_jp_analyst.html', data_engineer: 'resume_jp_data_engineer.html', universal: 'resume_jp_hybrid.html' },
  // Luxembourg: uses DE base (same EU Blue Card scheme, similar professional norms)
  lu: { ai_engineer: 'resume_de_engineer.html', hybrid: 'resume_de_hybrid.html', data_analyst: 'resume_de_analyst.html', data_engineer: 'resume_de_data_engineer.html', universal: 'resume_de_hybrid.html' },
  ie: { ai_engineer: 'resume_ie_engineer.html', hybrid: 'resume_ie_hybrid.html', data_analyst: 'resume_ie_analyst.html', data_engineer: 'resume_ie_data_engineer.html', universal: 'resume_ie_hybrid.html' },
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
{"type":"ai_engineer|data_analyst|data_engineer|hybrid|universal","confidence":0.0-1.0,"reasoning":"one sentence","country":"de|nl|sg|ae|jp|lu|ie|null"}

type rules:
- "ai_engineer" → primary focus on LLMs, RAG, LangChain, agents, GenAI, prompt engineering, inference
- "data_analyst" → primary focus on SQL, Tableau, Power BI, analytics, dashboards, BI, reporting, A/B testing, business intelligence
- "data_engineer" → primary focus on pipelines, ETL/ELT, Airflow, Spark, Kafka, dbt, data warehouse, Redshift/Snowflake/BigQuery, schema design, data contracts, orchestration, data quality frameworks, data lakes
- "hybrid" → requires both AI engineering AND strong data/analytics skills equally
- "universal" → role is non-technical or does not primarily focus on AI/ML, data analytics, or data engineering. Includes: marketing (performance, growth, brand, content, SEO/SEM), finance (FP&A, investment, banking, accounting), product management, HR/people ops, operations, consulting, sales/BD, legal, UX/design, healthcare, education, communications. Also use universal when the JD is ambiguous or when confidence in the four tech types is below 65%

country rules (detect from location, company HQ, currency, office city, visa mentions):
- "de" → Germany (Berlin, Munich, Hamburg, Frankfurt, GmbH, EUR salary, Blue Card mentioned)
- "nl" → Netherlands (Amsterdam, Rotterdam, Eindhoven, B.V., EUR, IND, HSM/Kennismigrant)
- "sg" → Singapore (Singapore, SGD, Pte Ltd, MOM, EP/Employment Pass, COMPASS)
- "ae" → UAE/Dubai (Dubai, Abu Dhabi, AED, UAE, DIFC, free zone, LLC)
- "jp" → Japan (Tokyo, Osaka, Kyoto, Fukuoka, JPY, ¥, K.K., G.K., Kabushiki Kaisha, JLPT, work visa Japan, Engineer visa Japan, Rakuten, Mercari, LINE, DeNA, CyberAgent, NTT, Fujitsu, SoftBank, Sony, Recruit)
- "lu" → Luxembourg (Luxembourg City, Kirchberg, Belval, S.A., S.à r.l., EUR, CSSF, EIB, European Investment Bank, Amazon Luxembourg, PayPal Luxembourg, Skype Luxembourg, Vodafone Luxembourg)
- "ie" → Ireland (Dublin, Cork, Galway, Limerick, Waterford, EUR, IDA Ireland, CSEP, Critical Skills Employment Permit, Enterprise Ireland, Google Dublin, Meta Dublin, LinkedIn Dublin, Stripe Dublin, Salesforce Dublin, HubSpot Dublin, Intercom, Workday Ireland, Indeed Ireland, Irish company, Ltd. Ireland)
- null → country unclear or not one of the above`,
    jd.slice(0, 3000),
    350,
  );
  try {
    const clean = res.replace(/```(?:json)?|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const type = (['ai_engineer', 'data_analyst', 'data_engineer', 'hybrid', 'universal'] as ResumeType[]).includes(parsed.type)
      ? parsed.type as ResumeType
      : 'hybrid';
    const validCountries: CountryCode[] = ['de', 'nl', 'sg', 'ae', 'jp', 'lu', 'ie'];
    const country = validCountries.includes(parsed.country) ? parsed.country as CountryCode : null;
    return { type, confidence: parsed.confidence ?? 0.7, reasoning: parsed.reasoning ?? '', country };
  } catch {
    return { type: 'hybrid', confidence: 0.5, reasoning: 'classification parse error — using hybrid', country: null };
  }
}

/** Normalize a string into a set of meaningful word tokens */
export function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
     .replace(/[()[\]]/g, ' ')   // strip brackets so "(RAG)" → "RAG"
     .split(/\W+/)
     .filter(w => w.length > 1), // drop single-char noise
  );
}

export function kwMatches(kw: string, html: string): boolean {
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

/**
 * Classify extracted keywords as niche (rare/specialist — high ATS signal) vs common.
 * Niche: dbt, Airflow, Kafka, Spark, RAG, Redshift, Snowflake, Kubernetes, Terraform, MLOps, LangChain…
 * Common: Python, SQL, AWS, Git, REST, JavaScript, Docker, React, CI/CD…
 */
export async function classifyKeywords(keywords: string[]): Promise<TaggedKeyword[]> {
  if (keywords.length === 0) return [];
  const res = await groqFast(
    'Classify each keyword as niche (rare/specialised — dbt, Airflow, Kafka, Spark, RAG, Redshift, Snowflake, BigQuery, Kubernetes, Terraform, MLOps, LangChain, Pinecone, Flink, EUV, FinFET, Qdrant) or common (ubiquitous across many JDs — Python, SQL, AWS, Git, REST, JavaScript, TypeScript, Java, Docker, React, Node.js, CI/CD, Linux, API). Return ONLY a JSON array with every input keyword: [{"kw":"...","niche":true/false}].',
    JSON.stringify(keywords),
    Math.min(keywords.length * 20 + 100, 800),
  );
  try {
    const clean = res.replace(/```(?:json)?|```/g, '').trim();
    const parsed: TaggedKeyword[] = JSON.parse(clean);
    if (Array.isArray(parsed) && parsed.every(x => typeof x.kw === 'string')) {
      const mapped = new Map(parsed.map(x => [x.kw.toLowerCase(), x.niche ?? false]));
      return keywords.map(kw => ({ kw, niche: mapped.get(kw.toLowerCase()) ?? false }));
    }
  } catch { /* fall through to safe default */ }
  return keywords.map(kw => ({ kw, niche: false }));
}

/** Remove near-duplicate keywords (e.g. "React" + "ReactJS") using 80% token overlap. */
export function deduplicateKeywords(keywords: string[]): string[] {
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
    'You are a senior job application strategist. Return a structured research brief that a resume writer can use to tailor a resume. Be specific and factual — no marketing fluff.',
    `Company: ${company}
Role: ${role}

Return this exact structure (fill in each field):
TECH STACK: [primary languages, frameworks, cloud platforms this company is known for]
ENGINEERING VALUES: [e.g. scale, reliability, speed, ML-first, data-driven, customer obsession — pick 2-3 that fit]
WHAT IMPRESSES THEM: [specific signal types that stand out in interviews/resumes at this company]
PRODUCT CONTEXT: [what team/product area this role likely supports]
TONE: [formal/startup/big-tech — how they communicate engineering quality]`,
    600,
  );
}

/** Rewrite the summary paragraph specifically for the target company/role. Always runs. */
export async function tailorSummary(
  baseHtml: string,
  company: string,
  role: string,
  research: string,
): Promise<string> {
  // Match <p> content inside the summary section (handles inline tags like <strong>)
  const match = baseHtml.match(/(<div[^>]*class="[^"]*\bsummary\b[^"]*"[\s\S]*?<p[^>]*>)([\s\S]*?)(<\/p>)/i);
  if (!match) return baseHtml;

  const originalText = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  const rewritten = await groqFast(
    'You are an elite resume writer. Return ONLY the new 2-3 sentence summary — plain text, no HTML, no markdown, no explanation.',
    `Rewrite this professional summary for a specific job application.

Target Company: ${company}
Target Role: ${role}
Company Research:
${research}

Original Summary (keep all metrics and product names):
${originalText}

REQUIREMENTS:
1. Open with "${role}" as the role identity — mirror the job title exactly
2. Keep EVERY quantified metric from the original (percentages, numbers, scale)
3. Weave in one specific signal from the company research (their tech stack or what impresses them)
4. 2-3 tight sentences — no filler words, no "passionate about", no "proven track record"
5. First-person implied — NO pronouns at all (no "I", "my", "they", "their", "he", "she"). Start sentences with strong action verbs or role nouns: "Engineer with...", "Architected...", "Built...", "Specializes in..."
6. The last phrase should signal unique fit for this specific company`,
    350,
  );

  const cleaned = rewritten.trim().replace(/^["']|["']$/g, '');
  // Preserve <strong> tags for product names in the original if present
  const newParagraph = match[1] + cleaned + match[3];
  return baseHtml.replace(match[0], newParagraph);
}

/** Inject a target-role subtitle line directly under the candidate name. */
function injectTargetRole(html: string, role: string): string {
  if (html.includes('class="target-role"')) {
    // Update existing line if re-tailoring
    return html.replace(
      /(<div[^>]*class="target-role"[^>]*>)[^<]*/i,
      `$1${role}`,
    );
  }
  return html.replace(
    /(<h1[^>]*>[\s\S]*?<\/h1>)/i,
    `$1\n    <div class="target-role" style="text-align:center;font-size:9.5pt;color:#555;font-weight:500;margin-top:1px;letter-spacing:0.3px;">${role}</div>`,
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

  // Strip base64 image data before sending to LLM (re-injected after).
  // Without this, a 33KB base64 string bloats the prompt and gets truncated.
  const photoMap = new Map<string, string>();
  let photoIdx = 0;
  const htmlForLlm = baseHtml.replace(/src="data:image\/[^;]+;base64,[^"]+"/g, (match) => {
    const token = `src="__PHOTO_${photoIdx++}__"`;
    photoMap.set(token, match);
    return token;
  });

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
13. ⚠️ ATS EXACT MATCH: Use the EXACT abbreviation/term as it appears in the keywords list — never expand it. Write "MLOps" not "Machine Learning Operations", "LLM" not "large language model", "dbt" not "data build tool", "RAG" not "retrieval-augmented generation". ATS parsers do literal string matching.
${country === 'de' ? `
13. GERMANY MARKET: Keep formal tone. Ensure every metric is precise. Do not remove the photo placeholder box or the Anabin degree note.` : ''}
${country === 'nl' ? `
13. NETHERLANDS MARKET: Keep the Profile section to 2 sentences max. Maintain clean, direct English. No fluff phrases.` : ''}
${country === 'sg' ? `
13. SINGAPORE MARKET: Keep "Employment Pass (shortage occupation — AI/ML)" phrase in the summary. Preserve the COMPASS qualification note in Education. Prioritise AI/ML keywords in top bullets.` : ''}
${country === 'ae' ? `
13. UAE MARKET: Keep "AWS-certified" or cloud certification keywords prominent. Preserve the Languages section. Keep nationality/visa line in header.` : ''}
${country === 'jp' ? `
13. JAPAN MARKET: Preserve the photo placeholder, the Languages section (including Japanese language entry), and the visa sponsorship line in the header. Keep tone precise and factual — Japanese employers value concise, evidence-backed statements. Keep the education note about Engineer visa eligibility.` : ''}

${compressHtml(htmlForLlm)}`,
    6000,
  );

  let result = tailored
    .replace(/^```(?:html)?\s*/m, '').replace(/\s*```$/m, '').trim()
    // Strip any <strong>/<b> tags the LLM added around keywords
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '$1')
    .replace(/<b>([\s\S]*?)<\/b>/gi, '$1');

  // Re-inject base64 photo data that was stripped before sending to LLM
  for (const [token, original] of photoMap) {
    result = result.replace(token, original);
  }
  return result;
}

/**
 * Strips GitHub and LinkedIn contact-item divs from the base HTML.
 * Done programmatically (pre-LLM) for reliability — more dependable than asking the LLM.
 */
function prepareUniversalBase(html: string): string {
  return html
    .replace(/<div class="contact-item">[\s\S]*?linkedin\.com[\s\S]*?<\/div>/gi, '')
    .replace(/<div class="contact-item">[\s\S]*?github\.com[\s\S]*?<\/div>/gi, '');
}

/**
 * Full resume rewrite for non-tech/universal roles via a single groqLarge call.
 * Unlike standard tailoring (keyword injection), this COMPLETELY rewrites bullets,
 * skills, summary and removes irrelevant sections for the target role.
 */
export async function tailorUniversal(
  baseHtml: string,
  company: string,
  role: string,
  research: string,
  jd: string,
  keywords: string[],
): Promise<string> {
  const tailored = await groqLarge(
    'You are a professional resume writer specialising in career pivots and cross-industry transitions. Return ONLY the complete modified HTML — no explanation, no markdown fences.',
    `You are completely rewriting this resume for a career pivot into a ${role} role at ${company}.

Company Research:
${research}

Job Description (for context on tone and priorities):
${jd.slice(0, 2000)}

Keywords to incorporate naturally: ${keywords.slice(0, 30).join(', ')}

TRANSFORMATION RULES — follow every one precisely:

1. SUMMARY: Rewrite as a ${role} professional with a strong analytical background from enterprise software. Emphasise business impact, cross-functional collaboration, data-driven decision making. Remove LLM/RAG/software-engineering terms unless the JD specifically calls for them. Keep 2-3 tight sentences.

2. EXPERIENCE JOB TITLE: Change the job title inside the experience entry (the <strong> or heading that currently says "AI Engineer & Software Engineer" or similar) to a title that fits ${role} — e.g. "Business Analyst", "Senior Analyst", "Operations Analyst", or whatever most closely matches the target role. Company name (ADP) and dates stay unchanged.

3. EXPERIENCE BULLETS: Completely rewrite EVERY bullet to be a compelling, specific achievement for a ${role} professional. You MAY fabricate plausible, role-appropriate experience points — invent quantified wins that would impress a hiring manager for this exact role. The only hard constraints are: company name (ADP) and employment dates MUST stay accurate. Everything else — bullet content, metrics, achievements — should be freshly created for the target role. Example for marketing: "Launched multi-channel outreach programme targeting enterprise payroll buyers, driving 35% increase in qualified pipeline over two quarters." Make each bullet start with a strong past-tense action verb. Make each bullet specific and quantified.

4. SKILLS SECTION ORDER: Move the entire Skills <div class="section"> block so it appears AFTER the Experience section, not before it. The final section order must be: Summary → Experience → Skills → (Projects if kept) → Education → Certifications.

5. SKILLS CONTENT: Replace tech-specific row names with role-relevant categories that fit ${role}. Keep category names SHORT — maximum 20 characters — so they fit the existing CSS column layout (e.g. "Core Skills", "Tools", "Soft Skills", "Domain", not long phrases like "Process Analysis & Design"). Surface transferable skills: data analysis, stakeholder communication, cross-functional delivery, SQL, reporting, process improvement, project management. Remove irrelevant dev-only tools.

6. PROJECTS SECTION: If projects are purely coding apps with no clear ${role} relevance, REMOVE the ENTIRE <div class="section"> block that contains the Projects heading. If a project can be reframed as a business initiative relevant to ${role}, keep it with reframed text.

7. CERTIFICATIONS: Remove purely technical certifications (IBM Data Engineering, Google AI Certificate, AWS certifications) unless directly relevant to ${role}. Keep academic scholarships and universally relevant awards.

8. FABRICATION RULES: Company name (ADP) and employment dates MUST stay accurate. Everything else — job title, bullet content, metrics, achievements, skills — should be invented to best fit ${role}. Make it convincing and specific.

9. Page 1 must fit one A4 page. After removing sections the content is shorter — this is correct and expected.

10. Return the COMPLETE modified HTML preserving all CSS classes, <style> blocks, and document structure. Do not omit any HTML tags.

${compressHtml(baseHtml)}`,
    8000,
  );

  return tailored
    .replace(/^```(?:html)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();
}

export async function runPipeline(
  jd: string,
  company: string,
  role: string,
  onStep: (step: string, data?: unknown) => void,
  confirmedKeywords?: string[],
): Promise<TailorResult> {
  onStep('classifying');
  const classification = await classifyJd(jd);
  onStep('classified', classification);
  // confidence ≤ 0.5 means the LLM response failed to parse and we fell back to hybrid
  if (classification.confidence <= 0.5) {
    onStep('warn', { id: 'warn_classify', message: '⚠ Classification uncertain — using Hybrid base as fallback' });
  }

  let keywords: string[];
  let taggedKeywords: TaggedKeyword[];
  if (confirmedKeywords && confirmedKeywords.length > 0) {
    // User confirmed (possibly edited) keyword set — skip LLM extraction but still classify for niche flags
    keywords = confirmedKeywords;
    taggedKeywords = await classifyKeywords(keywords);
    onStep('keywords', { count: keywords.length, keywords: taggedKeywords, confirmed: true });
  } else {
    onStep('extracting');
    keywords = await extractKeywords(jd);
    taggedKeywords = await classifyKeywords(keywords);
    onStep('keywords', { count: keywords.length, keywords: taggedKeywords });
    if (keywords.length === 0) {
      onStep('warn', { id: 'warn_keywords', message: '⚠ No keywords extracted — JD may be too short or in an unexpected format' });
    }
  }

  // Helper: sort a missing-keyword list so niche (high-ATS-signal) terms come first
  const nicheSet = new Set(taggedKeywords.filter(t => t.niche).map(t => t.kw));
  const nicheFirst = (kws: string[]) => [
    ...kws.filter(k => nicheSet.has(k)),
    ...kws.filter(k => !nicheSet.has(k)),
  ];

  const baseHtml = getBaseHtml(classification.type, classification.country);
  onStep('base_selected', { type: classification.type, country: classification.country ?? null });
  const before = scoreCoverage(keywords, baseHtml);
  onStep('coverage_before', { pct: before.pct, missing: before.missing.length });

  // Research company — useful context for both standard and universal pipelines
  onStep('researching');
  const research = await researchCompany(company, role);
  onStep('researched', { research });

  let html: string;
  let after: CoverageResult;

  if (classification.type === 'universal') {
    // ── Universal path: full rewrite for non-tech roles ──────────────────
    // Strip GitHub/LinkedIn contacts before sending to LLM (more reliable than asking the LLM)
    const strippedBase = prepareUniversalBase(baseHtml);

    onStep('tailoring', { missing: keywords.length, universal: true });
    html = await tailorUniversal(strippedBase, company, role, research, jd, keywords);
    // Inject target-role subtitle under the name heading
    html = injectTargetRole(html, role);
    after = scoreCoverage(keywords, html);
    onStep('tailored', { pct: after.pct });
  } else {
    // ── Standard path: summary rewrite + keyword injection ───────────────
    onStep('summarizing');
    html = await tailorSummary(baseHtml, company, role, research);
    after = scoreCoverage(keywords, html);

    // Keyword tailoring: run whenever ANY keywords are missing
    if (after.missing.length > 0) {
      onStep('tailoring', { missing: after.missing.length });
      html = await tailorHtml(html, nicheFirst(after.missing), company, role, research, false, classification.country);
      after = scoreCoverage(keywords, html);
      onStep('tailored', { pct: after.pct });

      // Second pass if meaningful keywords still missing
      if (after.pct < 92 && after.missing.length > 0) {
        onStep('tailoring2', { missing: after.missing.length });
        html = await tailorHtml(html, nicheFirst(after.missing), company, role, research, true, classification.country);
        after = scoreCoverage(keywords, html);
        onStep('tailored', { pct: after.pct });
      }
    } else {
      onStep('tailored', { pct: after.pct, skipped: true });
    }
  }

  const changes = computeChanges(baseHtml, html);
  return { html, before, after, keywords: taggedKeywords, company, role, research, changes, classification };
}

export { slugify };
