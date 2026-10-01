// Runs every drafted answer in eval/*.yaml through the same rule as record_verdict:
// required fields, and each quote found on its cited page. Reports counts, never an accuracy number.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { loadCorpus } from '../src/corpus';
import { checkVerdict, verdictSchema, type Verdict } from '../src/verdict';

type Answer = { verdict: Verdict['verdict']; why: string; evidence: [string, number, string][]; question?: string };
type EvalFile = { items: { id: string; question: string; answers: Record<string, Answer>; not_found?: string[] }[] };

const FILES = ['eval/insurance.yaml', 'eval/rental.yaml'];
const corpus = loadCorpus();
const sources = new Map(corpus.listSources().map((s) => [s.id, s]));
const counts: Record<string, number> = {};
const problems: string[] = [];
let notFound = 0;

for (const file of FILES) {
  const { items } = parse(readFileSync(file, 'utf8')) as EvalFile;
  for (const item of items) {
    notFound += item.not_found?.length ?? 0;
    for (const [provider, answer] of Object.entries(item.answers)) {
      counts[answer.verdict] = (counts[answer.verdict] ?? 0) + 1;
      const where = `${file} ${item.id} ${provider}`;
      const parsed = verdictSchema.safeParse(toVerdict(item.question, provider, answer));
      if (!parsed.success) problems.push(`${where}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      else problems.push(...checkVerdict(parsed.data, corpus).map((p) => `${where}: ${p}`));
    }
  }
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`${total} drafted answers ${JSON.stringify(counts)}, ${problems.length} without a verified quote, ${notFound} not found in the documents`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

function toVerdict(question: string, provider: string, answer: Answer): unknown {
  return {
    item: question,
    provider,
    verdict: answer.verdict,
    reasoning: answer.why,
    question: answer.question,
    evidence: (answer.evidence ?? []).map(([doc, page, quote]) => ({
      role: 'clause',
      doc_url: sources.get(doc)?.url ?? doc,
      page,
      quote,
      verified_on: sources.get(doc)?.verified_on ?? '',
    })),
  };
}
