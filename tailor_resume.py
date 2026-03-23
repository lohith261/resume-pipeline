#!/usr/bin/env python3
"""
Resume Tailoring Pipeline  —  Powered by Grok API (xAI)
────────────────────────────────────────────────────────
Usage:
  python3 tailor_resume.py "<job_description>" "<company>" "<role>"

Steps:
  1. Read resume_base.html
  2. Use Grok to extract structured keywords from the JD
  3. Use Grok to research the company & role context
  4. Score current keyword coverage
  5. If >10% missing → Grok rewrites/adds bullets naturally
  6. Write tailored HTML + PDF
  7. Print coverage report
"""

import sys, os, re, json, subprocess
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error   import URLError

# ── load .env manually (no extra deps) ──────────────────────────────────────
def load_env():
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

load_env()

GROK_API_KEY = os.environ.get("GROK_API_KEY", "")
GROK_URL     = "https://api.x.ai/v1/chat/completions"
GROK_MODEL   = "grok-3-mini"   # fast + cheap for tailoring tasks

BASE_DIR   = Path(__file__).parent
BASE_HTML  = BASE_DIR / "resume_base.html"
PDF_GEN    = BASE_DIR / "generate_pdf.js"
OUTPUT_DIR = BASE_DIR / "tailored"
OUTPUT_DIR.mkdir(exist_ok=True)


# ── Grok API call ────────────────────────────────────────────────────────────

def grok(system: str, user: str, max_tokens: int = 2000) -> str:
    if not GROK_API_KEY:
        raise RuntimeError("GROK_API_KEY not set in .env")
    payload = json.dumps({
        "model": GROK_MODEL,
        "messages": [
            {"role": "system",  "content": system},
            {"role": "user",    "content": user}
        ],
        "max_tokens": max_tokens,
        "temperature": 0.4
    }).encode()
    req = Request(
        GROK_URL,
        data    = payload,
        headers = {
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {GROK_API_KEY}"
        },
        method = "POST"
    )
    try:
        with urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
            return data["choices"][0]["message"]["content"].strip()
    except URLError as e:
        raise RuntimeError(f"Grok API error: {e}")


# ── helpers ──────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', text.lower()).strip('_')


def read_base_html() -> str:
    if not BASE_HTML.exists():
        raise FileNotFoundError(f"Base resume not found at {BASE_HTML}")
    return BASE_HTML.read_text(encoding="utf-8")


def write_tailored_html(company: str, role: str, html: str) -> Path:
    filename = f"resume_{slugify(company)}_{slugify(role)}.html"
    out_path  = OUTPUT_DIR / filename
    out_path.write_text(html, encoding="utf-8")
    print(f"[tailor] HTML written → {out_path}")
    return out_path


def generate_pdf(html_path: Path) -> Path:
    pdf_path = html_path.with_suffix(".pdf")
    node = "/opt/homebrew/bin/node"
    if not Path(node).exists():
        node = "node"
    result = subprocess.run(
        [node, str(PDF_GEN), str(html_path), str(pdf_path)],
        capture_output=True, text=True, cwd=str(BASE_DIR)
    )
    if result.returncode != 0:
        raise RuntimeError(f"PDF generation failed:\n{result.stderr}")
    print(f"[tailor] PDF written  → {pdf_path}")
    return pdf_path


# ── Step 1: Grok extracts keywords from JD ──────────────────────────────────

def extract_keywords_grok(jd: str) -> list[str]:
    print("[grok] Extracting keywords from JD...")
    response = grok(
        system = (
            "You are an ATS keyword extraction engine. "
            "Extract ALL important keywords and phrases from the job description. "
            "Focus on: technical skills, tools, frameworks, methodologies, domain terms. "
            "Return ONLY a JSON array of strings. No explanation. No markdown."
        ),
        user = f"Extract keywords from this JD:\n\n{jd[:4000]}"
    )
    # Parse JSON from response
    try:
        # Strip markdown code fences if present
        clean = re.sub(r'```(?:json)?|```', '', response).strip()
        keywords = json.loads(clean)
        if isinstance(keywords, list):
            return [str(k).strip() for k in keywords if k]
    except json.JSONDecodeError:
        pass
    # Fallback: extract quoted strings
    return re.findall(r'"([^"]+)"', response)


# ── Step 2: Grok researches company ─────────────────────────────────────────

def research_company_grok(company: str, role: str) -> str:
    print(f"[grok] Researching {company}...")
    return grok(
        system = (
            "You are a job application research assistant. "
            "Give a concise 3-5 sentence summary of the company's tech focus, culture, "
            "and what they value in engineers. Be factual and brief."
        ),
        user = f"Company: {company}\nRole: {role}\nWhat should I know to tailor my resume for this company?"
    )


# ── Step 3: Coverage scoring ─────────────────────────────────────────────────

