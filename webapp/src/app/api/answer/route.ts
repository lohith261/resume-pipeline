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

export async function POST(req: NextRequest) {
  const { question, company, role, research, resumeHtml } = await req.json();
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });

  const resumeText = stripHtml(resumeHtml ?? '').slice(0, 3000);

  try {
    const answer = await groqFast(
      `You are writing job application answers on behalf of a software engineer applying for ${role} at ${company}.

Company context: ${research ?? ''}

Candidate resume (key content):
${resumeText}

Rules:
- Answer in first person as the candidate
- Sound natural and human — like someone typing a thoughtful answer, not a bot
- Be specific: reference real experience, projects, or skills from the resume
- Keep it concise: 2–4 sentences unless the question genuinely needs more
- Don't start with "I am a..." or generic openers — vary the style
- Don't use buzzword soup or HR-speak`,
      question,
      600,
    );

    return NextResponse.json({ answer });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
