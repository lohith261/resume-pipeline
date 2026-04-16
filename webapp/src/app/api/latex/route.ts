import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'node-html-parser';
import { buildLatex } from '@/lib/latex';

export const maxDuration = 30;

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.html) {
    return NextResponse.json({ error: 'html is required' }, { status: 400 });
  }

  const latex = buildLatex(body.html as string);
  const name  = (parse(body.html as string).querySelector('h1')?.text?.trim() ?? 'Resume')
    .replace(/\s+/g, '_');

  return new NextResponse(latex, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}_Resume.tex"`,
      'Cache-Control': 'no-store',
    },
  });
}
