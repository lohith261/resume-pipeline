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

/** Reject private/internal URLs to prevent SSRF */
function isSafeUrl(raw: string): boolean {
  try {
    const { protocol, hostname } = new URL(raw);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    // Block localhost variants and RFC-1918 / link-local ranges
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|0\.0\.0\.0)/i.test(hostname)) return false;
    return true;
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });
  if (!isSafeUrl(url)) return NextResponse.json({ error: 'Invalid or disallowed URL' }, { status: 400 });

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
