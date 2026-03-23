# Resume Pipeline

An AI-powered resume tailoring system built for **Bandreddy Sri Sai Lohith**. Given a job description, it automatically researches the company, extracts ATS keywords, rewrites resume bullets to hit ≥ 90% keyword coverage, and exports a pixel-perfect 2-page PDF — all powered by the **Grok API (xAI)**.

---

## What It Does

```
You paste a JD  →  Grok extracts keywords  →  Grok researches company
                →  Coverage scored against base resume
                →  Grok rewrites bullets naturally (no buzzword soup)
                →  Tailored HTML written  →  Puppeteer exports 2-page PDF
                →  Live preview auto-reloads at localhost:3001
```

---

## Project Structure

```
resume-pipeline/
│
├── resume_base.html          # Master resume — ATS-clean 2-page HTML/CSS
│                             # Edited here first; all tailored versions branch from this
│
├── tailor_resume.py          # Core pipeline — Grok API orchestration
│                             # Steps: keyword extract → company research → bullet rewrite → coverage score
│
├── generate_pdf.js           # Puppeteer script — converts HTML → A4 PDF (exact 2 pages, no overflow)
│
├── server.js                 # Express preview server (port 3001)
│                             # • Serves resume HTML with SSE live-reload
│                             # • POST /tailor — triggers full pipeline via API
│                             # • GET  /preview/base
│                             # • GET  /preview/tailored/:name
│                             # • GET  /download/:filename
│
├── .claude/
│   └── launch.json           # Claude Code dev server config — run `preview_start resume-pipeline`
│
├── tailored/                 # Auto-generated output folder (git-tracked HTMLs, PDFs gitignored)
│   ├── resume_<company>_<role>.html
│   └── resume_<company>_<role>.pdf
│
├── .env                      # Local secrets — NEVER committed (see .env.example)
├── .gitignore
├── package.json
└── README.md
```

---

## Tech Stack

| Layer | Tool |
|---|---|
| AI / LLM | Grok API (`grok-3-mini`) via xAI — keyword extraction, company research, bullet rewriting |
| PDF Generation | Puppeteer (headless Chromium) — renders HTML → A4 PDF |
| Preview Server | Express.js + chokidar — SSE live-reload on file change |
| Resume Format | Pure HTML + CSS (Inter font, inline SVG icons for email/phone/LinkedIn/GitHub) |
| Runtime | Node.js v25+ (via Homebrew) + Python 3 |
| Version Control | Git + GitHub (`lohith261/resume-pipeline`) |

---

## Resume Design Decisions

- **2-page enforced** — page 1: Header, Summary, Experience, Projects. Page 2: Skills, Education, Awards. Split using two separate `<div class="page">` containers with `break-before: page` — the only reliable way to force page breaks in Puppeteer's Chromium renderer.
- **No `page-break-inside: avoid` on sections** — only on individual `.project-block` and `.job` elements. Applying it to whole sections causes Chromium to push entire sections to the next page, breaking the layout.
- **Spacing tuned to fill page 1** — `section margin-bottom: 18px`, `project-block margin-bottom: 13px`, `li margin-bottom: 5px`, `line-height: 1.44`. Values were measured with Puppeteer JS evaluation to leave ≤ 30px gap at page bottom.
- **ATS-friendly** — no tables, no columns, no images (except SVG contact icons), no text boxes. Plain semantic HTML for maximum parser compatibility.

---

## Environment Variables

Create a `.env` file in the project root:

```env
GROK_API_KEY=your_grok_api_key_here   # From console.x.ai
PORT=3001                              # Preview server port
```

> `.env` is gitignored. Never commit secrets.

---

## Local Setup

### Prerequisites

- **Node.js v18+** — install via Homebrew: `brew install node`
- **Python 3.9+** — comes with macOS or install via `brew install python`
- **Git** — `brew install git`

### 1. Clone the repo

```bash
git clone https://github.com/lohith261/resume-pipeline.git
cd resume-pipeline
```

### 2. Install Node dependencies

```bash
npm install
```

> This installs `express`, `chokidar`, `dotenv`, and `puppeteer` (which downloads Chromium automatically).

### 3. Set up environment variables

```bash
cp .env.example .env
# Then edit .env and add your GROK_API_KEY
```

### 4. Start the preview server

```bash
node server.js
```

Server starts at **http://localhost:3001**

