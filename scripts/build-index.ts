// Builds cache/index.json from sources.json. Fails if any document changed since it was verified.
// After re-verifying a changed or new document, run with --record to store its sha256 and today's date.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INDEX_PATH, type Index } from '../src/corpus';
import { extractHtmlText, extractPdfPages } from '../src/extract';
import { loadSources, SOURCES_PATH, type Source } from '../src/sources';

const USER_AGENT = 'Kisui/0.1 (open-source fine-print checker; one fetch per document per build)';
const FETCH_TIMEOUT_MS = 60_000;
const RECORD = process.argv.includes('--record');
const TODAY = new Date().toLocaleDateString('sv-SE'); // local YYYY-MM-DD

const file = loadSources();
const index: Index = { built_on: TODAY, docs: {} };
const problems: string[] = [];

await Promise.all(file.sources.map(indexSource));

if (RECORD) writeFileSync(SOURCES_PATH, JSON.stringify(file, null, 2) + '\n');
writeFileSync(INDEX_PATH, JSON.stringify(index));
console.log(`indexed ${Object.keys(index.docs).length} of ${file.sources.length} sources`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

async function indexSource(source: Source) {
  try {
    const raw = await readRaw(source);
    if (!raw) {
      console.warn(`not indexed: ${source.id} (save it as policies/${source.id}.${source.format})`);
      return;
    }
    const pages =
      source.format === 'pdf' ? await extractPdfPages(new Uint8Array(raw)) : [extractHtmlText(raw.toString('utf8'), source.selector)];
    const sha256 = createHash('sha256').update(source.format === 'pdf' ? raw : pages.join('\n')).digest('hex');
    if (sha256 !== source.sha256) {
      if (!RECORD) {
        problems.push(`${source.id}: content differs from the version verified on ${source.verified_on ?? 'never'}; re-verify, then run with --record`);
        return;
      }
      Object.assign(source, { sha256, verified_on: TODAY, pages: pages.length });
    }
    index.docs[source.id] = pages;
    writePageTexts(source.id, pages);
  } catch (error) {
    problems.push(`${source.id}: ${(error as Error).message}`);
  }
}

async function readRaw(source: Source): Promise<Buffer | null> {
  const dir = source.access === 'manual' ? 'policies' : join('cache', 'docs');
  const path = join(dir, `${source.id}.${source.format}`);
  if (existsSync(path)) return readFileSync(path);
  if (source.access === 'manual') return null;
  const res = await fetch(source.url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${source.url}`);
  const raw = Buffer.from(await res.arrayBuffer());
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, raw);
  return raw;
}

function writePageTexts(id: string, pages: string[]) {
  const dir = join('cache', 'text', id);
  mkdirSync(dir, { recursive: true });
  pages.forEach((text, i) => writeFileSync(join(dir, `p${String(i + 1).padStart(3, '0')}.txt`), text));
}
