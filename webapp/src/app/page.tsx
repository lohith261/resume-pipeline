'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Link, FileText, ChevronRight, Download, Loader2, CheckCircle, AlertCircle, Paperclip, Undo2 } from 'lucide-react';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface Step { id: string; message: string; done: boolean; }

interface CoverageResult {
  pct: number; total: number;
  missing: string[]; covered: string[];
}

interface BulletChange {
  type: 'modified' | 'added';
  before?: string;
  after: string;
}

type ResumeType = 'ai_engineer' | 'data_analyst' | 'data_engineer' | 'hybrid';
interface Classification { type: ResumeType; confidence: number; reasoning: string; country?: string | null; }
const BASE_LABELS: Record<ResumeType, string> = { ai_engineer: 'AI Engineer', data_analyst: 'Data Analyst', data_engineer: 'Data Engineer', hybrid: 'Hybrid' };
const BASE_COLORS: Record<ResumeType, string> = { ai_engineer: '#6366f1', data_analyst: '#0ea5e9', data_engineer: '#10b981', hybrid: '#f59e0b' };

interface TailorResult {
  company: string; role: string;
  html: string; htmlUrl: string; texUrl?: string;
  before: CoverageResult; after: CoverageResult;
  keywords: string[]; slug: string;
  research?: string;
  changes?: BulletChange[];
  classification?: Classification;
}

interface InterviewQuestion {
  question: string;
  star: { situation: string; task: string; action: string; result: string };
}

interface OutreachResult {
  email: { subject: string; body: string };
  linkedin: { connectNote: string; dm: string };
}

type Message =
  | { type: 'user';         text: string }
  | { type: 'thinking';     steps: Step[] }
  | { type: 'result';       result: TailorResult }
  | { type: 'answer';       text: string }
  | { type: 'edited';       summary: string }
  | { type: 'pending-edit'; pendingHtml: string; changes: BulletChange[] }
  | { type: 'cover-letter'; company: string; role: string }
  | { type: 'error';        text: string };

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());
const isEditIntent = (s: string) => /^(add|remove|delete|change|update|edit|replace|rewrite|shorten|expand|modify|fix|move|insert|take out|get rid|put |make |can you (add|remove|change|fix|update|rewrite)|please (add|remove|change|fix)|include|exclude)/i.test(s.trim());
const isCoverLetterRequest = (s: string) => /cover.?letter|covering letter|write.*letter.*for|generate.*cover/i.test(s);

function CoverageBadge({ pct }: { pct: number }) {
  const color = pct >= 90 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444';
  return <span style={{ color, fontWeight: 700, fontSize: 15 }}>{pct}%</span>;
}

function ScoreBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
      <span style={{ color: '#666', width: 100, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, background: '#1a1a1a', borderRadius: 3, height: 5, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ color, fontWeight: 600, width: 32, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function StepsList({ steps }: { steps: Step[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: s.done ? '#666' : '#e8e8e8' }}>
          {s.done
            ? <CheckCircle size={13} color="#22c55e" />
            : <Loader2 size={13} color="#6366f1" className="animate-spin" />}
          <span>{s.message}</span>
        </div>
      ))}
    </div>
  );
}

