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
      `You are answering job application questions for a software engineer applying for ${role} at ${company}.

Company: ${research ?? ''}

Resume highlights:
${resumeText}

How to answer:
- Write in first person, like you're having a real conversation — relaxed but thoughtful
- Tell a mini-story: what you did, why it mattered, what you learned or achieved
- Ground every answer in a specific real experience from the resume — no vague generics
- Vary your opening — never start with "I am" or "I have X years"
- Keep it human: short paragraphs, natural rhythm, no bullet points, no HR-speak
- Length: 3–5 sentences for most questions; longer only if the question clearly needs it
- End with something forward-looking or enthusiastic when it fits naturally`,
      question,
      800,
    );

    return NextResponse.json({ answer });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
