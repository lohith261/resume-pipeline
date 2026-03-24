import { NextRequest } from 'next/server';
import { runPipeline, detectCompanyRole, slugify } from '@/lib/tailor';
import { put } from '@vercel/blob';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { jd, company: companyHint, role: roleHint } = await req.json();
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
          const messages: Record<string, string> = {
            extracting:       'Extracting ATS keywords from JD...',
            keywords:         `Found ${(data as { count: number }).count} keywords`,
            coverage_before:  `Baseline coverage: ${(data as { pct: number }).pct}%`,
            researching:      `Researching ${company}...`,
            researched:       'Company research complete',
            tailoring:        `Weaving in ${(data as { missing: number }).missing} missing keywords...`,
            tailored:         `Tailoring complete`,
          };
          send('step', { id: step, message: messages[step] ?? step, data });
        });

        // Store the tailored HTML
        const slug    = `${slugify(company)}_${slugify(role)}`;
        const fileName = `resume_${slug}.html`;

        let htmlUrl: string;

        if (process.env.BLOB_READ_WRITE_TOKEN) {
          // Production: store in Vercel Blob
          const blob = await put(`tailored/${slug}/${fileName}`, result.html, {
            access: 'public',
            contentType: 'text/html',
            addRandomSuffix: false,
          });
          htmlUrl = blob.url;
        } else {
          // Dev: store locally via data URL (client will render inline)
          htmlUrl = `data:text/html;base64,${Buffer.from(result.html).toString('base64')}`;
        }

        send('done', {
          company:  result.company,
          role:     result.role,
          htmlUrl,
          html:     result.html,
          before:   result.before,
          after:    result.after,
          keywords: result.keywords,
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