function ResultCard({ result, onView, onRetailor }: { result: TailorResult; onView: (r: TailorResult) => void; onRetailor?: (kws: string[]) => void }) {
  const [kwExpanded, setKwExpanded]       = useState(false);
  const [changesExpanded, setChangesExpanded] = useState(false);
  const [editingKw, setEditingKw]         = useState(false);
  const [editedKws, setEditedKws]         = useState<string[]>([]);
  const [newKwInput, setNewKwInput]       = useState('');
  const PREVIEW = 5;
  const covered = result.after.covered;
  const missing = result.after.missing;
  const shownCovered = kwExpanded ? covered : covered.slice(0, PREVIEW);
  const shownMissing = kwExpanded ? missing : missing.slice(0, PREVIEW);
  const hiddenCount = (covered.length - shownCovered.length) + (missing.length - shownMissing.length);
  const changes = result.changes ?? [];
  const modified = changes.filter(c => c.type === 'modified');
  const added    = changes.filter(c => c.type === 'added');

  return (
    <div style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 12, padding: 16, maxWidth: 380 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{result.company}</div>
          <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{result.role}</div>
          {result.classification && (
            <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ background: BASE_COLORS[result.classification.type], color: '#fff', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20 }}>
                {BASE_LABELS[result.classification.type]} base
              </span>
              <span style={{ color: '#555', fontSize: 10 }}>{Math.round(result.classification.confidence * 100)}% confidence</span>
              {result.classification?.country && (() => {
                const countryLabel: Record<string, string> = { de: '🇩🇪 Germany', nl: '🇳🇱 Netherlands', sg: '🇸🇬 Singapore', ae: '🇦🇪 UAE', jp: '🇯🇵 Japan', lu: '🇱🇺 Luxembourg', ie: '🇮🇪 Ireland' };
                const countryColor: Record<string, string> = { de: '#2563eb', nl: '#f97316', sg: '#dc2626', ae: '#059669', jp: '#dc2626', lu: '#2563eb', ie: '#16a34a' };
                const c = result.classification.country as string;
                return (
                  <span style={{ background: countryColor[c] + '22', color: countryColor[c], border: `1px solid ${countryColor[c]}44`, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20 }}>
                    {countryLabel[c]}
                  </span>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Fit Score breakdown */}
      {(() => {
        const kwPct   = result.after.pct;
        const rolePct = Math.round((result.classification?.confidence ?? 0.7) * 100);
        const overall = Math.round(kwPct * 0.6 + rolePct * 0.4);
        const barColor = (p: number) => p >= 75 ? '#22c55e' : p >= 55 ? '#f59e0b' : '#ef4444';
        return (
          <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ fontSize: 10, color: '#555', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fit Score</div>
            <ScoreBar label="Keyword Match"   pct={kwPct}   color={barColor(kwPct)} />
            <ScoreBar label="Role Alignment"  pct={rolePct} color={barColor(rolePct)} />
            <ScoreBar label="Overall Fit"     pct={overall} color={barColor(overall)} />
          </div>
        );
      })()}

      {/* Keywords */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ fontSize: 11, color: '#4ade80' }}>✓ {covered.length} present</span>
            <span style={{ fontSize: 11, color: '#f87171' }}>✗ {missing.length} missing</span>
          </div>
          {onRetailor && !editingKw && (
            <button
              onClick={() => { setEditedKws(result.keywords); setEditingKw(true); }}
              style={{ background: 'transparent', border: '1px solid #2a3a5a', color: '#60a5fa', borderRadius: 4, padding: '1px 8px', fontSize: 10, cursor: 'pointer' }}
            >
              ✏️ Edit keywords
            </button>
          )}
        </div>

        {editingKw ? (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {editedKws.map((kw, i) => (
                <span key={i} style={{ background: '#1a2040', color: '#a0b4ff', border: '1px solid #2a3a6a', borderRadius: 4, padding: '1px 4px 1px 7px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {kw}
                  <button onClick={() => setEditedKws(p => p.filter((_, j) => j !== i))} style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: '0 2px', lineHeight: 1, fontSize: 13 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              <input
                value={newKwInput}
                onChange={e => setNewKwInput(e.target.value)}
                onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',') && newKwInput.trim()) { e.preventDefault(); setEditedKws(p => [...p, newKwInput.trim()]); setNewKwInput(''); } }}
                placeholder="Add keyword, press Enter"
                style={{ flex: 1, background: '#111', border: '1px solid #2a2a2a', color: '#e8e8e8', borderRadius: 4, padding: '3px 8px', fontSize: 11 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => { onRetailor!(editedKws); setEditingKw(false); }}
                style={{ flex: 1, background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                ↺ Re-tailor with these keywords
              </button>
              <button
                onClick={() => setEditingKw(false)}
                style={{ background: '#1a1a1a', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {shownCovered.map((kw, i) => (
              <span key={`c${i}`} style={{ background: '#0a1f12', color: '#4ade80', border: '1px solid #1a4a2a', borderRadius: 4, padding: '1px 7px', fontSize: 11 }}>{kw}</span>
            ))}
            {shownMissing.map((kw, i) => (
              <span key={`m${i}`} style={{ background: '#2a1212', color: '#f87171', border: '1px solid #3d1515', borderRadius: 4, padding: '1px 7px', fontSize: 11 }}>{kw}</span>
            ))}
            {!kwExpanded && hiddenCount > 0 && (
              <button onClick={() => setKwExpanded(true)} style={{ background: 'transparent', border: '1px solid #2a2a2a', color: '#555', borderRadius: 4, padding: '1px 7px', fontSize: 11, cursor: 'pointer' }}>
                +{hiddenCount} more
              </button>
            )}
            {kwExpanded && (
              <button onClick={() => setKwExpanded(false)} style={{ background: 'transparent', border: '1px solid #2a2a2a', color: '#555', borderRadius: 4, padding: '1px 7px', fontSize: 11, cursor: 'pointer' }}>
                show less
              </button>
            )}
          </div>
        )}
      </div>

      {/* Changes diff */}
      {changes.length > 0 && (
        <div style={{ marginBottom: 12, borderTop: '1px solid #222', paddingTop: 10 }}>
          <button
            onClick={() => setChangesExpanded(p => !p)}
            style={{ background: 'transparent', border: 'none', color: '#a0a0ff', fontSize: 12, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 5, marginBottom: changesExpanded ? 8 : 0 }}
          >
            <ChevronRight size={11} style={{ transform: changesExpanded ? 'rotate(90deg)' : 'none', transition: '0.15s' }} />
            ✏️ {modified.length} bullet{modified.length !== 1 ? 's' : ''} modified
            {added.length > 0 && ` · ➕ ${added.length} added`}
          </button>

          {changesExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {modified.map((c, i) => (
                <div key={`m${i}`} style={{ background: '#111', borderRadius: 6, padding: '8px 10px', fontSize: 11, lineHeight: 1.5 }}>
                  <div style={{ color: '#666', textDecoration: 'line-through', marginBottom: 4 }}>
                    {c.before}
                  </div>
                  <div style={{ color: '#4ade80' }}>↳ {c.after}</div>
                </div>
              ))}
              {added.map((c, i) => (
                <div key={`a${i}`} style={{ background: '#0a1020', border: '1px solid #1a2a4a', borderRadius: 6, padding: '8px 10px', fontSize: 11, lineHeight: 1.5 }}>
                  <span style={{ color: '#6366f1', marginRight: 5 }}>+</span>
                  <span style={{ color: '#a0b4ff' }}>{c.after}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => onView(result)}
        style={{ width: '100%', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        <FileText size={13} /> View Resume
      </button>
    </div>
  );
}

function PreviewPanel({ result, coverLetterHtml, initialTab = 'resume', onClose, onUndo, canUndo }: {
  result: TailorResult;
  coverLetterHtml: string | null;
  initialTab?: 'resume' | 'cover' | 'interview';
  onClose: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
}) {
  const [tab, setTab]                       = useState<'resume' | 'cover' | 'interview' | 'outreach'>(initialTab);
  const [interviewQs, setInterviewQs]       = useState<InterviewQuestion[] | null>(null);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [expandedQ, setExpandedQ]           = useState<number | null>(null);
  const [outreachContact, setOutreachContact] = useState({ name: '', title: '' });
  const [outreachResult, setOutreachResult]   = useState<OutreachResult | null>(null);
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachError, setOutreachError]     = useState<string | null>(null);
  const [interestAnswer, setInterestAnswer]   = useState<string | null>(null);
  const [interestLoading, setInterestLoading] = useState(false);
  const [copiedField, setCopiedField]         = useState<string | null>(null);
  const activeHtml = tab === 'cover' && coverLetterHtml ? coverLetterHtml : result.html;

  // Sync to cover tab when a new cover letter arrives
  useEffect(() => { if (initialTab === 'cover') setTab('cover'); }, [initialTab]);

  // Reset outreach + interest drafts when a new resume is tailored
  useEffect(() => {
    setOutreachResult(null);
    setOutreachError(null);
    setOutreachContact({ name: '', title: '' });
    setInterestAnswer(null);
  }, [result.slug]);

  // Fetch interview questions on first visit to that tab
  useEffect(() => {
    if (tab !== 'interview' || interviewQs || interviewLoading) return;
    setInterviewLoading(true);
    fetch('/api/interview-prep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeHtml: result.html,
        company: result.company,
        role: result.role,
        keywords: result.keywords,
        research: result.research ?? '',
      }),
    })
      .then(r => r.json())
      .then(d => { if (d.questions) setInterviewQs(d.questions); })
      .catch(() => {})
      .finally(() => setInterviewLoading(false));
  }, [tab, interviewQs, interviewLoading, result]);

  function getSlug() {
    const base = tab === 'cover'
      ? `Cover_Letter_${result.company}_${result.role}`
      : `Resume_${result.company}_${result.role}`;
    return base.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function copyText(field: string, text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }

  async function handleGenerateOutreach() {
    if (!outreachContact.name.trim() || outreachLoading) return;
    setOutreachLoading(true);
    setOutreachError(null);
    setOutreachResult(null);
    try {
      const r = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: result.company,
          role: result.role,
          research: result.research ?? '',
          resumeHtml: result.html,
          contactName: outreachContact.name.trim(),
          contactTitle: outreachContact.title.trim(),
        }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setOutreachResult(d as OutreachResult);
    } catch (e) {
      setOutreachError(String(e));
    }
    setOutreachLoading(false);
  }

  async function handleGenerateInterest() {
    if (interestLoading) return;
    setInterestLoading(true);
    try {
      const res = await fetch('/api/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: result.company,
          role: result.role,
          research: result.research ?? '',
          resumeHtml: result.html,
        }),
      });
      const data = await res.json();
      if (data.answer) setInterestAnswer(data.answer);
    } catch {
      // fail silently — button reappears
    } finally {
      setInterestLoading(false);
    }
  }

  function handleDownload() {
    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to download PDF'); return; }

    // Human-readable title → Chrome uses this as the suggested PDF filename
    // and embeds it as the PDF document title metadata
    const pdfTitle = tab === 'cover'
      ? `Lohith – Cover Letter – ${result.company}`
      : `Lohith – ${result.role} – ${result.company}`;

    const printHtml = activeHtml
      // Set readable title (becomes PDF filename suggestion + PDF title metadata)
      .replace(/<title>[^<]*<\/title>/i, `<title>${pdfTitle}</title>`)
      // Ensure author meta is present (some PDF tools / downstream processors read it)
      .replace(/<meta name="author"[^>]*>/i, '')
      .replace('</head>', '<meta name="author" content="Bandreddy Sri Sai Lohith" />\n</head>');

    win.document.open();
    win.document.write(printHtml);
    win.document.close();
    win.addEventListener('load', () => { win.focus(); win.print(); }, { once: true });
  }

  async function handleDownloadDocx() {
    try {
      const res = await fetch('/api/docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: activeHtml }),
      });
      if (!res.ok) throw new Error('DOCX generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${getSlug()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('DOCX download failed — try PDF instead');
    }
  }

  async function handleDownloadLatex() {
    // Prod: use the pre-generated .tex stored in Vercel Blob (instant, no re-conversion)
    if (result.texUrl && !result.texUrl.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = result.texUrl;
      a.download = `${getSlug()}.tex`;
      a.click();
      return;
    }
    // Dev or fallback: POST /api/latex to generate on the fly
    try {
      const res = await fetch('/api/latex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: activeHtml }),
      });
      if (!res.ok) throw new Error('LaTeX generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${getSlug()}.tex`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('LaTeX export failed');
    }
  }

  /** Open the tailored resume directly in Overleaf.
   *  - Public blob URL  → snip_uri  (Overleaf fetches the file)
   *  - data: URL        → form POST with snip field (no blob needed)
   */
  async function openInOverleaf() {
    if (!result.texUrl) return;

    if (!result.texUrl.startsWith('data:')) {
      // Blob URL available — use snip_uri (instant)
      window.open(
        `https://www.overleaf.com/docs?snip_uri=${encodeURIComponent(result.texUrl)}`,
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }

    // data: URL — decode the base64 LaTeX and POST it directly to Overleaf
    let latex: string;
    try {
      const b64 = result.texUrl.replace(/^data:text\/plain;base64,/, '');
      latex = atob(b64);
    } catch {
      // Fallback: re-generate via /api/latex
      try {
        const res = await fetch('/api/latex', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: activeHtml }),
        });
        latex = await res.text();
      } catch {
        alert('Could not prepare LaTeX for Overleaf — try the LaTeX download button instead.');
        return;
      }
    }

    // Form-POST approach: Overleaf accepts a `snip` field with raw LaTeX
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://www.overleaf.com/docs';
    form.target = '_blank';
    form.rel    = 'noopener noreferrer';

    const snipInput = document.createElement('input');
    snipInput.type  = 'hidden';
    snipInput.name  = 'snip';
    snipInput.value = latex;
    form.appendChild(snipInput);

    const typeInput = document.createElement('input');
    typeInput.type  = 'hidden';
    typeInput.name  = 'snip_type';
    typeInput.value = 'main.tex';
    form.appendChild(typeInput);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  function handleDownloadTxt() {
    const slug = getSlug();

    // Parse HTML into a structured DOM — never use innerText on the raw tree
    // because HTML attributes (id, data-*, class values) bleed into innerText
    // on some browsers and produce garbage like UUIDs in address fields.
    const root = document.createElement('div');
    root.innerHTML = activeHtml;

    const t = (el: Element | null | undefined) => el?.textContent?.trim() ?? '';

    const lines: string[] = [];

    // ── NAME ──────────────────────────────────────────────────────────────
    const name = t(root.querySelector('.header h1, h1'));
    if (name) { lines.push(name); lines.push(''); }

    // ── CONTACT ───────────────────────────────────────────────────────────
    const contactParts: string[] = [];
    root.querySelectorAll('.contact span, .contact a').forEach(el => {
      const v = t(el);
      if (v) contactParts.push(v);
    });
    if (contactParts.length) { lines.push(contactParts.join(' | ')); lines.push(''); }

    // ── Helper: find a section by title keyword ────────────────────────
    const findSection = (keyword: string) =>
      [...root.querySelectorAll('.section')].find(s =>
        s.querySelector('.section-title')?.textContent?.toLowerCase().includes(keyword)
      );

    // ── SUMMARY ───────────────────────────────────────────────────────────
    const summarySection = findSection('summary') ?? findSection('profile');
    if (summarySection) {
      const para = t(summarySection.querySelector('p'));
      if (para) { lines.push(para); lines.push(''); }
    }

    // ── SKILLS ────────────────────────────────────────────────────────────
    const skillsSection = findSection('skill');
    if (skillsSection) {
      lines.push('SKILLS');
      skillsSection.querySelectorAll('.skill-row').forEach(row => {
        const cat = t(row.querySelector('.skill-cat'));
        const val = t(row.querySelector('.skill-val'));
        if (cat && val) lines.push(`${cat}: ${val}`);
      });
      lines.push('');
    }

    // ── EXPERIENCE ────────────────────────────────────────────────────────
    // Each job entry must have Title / Company / Date on separate lines so
    // Workday's parser can map them to the correct form fields.
    const expSection = findSection('experience');
    if (expSection) {
      lines.push('EXPERIENCE');
      expSection.querySelectorAll('.job').forEach(job => {
        const title   = t(job.querySelector('.job-title'));
        const company = t(job.querySelector('.job-company'));
        const date    = t(job.querySelector('.job-date'));
        if (title)   lines.push(title);
        if (company) lines.push(company);
        if (date)    lines.push(date);
        job.querySelectorAll('li').forEach(li => lines.push('• ' + t(li)));
        lines.push('');
      });
    }

    // ── PROJECTS ──────────────────────────────────────────────────────────
    const projSection = findSection('project');
    if (projSection) {
      lines.push('PROJECTS');
      projSection.querySelectorAll('.project-block').forEach(proj => {
        const projName = t(proj.querySelector('.project-name'));
        const urls = [...proj.querySelectorAll('.project-links a')]
          .map(a => (a as HTMLAnchorElement).href || t(a))
          .filter(Boolean)
          .join(' | ');
        lines.push(projName + (urls ? ' — ' + urls : ''));
        proj.querySelectorAll('li').forEach(li => lines.push('• ' + t(li)));
        lines.push('');
      });
    }

    // ── EDUCATION ─────────────────────────────────────────────────────────
    const eduSection = findSection('education');
    if (eduSection) {
      lines.push('EDUCATION');
      const degree = t(eduSection.querySelector('.edu-degree'));
      const school = t(eduSection.querySelector('.edu-school'));
      const year   = t(eduSection.querySelector('.edu-year'));
      if (degree) lines.push(degree);
      if (school) lines.push(school);
      if (year)   lines.push(year);
      eduSection.querySelectorAll('li').forEach(li => lines.push('• ' + t(li)));
      lines.push('');
    }

    // ── AWARDS / CERTIFICATIONS ───────────────────────────────────────────
    ['award', 'certification', 'honour', 'honor'].forEach(kw => {
      const sec = findSection(kw);
      if (!sec) return;
      lines.push(t(sec.querySelector('.section-title')).toUpperCase());
      sec.querySelectorAll('li').forEach(li => lines.push('• ' + t(li)));
      lines.push('');
    });

    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isResume = tab === 'resume';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #222', background: '#161616', flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{result.company} — {result.role}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
            {tab === 'resume'
              ? <>Coverage: <CoverageBadge pct={result.after.pct} /> &nbsp;·&nbsp; {result.after.covered.length}/{result.after.total} keywords</>
              : tab === 'cover'
              ? <span style={{ color: '#a0b4ff' }}>Cover Letter</span>
              : tab === 'outreach'
              ? <span style={{ color: '#0ea5e9' }}>Warm Outreach · email + LinkedIn drafts</span>
              : <span style={{ color: '#f59e0b' }}>Interview Prep · 5 questions tailored to this JD</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, background: '#1a1a1a', borderRadius: 7, padding: 3 }}>
            <button onClick={() => setTab('resume')} style={{ background: tab === 'resume' ? '#6366f1' : 'transparent', color: tab === 'resume' ? '#fff' : '#666', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>📄 Resume</button>
            {coverLetterHtml && <button onClick={() => setTab('cover')} style={{ background: tab === 'cover' ? '#6366f1' : 'transparent', color: tab === 'cover' ? '#fff' : '#666', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>✉️ Cover</button>}
            <button onClick={() => setTab('interview')} style={{ background: tab === 'interview' ? '#f59e0b' : 'transparent', color: tab === 'interview' ? '#000' : '#666', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>🎯 Interview</button>
            <button onClick={() => setTab('outreach')} style={{ background: tab === 'outreach' ? '#0ea5e9' : 'transparent', color: tab === 'outreach' ? '#fff' : '#666', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>📬 Outreach</button>
          </div>
          {canUndo && tab !== 'interview' && tab !== 'outreach' && (
            <button onClick={onUndo} title="Undo last edit" style={{ background: '#1a1a1a', color: '#f59e0b', border: '1px solid #3a2a00', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Undo2 size={13} /> Undo
            </button>
          )}
          {tab !== 'interview' && tab !== 'outreach' && <>
            <button onClick={handleDownload} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Download size={13} /> PDF
            </button>
            <button onClick={handleDownloadDocx} title="Word document — highest ATS compatibility" style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed8', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Download size={13} /> DOCX
            </button>
            <button onClick={handleDownloadLatex} title="LaTeX source — upload to Overleaf for premium PDF" style={{ background: '#1a2e1a', color: '#86efac', border: '1px solid #166534', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Download size={13} /> LaTeX
            </button>
            {result.texUrl && (
              <button
                onClick={openInOverleaf}
                title="Open this resume in Overleaf — compile to get a premium PDF"
                style={{ background: '#1a3a1a', color: '#4ade80', border: '1px solid #166534', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                ↗ Overleaf
              </button>
            )}
            <button onClick={handleDownloadTxt} title="Plain text — best for Workday / ATS form parsing" style={{ background: '#1e293b', color: '#64748b', border: '1px solid #334155', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Download size={13} /> TXT
            </button>
          </>}
          <button onClick={onClose} style={{ background: '#222', color: '#888', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer' }}>✕</button>
        </div>
      </div>

      {/* Content */}
      {tab === 'outreach' ? (
        <div style={{ flex: 1, overflowY: 'auto', background: '#111', padding: '24px 32px 48px' }}>
          <div style={{ maxWidth: 680, margin: '0 auto' }}>

            {/* Step 1 — LinkedIn search */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e8e8', marginBottom: 8 }}>Step 1 — Find your contact on LinkedIn</div>
              <p style={{ fontSize: 12, color: '#888', marginBottom: 12, lineHeight: 1.6 }}>
                Look for a hiring manager, engineering lead, or recruiter at <strong style={{ color: '#ccc' }}>{result.company}</strong>.
                Titles like &quot;Engineering Manager&quot;, &quot;Head of Data&quot;, &quot;Tech Lead&quot;, or &quot;Technical Recruiter&quot; work well.
              </p>
              <a
                href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`hiring manager ${result.role} ${result.company}`)}&origin=GLOBAL_SEARCH_HEADER`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#0a66c2', color: '#fff', borderRadius: 8, padding: '9px 16px', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
              >
                🔍 Search LinkedIn for {result.company} contacts ↗
              </a>
            </div>

            {/* Step 2 — Enter contact details */}
            <div style={{ marginBottom: 24, background: '#1a1a1a', borderRadius: 10, padding: 18, border: '1px solid #252525' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e8e8', marginBottom: 14 }}>Step 2 — Enter their details</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 5 }}>Full Name *</label>
                  <input
                    value={outreachContact.name}
                    onChange={e => setOutreachContact(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Sarah Chen"
                    style={{ width: '100%', background: '#111', border: '1px solid #2a2a2a', color: '#e8e8e8', borderRadius: 6, padding: '8px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 5 }}>Job Title <span style={{ color: '#555' }}>(optional)</span></label>
                  <input
                    value={outreachContact.title}
                    onChange={e => setOutreachContact(p => ({ ...p, title: e.target.value }))}
                    placeholder="e.g. Engineering Manager, Data Platform"
                    style={{ width: '100%', background: '#111', border: '1px solid #2a2a2a', color: '#e8e8e8', borderRadius: 6, padding: '8px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
              <button
                onClick={handleGenerateOutreach}
                disabled={!outreachContact.name.trim() || outreachLoading}
                style={{ background: outreachContact.name.trim() && !outreachLoading ? '#0ea5e9' : '#1a2a2a', color: outreachContact.name.trim() && !outreachLoading ? '#fff' : '#444', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: outreachContact.name.trim() && !outreachLoading ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 7, transition: 'background 0.2s' }}
              >
                {outreachLoading
                  ? <><Loader2 size={13} className="animate-spin" /> Generating messages...</>
                  : '✉ Generate Messages'}
              </button>
              {outreachError && <div style={{ fontSize: 12, color: '#f87171', marginTop: 10 }}>{outreachError}</div>}
            </div>

            {/* Generated message cards */}
            {outreachResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Warm Email */}
                <div style={{ background: '#1a1a1a', border: '1px solid #252525', borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#e8e8e8' }}>✉ Warm Email</div>
                    <button
                      onClick={() => copyText('email', `Subject: ${outreachResult.email.subject}\n\n${outreachResult.email.body}`)}
                      style={{ background: copiedField === 'email' ? '#052e16' : '#111', color: copiedField === 'email' ? '#4ade80' : '#888', border: `1px solid ${copiedField === 'email' ? '#166534' : '#2a2a2a'}`, borderRadius: 6, padding: '4px 11px', fontSize: 11, cursor: 'pointer', transition: 'all 0.15s' }}
                    >
                      {copiedField === 'email' ? '✓ Copied!' : '📋 Copy'}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Subject</div>
                  <div style={{ fontSize: 12, color: '#a0b4ff', fontWeight: 500, marginBottom: 14, padding: '7px 10px', background: '#111', borderRadius: 6 }}>
                    {outreachResult.email.subject}
                  </div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 5 }}>Body</div>
                  <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.7, whiteSpace: 'pre-wrap', padding: '9px 10px', background: '#111', borderRadius: 6 }}>
                    {outreachResult.email.body}
                  </div>
                </div>

                {/* LinkedIn Connection Note */}
                <div style={{ background: '#1a1a1a', border: '1px solid #252525', borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#e8e8e8' }}>💼 LinkedIn Connection Note</div>
                      <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>Paste when sending a connection request (300 char limit)</div>
                    </div>
                    <button
                      onClick={() => copyText('connect', outreachResult.linkedin.connectNote)}
                      style={{ background: copiedField === 'connect' ? '#052e16' : '#111', color: copiedField === 'connect' ? '#4ade80' : '#888', border: `1px solid ${copiedField === 'connect' ? '#166534' : '#2a2a2a'}`, borderRadius: 6, padding: '4px 11px', fontSize: 11, cursor: 'pointer', transition: 'all 0.15s' }}
                    >
                      {copiedField === 'connect' ? '✓ Copied!' : '📋 Copy'}
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.65, whiteSpace: 'pre-wrap', padding: '9px 10px', background: '#111', borderRadius: 6, marginBottom: 6 }}>
                    {outreachResult.linkedin.connectNote}
                  </div>
                  <div style={{ fontSize: 10, color: outreachResult.linkedin.connectNote.length > 280 ? '#f87171' : '#555', textAlign: 'right' }}>
                    {outreachResult.linkedin.connectNote.length} / 300 chars
                  </div>
                </div>

                {/* LinkedIn DM */}
                <div style={{ background: '#1a1a1a', border: '1px solid #252525', borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#e8e8e8' }}>💬 LinkedIn DM</div>
                      <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>Send this after they accept your connection request</div>
                    </div>
                    <button
                      onClick={() => copyText('dm', outreachResult.linkedin.dm)}
                      style={{ background: copiedField === 'dm' ? '#052e16' : '#111', color: copiedField === 'dm' ? '#4ade80' : '#888', border: `1px solid ${copiedField === 'dm' ? '#166534' : '#2a2a2a'}`, borderRadius: 6, padding: '4px 11px', fontSize: 11, cursor: 'pointer', transition: 'all 0.15s' }}
                    >
                      {copiedField === 'dm' ? '✓ Copied!' : '📋 Copy'}
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.65, whiteSpace: 'pre-wrap', padding: '9px 10px', background: '#111', borderRadius: 6 }}>
                    {outreachResult.linkedin.dm}
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      ) : tab === 'interview' ? (
        <div style={{ flex: 1, overflowY: 'auto', background: '#111', padding: '24px 32px 48px' }}>

          {/* ── What interests you? card ─────────────────────────────────── */}
          <div style={{ maxWidth: 720, margin: '0 auto 20px', background: '#1c1a10', border: '1px solid #854d0e', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: interestAnswer ? 10 : 0 }}>
              <span style={{ color: '#fbbf24', fontWeight: 600, fontSize: 13 }}>
                ✦ What interests you about working for {result.company}?
              </span>
              {interestAnswer && (
                <button
                  onClick={() => copyText('interest', interestAnswer)}
                  style={{ background: '#292524', border: `1px solid ${copiedField === 'interest' ? '#166534' : '#57534e'}`, borderRadius: 6, color: copiedField === 'interest' ? '#4ade80' : '#d6d3d1', fontSize: 11, padding: '3px 10px', cursor: 'pointer', transition: 'all 0.15s' }}
                >
                  {copiedField === 'interest' ? '✓ Copied!' : '📋 Copy'}
                </button>
              )}
            </div>
            {interestAnswer ? (
              <p style={{ color: '#d6d3d1', fontSize: 13, lineHeight: 1.65, margin: 0 }}>{interestAnswer}</p>
            ) : (
              <button
                onClick={handleGenerateInterest}
                disabled={interestLoading}
                style={{ marginTop: 8, background: '#451a03', border: '1px solid #92400e', borderRadius: 7, color: '#fbbf24', fontSize: 13, fontWeight: 600, padding: '7px 16px', cursor: interestLoading ? 'wait' : 'pointer', opacity: interestLoading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {interestLoading ? (
                  <><Loader2 size={13} className="animate-spin" /> Generating…</>
                ) : '✦ Generate Answer'}
              </button>
            )}
          </div>

          {interviewLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#888', fontSize: 13, marginTop: 40, justifyContent: 'center' }}>
              <Loader2 size={16} color="#f59e0b" className="animate-spin" />
              Generating 5 tailored questions...
            </div>
          )}
          {!interviewLoading && interviewQs && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720, margin: '0 auto' }}>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>
                Questions tailored for <strong style={{ color: '#888' }}>{result.role}</strong> at <strong style={{ color: '#888' }}>{result.company}</strong> · click a question to see your STAR answer
              </div>
              {interviewQs.map((q, i) => (
                <div key={i} style={{ background: '#1a1a1a', border: `1px solid ${expandedQ === i ? '#f59e0b44' : '#222'}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.2s' }}>
                  <button
                    onClick={() => setExpandedQ(expandedQ === i ? null : i)}
                    style={{ width: '100%', background: 'transparent', border: 'none', padding: '14px 16px', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12 }}
                  >
                    <span style={{ background: '#f59e0b22', color: '#f59e0b', borderRadius: 20, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
                    <span style={{ color: '#e8e8e8', fontSize: 13, fontWeight: 500, lineHeight: 1.4, flex: 1 }}>{q.question}</span>
                    <ChevronRight size={14} color="#444" style={{ transform: expandedQ === i ? 'rotate(90deg)' : 'none', transition: '0.15s', flexShrink: 0, marginTop: 3 }} />
                  </button>
                  {expandedQ === i && (
                    <div style={{ borderTop: '1px solid #222', padding: '14px 16px 16px 50px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {(['situation', 'task', 'action', 'result'] as const).map(key => (
                        <div key={key}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>{key}</div>
                          <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.55 }}>{q.star[key]}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {!interviewLoading && !interviewQs && (
            <div style={{ textAlign: 'center', color: '#555', fontSize: 13, marginTop: 60 }}>Could not generate questions — try again.</div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', background: '#444', display: 'flex', justifyContent: 'center', padding: '24px 24px 48px' }}>
          <div style={{ position: 'relative', width: 794 }}>
            <iframe
              key={tab}
              src={`data:text/html;charset=utf-8,${encodeURIComponent(activeHtml)}`}
              style={{ width: 794, height: isResume ? 2246 : 1122, border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.6)', borderRadius: 2, display: 'block' }}
              title={isResume ? 'Resume Preview' : 'Cover Letter Preview'}
            />
            {/* Page-break indicator — resume only */}
            {isResume && (
              <div style={{ position: 'absolute', top: 1123, left: -32, right: -32, pointerEvents: 'none', zIndex: 10 }}>
                <div style={{ height: 3, background: '#ef4444', opacity: 0.85 }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: '0 0 4px 4px', letterSpacing: 0.5 }}>PAGE 1 END</span>
                  <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: '0 0 4px 4px', letterSpacing: 0.5 }}>PAGE 2 START</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────────── */
export default function Home() {
  const [messages, setMessages]         = useState<Message[]>([]);
  const [input, setInput]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [preview, setPreview]           = useState<TailorResult | null>(null);
  const [coverLetterHtml, setCoverLetterHtml] = useState<string | null>(null);
  const [previewInitialTab, setPreviewInitialTab] = useState<'resume' | 'cover'>('resume');
  const [htmlHistory, setHtmlHistory]   = useState<string[]>([]);
  const [lastJd, setLastJd]             = useState<string>('');
  const bottomRef                       = useRef<HTMLDivElement>(null);
  const textareaRef                     = useRef<HTMLTextAreaElement>(null);
  const fileInputRef                    = useRef<HTMLInputElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function handleSubmit() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setLoading(true);

    setMessages(prev => [...prev, { type: 'user', text }]);
    const thinkingIdx = messages.length + 1;
    setMessages(prev => [...prev, { type: 'thinking', steps: [] }]);

    const addStep = (step: Step) => setMessages(prev => prev.map((m, i) => {
      if (i !== thinkingIdx || m.type !== 'thinking') return m;
      const exists = m.steps.find(s => s.id === step.id);
      if (exists) return { ...m, steps: m.steps.map(s => s.id === step.id ? { ...s, done: true } : s) };
      return { ...m, steps: [...m.steps, step] };
    }));

    const doneStep = (id: string) => setMessages(prev => prev.map((m, i) => {
      if (i !== thinkingIdx || m.type !== 'thinking') return m;
      return { ...m, steps: m.steps.map(s => s.id === id ? { ...s, done: true } : s) };
    }));

    // Find the most recent result for context
    const activeResult = preview ?? (messages.slice().reverse().find(m => m.type === 'result') as { type: 'result'; result: TailorResult } | undefined)?.result;

    // Cover letter mode
    if (activeResult && !isUrl(text) && text.length < 600 && isCoverLetterRequest(text)) {
      try {
        setMessages(prev => prev.map((m, i) => i === thinkingIdx && m.type === 'thinking'
          ? { ...m, steps: [{ id: 'cover', message: `Writing cover letter for ${activeResult.company}...`, done: false }] } : m));
        const r = await fetch('/api/cover-letter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company: activeResult.company,
            role: activeResult.role,
            research: activeResult.research ?? '',
            resumeHtml: activeResult.html,
          }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        setCoverLetterHtml(d.html);
        setPreviewInitialTab('cover');
        setPreview(prev => prev); // keep preview open
        setMessages(prev => prev.map((m, i) => i === thinkingIdx
          ? { type: 'cover-letter' as const, company: activeResult.company, role: activeResult.role } : m));
      } catch (e) {
        setMessages(prev => prev.map((m, i) => i === thinkingIdx ? { type: 'error' as const, text: String(e) } : m));
      }
      setLoading(false);
      return;
    }

    // Edit mode: instruction to modify the resume
    if (activeResult && !isUrl(text) && text.length < 600 && isEditIntent(text)) {
      try {
        setMessages(prev => prev.map((m, i) => i === thinkingIdx && m.type === 'thinking'
          ? { ...m, steps: [{ id: 'editing', message: 'Editing resume...', done: false }] } : m));
        const r = await fetch('/api/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction: text, html: activeResult.html }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        // Show diff preview — user must click Apply to commit
        setMessages(prev => prev.map((m, i) => i === thinkingIdx
          ? { type: 'pending-edit' as const, pendingHtml: d.html, changes: d.changes ?? [] } : m));
      } catch (e) {
        setMessages(prev => prev.map((m, i) => i === thinkingIdx ? { type: 'error' as const, text: String(e) } : m));
      }
      setLoading(false);
      return;
    }

    // Q&A mode: if a resume is already generated and input looks like a question (not URL, not long JD)
    const activeResult2 = activeResult;
    if (activeResult2 && !isUrl(text) && text.length < 600) {
      try {
        const r = await fetch('/api/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: text,
            company: activeResult2.company,
            role: activeResult2.role,
            research: activeResult2.research ?? '',
            resumeHtml: activeResult2.html,
          }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        setMessages(prev => prev.map((m, i) => i === thinkingIdx ? { type: 'answer' as const, text: d.answer } : m));
      } catch (e) {
        setMessages(prev => prev.map((m, i) => i === thinkingIdx ? { type: 'error' as const, text: String(e) } : m));
      }
      setLoading(false);
      return;
    }

    let jd = text;

    if (isUrl(text)) {
      addStep({ id: 'fetch', message: `Fetching from ${new URL(text).hostname}...`, done: false });
      try {
        const r = await fetch('/api/fetch-jd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: text }) });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        jd = d.jd;
        doneStep('fetch');
      } catch (e) {
        setMessages(prev => prev.map((m, i) => i === thinkingIdx ? { type: 'error', text: `Failed to fetch: ${e}` } : m));
        setLoading(false);
        return;
      }
    }

    setLastJd(jd); // remember for keyword re-tailor

    try {
      const res = await fetch('/api/tailor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jd }) });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let event = ''; // must persist across chunks

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('event: ')) { event = line.slice(7).trim(); continue; }
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));

          if (event === 'detected')  addStep({ id: 'detected', message: `${data.company} — ${data.role}`, done: true });
          if (event === 'step')      addStep({ id: data.id, message: data.message, done: false });
          if (event === 'done') {
            setMessages(prev => prev.map((m, i) => i === thinkingIdx && m.type === 'thinking' ? { ...m, steps: m.steps.map(s => ({ ...s, done: true })) } : m));
            setMessages(prev => [...prev, { type: 'result', result: data as TailorResult }]);
            setPreview(data as TailorResult);
            setHtmlHistory([]); // fresh tailor clears undo history
          }
          if (event === 'error') {
            setMessages(prev => prev.map((m, i) => i === thinkingIdx ? { type: 'error', text: data.message } : m));
          }
        }
      }
    } catch (e) {
      setMessages(prev => prev.map((m, i) => i === thinkingIdx ? { type: 'error', text: String(e) } : m));
    }
    setLoading(false);
  }

  async function handleRetailor(confirmedKeywords: string[]) {
    if (!lastJd || loading) return;
    setLoading(true);
    const thinkingIdx = messages.length;
    setMessages(prev => [...prev, { type: 'thinking', steps: [{ id: 'retailor', message: `Re-tailoring with ${confirmedKeywords.length} keywords...`, done: false }] }]);

    const addStep = (step: Step) => setMessages(prev => prev.map((m, i) => {
      if (i !== thinkingIdx || m.type !== 'thinking') return m;
      const exists = m.steps.find(s => s.id === step.id);
      if (exists) return { ...m, steps: m.steps.map(s => s.id === step.id ? { ...s, done: true } : s) };
      return { ...m, steps: [...m.steps, step] };
    }));

    try {
      const res = await fetch('/api/tailor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jd: lastJd, confirmedKeywords }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let event = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('event: ')) { event = line.slice(7).trim(); continue; }
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));
          if (event === 'step') addStep({ id: data.id, message: data.message, done: false });
          if (event === 'done') {
            setMessages(prev => prev.map((m, i) => i === thinkingIdx && m.type === 'thinking' ? { ...m, steps: m.steps.map(s => ({ ...s, done: true })) } : m));
            setMessages(prev => [...prev, { type: 'result', result: data as TailorResult }]);
            setPreview(data as TailorResult);
            setHtmlHistory([]);
          }
          if (event === 'error') {
            setMessages(prev => prev.map((m, i) => i === thinkingIdx ? { type: 'error', text: data.message } : m));
          }
        }
      }
    } catch (e) {
      setMessages(prev => prev.map((m, i) => i === thinkingIdx ? { type: 'error', text: String(e) } : m));
    }
    setLoading(false);
  }

  function applyEdit(msgIdx: number, newHtml: string) {
    const activeResult = preview ?? (messages.slice().reverse().find(m => m.type === 'result') as { type: 'result'; result: TailorResult } | undefined)?.result;
    if (!activeResult) return;
    setHtmlHistory(prev => [...prev, activeResult.html]);
    const updatedResult = { ...activeResult, html: newHtml };
    setPreview(updatedResult);
    setMessages(prev => prev.map((m, i) => {
      if (i === msgIdx) return { type: 'edited' as const, summary: 'Done! Resume updated — check the preview.' };
      if (m.type === 'result' && m.result === activeResult) return { ...m, result: updatedResult };
      return m;
    }));
  }

  function discardEdit(msgIdx: number) {
    setMessages(prev => prev.map((m, i) =>
      i === msgIdx ? { type: 'edited' as const, summary: 'Edit discarded.' } : m
    ));
  }

  async function handleRetry() {
    if (!lastJd || loading) return;
    setLoading(true);
    const thinkingIdx = messages.length;
    setMessages(prev => [...prev, { type: 'thinking', steps: [] }]);

    const addStep = (step: Step) => setMessages(prev => prev.map((m, i) => {
      if (i !== thinkingIdx || m.type !== 'thinking') return m;
      const exists = m.steps.find(s => s.id === step.id);
      if (exists) return { ...m, steps: m.steps.map(s => s.id === step.id ? { ...s, done: true } : s) };
      return { ...m, steps: [...m.steps, step] };
    }));

    try {
      const res = await fetch('/api/tailor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jd: lastJd }) });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let event = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('event: ')) { event = line.slice(7).trim(); continue; }
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));
          if (event === 'detected')  addStep({ id: 'detected', message: `${data.company} — ${data.role}`, done: true });
          if (event === 'step')      addStep({ id: data.id, message: data.message, done: false });
          if (event === 'done') {
            setMessages(prev => prev.map((m, i) => i === thinkingIdx && m.type === 'thinking' ? { ...m, steps: m.steps.map(s => ({ ...s, done: true })) } : m));
            setMessages(prev => [...prev, { type: 'result', result: data as TailorResult }]);
            setPreview(data as TailorResult);
            setHtmlHistory([]);
          }
          if (event === 'error') {
            setMessages(prev => prev.map((m, i) => i === thinkingIdx ? { type: 'error', text: data.message } : m));
          }
        }
      }
    } catch (e) {
      setMessages(prev => prev.map((m, i) => i === thinkingIdx ? { type: 'error', text: String(e) } : m));
    }
    setLoading(false);
  }

  function handleUndo() {
    if (htmlHistory.length === 0 || !preview) return;
    const previousHtml = htmlHistory[htmlHistory.length - 1];
    setHtmlHistory(prev => prev.slice(0, -1));
    const restored = { ...preview, html: previousHtml };
    setPreview(restored);
    setMessages(prev => prev.map(m =>
      m.type === 'result' && m.result.company === preview.company && m.result.role === preview.role
        ? { ...m, result: restored } : m
    ));
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      if (text) setInput(text.slice(0, 8000)); // cap at 8K chars
    };
    reader.readAsText(file);
    e.target.value = ''; // reset so same file can be re-selected
  }

  const showSplit = preview !== null;

  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden', background: '#0f0f0f', color: '#e8e8e8', fontFamily: '-apple-system, BlinkMacSystemFont, Inter, sans-serif' }}>
      {/* Chat */}
      <div style={{ width: showSplit ? '38%' : '100%', maxWidth: showSplit ? 520 : 720, margin: '0 auto', display: 'flex', flexDirection: 'column', borderRight: showSplit ? '1px solid #222' : 'none', transition: 'width 0.25s' }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #1a1a1a' }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>✦ Resume Tailor</div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>Paste a job description or URL · AI tailors your resume in seconds</div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {messages.length === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center', paddingBottom: 60 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#555', marginBottom: 6 }}>Drop a JD or job URL below</div>
              <div style={{ fontSize: 12, color: '#3a3a3a', maxWidth: 300, margin: '0 auto' }}>Works with Ashby, LinkedIn, Wellfound, Greenhouse and more</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 20, alignItems: 'center' }}>
                {['https://jobs.ashbyhq.com/...', 'https://www.linkedin.com/jobs/view/...'].map((ex, i) => (
                  <button key={i} onClick={() => setInput(ex)} style={{ background: '#161616', border: '1px solid #222', borderRadius: 7, padding: '6px 12px', fontSize: 11, color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Link size={11} /> {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i}>
              {m.type === 'user' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ background: '#1a1a2e', border: '1px solid #252540', borderRadius: '12px 12px 3px 12px', padding: '9px 13px', fontSize: 13, maxWidth: '85%', color: '#b0b0ff', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {m.text.length > 220 ? m.text.slice(0, 220) + `… (${m.text.length} chars)` : m.text}
                  </div>
                </div>
              )}
              {m.type === 'thinking' && (
                <div style={{ display: 'flex', gap: 9 }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a1a2e', border: '1px solid #252540', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, marginTop: 1 }}>✦</div>
                  <div style={{ background: '#141414', border: '1px solid #1e1e1e', borderRadius: '3px 12px 12px 12px', padding: '10px 14px', minWidth: 160 }}>
                    {m.steps.length === 0
                      ? <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#555', fontSize: 13 }}><Loader2 size={12} className="animate-spin" />Starting...</div>
                      : <StepsList steps={m.steps} />}
                  </div>
                </div>
              )}
              {m.type === 'result' && (
                <div style={{ display: 'flex', gap: 9 }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a1a2e', border: '1px solid #252540', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, marginTop: 1 }}>✦</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 13, color: '#666' }}>Done! Preview opens on the right 👉</div>
                    <ResultCard result={m.result} onView={setPreview} onRetailor={handleRetailor} />
                  </div>
                </div>
              )}
              {m.type === 'edited' && (
                <div style={{ display: 'flex', gap: 9 }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a1a2e', border: '1px solid #252540', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, marginTop: 1 }}>✦</div>
                  <div style={{ background: '#0f1f0f', border: '1px solid #1a3a1a', borderRadius: '3px 12px 12px 12px', padding: '10px 14px', fontSize: 13, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <CheckCircle size={13} color="#4ade80" /> {m.summary}
                  </div>
                </div>
              )}
              {m.type === 'pending-edit' && (() => {
                const pe = m;
                const modified = pe.changes.filter(c => c.type === 'modified');
                const added    = pe.changes.filter(c => c.type === 'added');
                return (
                  <div style={{ display: 'flex', gap: 9 }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a1a2e', border: '1px solid #252540', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, marginTop: 1 }}>✦</div>
                    <div style={{ background: '#0d1520', border: '1px solid #1e2a40', borderRadius: '3px 12px 12px 12px', padding: '12px 14px', fontSize: 13, maxWidth: '92%' }}>
                      <div style={{ color: '#a0b4ff', fontWeight: 600, marginBottom: 8 }}>
                        ✏️ Review changes — {modified.length} modified{added.length > 0 ? `, ${added.length} added` : ''}
                      </div>
                      {pe.changes.length === 0 && (
                        <div style={{ color: '#555', fontSize: 12, marginBottom: 10 }}>No bullet-level changes detected (structural edit).</div>
                      )}
                      {pe.changes.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                          {modified.map((c, ci) => (
                            <div key={`m${ci}`} style={{ background: '#111', borderRadius: 6, padding: '8px 10px', fontSize: 11, lineHeight: 1.5 }}>
                              <div style={{ color: '#666', textDecoration: 'line-through', marginBottom: 4 }}>{c.before}</div>
                              <div style={{ color: '#4ade80' }}>↳ {c.after}</div>
                            </div>
                          ))}
                          {added.map((c, ci) => (
                            <div key={`a${ci}`} style={{ background: '#0a1020', border: '1px solid #1a2a4a', borderRadius: 6, padding: '8px 10px', fontSize: 11, lineHeight: 1.5 }}>
                              <span style={{ color: '#6366f1', marginRight: 5 }}>+</span>
                              <span style={{ color: '#a0b4ff' }}>{c.after}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => applyEdit(i, pe.pendingHtml)}
                          style={{ background: '#22c55e', color: '#000', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                        >
                          ✓ Apply
                        </button>
                        <button
                          onClick={() => discardEdit(i)}
                          style={{ background: '#1a1a1a', color: '#888', border: '1px solid #333', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
                        >
                          ✕ Discard
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
              {m.type === 'answer' && (
                <div style={{ display: 'flex', gap: 9 }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a1a2e', border: '1px solid #252540', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, marginTop: 1 }}>✦</div>
                  <div style={{ background: '#111820', border: '1px solid #1a2a1a', borderRadius: '3px 12px 12px 12px', padding: '12px 15px', fontSize: 13, color: '#d4e8d4', lineHeight: 1.65, maxWidth: '88%', whiteSpace: 'pre-wrap' }}>
                    {m.text}
                  </div>
                </div>
              )}
              {m.type === 'cover-letter' && (
                <div style={{ display: 'flex', gap: 9 }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a1a2e', border: '1px solid #252540', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, marginTop: 1 }}>✦</div>
                  <div style={{ background: '#0d1020', border: '1px solid #1e2040', borderRadius: '3px 12px 12px 12px', padding: '12px 15px', fontSize: 13, color: '#a0b4ff' }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>✉️ Cover letter ready!</div>
                    <div style={{ color: '#666', fontSize: 12, marginBottom: 10 }}>{m.company} — {m.role}</div>
                    <button
                      onClick={() => setPreviewInitialTab('cover')}
                      style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
                    >
                      View in preview →
                    </button>
                  </div>
                </div>
              )}
              {m.type === 'error' && (
                <div style={{ display: 'flex', gap: 9 }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#2a1212', border: '1px solid #3d1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <AlertCircle size={13} color="#ef4444" />
                  </div>
                  <div style={{ background: '#1a1010', border: '1px solid #2a1515', borderRadius: '3px 12px 12px 12px', padding: '10px 14px', fontSize: 13, color: '#f87171' }}>
                    <div>{m.text}</div>
                    {lastJd && (
                      <button
                        onClick={handleRetry}
                        disabled={loading}
                        style={{ marginTop: 8, background: '#2a1515', color: '#fca5a5', border: '1px solid #3d1a1a', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 500, opacity: loading ? 0.5 : 1 }}
                      >
                        ↺ Retry
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div style={{ padding: '10px 16px 14px', borderTop: '1px solid #1a1a1a' }}>
          <div style={{ display: 'flex', gap: 8, background: '#161616', border: '1px solid #222', borderRadius: 11, padding: '7px 7px 7px 13px', alignItems: 'flex-end' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="Upload .txt job description"
              style={{ width: 28, height: 28, borderRadius: 6, background: 'transparent', border: 'none', cursor: loading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: loading ? 0.3 : 0.5 }}
            >
              <Paperclip size={14} color="#888" />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
              onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 300)}px`; }}
              placeholder={preview ? 'Edit resume, ask a question, or paste a new JD/URL...' : 'Paste job URL or description...'}
              rows={1}
              disabled={loading}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#e8e8e8', fontSize: 13, resize: 'none', maxHeight: 300, lineHeight: 1.5, fontFamily: 'inherit', paddingTop: 3 }}
            />
            <button
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
              style={{ width: 32, height: 32, borderRadius: 7, background: loading || !input.trim() ? '#1e1e1e' : '#6366f1', border: 'none', cursor: loading || !input.trim() ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              {loading ? <Loader2 size={14} color="#444" className="animate-spin" /> : <Send size={14} color={input.trim() ? '#fff' : '#444'} />}
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#2a2a2a', marginTop: 5, textAlign: 'center' }}>Enter to send · Shift+Enter for newline · 📎 upload .txt JD</div>
        </div>
      </div>

      {/* Preview */}
      {showSplit && preview && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <PreviewPanel
            result={preview}
            coverLetterHtml={coverLetterHtml}
            initialTab={previewInitialTab}
            onClose={() => { setPreview(null); setCoverLetterHtml(null); setPreviewInitialTab('resume'); setHtmlHistory([]); }}
            onUndo={handleUndo}
            canUndo={htmlHistory.length > 0}
          />
        </div>
      )}
    </div>
  );
}
