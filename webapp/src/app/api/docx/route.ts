import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'node-html-parser';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from 'docx';

export const maxDuration = 30;

// ── helpers ──────────────────────────────────────────────────────────────────

const PT = (n: number) => n * 20; // points → twips

function txt(el: ReturnType<typeof parse> | null | undefined): string {
  return (el as any)?.text?.trim() ?? '';
}

function sectionHeader(title: string): Paragraph {
  return new Paragraph({
    text: title.toUpperCase(),
    heading: HeadingLevel.HEADING_2,
    spacing: { before: PT(8), after: PT(3) },
    border: { bottom: { style: 'single', size: 4, space: 2, color: 'AAAAAA' } },
  });
}

function bulletPara(text: string): Paragraph {
  return new Paragraph({
    text,
    numbering: { reference: 'bullet-list', level: 0 },
    spacing: { before: 0, after: PT(1) },
  });
}

function bodyPara(runs: TextRun[], spacingBefore = 0, spacingAfter = PT(2)): Paragraph {
  return new Paragraph({
    children: runs,
    spacing: { before: spacingBefore, after: spacingAfter },
  });
}

// ── main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.html) {
    return NextResponse.json({ error: 'html is required' }, { status: 400 });
  }

  const root = parse(body.html as string);
  const paragraphs: Paragraph[] = [];

  // ── NAME ─────────────────────────────────────────────────────────────────
  const name = txt(root.querySelector('h1')) || 'Resume';
  paragraphs.push(
    new Paragraph({
      text: name,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: PT(3) },
    })
  );

  // ── CONTACT LINE ─────────────────────────────────────────────────────────
  const contactParts: string[] = [];
  root.querySelectorAll('.contact-item span, .contact-item a').forEach((el: any) => {
    const v = el.text.trim();
    if (v) contactParts.push(v);
  });
  if (contactParts.length) {
    paragraphs.push(
      new Paragraph({
        text: contactParts.join('  |  '),
        alignment: AlignmentType.CENTER,
        spacing: { after: PT(6) },
      })
    );
  }

  // ── SECTIONS ─────────────────────────────────────────────────────────────
  const sections = root.querySelectorAll('.section');

  for (const sec of sections as any[]) {
    const secTitle: string = sec.querySelector('.section-title')?.text?.trim() ?? '';
    if (!secTitle) continue;

    paragraphs.push(sectionHeader(secTitle));

    const lower = secTitle.toLowerCase();

    // ── Summary ────────────────────────────────────────────────────────────
    if (lower === 'summary') {
      const summary = txt(sec.querySelector('p'));
      if (summary) {
        paragraphs.push(
          new Paragraph({ text: summary, spacing: { after: PT(4) } })
        );
      }

    // ── Skills ─────────────────────────────────────────────────────────────
    } else if (lower === 'skills') {
      (sec.querySelectorAll('.skill-row') as any[]).forEach((row: any) => {
        const cat = row.querySelector('.skill-cat')?.text?.trim() ?? '';
        const val = row.querySelector('.skill-val')?.text?.trim() ?? '';
        paragraphs.push(
          bodyPara([
            new TextRun({ text: `${cat}: `, bold: true }),
            new TextRun(val),
          ], 0, PT(2))
        );
      });

    // ── Experience ─────────────────────────────────────────────────────────
    } else if (lower === 'experience') {
      (sec.querySelectorAll('.job') as any[]).forEach((job: any, i: number) => {
        const jobTitle = job.querySelector('.job-title')?.text?.trim() ?? '';
        const jobDate  = job.querySelector('.job-date')?.text?.trim()  ?? '';
        const company  = job.querySelector('.job-company')?.text?.trim() ?? '';

        paragraphs.push(
          bodyPara([
            new TextRun({ text: jobTitle, bold: true }),
            new TextRun({ text: jobDate ? `  ·  ${jobDate}` : '' }),
          ], i === 0 ? 0 : PT(6), PT(1))
        );
        if (company) {
          paragraphs.push(
            new Paragraph({ text: company, spacing: { before: 0, after: PT(2) } })
          );
        }
        (job.querySelectorAll('li') as any[]).forEach((li: any) => {
          paragraphs.push(bulletPara(li.text.trim()));
        });
      });

    // ── Projects ───────────────────────────────────────────────────────────
    } else if (lower === 'projects') {
      (sec.querySelectorAll('.project-block') as any[]).forEach((proj: any, i: number) => {
        const projName = proj.querySelector('.project-name')?.text?.trim() ?? '';
        const projDate = proj.querySelector('.job-date')?.text?.trim()    ?? '';
        const links    = proj.querySelector('.project-links')?.text?.trim() ?? '';

        paragraphs.push(
          bodyPara([
            new TextRun({ text: projName, bold: true }),
            new TextRun({ text: projDate ? `  ·  ${projDate}` : '' }),
          ], i === 0 ? 0 : PT(6), PT(1))
        );
        if (links) {
          paragraphs.push(
            new Paragraph({ text: links, spacing: { before: 0, after: PT(2) } })
          );
        }
        (proj.querySelectorAll('li') as any[]).forEach((li: any) => {
          paragraphs.push(bulletPara(li.text.trim()));
        });
      });

    // ── Education ──────────────────────────────────────────────────────────
    } else if (lower === 'education') {
      const degree = sec.querySelector('.edu-degree')?.text?.trim() ?? '';
      const year   = sec.querySelector('.edu-year')?.text?.trim()   ?? '';
      const school = sec.querySelector('.edu-school')?.text?.trim() ?? '';

      if (degree) {
        paragraphs.push(
          bodyPara([
            new TextRun({ text: degree, bold: true }),
            new TextRun({ text: year ? `  ·  ${year}` : '' }),
          ], 0, PT(1))
        );
      }
      if (school) {
        paragraphs.push(
          new Paragraph({ text: school, spacing: { before: 0, after: PT(2) } })
        );
      }
      (sec.querySelectorAll('li') as any[]).forEach((li: any) => {
        paragraphs.push(bulletPara(li.text.trim()));
      });

    // ── Awards / Certifications (award-header pattern) ─────────────────────
    } else {
      const awardHeaders = sec.querySelectorAll('.award-header') as any[];
      awardHeaders.forEach((hdr: any, i: number) => {
        const awardTitle = hdr.querySelector('.award-title')?.text?.trim() ?? '';
        const awardYear  = hdr.querySelector('.award-year')?.text?.trim()  ?? '';
        const nextEl     = hdr.nextElementSibling as any;
        const org        = nextEl?.classList?.contains('award-org')
          ? nextEl.text.trim()
          : '';

        paragraphs.push(
          bodyPara([
            new TextRun({ text: awardTitle, bold: true }),
            new TextRun({ text: awardYear ? `  ·  ${awardYear}` : '' }),
          ], i === 0 ? 0 : PT(5), PT(0))
        );
        if (org) {
          paragraphs.push(
            new Paragraph({ text: org, spacing: { before: 0, after: PT(1) } })
          );
        }
        // Bullets immediately after award-org (if any)
        const afterOrg = org ? nextEl?.nextElementSibling as any : nextEl;
        if (afterOrg?.tagName === 'UL') {
          (afterOrg.querySelectorAll('li') as any[]).forEach((li: any) => {
            paragraphs.push(bulletPara(li.text.trim()));
          });
        }
      });
    }
  }

  // ── Build Document ────────────────────────────────────────────────────────
  const doc = new Document({
    creator: 'Job Tailor – jobtailor.in',
    title: `${name} – Resume`,
    description: 'ATS-optimised resume generated by Job Tailor',
    numbering: {
      config: [
        {
          reference: 'bullet-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '\u2022',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: convertInchesToTwip(0.25),
                    hanging: convertInchesToTwip(0.15),
                  },
                },
                run: { font: 'Calibri' },
              },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        heading1: {
          run: { size: PT(16), bold: true, font: 'Calibri', color: '111111' },
          paragraph: { alignment: AlignmentType.CENTER },
        },
        heading2: {
          run: {
            size: PT(11),
            bold: true,
            font: 'Calibri',
            allCaps: true,
            color: '222222',
          },
        },
        document: {
          run: { size: PT(10.5), font: 'Calibri', color: '111111' },
          paragraph: { spacing: { line: 276, lineRule: 'auto' } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top:    convertInchesToTwip(0.55),
              bottom: convertInchesToTwip(0.55),
              left:   convertInchesToTwip(0.75),
              right:  convertInchesToTwip(0.75),
            },
          },
        },
        children: paragraphs,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const slug = name.replace(/\s+/g, '_');

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${slug}_Resume.docx"`,
      'Cache-Control': 'no-store',
    },
  });
}
