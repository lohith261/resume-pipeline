import { NextRequest, NextResponse } from 'next/server';
import { groqFast } from '@/lib/groq';

async function fetchWithJina(url: string): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      'Accept': 'text/plain',
      'X-Return-Format': 'text',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Jina ${res.status}`);
  return res.text();
}

async function fetchDirect(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResumeTailor/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  try {
    // Try Jina reader first (handles JS-rendered pages: Workday, Greenhouse, etc.)
    // Fall back to direct fetch if Jina fails
    let rawText = '';
    try {
      rawText = await fetchWithJina(url);
    } catch {
      rawText = await fetchDirect(url);
    }

    const text = rawText.slice(0, 6000);

    if (text.length < 100) {
      return NextResponse.json(
        { error: 'Could not extract content from this URL. Please paste the job description text directly.' },
        { status: 422 },
      );
    }

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
