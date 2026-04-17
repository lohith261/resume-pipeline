import { NextRequest, NextResponse } from 'next/server';
import { groqFast } from '@/lib/groq';

export const maxDuration = 60;

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 2500);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { company, role, research, resumeHtml, contactName, contactTitle } = body;

  if (!company || typeof company !== 'string')
    return NextResponse.json({ error: 'company required' }, { status: 400 });
  if (!role || typeof role !== 'string')
    return NextResponse.json({ error: 'role required' }, { status: 400 });
  if (!contactName || typeof contactName !== 'string' || contactName.trim().length === 0)
    return NextResponse.json({ error: 'contactName required' }, { status: 400 });
  if (contactName.length > 100)
    return NextResponse.json({ error: 'contactName too long (max 100 chars)' }, { status: 400 });
  if (contactTitle && (typeof contactTitle !== 'string' || contactTitle.length > 100))
    return NextResponse.json({ error: 'contactTitle must be a string (max 100 chars)' }, { status: 400 });
  if (resumeHtml && resumeHtml.length > 300_000)
    return NextResponse.json({ error: 'resumeHtml too large' }, { status: 400 });

  const resumeText = stripHtml(resumeHtml ?? '');
  const titleLine  = contactTitle?.trim() ? ` (${contactTitle.trim()})` : '';

  const raw = await groqFast(
    `You are an expert at writing concise, human-sounding professional outreach for job seekers.
Write THREE messages for the candidate below. Follow the exact format — no extra commentary.

---EMAIL---
Subject: <subject line — specific, not generic>

<Email body: 130-160 words. Peer-to-peer tone, NOT a cover letter. Mention one specific detail about the company from the research. Reference one concrete achievement from the resume. End with a soft CTA like "happy to share more or jump on a quick call">
---CONNECT---
<LinkedIn connection request note: STRICTLY under 290 characters. Warm, specific, mentions the role. No filler phrases like "I came across your profile".>
---DM---
<LinkedIn DM to send after they accept: 60-90 words. Reference the role and one specific achievement. Conversational, not salesy.>`,

    `Contact name: ${contactName.trim()}${titleLine}
Company: ${company}
Role applying for: ${role}
Company research: ${(research ?? '').slice(0, 600)}
Candidate resume excerpt:
${resumeText}`,
    900,
  );

  // ── Parse the three sections ──────────────────────────────────────────────
  const emailRaw   = (raw.split('---CONNECT---')[0] ?? '').replace(/^[\s\S]*?---EMAIL---\s*/i, '').trim();
  const connectRaw = (raw.split('---CONNECT---')[1] ?? '').split('---DM---')[0].trim();
  const dmRaw      = (raw.split('---DM---')[1] ?? '').trim();

  const subjectMatch = emailRaw.match(/^Subject:\s*(.+)/i);
  const subject = subjectMatch ? subjectMatch[1].trim() : `Interested in the ${role} role at ${company}`;
  const emailBody = emailRaw.replace(/^Subject:[^\n]+\n*/i, '').trim();

  return NextResponse.json({
    email: {
      subject,
      body: emailBody,
    },
    linkedin: {
      connectNote: connectRaw.slice(0, 295),
      dm: dmRaw,
    },
  });
}
