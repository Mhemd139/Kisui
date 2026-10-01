# Kisui (כיסוי)

Reads the fine print of travel insurance and car rental for your exact trip, and shows the clause behind every answer.

Tell it once, in Hebrew, Arabic or English: your age, licence, cards, route, dates and activities. For each item you get:

- ✅ covered or allowed
- ⚠ needs an extension, a fee or a condition
- ❌ excluded or not allowed
- ❓ unclear: you get a ready question to send the provider, and their written answer becomes your proof in a claim

Every verdict shows its evidence chain: your fact → the clause → the definition or linked list it points to → the verdict, with the quote and the page. Kisui shows what each provider's own documents say. It never ranks providers or tells you what to buy.

Built first for Israeli travellers: Israeli travel insurers, and rental companies in Italy.

## The rule: no clause, no verdict

`record_verdict` rejects any verdict unless every piece of evidence has a `quote`, `doc_url`, `page` and `verified_on`, and the quote is actually found on that page of an indexed document. The agent may only show verdicts the server accepted.

## How it works

- [`skills/kisui/SKILL.md`](skills/kisui/SKILL.md) holds the reasoning steps (an [Agent Skill](https://agentskills.io)): take the trip profile once, find the clauses, follow every cross-reference, record the verdict, answer.
- An MCP server does the mechanical part, over Streamable HTTP at `/mcp`:

| Tool | Does |
|---|---|
| `list_sources` | Lists the documents it can quote, with link, sha256 and verified-on date |
| `search_clauses` | Finds lines by words (Hebrew-aware: niqqud, final letters and punctuation are ignored) |
| `get_clause` | Returns a line with its context, ready to cite |
| `record_verdict` | Checks a verdict against the rule above and returns the accepted record |

## Sources

[`sources.json`](sources.json) lists every document: the link on the provider's own site, the sha256 of what was verified, and the date. The documents and their text are never committed. They are fetched and indexed at build time, and the build fails if a document changed since it was verified.

When a site refuses automated access, Kisui does not work around it. The source is marked `"access": "manual"` and the owner saves the file by hand as `policies/<id>.<format>` (never committed).

Hebrew PDFs are extracted with [unpdf](https://github.com/unjs/unpdf) (pdf.js). Lines are rebuilt right to left and checked against known lines in the tests.

## Run it

Node 20 or later.

```bash
npm install
```

```bash
npm run index
```

```bash
npm run dev
```

The server is then at `http://localhost:3000/mcp`. Add it as an MCP server in your client, for example in Claude Code:

```bash
claude mcp add --transport http kisui http://localhost:3000/mcp
```

After re-verifying a changed or new document, record its new hash and today's date:

```bash
npm run index -- --record
```

## Deploy

It is a Next.js app with one route, `app/mcp/route.ts`, built on [mcp-handler](https://github.com/vercel/mcp-handler). On Vercel, `npm run build` runs `npm run index` first, so the index is built from the providers' sites at deploy time. Manual sources are not available there unless you add them another way.

## Tests and eval

```bash
npm test
```

Tests cover the rejection rule (directly and through the MCP tools) and Hebrew extraction on a real policy (run `npm run index` first).

```bash
npm run eval
```

[`eval/insurance.yaml`](eval/insurance.yaml) and [`eval/rental.yaml`](eval/rental.yaml) hold draft answers per provider, each with quotes. They are **unreviewed drafts, not ground truth**, so no accuracy number is reported. `npm run eval` checks only that every quote is found on its cited page.

## Not advice

Kisui quotes documents; it does not give insurance advice or recommend a provider. Documents change, and a quote can be read in more than one way. Confirm anything that matters with the provider, in writing, before you buy or travel.
