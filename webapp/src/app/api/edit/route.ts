import { NextRequest, NextResponse } from 'next/server';
import { groqLarge, compressHtml } from '@/lib/groq';

export async function POST(req: NextRequest) {
  const { instruction, html } = await req.json();
  if (!instruction || !html) return NextResponse.json({ error: 'instruction and html required' }, { status: 400 });

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
    return NextResponse.json({ html: clean });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
