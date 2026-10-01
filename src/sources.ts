import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Source = {
  id: string;
  provider: string;
  kind: 'insurance' | 'rental' | 'rule';
  title: string;
  url: string;
  found_via?: string;
  format: 'pdf' | 'html';
  selector?: string;
  // manual: the site refused automated access; the owner saves the file as policies/<id>.<format>
  access: 'auto' | 'manual';
  country?: string;
  lang: string;
  sha256: string | null;
  verified_on: string | null;
  pages: number | null;
  note?: string;
};

export type SourcesFile = { sources: Source[] };

export const SOURCES_PATH = join(process.cwd(), 'sources.json');

export function loadSources(): SourcesFile {
  return JSON.parse(readFileSync(SOURCES_PATH, 'utf8')) as SourcesFile;
}