| URL | Description |
|---|---|
| `http://localhost:3001` | Homepage — lists all available resumes |
| `http://localhost:3001/preview/base` | Live preview of base resume |
| `http://localhost:3001/preview/tailored/<name>` | Live preview of a tailored resume |
| `http://localhost:3001/download/<file>.pdf` | Download a PDF |

> The server **auto-reloads** any open browser tab when an `.html` file changes — no manual refresh needed.

---

## Tailoring a Resume

### Option A — via Python (CLI)

```bash
python3 tailor_resume.py "<paste full JD here>" "Company Name" "Role Title"
```

Example:
```bash
python3 tailor_resume.py "We are looking for a GenAI Full-Stack Engineer..." "Accenture" "GenAI Full-Stack Engineer"
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
  Before   : 43.9% (18/41)
  After    : 91.2% (38/41)
============================================================

[tailor] HTML written → tailored/resume_accenture_genai_full_stack_engineer.html
[tailor] PDF written  → tailored/resume_accenture_genai_full_stack_engineer.pdf

✅ Done!
   Preview : http://localhost:3001/preview/tailored/resume_accenture_genai_full_stack_engineer
```

### Option B — via API (while server is running)

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
  "pdfUrl": "/download/resume_accenture_genai_full_stack_engineer.pdf",
  "htmlUrl": "/preview/tailored/resume_accenture_genai_full_stack_engineer"
}
```

> The API also **broadcasts a live-reload** to any open browser tabs automatically.

---

## Generating a PDF Manually

To convert any resume HTML to PDF directly:

```bash
node generate_pdf.js tailored/resume_accenture_genai_full_stack_engineer.html tailored/output.pdf
```

Or for the base resume:

```bash
node generate_pdf.js resume_base.html resume_base.pdf
```

---

## How the Grok Pipeline Works (tailor_resume.py)

```
Step 1 — Read base resume HTML
Step 2 — Call Grok: extract structured keywords from JD
          Model: grok-3-mini | Temp: 0.4 | Returns: JSON array of strings
Step 3 — Score keyword coverage (regex match against base HTML)
Step 4 — Call Grok: research company + role context (3–5 sentence brief)
Step 5 — If coverage < 90%:
            Call Grok: rewrite bullets weaving in missing keywords
            Rules: edit existing bullets first, add new ones only if >10% still missing,
                   human English only, no fabrication, no structure changes
Step 6 — Re-score coverage after tailoring
Step 7 — Write tailored HTML → tailored/resume_<company>_<role>.html
Step 8 — Call generate_pdf.js via subprocess → PDF
Step 9 — Save JSON report → tailored/report_<company>_<role>.json
```

---

## Tailoring Rules (for LLMs reading this)

When editing bullets, follow these constraints strictly:

1. **Edit existing bullets first** — weave keywords naturally into current sentences
2. **Add new bullets only if** more than 10% of important keywords still can't fit
3. **Never fabricate** — only enhance what already exists in the candidate's real experience
4. **Human English** — no buzzword stacking, no robotic keyword lists
5. **Max 2 lines per bullet** — keep concise
6. **Do not touch** HTML structure, CSS, section headings, or contact info
7. **Return complete HTML** — not a diff, not a snippet

---

## Output Files

All outputs go into `tailored/`:

| File | Description |
|---|---|
| `resume_<co>_<role>.html` | Tailored resume HTML (committed to git) |
| `resume_<co>_<role>.pdf` | Exported PDF (gitignored — binary) |
| `report_<co>_<role>.json` | Coverage report: before/after scores, keyword lists, company research (gitignored) |

---

## Updating the Base Resume

All tailored resumes are generated from `resume_base.html`. To update your base resume:

1. Edit `resume_base.html` directly
2. Preview at `http://localhost:3001/preview/base` (auto-reloads on save)
3. Check page layout — page 1 should end within **30px of the bottom** of A4
4. Commit the updated base: `git add resume_base.html && git commit -m "update base resume"`

---

## Known Constraints

- **Puppeteer PDF page breaks** — must use two separate `<div class="page">` wrappers. CSS `page-break-before` on elements inside a single wrapper is unreliable in Chromium headless.
- **Grok token limit** — `tailor_resume.py` caps JD input at 4000 chars and keyword list at 40 items to stay within `grok-3-mini` context limits.
- **Port 3001** — hardcoded in `.env`. If in use, change `PORT` in `.env` and update `.claude/launch.json`.

---

## Author

**Bandreddy Sri Sai Lohith**
[linkedin.com/in/srisailohith](https://linkedin.com/in/srisailohith) · [github.com/lohith261](https://github.com/lohith261) · bandreddysrisailohith@gmail.com
