require('dotenv').config();
const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const chokidar = require('chokidar');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE = __dirname;

app.use(express.json());

// ── SSE live-reload endpoint ─────────────────────────────────────────────────
const clients = new Set();

app.get('/livereload', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

function broadcast() {
  for (const c of clients) c.write('data: reload\n\n');
}

// Watch all HTML files for changes
chokidar.watch(path.join(BASE, '**/*.html'), { ignoreInitial: true })
  .on('change', f => { console.log('🔄 Changed:', path.basename(f)); broadcast(); });

// ── Live-reload injector ──────────────────────────────────────────────────────
function injectLiveReload(html) {
  const script = `
<script>
  (function(){
    const es = new EventSource('/livereload');
    es.onmessage = () => location.reload();
    es.onerror   = () => setTimeout(() => location.reload(), 2000);
  })();
</script>`;
  return html.replace('</body>', script + '\n</body>');
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Home — list all available resumes
app.get('/', (req, res) => {
  const tailoredDir = path.join(BASE, 'tailored');
  const tailored = [];

  if (fs.existsSync(tailoredDir)) {
    const entries = fs.readdirSync(tailoredDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const compDir = path.join(tailoredDir, entry.name);
        const files = fs.readdirSync(compDir).filter(f => f.endsWith('.html'));
        for (const f of files) {
          tailored.push(`${entry.name}/${f}`);
        }
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        tailored.push(entry.name);
      }
    }
  }

  const links = [
    `<li><a href="/preview/base">📄 resume_base</a></li>`,
    ...tailored.map(f => {
      const name = f.replace('.html', '');
      return `<li><a href="/preview/tailored/${name}">🎯 ${name}</a></li>`;
    })
  ].join('\n');

  res.send(`<!DOCTYPE html><html><head>
    <title>Resume Pipeline</title>
    <style>
      body { font-family: system-ui; max-width: 700px; margin: 60px auto; padding: 0 20px; background: #f9f9f9; }
      h1 { font-size: 1.6rem; margin-bottom: 4px; }
      p  { color: #666; margin-bottom: 24px; }
      ul { list-style: none; padding: 0; }
      li { margin: 8px 0; }
      a  { color: #1a56db; font-size: 1rem; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .api { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-top: 32px; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; }
    </style>
  </head><body>
    <h1>📑 Resume Pipeline</h1>
    <p>Live preview — changes auto-reload in the browser.</p>
    <ul>${links}</ul>
    <div class="api">
      <strong>Tailor a resume via API:</strong><br><br>
      <code>POST /tailor</code><br><br>
      Body: <code>{ "jd": "...", "company": "Accenture", "role": "GenAI Engineer" }</code><br><br>
      Returns: <code>{ "coverage": 92, "pdfUrl": "/download/resume_accenture_genai_engineer.pdf" }</code>
    </div>
  </body></html>`);
});

// Preview base resume
app.get('/preview/base', (req, res) => {
  const file = path.join(BASE, 'resume_base.html');
  if (!fs.existsSync(file)) return res.status(404).send('Not found');
  res.send(injectLiveReload(fs.readFileSync(file, 'utf8')));
});

// Preview tailored resume (nested company format)
app.get('/preview/tailored/:company/:name', (req, res) => {
  const file = path.join(BASE, 'tailored', req.params.company, req.params.name + '.html');
  if (!fs.existsSync(file)) return res.status(404).send('Not found');
  res.send(injectLiveReload(fs.readFileSync(file, 'utf8')));
});

// Preview tailored resume (fallback for files strictly in tailored/)
app.get('/preview/tailored/:name', (req, res) => {
  const file = path.join(BASE, 'tailored', req.params.name + '.html');
  if (!fs.existsSync(file)) return res.status(404).send('Not found');
  res.send(injectLiveReload(fs.readFileSync(file, 'utf8')));
});

// Download PDF (nested company format)
app.get('/download/:company/:file', (req, res) => {
  const file = path.join(BASE, 'tailored', req.params.company, req.params.file);
  if (!fs.existsSync(file)) return res.status(404).send('PDF not found');
  res.download(file);
});

// Download PDF (fallback)
app.get('/download/:file', (req, res) => {
  const p1 = path.join(BASE, 'tailored', req.params.file);
  const p2 = path.join(BASE, req.params.file);
  const file = fs.existsSync(p1) ? p1 : fs.existsSync(p2) ? p2 : null;
  if (!file) return res.status(404).send('PDF not found');
  res.download(file);
});

// ── Tailor endpoint — calls Python + Grok ────────────────────────────────────
app.post('/tailor', async (req, res) => {
  const { jd, company, role } = req.body;
  if (!jd || !company || !role)
    return res.status(400).json({ error: 'jd, company, role are required' });

  const { execFile } = require('child_process');
  const python = '/opt/homebrew/bin/python3';

  console.log(`\n🎯 Tailoring for ${company} — ${role}`);

  execFile(python, ['tailor_resume.py', jd, company, role], {
    cwd: BASE,
    env: { ...process.env, PATH: '/opt/homebrew/bin:' + process.env.PATH },
    maxBuffer: 1024 * 1024 * 10
  }, (err, stdout, stderr) => {
    if (err) {
      console.error('tailor error:', stderr);
      return res.status(500).json({ error: stderr || err.message });
    }
    console.log(stdout);

    // Parse coverage from stdout
    const coverageMatch = stdout.match(/Coverage:\s*([\d.]+)%/);
    const coverage = coverageMatch ? parseFloat(coverageMatch[1]) : null;

    const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' +
                 role.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const compSlug = company.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    
    const pdfUrl  = `/download/${compSlug}/resume_${slug}.pdf`;
    const htmlUrl = `/preview/tailored/${compSlug}/resume_${slug}`;

    broadcast(); // auto-reload any open preview tabs

    res.json({ ok: true, coverage, pdfUrl, htmlUrl, log: stdout });
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Resume Pipeline running at http://localhost:${PORT}`);
  console.log(`   Preview base resume : http://localhost:${PORT}/preview/base`);
  console.log(`   Tailor via POST     : http://localhost:${PORT}/tailor`);
  console.log(`   Auto-reload         : active (watching *.html)\n`);
});
