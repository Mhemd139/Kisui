import { z } from 'zod';
import type { Corpus } from './corpus';

const MAX_QUOTE_CHARS = 500;

export const VERDICT_SYMBOLS = { covered: '✅', needs_extension: '⚠', excluded: '❌', unclear: '❓' } as const;

const evidenceSchema = z.object({
  role: z.enum(['clause', 'definition', 'list', 'schedule', 'outside_rule']),
  doc_url: z.string().min(1).describe('The source URL exactly as list_sources or get_clause returns it'),
  page: z.number().int().min(1),
  quote: z.string().min(1).max(MAX_QUOTE_CHARS).describe('Exact words from that page, in the original language'),
  verified_on: z.string().min(1).describe("The source's verified_on date"),
});

export const verdictSchema = z.object({
  item: z.string().min(1).describe("The traveller's fact being checked, e.g. 'tandem paragliding as a passenger'"),
  provider: z.string().min(1),
  verdict: z.enum(['covered', 'needs_extension', 'excluded', 'unclear']),
  reasoning: z.string().min(1).describe('The chain in words: fact → clause → definition or linked list → verdict'),
  evidence: z.array(evidenceSchema).min(1),
  question: z.string().optional().describe('Required when unclear: the exact question to send the provider'),
  depends_on: z.array(z.string()).optional().describe('Trip facts that are still unknown and could change the verdict'),
});

export type Verdict = z.infer<typeof verdictSchema>;

// The one hard rule: no clause, no verdict. Every quote must be found on the cited page.
export function checkVerdict(verdict: Verdict, corpus: Corpus): string[] {
  const problems = verdict.evidence.flatMap((e, i) => checkEvidence(e, corpus).map((p) => `evidence ${i + 1}: ${p}`));
  if (verdict.verdict === 'unclear' && !verdict.question?.trim()) problems.push('an unclear verdict needs the question to send the provider');
  return problems;
}

function checkEvidence(e: Verdict['evidence'][number], corpus: Corpus): string[] {
  const source = corpus.sourceByUrl(e.doc_url);
  if (!source) return [`${e.doc_url} is not in sources.json`];
  const pages = corpus.pageCount(source.id);
  if (!pages) return [`${source.id} is not indexed, so its quote cannot be checked`];
  if (e.verified_on !== source.verified_on) return [`verified_on is ${source.verified_on} for ${source.id}, not ${e.verified_on}`];
  if (e.page > pages) return [`${source.id} has only ${pages} pages`];
  if (!corpus.hasQuote(source.id, e.page, e.quote)) return [`quote not found on page ${e.page} of ${source.id}`];
  return [];
}