def coverage_report(keywords: list[str], html: str) -> dict:
    covered, missing = [], []
    for kw in keywords:
        if re.search(re.escape(kw), html, re.IGNORECASE):
            covered.append(kw)
        else:
            missing.append(kw)
    total = len(keywords)
    pct   = (len(covered) / total * 100) if total else 100.0
    return {
        "covered":     covered,
        "missing":     missing,
        "pct_covered": round(pct, 1),
        "total":       total
    }


# ── Step 4: Grok tailors the resume HTML ─────────────────────────────────────

def tailor_html_grok(
    base_html: str,
    missing_keywords: list[str],
    company: str,
    role: str,
    company_research: str,
    jd: str
) -> str:
    if not missing_keywords:
        print("[grok] Coverage already ≥ 90% — no tailoring needed.")
        return base_html

    print(f"[grok] Tailoring resume — weaving in {len(missing_keywords)} missing keywords...")

    missing_str = ", ".join(missing_keywords[:40])  # cap to avoid token overflow

    instruction = f"""You are an expert resume writer tailoring an HTML resume for a job application.

Company: {company}
Role: {role}
Company context: {company_research}

Missing keywords to weave in: {missing_str}

Rules:
- Edit existing bullet points to naturally incorporate missing keywords where they fit
- If more than 10% of important keywords cannot fit in existing bullets, you may add 1-2 new bullets
- CRITICAL: The first page is strictly space-constrained. If you add text, you MUST condense other parts or delete a less important bullet so the overall length does NOT increase.
- NEVER fabricate experience or projects — only enhance what already exists
- Write in natural human English — no buzzword soup, no robotic lists
- Keep every sentence concise (max 1.5 lines per bullet ideally)
- Do NOT change the HTML structure, CSS, or any section headings
- Return the COMPLETE modified HTML — nothing else

The current HTML resume is below. Return the full modified HTML:

{base_html}"""

    tailored = grok(
        system = "You are a professional resume tailoring assistant. Return ONLY the complete HTML — no explanation, no markdown fences.",
        user   = instruction,
        max_tokens = 6000
    )

    # Clean up any accidental markdown fences
    tailored = re.sub(r'^```(?:html)?\s*', '', tailored.strip())
    tailored = re.sub(r'\s*```$', '', tailored.strip())

    return tailored


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 4:
        print("Usage: python3 tailor_resume.py <jd_text_or_file> <company> <role>")
        sys.exit(1)

    jd_input = sys.argv[1]
    company  = sys.argv[2]
    role     = sys.argv[3]

    jd = Path(jd_input).read_text(encoding="utf-8") if os.path.isfile(jd_input) else jd_input

    # ── 1. Read base resume
    base_html = read_base_html()

    # ── 2. Extract keywords via Grok
    keywords = extract_keywords_grok(jd)
    print(f"[grok] Extracted {len(keywords)} keywords")

    # ── 3. Initial coverage check
    report = coverage_report(keywords, base_html)

    # ── 4. Research company via Grok
    company_research = research_company_grok(company, role)

    # ── 5. Tailor HTML if needed
    if report["pct_covered"] < 90 and report["missing"]:
        tailored_html = tailor_html_grok(
            base_html, report["missing"], company, role,
            company_research, jd
        )
        # Re-score after tailoring
        report_after = coverage_report(keywords, tailored_html)
    else:
        tailored_html  = base_html
        report_after   = report

    # ── 6. Print report
    print("\n" + "="*60)
    print(f"  KEYWORD COVERAGE REPORT")
    print(f"  Company  : {company}")
    print(f"  Role     : {role}")
    print(f"  Before   : {report['pct_covered']}% ({len(report['covered'])}/{report['total']})")
    print(f"  After    : {report_after['pct_covered']}% ({len(report_after['covered'])}/{report_after['total']})")
    print("="*60)
    if report_after["missing"]:
        print(f"\n  Still missing ({len(report_after['missing'])}):")
        for kw in report_after["missing"][:20]:
            print(f"    • {kw}")
    else:
        print("\n  ✅ 100% keyword coverage!")
    print("="*60 + "\n")

    # ── 7. Save report JSON
    report_path = OUTPUT_DIR / f"report_{slugify(company)}_{slugify(role)}.json"
    report_path.write_text(json.dumps({
        "company": company, "role": role,
        "company_research": company_research,
        "keywords": keywords,
        "before": report, "after": report_after
    }, indent=2), encoding="utf-8")
    print(f"[tailor] Report saved → {report_path}")

    # ── 8. Write HTML + PDF
    out_html = write_tailored_html(company, role, tailored_html)
    generate_pdf(out_html)

    slug    = f"{slugify(company)}_{slugify(role)}"
    preview = f"http://localhost:3000/preview/tailored/resume_{slug}"
    print(f"\n✅ Done!")
    print(f"   Preview : {preview}")
    print(f"   Coverage: {report_after['pct_covered']}%\n")


if __name__ == "__main__":
    main()
