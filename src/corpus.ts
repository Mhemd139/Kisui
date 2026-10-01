import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSources, type Source } from './sources';

export const INDEX_PATH = join(process.cwd(), 'cache', 'index.json');
const DEFAULT_LIMIT = 10;
const MIN_TERM_LENGTH = 2;
const FINAL_FORMS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

export type Index = { built_on: string; docs: Record<string, string[]> };
export type Hit = { doc_id: string; provider: string; page: number; line: number; text: string; matched_terms: number };
export type SearchFilter = { provider?: string; doc_ids?: string[]; limit?: number };
export type SourceFilter = { provider?: string; kind?: Source['kind'] };
export type Corpus = ReturnType<typeof createCorpus>;
type Line = { text: string; normalized: string };

// Punctuation, niqqud and other marks, and final letter forms are ignored, so extraction quirks don't break matching.
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[ךםןףץ]/g, (c) => FINAL_FORMS[c])
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function createCorpus(sources: Source[], docs: Index['docs']) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const byUrl = new Map(sources.map((s) => [s.url, s]));
  // Normalized once here, so a search only compares strings.
  const lines = new Map(
    Object.entries(docs).map(([id, pages]) => [
      id,
      pages.map((page) => page.split('\n').map((text): Line => ({ text, normalized: normalize(text) }))),
    ]),
  );

  const isProvider = (source: Source, provider?: string) => !provider || source.provider.toLowerCase() === provider.toLowerCase();

  function searchDoc(source: Source, terms: string[]): Hit[] {
    return (lines.get(source.id) ?? []).flatMap((pageLines, p) =>
      pageLines.flatMap(({ text, normalized }, l) => {
        const matched_terms = terms.filter((t) => normalized.includes(t)).length;
        return matched_terms ? [{ doc_id: source.id, provider: source.provider, page: p + 1, line: l + 1, text, matched_terms }] : [];
      }),
    );
  }

  return {
    listSources: (filter: SourceFilter = {}) =>
      sources
        .filter((s) => isProvider(s, filter.provider) && (!filter.kind || s.kind === filter.kind))
        .map((s) => ({ ...s, indexed: lines.has(s.id) })),
    sourceByUrl: (url: string) => byUrl.get(url),
    pageCount: (id: string) => lines.get(id)?.length ?? 0,

    search(query: string, filter: SearchFilter = {}): Hit[] {
      const terms = [...new Set(normalize(query).split(' '))].filter((t) => t.length >= MIN_TERM_LENGTH);
      return sources
        .filter((s) => lines.has(s.id) && isProvider(s, filter.provider) && (!filter.doc_ids || filter.doc_ids.includes(s.id)))
        .flatMap((s) => searchDoc(s, terms))
        .sort((a, b) => b.matched_terms - a.matched_terms)
        .slice(0, filter.limit ?? DEFAULT_LIMIT);
    },

    clause(id: string, page: number, line: number, context: number) {
      const source = byId.get(id);
      const pageLines = lines.get(id)?.[page - 1];
      if (!source || !pageLines || line < 1 || line > pageLines.length) return undefined;
      const from = Math.max(1, line - context);
      const to = Math.min(pageLines.length, line + context);
      return {
        doc_id: id,
        provider: source.provider,
        title: source.title,
        doc_url: source.url,
        verified_on: source.verified_on,
        page,
        lines: pageLines.slice(from - 1, to).map(({ text }, i) => ({ line: from + i, text })),
      };
    },

    hasQuote(id: string, page: number, quote: string): boolean {
      const pageLines = lines.get(id)?.[page - 1];
      return !!pageLines && pageLines.map((l) => l.normalized).join(' ').includes(normalize(quote));
    },
  };
}

let loaded: Corpus | undefined;

export function loadCorpus(): Corpus {
  loaded ??= createCorpus(loadSources().sources, (JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as Index).docs);
  return loaded;
}
