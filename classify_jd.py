#!/usr/bin/env python3
"""
JD Classifier — classify a job description as ai_engineer, data_analyst, or hybrid.

Usage:
  python3 classify_jd.py "<job description text>"
  python3 classify_jd.py  # reads stdin

Output (JSON):
  {
    "classification": "ai_engineer",
    "confidence": 0.92,
    "keywords_found": ["LangChain", "RAG", "LLMs"],
    "reasoning": "Strong LLM/RAG keywords → AI Engineer"
  }
"""

import sys, os, re, json
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError
import ssl


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
GROK_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROK_MODEL   = "llama-3.1-8b-instant"   # fast enough for classification


AI_ENGINEER_KEYWORDS = [
    "llm", "large language model", "rag", "retrieval augmented", "langchain",
    "langGraph", "openai", "groq", "gemini", "claude", "anthropic", "bedrock",
    "vector embed", "semantic search", "prompt engineer", "fine-tun",
    "agent", "agentic", "tool calling", "function calling", "ai pipeline",
    "generative ai", "genai", "llmops", "mlops", "inference", "transformer",
    "hugging face", "diffusion model", "multimodal", "embedding",
]

DATA_ANALYST_KEYWORDS = [
    "sql", "tableau", "power bi", "looker", "data studio", "excel",
    "pandas", "numpy", "matplotlib", "seaborn", "plotly",
    "data pipeline", "etl", "data warehouse", "data lake", "dbt",
    "analytics", "business intelligence", "bi report", "dashboard",
    "statistics", "statistical analysis", "a/b test", "hypothesis",
    "data model", "schema design", "query optimiz", "indexing",
    "spark", "hadoop", "hive", "airflow", "data engineer",
    "scikit-learn", "machine learning", "regression", "classification",
]


def quick_classify(jd: str) -> dict:
    """Keyword-based pre-filter — fast, no API call needed for clear-cut cases."""
    jd_lower = jd.lower()
    ai_hits   = [k for k in AI_ENGINEER_KEYWORDS   if k in jd_lower]
    data_hits = [k for k in DATA_ANALYST_KEYWORDS  if k in jd_lower]

    ai_score   = len(ai_hits)
    data_score = len(data_hits)
    total      = ai_score + data_score or 1

    if ai_score / total >= 0.75 and ai_score >= 4:
        return {"classification": "ai_engineer",  "confidence": round(ai_score / total, 2),
                "keywords_found": ai_hits[:8], "reasoning": f"{ai_score} AI/LLM keywords vs {data_score} data keywords"}
    if data_score / total >= 0.75 and data_score >= 4:
        return {"classification": "data_analyst", "confidence": round(data_score / total, 2),
                "keywords_found": data_hits[:8], "reasoning": f"{data_score} data/analytics keywords vs {ai_score} AI keywords"}
    return None   # ambiguous — call LLM


def llm_classify(jd: str) -> dict:
    """Use Groq LLM for nuanced classification when keyword heuristics are ambiguous."""
    if not GROK_API_KEY:
        # Fallback: simple keyword majority
        jd_lower = jd.lower()
        ai_hits   = sum(1 for k in AI_ENGINEER_KEYWORDS   if k in jd_lower)
        data_hits = sum(1 for k in DATA_ANALYST_KEYWORDS  if k in jd_lower)
        if ai_hits > data_hits:
            return {"classification": "ai_engineer",  "confidence": 0.6, "keywords_found": [], "reasoning": "Keyword majority (no API key)"}
        if data_hits > ai_hits:
            return {"classification": "data_analyst", "confidence": 0.6, "keywords_found": [], "reasoning": "Keyword majority (no API key)"}
        return {"classification": "hybrid",       "confidence": 0.5, "keywords_found": [], "reasoning": "Even split (no API key)"}

    system = """You are a job description classifier. Classify the JD into exactly one of:
- "ai_engineer"  → primary focus on LLMs, RAG, LangChain, agents, GenAI, inference, prompt engineering
- "data_analyst" → primary focus on SQL, Tableau, analytics, dashboards, BI, ETL, statistics, Python data science
- "hybrid"       → requires both AI engineering AND strong data/analytics skills equally

Return ONLY valid JSON (no markdown):
{"classification": "...", "confidence": 0.0-1.0, "keywords_found": [...], "reasoning": "..."}"""

    payload = json.dumps({
        "model": GROK_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": jd[:3000]}
        ],
        "max_tokens": 300,
        "temperature": 0.1
    }).encode()

    req = Request(
        GROK_URL,
        data=payload,
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {GROK_API_KEY}",
        },
        method="POST"
    )

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    try:
        with urlopen(req, timeout=30, context=ctx) as r:
            data = json.loads(r.read())
        text = data["choices"][0]["message"]["content"].strip()
        text = re.sub(r'^```(?:json)?|```$', '', text, flags=re.MULTILINE).strip()
        result = json.loads(text)
        if result.get("classification") not in ("ai_engineer", "data_analyst", "hybrid"):
            raise ValueError("invalid classification")
        return result
    except Exception as e:
        # Final fallback
        return {"classification": "hybrid", "confidence": 0.5, "keywords_found": [], "reasoning": f"LLM error: {e}"}


def classify_jd(jd: str) -> dict:
    """Main entry point. Returns classification dict."""
    result = quick_classify(jd)
    if result:
        return result
    return llm_classify(jd)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        jd_text = " ".join(sys.argv[1:])
    else:
        jd_text = sys.stdin.read()

    if not jd_text.strip():
        print("Usage: python3 classify_jd.py '<job description>'", file=sys.stderr)
        sys.exit(1)

    result = classify_jd(jd_text)
    print(json.dumps(result, indent=2))
