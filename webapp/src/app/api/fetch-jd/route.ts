import { NextRequest, NextResponse } from 'next/server';
import { groqFast } from '@/lib/groq';

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResumeTailor/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();

    // Strip HTML tags to get plain text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 6000);

    // Use Groq to extract structured JD
    const jd = await groqFast(
      'You are a job description extractor. From the raw webpage text, extract the clean job description including: role title, company, responsibilities, requirements, tech stack. Remove navigation, footer, cookie notices etc. Return clean plain text only.',
      text,
      2000,
    );

    return NextResponse.json({ jd });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
