import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Corpus } from './corpus';
import { checkVerdict, VERDICT_SYMBOLS, verdictSchema } from './verdict';

const MAX_RESULTS = 30;
const MAX_CONTEXT_LINES = 20;
const DEFAULT_CONTEXT_LINES = 4;
const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

export const SERVER_INSTRUCTIONS =
  'Quote before you judge: find clauses with search_clauses, read them with get_clause, follow every cross-reference ' +
  '(definitions, extension lists, the policy schedule, country rules), and show a verdict only after record_verdict accepts it. ' +
  'Never rank providers or recommend one; tell the traveller to confirm in writing.';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const error = (text: string) => ({ isError: true, content: [{ type: 'text' as const, text }] });

export function registerTools(server: McpServer, corpus: Corpus) {
  server.registerTool(
    'list_sources',
    {
      title: 'List sources',
      description:
        "Documents Kisui can quote: insurer policies, extension lists and rental terms, each with its link on the provider's own site, sha256 and verified_on date. indexed=false means the file is not available yet.",
      inputSchema: z.object({ provider: z.string().optional(), kind: z.enum(['insurance', 'rental', 'rule']).optional() }),
      annotations: READ_ONLY,
    },
    async ({ provider, kind }) => json(corpus.listSources({ provider, kind })),
  );

  server.registerTool(
    'search_clauses',
    {
      title: 'Search clauses',
      description:
        'Finds lines in the indexed documents. Write the query in the document language (Hebrew for Israeli policies) using bare words: "ספורט" also finds "לספורט" and "הספורט", but "הספורט" misses "ספורט". Lines are ranked by how many query words they contain.',
      inputSchema: z.object({
        query: z.string().min(1),
        provider: z.string().optional(),
        doc_ids: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ query, ...filter }) => json(corpus.search(query, filter)),
  );

  server.registerTool(
    'get_clause',
    {
      title: 'Get clause',
      description: 'Returns a line with the lines around it, plus the doc_url, page and verified_on needed to cite it.',
      inputSchema: z.object({
        doc_id: z.string(),
        page: z.number().int().min(1),
        line: z.number().int().min(1),
        context: z.number().int().min(0).max(MAX_CONTEXT_LINES).optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ doc_id, page, line, context }) => {
      const clause = corpus.clause(doc_id, page, line, context ?? DEFAULT_CONTEXT_LINES);
      return clause ? json(clause) : error(`No line ${line} on page ${page} of ${doc_id}.`);
    },
  );

  server.registerTool(
    'record_verdict',
    {
      title: 'Record verdict',
      description:
        'Checks a verdict before it is shown and returns the accepted record. Rejects it unless every evidence item quotes words found on the cited page of an indexed source. An unclear verdict must carry the question to send the provider.',
      inputSchema: verdictSchema,
      annotations: READ_ONLY,
    },
    async (verdict) => {
      const problems = checkVerdict(verdict, corpus);
      if (problems.length) return error(`Rejected: no clause, no verdict.\n${problems.join('\n')}`);
      return json({ accepted: true, symbol: VERDICT_SYMBOLS[verdict.verdict], ...verdict });
    },
  );
}
