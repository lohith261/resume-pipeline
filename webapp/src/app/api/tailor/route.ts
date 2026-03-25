import { NextRequest } from 'next/server';
import { runPipeline, detectCompanyRole, slugify } from '@/lib/tailor';
import { put } from '@vercel/blob';

export const maxDuration = 300;

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
          const d = data as Record<string, unknown> | undefined;
          let message = step;
          if (step === 'extracting')      message = 'Extracting ATS keywords from JD...';
          else if (step === 'keywords')   message = `Found ${d?.count ?? '?'} keywords`;
          else if (step === 'coverage_before') message = `Baseline coverage: ${d?.pct ?? '?'}%`;
          else if (step === 'researching') message = `Researching ${company}...`;
          else if (step === 'researched') message = 'Company research complete';
          else if (step === 'tailoring')  message = `Weaving in ${d?.missing ?? '?'} missing keywords...`;
          else if (step === 'tailoring2') message = `2nd pass — ${d?.missing ?? '?'} keywords still missing, trying again...`;
          else if (step === 'tailored')   message = 'Tailoring complete';
          send('step', { id: step, message, data });
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
          research: result.research,
          changes:  result.changes,
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
