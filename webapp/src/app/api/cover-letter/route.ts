import { NextRequest, NextResponse } from 'next/server';
import { groqFast } from '@/lib/groq';

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 3000);
}

export async function POST(req: NextRequest) {
  const { company, role, research, resumeHtml } = await req.json();
  if (!company || !role) return NextResponse.json({ error: 'company and role required' }, { status: 400 });

  const resumeText = stripHtml(resumeHtml ?? '');

  const letterBody = await groqFast(
    `You are a professional cover letter writer. Write a compelling, natural cover letter in first person for the candidate below.
Rules:
- 3 body paragraphs: (1) opening + why this role, (2) key achievements from resume that match the role, (3) why this company + closing
- Sound like a real human, not a template — no clichés like "I am writing to express my interest"
- Be specific: reference actual projects, technologies, and measurable results from the resume
- Keep it to one page (under 350 words total for the body)
- Return ONLY the 3 paragraphs as plain text, separated by a blank line — no greeting, no sign-off, no extra commentary`,
    `Company: ${company}
Role: ${role}
Company context: ${research ?? ''}
Candidate resume:\n${resumeText}`,
    700,
  );

  // Extract name and contact from resume HTML (grab from header section)
  const nameMatch = resumeHtml?.match(/<h1[^>]*>(.*?)<\/h1>/i) ??
                    resumeHtml?.match(/class="name"[^>]*>(.*?)</i);
  const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : 'Bandreddy Sri Sai Lohith';

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const paragraphs = letterBody
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(Boolean);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Cover_Letter_${company}_${role}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 10.5pt;
    color: #1a1a1a;
    background: #fff;
    -webkit-print-color-adjust: exact;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 22mm 22mm 20mm;
  }
  /* ── Header ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding-bottom: 10px;
    border-bottom: 1.5px solid #1a1a1a;
    margin-bottom: 28px;
  }
  .header-name {
    font-size: 20pt;
    font-weight: 600;
    letter-spacing: -0.3px;
  }
  .header-contact {
    font-size: 8.5pt;
    color: #444;
    text-align: right;
    line-height: 1.7;
  }
  .header-contact a { color: #444; text-decoration: none; }
  /* ── Body ── */
  .date { font-size: 9.5pt; color: #555; margin-bottom: 22px; }
  .recipient { margin-bottom: 20px; line-height: 1.7; }
  .recipient strong { font-weight: 600; }
  .salutation { margin-bottom: 16px; font-weight: 500; }
  .body p {
    margin-bottom: 14px;
    line-height: 1.7;
    text-align: justify;
  }
  .closing { margin-top: 24px; line-height: 1.9; }
  .closing .sign-off { font-weight: 500; }
  .closing .sig-name { font-weight: 600; margin-top: 4px; }
</style>
</head>
<body>
<div class="page">
  <!-- Header -->
  <div class="header">
    <div class="header-name">${name}</div>
    <div class="header-contact">
      bandreddysrisailohith@gmail.com &nbsp;·&nbsp; 8688457071<br>
      linkedin.com/in/srisailohith &nbsp;·&nbsp; github.com/lohith261
    </div>
  </div>

  <!-- Date -->
  <div class="date">${today}</div>

  <!-- Recipient -->
  <div class="recipient">
    <strong>Hiring Manager</strong><br>
    ${company}
  </div>

  <!-- Salutation -->
  <div class="salutation">Dear Hiring Manager,</div>

  <!-- Body paragraphs -->
  <div class="body">
    ${paragraphs.map(p => `<p>${p}</p>`).join('\n    ')}
  </div>

  <!-- Closing -->
  <div class="closing">
    <div class="sign-off">Warm regards,</div>
    <div class="sig-name">${name}</div>
  </div>
</div>
</body>
</html>`;

  return NextResponse.json({ html });
}
