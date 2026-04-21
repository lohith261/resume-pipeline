import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { detectCompanyRole, researchCompany } from '@/lib/tailor';
import { groqFast } from '@/lib/groq';

export const maxDuration = 60;

// ── Voice / persona rules (same as /api/interest) ───────────────────────────
function interestsPrompt(company: string, role: string, research: string, resumeText: string): string {
  return `You are Lohith — a software / data engineer writing a short, honest answer to "What interests you about working for ${company}?" for a ${role} application.

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
- No bullet points, no numbered lists, no bold — flowing prose only`;
}

function whyFitPrompt(company: string, role: string, research: string, resumeText: string): string {
  return `You are Lohith — a software / data engineer writing a concise answer to "Why are you a good fit for this ${role} role at ${company}?" for a job application form.

Company research: ${research || 'Not available.'}

Your background (draw only from this, never invent facts):
${resumeText}

Rules:
- Write in first person, natural and direct. Not a cover letter — more like a confident self-intro.
- Length: 80–100 words exactly.
- Cover: one concrete technical skill or tool relevant to this role + one specific measurable result from your experience + one forward-looking sentence on what you'd bring.
- Use contractions. No clichés. Do NOT start with "I".
- Flowing prose, no bullets.`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const jd          = typeof body?.jd      === 'string' ? body.jd.trim()      : '';
  const companyHint = typeof body?.company === 'string' ? body.company.trim() : undefined;
  const roleHint    = typeof body?.role    === 'string' ? body.role.trim()    : undefined;

  if (!jd) {
    return new Response(JSON.stringify({ error: 'jd required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Load base resume for grounding answers in real achievements
  let resumeText = '';
  try {
    const baseHtmlPath = path.join(process.cwd(), 'src', 'data', 'resume_ai_engineer.html');
    resumeText = stripHtml(fs.readFileSync(baseHtmlPath, 'utf8')).slice(0, 3000);
  } catch {
    resumeText = 'AI Engineer at ADP with 2+ years experience building LLM/RAG pipelines, Python ETL, AWS data infrastructure.';
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }

      try {
        // ── Step 1: detect company + role ──────────────────────────────────
        let company = companyHint;
        let role    = roleHint;

        if (!company || !role) {
          send('step', { message: 'Detecting company and role…' });
          const detected = await detectCompanyRole(jd);
          company = companyHint || detected.company;
          role    = roleHint    || detected.role;
        }
        send('detected', { company, role });

        // ── Step 2: research ────────────────────────────────────────────────
        send('step', { message: `Researching ${company}…` });
        const research = await researchCompany(company, role);
        send('step', { message: 'Research complete' });

        // ── Step 3: generate answers in parallel ────────────────────────────
        send('step', { message: 'Writing application answers…' });
        const [interests, whyFit] = await Promise.all([
          groqFast(interestsPrompt(company, role, research, resumeText), `What interests you about working for ${company}?`, 500),
          groqFast(whyFitPrompt(company, role, research, resumeText), `Why are you a good fit for this ${role} role?`, 350),
        ]);

        send('done', {
          company,
          role,
          research,
          answers: {
            interests: interests.trim(),
            whyFit:    whyFit.trim(),
          },
        });
      } catch (e: unknown) {
        send('error', { message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  });
}
