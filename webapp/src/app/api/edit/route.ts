import { NextRequest, NextResponse } from 'next/server';
import { groqLarge, compressHtml } from '@/lib/groq';
import { computeChanges } from '@/lib/tailor';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';
  const html        = typeof body?.html        === 'string' ? body.html              : '';
  if (!instruction || !html) return NextResponse.json({ error: 'instruction and html required' }, { status: 400 });
  if (instruction.length > 1_000) return NextResponse.json({ error: 'instruction too long (max 1000 chars)' }, { status: 400 });
  if (html.length > 300_000)      return NextResponse.json({ error: 'html too large'                         }, { status: 400 });

  try {
    // Compress HTML before sending — reduces tokens ~25%
    const compressed = compressHtml(html);

    const updated = await groqLarge(
      `You are editing an HTML resume based on a user instruction. Make ONLY the requested change — nothing else. Return the COMPLETE modified HTML with no explanation, no markdown fences, no commentary.`,
      `Instruction: ${instruction}

Resume HTML:
${compressed}`,
      6000,
    );

    const clean = updated.replace(/^```(?:html)?\s*/m, '').replace(/\s*```$/m, '').trim();

    // Compute a diff so the client can show a preview before applying
    const changes = computeChanges(html, clean);

    return NextResponse.json({ html: clean, changes });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
