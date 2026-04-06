import { NextRequest, NextResponse } from 'next/server';
import { groq } from '@/lib/groq';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { resumeHtml, company, role, keywords, research } = await req.json();

  // Extract bullet text from resume HTML (server-safe regex, no DOM)
  const bullets: string[] = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(resumeHtml as string)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, '').trim();
    if (text.length > 20) bullets.push(text);
  }

  const prompt = `Company: ${company}
Role: ${role}
Company context: ${(research as string | undefined) ?? ''}
Keywords from job description: ${(keywords as string[]).slice(0, 25).join(', ')}

Candidate resume bullets (ground ALL answers in these — never fabricate):
${bullets.slice(0, 18).map((b, i) => `${i + 1}. ${b}`).join('\n')}

Generate exactly 5 interview questions this company is most likely to ask for this specific role. Mix: 1 behavioural, 1 technical/system-design, 1 situational, 1 role-specific, 1 motivation/culture. For each, write a concise STAR answer using only the candidate's real experience above. Keep each STAR field to 1-2 sentences.

Return ONLY valid JSON array — no markdown fences, no explanation:
[
  {
    "question": "...",
    "star": {
      "situation": "...",
      "task": "...",
      "action": "...",
      "result": "..."
    }
  }
]`;

  try {
    const raw = await groq(
      'You are an expert interview coach. Return ONLY a valid JSON array — no markdown, no explanation.',
      prompt,
      1800,
    );
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    const questions = JSON.parse(cleaned);
    return NextResponse.json({ questions });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
