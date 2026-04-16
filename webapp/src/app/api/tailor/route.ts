import { NextRequest } from 'next/server';
import { runPipeline, detectCompanyRole, slugify } from '@/lib/tailor';
import { put } from '@vercel/blob';

export const maxDuration = 300;

// ── Simple in-memory rate limiter (sliding window, per IP) ───────────────────
const ipLog = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;   // 1 minute
const RATE_MAX       = 8;        // max 8 tailor requests per minute per IP

function isRateLimited(ip: string): boolean {
  const now  = Date.now();
  const prev = (ipLog.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (prev.length >= RATE_MAX) return true;
  ipLog.set(ip, [...prev, now]);
  return false;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  if (isRateLimited(ip)) {
    return new Response(
      JSON.stringify({ error: 'Too many requests — please wait a minute before trying again.' }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } }
    );
  }

  const { jd, company: companyHint, role: roleHint, confirmedKeywords } = await req.json();
  if (!jd) return new Response('jd required', { status: 400 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }

      try {
        // Auto-detect company/role if not provided
        let company = companyHint;
        let role = roleHint;

        if (!company || !role) {
          send('step', { id: 'detecting', message: 'Detecting company and role...' });
          const detected = await detectCompanyRole(jd);
          company = companyHint || detected.company;
          role    = roleHint    || detected.role;
          send('detected', { company, role });
        } else {
          send('detected', { company, role });
        }

        const result = await runPipeline(jd, company, role, (step, data) => {
          const d = data as Record<string, unknown> | undefined;
          let message = step;
          if (step === 'classifying')     message = 'Detecting role type...';
          else if (step === 'classified') {
            const typeLabel: Record<string, string> = { ai_engineer: 'AI Engineer', data_analyst: 'Data Analyst', data_engineer: 'Data Engineer', hybrid: 'Hybrid' };
            const countryLabel: Record<string, string> = { de: 'Germany', nl: 'Netherlands', sg: 'Singapore', ae: 'UAE', jp: 'Japan', lu: 'Luxembourg' };
            const label = typeLabel[(d?.type as string) ?? 'hybrid'] ?? 'Hybrid';
            const pct   = Math.round(((d?.confidence as number) ?? 0.7) * 100);
            const countryStr = d?.country ? ` · ${countryLabel[d.country as string] ?? ''} base` : '';
            message = `${label} role (${pct}% confidence)${countryStr} — using ${label} base`;
          }
          else if (step === 'base_selected') {
            const typeLabel: Record<string, string> = { ai_engineer: 'AI Engineer', data_analyst: 'Data Analyst', data_engineer: 'Data Engineer', hybrid: 'Hybrid' };
            const countryLabel: Record<string, string> = { de: 'Germany 🇩🇪', nl: 'Netherlands 🇳🇱', sg: 'Singapore 🇸🇬', ae: 'UAE 🇦🇪', jp: 'Japan 🇯🇵', lu: 'Luxembourg 🇱🇺 (DE base)' };
            const roleStr    = typeLabel[(d?.type as string) ?? 'hybrid'] ?? 'Hybrid';
            const countryStr = d?.country ? countryLabel[d.country as string] ?? '' : 'Global 🌐';
            message = `Using ${roleStr} base · ${countryStr}`;
          }
          else if (step === 'extracting')      message = 'Extracting ATS keywords from JD...';
          else if (step === 'keywords') {
            message = (d as Record<string, unknown>)?.confirmed
              ? `Using ${d?.count ?? '?'} confirmed keywords`
              : `Found ${d?.count ?? '?'} keywords`;
          }
          else if (step === 'coverage_before') message = `Baseline coverage: ${d?.pct ?? '?'}%`;
          else if (step === 'researching') message = `Researching ${company}...`;
          else if (step === 'researched') message = 'Research complete';
          else if (step === 'summarizing') message = `Writing ${company}-specific summary...`;
          else if (step === 'tailoring')  message = `Weaving in ${d?.missing ?? '?'} missing keywords...`;
          else if (step === 'tailoring2') message = `2nd pass — ${d?.missing ?? '?'} keywords still missing...`;
          else if (step === 'tailored')   message = (d as Record<string,unknown>)?.skipped
            ? `Summary tailored · ${d?.pct ?? '?'}% coverage`
            : `Tailoring complete · ${d?.pct ?? '?'}%`;
          else if (step === 'warn')       message = (d?.message as string) ?? '⚠ Warning';
          send('step', { id: step, message, data });
        }, Array.isArray(confirmedKeywords) && confirmedKeywords.length > 0 ? confirmedKeywords : undefined);

        // Inject <base> tag so relative asset URLs (e.g. /photo_professional.jpg)
        // resolve to the app origin even when HTML is served from Vercel Blob CDN.
        const origin = req.nextUrl.origin;
        const htmlWithBase = result.html.replace(
          /(<head[^>]*>)/i,
          `$1<base href="${origin}" />`,
        );

        // Store the tailored HTML
        const slug    = `${slugify(company)}_${slugify(role)}`;
        const fileName = `resume_${slug}.html`;

        let htmlUrl: string;

        if (process.env.BLOB_READ_WRITE_TOKEN) {
          // Production: store in Vercel Blob
          const blob = await put(`tailored/${slug}/${fileName}`, htmlWithBase, {
            access: 'public',
            contentType: 'text/html',
            addRandomSuffix: false,
          });
          htmlUrl = blob.url;
        } else {
          // Dev: store locally via data URL (client will render inline)
          htmlUrl = `data:text/html;base64,${Buffer.from(htmlWithBase).toString('base64')}`;
        }

        send('done', {
          company:  result.company,
          role:     result.role,
          htmlUrl,
          html:           htmlWithBase,
          before:         result.before,
          after:          result.after,
          keywords:       result.keywords,
          research:       result.research,
          changes:        result.changes,
          classification: result.classification,
          slug,
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
