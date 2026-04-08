# Resume Pipeline

An AI-powered resume tailoring system built for **Bandreddy Sri Sai Lohith**. Paste a job description or URL, and the pipeline automatically extracts ATS keywords, researches the company, rewrites resume bullets to hit ≥ 90% keyword coverage, and exports a clean 2-page PDF.

**Live Web App:** [webapp-ten-beryl.vercel.app](https://webapp-ten-beryl.vercel.app)

**Primary AI:** Groq API (`llama-3.3-70b-versatile`) — 131K TPM, no rate-limit issues
**Fallback AI:** OpenRouter (`google/gemini-2.5-flash`) — auto-switches on Groq failure
**PDF Engine:** Browser `window.print()` — zero dependencies, works everywhere
**Preview Server:** Express.js with SSE live-reload (local dev)

---

## How It Works

```
JD text / URL input
    │
    ├─► [Groq] Classify role type → ai_engineer | data_analyst | hybrid
    │         └─► Select matching base resume (87%+ starting coverage)
    │
    ├─► [Groq] Extract ATS technical keywords from JD
    ├─► Score baseline keyword coverage against selected base
    ├─► [Groq] Research company + role context
    │
    ├─ Coverage < 90%? ──► [Groq] Pass 1: Weave keywords into existing bullets
    │                 └──► Still < 90%? Pass 2: Target remaining missing keywords
    │
    ├─► Compute bullet diff (modified vs added vs unchanged)
    ├─► Write → tailored/<company>/resume_<company>_<role>.html
    ├─► PDF → browser window.print() (web) / Puppeteer (CLI)
    └─► SSE broadcast → live progress in chat UI
```

### Multi-Base Resume System

Three specialized bases, auto-selected per JD:

| Base | File | Best for |
|---|---|---|
| AI Engineer | `resume_ai_engineer.html` | LLMs, RAG, LangChain, agents, GenAI, inference |
| Data Analyst | `resume_data_analyst.html` | SQL, ETL, dashboards, BI, Python analytics |
| Hybrid | `resume_base.html` | Full-stack, balanced AI + data roles |

The classifier (`classify_jd.py` / `classifyJd()`) first runs a fast keyword heuristic. If ambiguous, it calls Groq to classify. The UI shows which base was selected and confidence %, with a one-sentence reasoning.

---

## Web App (Vercel)

The webapp at [webapp-ten-beryl.vercel.app](https://webapp-ten-beryl.vercel.app) provides a ChatGPT-style interface for the full pipeline.

### Features

| Feature | Description |
|---|---|
| **Paste JD or URL** | Auto-detects company & role; supports Ashby, LinkedIn, Greenhouse, Wellfound |
| **Live progress** | SSE streaming shows each step (fetching → keywords → research → tailoring) |
| **Resume preview** | Side-by-side split view with page-break indicators at the A4 boundary |
| **PDF download** | Opens a print-ready tab — saves as `Resume_Company_Role.pdf`, no browser headers/footers |
| **Keyword coverage** | Shows green ✓ present / red ✗ missing badges; expand to see all keywords |
| **Bullet diff** | Collapsible changelog showing exactly which bullets were modified (before → after) and which were added |
| **Q&A mode** | After tailoring, ask application portal questions — answered in first-person using your resume + company context |
| **Edit mode** | Type instructions like *"remove the Spring Boot bullet"* or *"add Docker to skills"* — preview updates instantly |
| **Cover letter** | Generate a tailored cover letter for the role in one click |
| **Interview prep** | STAR-method question bank and talking points based on the JD and your tailored resume |
| **Fit Score** | Keyword match % + role alignment score shown as a visual breakdown |
| **TXT download** | Download resume as plain text for Workday / ATS form autofill |

### Web App Structure

```
webapp/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Chat UI — tailor / Q&A / edit modes
│   │   └── api/
│   │       ├── tailor/route.ts       # SSE pipeline: keywords → research → tailor
│   │       ├── fetch-jd/route.ts     # Scrape & clean job description from URL
│   │       ├── answer/route.ts       # Answer application questions in first-person
│   │       ├── edit/route.ts         # Edit resume via chat instruction
│   │       ├── cover-letter/route.ts # Generate tailored cover letter
│   │       └── interview-prep/route.ts # STAR-method interview prep & fit score
│   ├── lib/
│   │   ├── groq.ts                   # Groq (70b primary) + OpenRouter Gemini Flash fallback
│   │   └── tailor.ts                 # Pipeline: extractKeywords → researchCompany → tailorHtml
│   └── data/
│       └── resume_base.html          # Master resume embedded for Vercel serverless access
└── .env.local                        # GROQ_API_KEY, OPENROUTER_API_KEY
```

### How the Chat Modes Work

After a resume is generated, the input box intelligently routes:

```
Short message starting with "add", "remove", "change", "fix"...
    → Edit mode: patches HTML in-place, refreshes preview

Short message / question (< 600 chars, not a URL)
    → Q&A mode: answers the question using resume + company context

URL or long text (> 600 chars)
    → New tailoring run
```

### Bullet Diff (Changes Changelog)

Every tailoring run computes a word-level diff between the base resume and the tailored output:

- **Modified bullets** — shown with the original text struck through in gray, new version in green below it
- **Added bullets** — shown with a `+` prefix in indigo (only appear when >10% of keywords couldn't fit in existing bullets)
- Collapsed by default under `✏️ N bullets modified · ➕ N added` — click to expand

---

## Project Structure

```
resume-pipeline/
│
├── resume_ai_engineer.html       # AI/LLM-focused base (RAG, LangChain, agents, GenAI)
├── resume_data_analyst.html      # Analytics-focused base (SQL, ETL, dashboards, Python)
├── resume_base.html              # Hybrid base — balanced AI + data (also resume_hybrid.html)
│                                 # ATS-clean, 2-page, pure HTML/CSS, no tables/columns
│                                 # All tailored resumes are generated from this file
│
├── classify_jd.py                # JD classifier → ai_engineer | data_analyst | hybrid
│                                 # Fast keyword heuristic first; Groq LLM for ambiguous cases
├── tailor_resume.py              # Core AI pipeline
│                                 # Calls Groq API → keyword extract → company research
│                                 # → coverage score → bullet rewrite → HTML + PDF output
│                                 # Auto-falls back to OpenRouter if Groq hits rate limit
│
├── generate_pdf.js               # Puppeteer HTML→PDF converter
│                                 # Renders at A4, zero margins, waits for fonts
│                                 # Usage: node generate_pdf.js <input.html> <output.pdf>
│
├── server.js                     # Express preview server (port 3001)
│                                 # GET  /                              → home, lists all resumes
│                                 # GET  /preview/base                 → live base resume
│                                 # GET  /preview/tailored/<co>/<name> → live tailored resume
│                                 # GET  /download/<co>/<file>.pdf     → download PDF
│                                 # POST /tailor                       → trigger full pipeline
│                                 # GET  /livereload                   → SSE stream for auto-reload
│
├── tailored/                     # All outputs — nested by company slug
│   ├── accenture/
│   │   ├── resume_accenture_genai_full_stack_engineer.html
│   │   ├── resume_accenture_genai_full_stack_engineer.pdf   ← gitignored
│   │   └── report_accenture_genai_full_stack_engineer.json  ← gitignored
│   ├── clera/
│   ├── scale_ai/
│   └── ... (22+ companies)
│
├── .claude/
│   └── launch.json               # Claude Code dev server config
│
├── .env                          # Local secrets — NEVER committed
├── .env.example                  # Template — safe to commit
├── .gitignore
├── package.json
└── README.md
```

---

## Environment Variables

Create `.env` in the project root (copy from `.env.example`):

```env
GROQ_API_KEY=your_groq_api_key          # From console.groq.com (free tier available)
OPENROUTER_API_KEY=your_openrouter_key  # From openrouter.ai (fallback — optional)
PORT=3001                               # Preview server port
```

> `.env` is gitignored. The pipeline works with just `GROQ_API_KEY`. `OPENROUTER_API_KEY` is only used as fallback when Groq hits its rate limit.

---

## Local Setup

### Prerequisites

```bash
# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js and Python
brew install node python
```

### 1. Clone

```bash
git clone https://github.com/lohith261/resume-pipeline.git
cd resume-pipeline
```

### 2. Install Node dependencies

```bash
npm install
```

> Installs `express`, `chokidar`, `dotenv`, and `puppeteer` (downloads Chromium automatically ~150MB).

### 3. Set up environment variables

```bash
cp .env.example .env
# Edit .env — add your GROQ_API_KEY at minimum
```

### 4. Start the preview server

```bash
node server.js
```

Open **http://localhost:3001** — you'll see all available resumes listed.

| URL | What it does |
|---|---|
| `http://localhost:3001` | Home — lists all resumes |
| `http://localhost:3001/preview/base` | Live base resume (auto-reloads on save) |
| `http://localhost:3001/preview/tailored/accenture/resume_accenture_genai_full_stack_engineer` | Tailored resume preview |

---

## Tailoring a Resume

### Option A — CLI

```bash
python3 tailor_resume.py "<full JD text>" "Company Name" "Role Title"
```

Example:

```bash
python3 tailor_resume.py "We are looking for a GenAI Full-Stack Engineer to build agentic applications..." "Accenture" "GenAI Full-Stack Engineer"
```

Output:

```
[grok] Extracting keywords from JD...
[grok] Extracted 42 keywords
[grok] Researching Accenture...
[grok] Tailoring resume — weaving in 18 missing keywords...

============================================================
  KEYWORD COVERAGE REPORT
  Company  : Accenture
  Role     : GenAI Full-Stack Engineer
  Before   : 43.9%  (18/42)
  After    : 91.2%  (38/42)
============================================================

[tailor] HTML written → tailored/accenture/resume_accenture_genai_full_stack_engineer.html
[tailor] PDF written  → tailored/accenture/resume_accenture_genai_full_stack_engineer.pdf

✅ Done!  Preview: http://localhost:3001/preview/tailored/accenture/resume_accenture_genai_full_stack_engineer
```

### Option B — API (server must be running)

```bash
curl -X POST http://localhost:3001/tailor \
  -H "Content-Type: application/json" \
  -d '{
    "jd": "We are looking for a GenAI Full-Stack Engineer...",
    "company": "Accenture",
    "role": "GenAI Full-Stack Engineer"
  }'
```

Response:

```json
{
  "ok": true,
  "coverage": 91.2,
  "pdfUrl": "/download/accenture/resume_accenture_genai_full_stack_engineer.pdf",
  "htmlUrl": "/preview/tailored/accenture/resume_accenture_genai_full_stack_engineer",
  "log": "..."
}
```

> The API also triggers an SSE broadcast — any open browser preview tabs **auto-reload** instantly.

---

## Generating a PDF Manually

```bash
# Any HTML file → PDF
node generate_pdf.js tailored/accenture/resume_accenture_genai_full_stack_engineer.html tailored/accenture/output.pdf

# Regenerate base resume PDF
node generate_pdf.js resume_base.html resume_base.pdf
```

---

## AI Pipeline Details (`tailor_resume.py`)

| Step | What happens |
|---|---|
| 1 | Read `resume_base.html` |
| 2 | **Groq**: Extract structured keyword list from JD (JSON array) |
| 3 | Score keyword coverage — regex match against base HTML |
| 4 | **Groq**: Research company + role (3–5 sentence brief) |
| 5 | If coverage < 90%: **Groq** rewrites bullets, weaving in missing keywords |
| 6 | Re-score coverage on tailored HTML |
| 7 | Print before/after coverage report to stdout |
| 8 | Save JSON report → `tailored/<company>/report_<co>_<role>.json` |
| 9 | Write HTML → `tailored/<company>/resume_<co>_<role>.html` |
| 10 | Spawn `node generate_pdf.js` subprocess → PDF |
| 11 | Write ATS scan checklist → `tailored/<company>/ats_checklist.txt` |

**Rate limit handling:** If Groq returns HTTP 429, the pipeline waits 3s, retries once, then automatically falls back to OpenRouter (`google/gemini-2.5-flash`) with no user intervention needed.

---

## Tailoring Rules (for LLMs reading this)

When the AI edits resume bullets, it follows these strict constraints:

1. **Edit existing bullets first** — weave keywords naturally into current sentences
2. **Add new bullets only if** >10% of important keywords still can't fit anywhere
3. **Space constraint is critical** — page 1 is strictly sized. If text is added, something else must be shortened so the layout stays within 2 pages
4. **Never fabricate** — only enhance what already exists in the candidate's real experience
5. **Human English only** — no buzzword stacking, no robotic keyword lists
6. **Max ~1.5 lines per bullet** — keep concise
7. **Do not touch** HTML structure, CSS, section headings, or contact info
8. **Use exact JD phrasing** — insert keywords verbatim (no paraphrases)
9. **Return complete HTML** — not a diff, not a snippet, no markdown fences

---

## Resume Layout Notes (important for PDF debugging)

- **Two separate `<div class="page">` containers** — the only reliable way to force a clean page break in Puppeteer's Chromium renderer. CSS `page-break-before` on elements inside one container is unreliable.
- **Page 1:** Header, Summary, Experience, Projects
- **Page 2:** Skills, Education, Awards & Honors
- **`page-break-inside: avoid` is set only on `.project-block` and `.job`**, NOT on `.section`. Setting it on entire sections causes Chromium to push the whole section to the next page when it doesn't fully fit, creating a 3rd page.
- **Spacing is tuned precisely** — `section margin-bottom: 12px`, `project-block: 8px`, `li: 1px`, `line-height: 1.42`. These values leave ≤ 30px gap at the bottom of page 1 and prevent overflow into a 3rd page.

---

## Output Files

| File | Committed to git? |
|---|---|
| `tailored/<co>/resume_<co>_<role>.html` | ✅ Yes |
| `tailored/<co>/resume_<co>_<role>.pdf` | ❌ No (binary, gitignored) |
| `tailored/<co>/report_<co>_<role>.json` | ❌ No (contains full JD text) |
| `tailored/<co>/ats_checklist.txt` | ✅ Yes |
| `resume_base.html` | ✅ Yes |
| `resume_base.pdf` | ❌ No |

---

## Companies Tailored So Far

Airweave, Algo1, Bjak, Build, Clera, Concentrate AI, Conductor, Duku AI, Faction, FutureSight, Guild.ai, Happy Robot, Interactivated, Minted, OneSeven Tech, Reflow, Sapiom, Scale AI, StackOne, TalentPluto, Titan AI, TSCAI + Accenture (22 total)

---

## Author

**Bandreddy Sri Sai Lohith**
[linkedin.com/in/srisailohith](https://linkedin.com/in/srisailohith) · [github.com/lohith261](https://github.com/lohith261) · bandreddysrisailohith@gmail.com
