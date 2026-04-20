import { NextRequest, NextResponse } from 'next/server';
import { groqFast } from '@/lib/groq';

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const company    = typeof body?.company    === 'string' ? body.company.trim()    : '';
  const role       = typeof body?.role       === 'string' ? body.role.trim()       : '';
  const research   = typeof body?.research   === 'string' ? body.research.trim()   : '';
  const resumeHtml = typeof body?.resumeHtml === 'string' ? body.resumeHtml        : '';

  if (!company || !role || !resumeHtml) {
    return NextResponse.json({ error: 'company, role, and resumeHtml are required' }, { status: 400 });
  }
  if (resumeHtml.length > 300_000) {
    return NextResponse.json({ error: 'resumeHtml too long' }, { status: 400 });
  }

  const resumeText = stripHtml(resumeHtml).slice(0, 3000);

  try {
    const answer = await groqFast(
      `You are Lohith — a software / data engineer writing a short, honest answer to "What interests you about working for ${company}?" for a ${role} application.

Company research: ${research || 'Not available — draw only from what the role suggests about the company.'}

Your background (draw only from this, never invent facts):
${resumeText}

Rules — follow every one:
- Write in first person, conversational tone. Sound like you typed this yourself in a job application form, not like a cover letter or a speech.
- Length: 150–180 words. No more, no less.
- Structure (don't label these, just flow naturally):
    1. One specific thing about what this company builds or does that genuinely resonates — reference something concrete from the research or from what the role implies about the product
    2. One bridge: how a specific skill or project from your background makes you well-suited or particularly drawn to this problem space
    3. A forward-looking sentence on what you hope to contribute or learn — keep it grounded, not lofty
- Use contractions: "I've", "it's", "that's", "I'd"
- No clichés: never say "I've always been passionate about", "this is an exciting opportunity", "fast-paced environment", "make an impact", "synergy", "leverage"
- Do NOT start with "I" as the first word
- No bullet points, no numbered lists, no bold — flowing prose only`,
      `What interests you about working for ${company}?`,
      500,
    );

    return NextResponse.json({ answer: answer.trim() });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
