import { getDocumentProxy } from 'unpdf';
import { parse } from 'node-html-parser';

type Item = { str: string; x: number; y: number; width: number };

const HEBREW = /\p{Script=Hebrew}/u;
const LTR_STRONG = /[A-Za-z0-9]/;
const BRACKET_MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{' };
const EDGE_NEUTRALS = /^([.,:;()[\]{}]*)(.*?)([.,:;()[\]{}]*)$/s;
const SAME_LINE_PT = 2;
const SPACE_GAP_PT = 1.5;
const HTML_NOISE = 'script, style, noscript, svg, header, footer, nav, form';

// pdf.js returns each text run in logical order, but Hebrew PDFs often emit runs
// left to right. A line with Hebrew is rebuilt right to left, keeping LTR runs
// (numbers, Latin words) in their own order.
export async function extractPdfPages(data: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(data);
  const pages: Item[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const { items } = await (await pdf.getPage(n)).getTextContent();
    const textItems = items.flatMap((it) =>
      'str' in it && it.str ? [{ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width }] : [],
    );
    pages.push(dedupe(textItems));
  }
  const asStored = pages.map((items) => toLines(items, false).join('\n'));
  if (!hasVisualBrackets(asStored.join('\n'))) return asStored;
  return pages.map((items) => toLines(items, true).join('\n'));
}

// Some producers store punctuation inside Hebrew runs in visual order: ")להלן(" instead of "(להלן)".
function hasVisualBrackets(text: string): boolean {
  const closeBeforeHebrew = text.match(/\)[א-ת]/g)?.length ?? 0;
  const openBeforeHebrew = text.match(/\([א-ת]/g)?.length ?? 0;
  return closeBeforeHebrew > openBeforeHebrew;
}

// selector: the element that holds the terms, so page chrome (dates, promos) doesn't change the hash.
export function extractHtmlText(html: string, selector?: string): string {
  const root = parse(html);
  root.querySelectorAll(HTML_NOISE).forEach((el) => el.remove());
  const main = selector ? root.querySelector(selector) : (root.querySelector('main') ?? root.querySelector('body') ?? root);
  if (!main) throw new Error(`selector ${selector} not found on the page`);
  return main.structuredText
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function dedupe(items: Item[]): Item[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = `${it.str}|${Math.round(it.x)}|${Math.round(it.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Stream order is the producer's reading order (cell by cell in tables); a new line starts when y moves.
function toLines(items: Item[], visualNeutrals: boolean): string[] {
  const lines: Item[][] = [];
  for (const it of items) {
    const line = lines.at(-1);
    if (line && Math.abs(line[0].y - it.y) <= SAME_LINE_PT) line.push(it);
    else lines.push([it]);
  }
  return lines
    .map((line) => joinItems(line.some((it) => HEBREW.test(it.str)) ? orderRtl(line, visualNeutrals) : orderLtr(line)))
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function orderLtr(line: Item[]): Item[] {
  return [...line].sort((a, b) => a.x - b.x);
}

// For visual-order producers: mirror brackets, and move edge punctuation of LTR runs
// (",www.site.co.il") to the logical side.
function toLogical(it: Item, visualNeutrals: boolean): Item {
  if (!visualNeutrals) return it;
  if (HEBREW.test(it.str)) return { ...it, str: mirror(it.str) };
  if (!LTR_STRONG.test(it.str)) return { ...it, str: mirror([...it.str].reverse().join('')) };
  const [, lead, core, trail] = it.str.match(EDGE_NEUTRALS) ?? ['', '', it.str, ''];
  return { ...it, str: mirror(trail) + core + mirror(lead) };
}

function mirror(text: string): string {
  return text.replace(/[()[\]{}]/g, (c) => BRACKET_MIRROR[c]);
}

function orderRtl(line: Item[], visualNeutrals: boolean): Item[] {
  const out: Item[] = [];
  let run: Item[] = [];
  let neutrals: Item[] = [];
  for (const it of [...line].sort((a, b) => b.x - a.x).map((item) => toLogical(item, visualNeutrals))) {
    if (HEBREW.test(it.str)) {
      out.push(...run.reverse(), ...neutrals, it);
      run = [];
      neutrals = [];
    } else if (LTR_STRONG.test(it.str)) {
      if (run.length) run.push(...neutrals);
      else out.push(...neutrals);
      run.push(it);
      neutrals = [];
    } else {
      neutrals.push(it);
    }
  }
  out.push(...run.reverse(), ...neutrals);
  return out;
}

function joinItems(ordered: Item[]): string {
  let text = '';
  ordered.forEach((it, i) => {
    const prev = ordered[i - 1];
    if (prev && visualGap(prev, it) > SPACE_GAP_PT && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
    text += it.str;
  });
  return text;
}

function visualGap(a: Item, b: Item): number {
  return a.x < b.x ? b.x - (a.x + a.width) : a.x - (b.x + b.width);
}
