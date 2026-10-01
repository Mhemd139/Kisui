import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractPdfPages } from '../src/extract';

const PDF = 'cache/docs/passportcard-policy.pdf';
if (!existsSync(PDF)) throw new Error(`${PDF} is missing: run "npm run index" first`);
const pages = await extractPdfPages(new Uint8Array(readFileSync(PDF)));

describe('Hebrew extraction, PassportCard policy (November 2025)', () => {
  it.each([
    [5, 'כללי 1. שם הפוליסה PassportCard ביטוח נסיעות לחו”ל'],
    [5, '5. תקופת אכשרה ראה סעיף 9.3א'],
    [41, '12.1 הגדרה- ספורט אתגרי משמעותו:'],
    [41, 'www.passportcard.co.il, הנעשית במסגרת תחביב'],
    [52, 'לתקנה 11 (להלן - "המבחנים"). גובה הפיצוי במקרה'],
    [60, '23.19 רכיבה בכלי רכב דו-גלגלי או תלת-גלגלי כנהג או'],
  ])('page %i reads right to left: %s', (page, line) => {
    expect(pages[page - 1].split('\n')).toContain(line);
  });

  it('mirrors brackets around Hebrew text', () => {
    expect(pages.join('\n')).not.toMatch(/\)[א-ת]/);
  });
});
