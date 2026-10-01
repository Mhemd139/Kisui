import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from 'mcp-handler';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCorpus } from '../src/corpus';
import { registerTools } from '../src/server';
import { checkVerdict, verdictSchema, type Verdict } from '../src/verdict';

const POLICY_URL = 'https://insurer.example/policy.pdf';

const corpus = createCorpus(
  [
    { id: 'demo-policy', provider: 'Demo', kind: 'insurance', title: 'Demo policy', url: POLICY_URL, format: 'pdf', access: 'auto', lang: 'he', sha256: '0'.repeat(64), verified_on: '2026-10-01', pages: 2 },
    { id: 'demo-list', provider: 'Demo', kind: 'insurance', title: 'Demo list', url: 'https://insurer.example/list', format: 'html', access: 'manual', lang: 'he', sha256: null, verified_on: null, pages: null },
  ],
  {
    'demo-policy': [
      'פרק 12 - הרחבה לספורט אתגרי\n12.1 כל פעילות שאינה מפורטת כאמור\nאינה כלולה בהרחבה זו',
      '23.22 פעילות המבוטח בכל ענף ספורט אתגרי (למעט הרחבה)',
    ],
  },
);

const evidence = { role: 'clause', doc_url: POLICY_URL, page: 2, quote: 'פעילות המבוטח בכל ענף ספורט אתגרי', verified_on: '2026-10-01' } as const;
const verdict: Verdict = { item: 'tandem paragliding', provider: 'Demo', verdict: 'excluded', reasoning: 'Extreme sports are excluded.', evidence: [evidence] };
const withEvidence = (change: object): Verdict => ({ ...verdict, evidence: [{ ...evidence, ...change }] });

describe('no clause, no verdict', () => {
  it('accepts a quote found on the cited page', () => {
    expect(checkVerdict(verdict, corpus)).toEqual([]);
  });

  it('accepts a quote that runs across lines, ignoring punctuation', () => {
    expect(checkVerdict(withEvidence({ page: 1, quote: 'כל פעילות שאינה מפורטת, כאמור אינה כלולה' }), corpus)).toEqual([]);
  });

  it.each([
    ['a quote that is not on that page', { page: 1 }, /quote not found on page 1/],
    ['a source outside sources.json', { doc_url: 'https://elsewhere.example/x.pdf' }, /not in sources\.json/],
    ['a stale verified_on date', { verified_on: '2025-01-01' }, /verified_on is 2026-10-01/],
    ['a page beyond the document', { page: 3 }, /only 2 pages/],
    ['a source that is not indexed', { doc_url: 'https://insurer.example/list' }, /not indexed/],
  ])('rejects %s', (_, change, message) => {
    expect(checkVerdict(withEvidence(change), corpus).join('\n')).toMatch(message);
  });

  it('rejects an unclear verdict without the question for the provider', () => {
    expect(checkVerdict({ ...verdict, verdict: 'unclear' }, corpus).join('\n')).toMatch(/needs the question/);
  });

  it.each(['quote', 'doc_url', 'page', 'verified_on'])('rejects evidence missing %s', (field) => {
    const partial: Record<string, unknown> = { ...evidence };
    delete partial[field];
    expect(verdictSchema.safeParse({ ...verdict, evidence: [partial] }).success).toBe(false);
  });

  it('rejects a verdict with no evidence', () => {
    expect(verdictSchema.safeParse({ ...verdict, evidence: [] }).success).toBe(false);
  });
});

describe('MCP tools', () => {
  let client: Client;

  beforeAll(async () => {
    const handler = createMcpHandler((server) => registerTools(server, corpus));
    client = new Client({ name: 'kisui-test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://kisui.test/mcp'), { fetch: (url, init) => handler(new Request(url, init)) }),
    );
  });

  it('lists the four tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_clause', 'list_sources', 'record_verdict', 'search_clauses']);
  });

  it('finds a Hebrew line whose word carries a prefix', async () => {
    const result = await client.callTool({ name: 'search_clauses', arguments: { query: 'ספורט אתגרי' } });
    expect(JSON.stringify(result.content)).toContain('הרחבה לספורט אתגרי');
  });

  it('rejects a verdict without a quote', async () => {
    const result = await client.callTool({ name: 'record_verdict', arguments: withEvidence({ quote: undefined }) });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('evidence.0.quote');
  });

  it('rejects a verdict whose quote is not on the cited page', async () => {
    const result = await client.callTool({ name: 'record_verdict', arguments: withEvidence({ page: 1 }) });
    expect(result.isError).toBe(true);
  });

  it('accepts a cited verdict', async () => {
    const result = await client.callTool({ name: 'record_verdict', arguments: verdict });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain('\\"accepted\\": true');
  });
});
