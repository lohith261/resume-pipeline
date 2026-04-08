# Resume Tailor

AI-powered resume tailoring webapp. Paste a job description, get a resume optimized for that specific role and company — including keyword coverage scoring, a tailored cover letter, and AI-generated interview prep.

Live: [jobtailor.in](https://jobtailor.in)

---

## Features

### Resume Tailoring
- Paste any job description — the pipeline extracts keywords, classifies the role (engineer / data analyst / hybrid), and selects the best matching base resume
- Two-pass LLM tailoring: first pass rewrites bullets to match keywords; second pass strengthens the top 3 bullets (F-pattern optimization for the 7-second recruiter scan)
- Real-time progress via SSE streaming (keyword extraction → classification → tailoring pass 1 → tailoring pass 2)
- Undo support: edit the tailored resume with plain-English instructions, undo any edit that makes things worse

### Fit Score
- **Keyword Match** — % of JD keywords covered by the tailored resume
- **Role Alignment** — classification confidence score
- **Overall Fit** — weighted composite (60/40)
- Animated score bars shown inline after tailoring completes

### Country-Aware Targeting
Detects target country from the JD (location mentions, company entity suffixes, currency, visa terminology) and selects a country-specific base resume:

| Country | Base | Key differences |
|---|---|---|
| Germany | `resume_germany.html` | Photo placeholder, EU Blue Card mention, Anabin H+ note |
| Netherlands | `resume_netherlands.html` | Clean header, Kennismigrant (HSM) visa note |
| Singapore | `resume_singapore.html` | EP sponsorship line, COMPASS qualification note |
| UAE | `resume_uae.html` | Photo placeholder, Certifications → Languages → Education order, Languages section |

Tailoring prompt also injects country-specific rules (e.g. German metric precision, Singapore COMPASS-awareness, UAE certification emphasis).

### Cover Letter
- One-click generation after tailoring
- Extracts your name, email, phone from the resume HTML — no hardcoded values
- Grounded in real resume bullets + JD keywords

### Interview Prep
- 5 STAR-format questions generated after tailoring: behavioral, technical/system-design, situational, role-specific, motivation/culture
- Every answer is grounded in your actual resume bullets — model is instructed never to fabricate
- Collapsible cards per question; auto-fetched on first tab visit

### Downloads
- **PDF** — browser print dialog, clean single-page layout
- **TXT** — structured plain-text output for Workday / ATS autofill (parses CSS class selectors, not raw innerText, to avoid HTML attribute leakage)

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI | Tailwind CSS, plain React (no component library) |
| LLM — fast tasks | Groq `llama-3.1-8b-instant` (keyword extraction, research) |
| LLM — tailoring | Groq `llama-3.3-70b-versatile` (resume rewrites, interview prep) |
| LLM — large input | OpenRouter `google/gemini-2.0-flash-001` (cover letter, HTML editing) |
| Streaming | Server-Sent Events (SSE) |
| Deployment | Vercel |

---

## Base Resumes

Four role variants + four country variants live in `src/data/`:

```
resume_base.html          — general software engineering
resume_ai_engineer.html   — AI/ML engineer focus
resume_hybrid.html        — AI Engineer (recent) + Data Analyst (prior)
resume_data_analyst.html  — data analyst / analytics engineering

resume_germany.html       — DE market structure
resume_netherlands.html   — NL market structure
resume_singapore.html     — SG market structure
resume_uae.html           — UAE market structure
```

Country bases take priority over role bases. If a Germany JD is detected, `resume_germany.html` is used regardless of role classification.

---

## Environment Variables

```bash
GROQ_API_KEY=           # Required — Groq API key
OPENROUTER_API_KEY=     # Optional — fallback for large-input tasks and Groq rate limits
SITE_URL=               # Optional — used as HTTP-Referer for OpenRouter
```

---

## Local Development

```bash
cd webapp
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Pipeline Architecture

```
JD input
  → /api/fetch-jd        (optional URL fetch)
  → /api/tailor (SSE)
      1. groqFast: extract keywords
      2. groq: classify role type + detect country
      3. getBaseHtml(type, country) → select HTML base
      4. groqLarge: tailoring pass 1 (keyword injection)
      5. groqLarge: tailoring pass 2 (F-pattern top-3 strengthening)
      → stream: keywords · classified · tailoring · done
  → client: score bars, preview iframe, tabs

Tabs:
  Resume  → PDF / TXT download, inline edit + undo
  Cover   → /api/cover-letter → PDF / TXT
  Interview → /api/interview-prep → 5 STAR cards
```
