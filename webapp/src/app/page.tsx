'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Link, FileText, ChevronRight, Download, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

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

interface TailorResult {
  company: string; role: string;
  html: string; htmlUrl: string;
  before: CoverageResult; after: CoverageResult;
  keywords: string[]; slug: string;
  research?: string;
  changes?: BulletChange[];
}

type Message =
  | { type: 'user';     text: string }
  | { type: 'thinking'; steps: Step[] }
  | { type: 'result';   result: TailorResult }
  | { type: 'answer';   text: string }
  | { type: 'edited';   summary: string }
  | { type: 'error';    text: string };

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());
const isEditIntent = (s: string) => /^(add|remove|delete|change|update|edit|replace|rewrite|shorten|expand|modify|fix|move|insert|take out|get rid|put |make |can you (add|remove|change|fix|update|rewrite)|please (add|remove|change|fix)|include|exclude)/i.test(s.trim());

function CoverageBadge({ pct }: { pct: number }) {
  const color = pct >= 90 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444';
  return <span style={{ color, fontWeight: 700, fontSize: 15 }}>{pct}%</span>;
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

function ResultCard({ result, onView }: { result: TailorResult; onView: (r: TailorResult) => void }) {
  const [kwExpanded, setKwExpanded]       = useState(false);
  const [changesExpanded, setChangesExpanded] = useState(false);
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
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>Coverage</div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: '#555' }}>{result.before.pct}%</span>
            <ChevronRight size={11} color="#444" />
            <CoverageBadge pct={result.after.pct} />
          </div>
        </div>
      </div>

      {/* Keywords */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#4ade80' }}>✓ {covered.length} present</span>
          <span style={{ fontSize: 11, color: '#f87171' }}>✗ {missing.length} missing</span>
        </div>
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

function PreviewPanel({ result, onClose }: { result: TailorResult; onClose: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const src = `data:text/html;charset=utf-8,${encodeURIComponent(result.html)}`;

  function handleDownload() {
    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to download PDF'); return; }
    const slug = `Resume_${result.company}_${result.role}`.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    win.document.open();
    win.document.write(result.html.replace(/<title>[^<]*<\/title>/, `<title>${slug}</title>`));
    win.document.close();
    win.addEventListener('load', () => { win.focus(); win.print(); }, { once: true });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #222', background: '#161616', flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{result.company} — {result.role}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
            Coverage: <CoverageBadge pct={result.after.pct} /> &nbsp;·&nbsp; {result.after.covered.length}/{result.after.total} keywords
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleDownload}
            style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Download size={13} /> Download PDF
          </button>
          <button
            onClick={onClose}
            style={{ background: '#222', color: '#888', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer' }}
          >✕</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', background: '#444', display: 'flex', justifyContent: 'center', padding: '24px 24px 48px' }}>
        <div style={{ position: 'relative', width: 794 }}>
          <iframe
            ref={iframeRef}
            src={src}
            style={{ width: 794, height: 2246, border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.6)', borderRadius: 2, display: 'block' }}
            title="Resume Preview"
          />
          {/* Page 1 / Page 2 break at 1123px */}
          <div style={{ position: 'absolute', top: 1123, left: -32, right: -32, pointerEvents: 'none', zIndex: 10 }}>
            <div style={{ height: 3, background: '#ef4444', opacity: 0.85 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: '0 0 4px 4px', letterSpacing: 0.5 }}>PAGE 1 END</span>
              <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: '0 0 4px 4px', letterSpacing: 0.5 }}>PAGE 2 START</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────────── */
export default function Home() {
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [preview, setPreview]         = useState<TailorResult | null>(null);
  const bottomRef                     = useRef<HTMLDivElement>(null);
  const textareaRef                   = useRef<HTMLTextAreaElement>(null);

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
        const updatedResult = { ...activeResult, html: d.html };
        setPreview(updatedResult);
        // Also update the result card in messages so future edits use latest HTML
        setMessages(prev => prev.map(m => m.type === 'result' && m.result === activeResult
          ? { ...m, result: updatedResult } : m));
        setMessages(prev => prev.map((m, i) => i === thinkingIdx
          ? { type: 'edited' as const, summary: 'Done! Resume updated — check the preview.' } : m));
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
                    <ResultCard result={m.result} onView={setPreview} />
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
              {m.type === 'answer' && (
                <div style={{ display: 'flex', gap: 9 }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a1a2e', border: '1px solid #252540', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, marginTop: 1 }}>✦</div>
                  <div style={{ background: '#111820', border: '1px solid #1a2a1a', borderRadius: '3px 12px 12px 12px', padding: '12px 15px', fontSize: 13, color: '#d4e8d4', lineHeight: 1.65, maxWidth: '88%', whiteSpace: 'pre-wrap' }}>
                    {m.text}
                  </div>
                </div>
              )}
              {m.type === 'error' && (
                <div style={{ display: 'flex', gap: 9 }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#2a1212', border: '1px solid #3d1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <AlertCircle size={13} color="#ef4444" />
                  </div>
                  <div style={{ background: '#1a1010', border: '1px solid #2a1515', borderRadius: '3px 12px 12px 12px', padding: '10px 14px', fontSize: 13, color: '#f87171' }}>
                    {m.text}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div style={{ padding: '10px 16px 14px', borderTop: '1px solid #1a1a1a' }}>
          <div style={{ display: 'flex', gap: 8, background: '#161616', border: '1px solid #222', borderRadius: 11, padding: '7px 7px 7px 13px', alignItems: 'flex-end' }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
              onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 180)}px`; }}
              placeholder={preview ? 'Edit resume, ask a question, or paste a new JD/URL...' : 'Paste job URL or description...'}
              rows={1}
              disabled={loading}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#e8e8e8', fontSize: 13, resize: 'none', maxHeight: 180, lineHeight: 1.5, fontFamily: 'inherit', paddingTop: 3 }}
            />
            <button
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
              style={{ width: 32, height: 32, borderRadius: 7, background: loading || !input.trim() ? '#1e1e1e' : '#6366f1', border: 'none', cursor: loading || !input.trim() ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              {loading ? <Loader2 size={14} color="#444" className="animate-spin" /> : <Send size={14} color={input.trim() ? '#fff' : '#444'} />}
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#2a2a2a', marginTop: 5, textAlign: 'center' }}>Enter to send · Shift+Enter for newline</div>
        </div>
      </div>

      {/* Preview */}
      {showSplit && preview && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <PreviewPanel result={preview} onClose={() => setPreview(null)} />
        </div>
      )}
    </div>
  );
}
