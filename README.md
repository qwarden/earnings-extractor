# Earnings Data Extractor

A web tool that extracts financial data from earnings call PDFs into structured, exportable tables. Upload transcripts, review and correct the extracted data, and download as CSV.

## Running It

```bash
# Local
npm install
cp .env.example .env   # add your ANTHROPIC_API_KEY
npm run dev

# Docker
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000), upload a PDF, and the tool extracts company name, quarter, revenue, EPS, net income, operating income, gross margin, operating expenses, and buyback/dividend info.

Sample earnings PDFs are in the `samples/` folder for testing.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude |
| `APP_PASSWORD` | No | — | If set, enables password login |
| `APP_SECRET` | No | `APP_PASSWORD` | Secret for signing session cookies |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-20250514` | Claude model used for extraction |

## Approach

This project was built with heavy use of Claude Code (Anthropic's AI coding tool). I used it to scaffold, implement, and iterate on the entire codebase. My role was directing the approach, making product decisions, reviewing output, and catching issues.

**Why LLM extraction:** The input is unstructured — earnings call transcripts and quarterly update PDFs with varying formats across companies. There's no consistent template to parse against. LLM extraction felt like the only realistic path for handling that kind of variability without building per-company parsers.

**How it works:**

1. PDF text is extracted server-side using `pdf-parse`
2. The text is sent to Claude with a structured prompt asking for specific financial fields as JSON
3. If text extraction fails or returns too many empty fields, the tool falls back to sending the full PDF to Claude's document understanding (more expensive, but handles image-heavy or complex-layout PDFs)
4. Results go through validation (sanity checks on ranges, required fields)
5. The user can review, edit any value inline, and export to CSV

## Architecture

```
Next.js App (TypeScript, Tailwind CSS)
├── Frontend
│   ├── Login page (optional, password-gated)
│   ├── Upload zone (drag-drop, multi-file)
│   ├── Result cards (editable fields, validation badges)
│   └── CSV export
├── API Routes
│   ├── POST /api/extract — accepts a PDF, returns extracted JSON
│   ├── POST /api/export  — accepts JSON, returns CSV
│   └── POST/DELETE /api/auth — session management
├── Core
│   ├── pdf-parser.ts        — pdf-parse text extraction
│   ├── llm-extractor.ts     — Claude API with text→vision fallback
│   ├── validator.ts         — financial data sanity checks
│   └── prompts/extraction.ts — LLM extraction prompt
├── Middleware (middleware.ts)
│   └── Auth guard (redirects unauthenticated users)
└── scripts/
    ├── verify.py        — accuracy verification against ground truth
    └── ground-truth.csv — manually verified extraction results for 10 sample PDFs
```

## Product Decisions

- **Inline editing before export**: LLM extraction won't be 100% accurate. Rather than forcing users to fix things in Excel after the fact, they can click any value and correct it in the browser before exporting. This felt important given the client's team is currently doing manual data entry — the tool should reduce their work, not create a different kind of it.

- **Text-first extraction with vision fallback**: The tool tries cheap text extraction first, then falls back to sending the full PDF to Claude's document understanding only when needed (text too short, or too many fields came back empty). This keeps API costs low for well-formatted transcripts while still handling image-heavy or complex-layout PDFs.

- **Password auth**: The problem statement mentions a single client team. A shared password is appropriate for that scope.

- **Per-file progress tracking**: Extraction takes 10–30 seconds per file, so each file shows its own status rather than a single spinner for the whole batch. Up to 5 files process concurrently.

- **Retry with backoff on rate limits**: Claude API calls automatically retry up to 3 times with increasing delays (15s, 30s, 45s) when a 429 is returned. This matters because vision-based PDF processing is token-heavy and can hit API rate limits mid-batch.

- **Friendly error surfacing**: Server-side errors (rate limits, API failures) are translated into plain-language messages shown next to the file that failed, rather than only appearing in server logs.

- **Interrupted upload recovery**: If the page reloads mid-processing, incomplete files are marked as "Interrupted" with a Retry button. A lightweight alternative to a server-side job queue, which would be overkill for this use case.

## Deployment

The app is Dockerized and can be hosted on any managed cloud platform. Recommended path for a fully-managed off-prem setup:

**Vercel** (simplest for Next.js): connect the repo, set environment variables in the dashboard, and deploy. No infrastructure to manage. Scales automatically.

**Docker on cloud** (more control): the included `Dockerfile` and `docker-compose.yml` run on AWS ECS, GCP Cloud Run, or any container-hosting service. For a team of 10, a single small instance is sufficient — extractions are API-bound, not compute-bound.

Either way, only two environment variables are needed in production:

```
ANTHROPIC_API_KEY=sk-ant-...
APP_PASSWORD=...
APP_SECRET=...   # random secret for signing session cookies
```

**Rate limits**: with 10 analysts potentially processing batches simultaneously, the Anthropic API's tokens-per-minute limit is the main constraint. The app handles this with a concurrency semaphore and automatic retry with backoff, but for heavy usage a higher API tier is recommended (request via the [Anthropic Console](https://console.anthropic.com/) under Settings → Limits).

## Authentication

The current demo uses a single shared password. For production with 10 named analysts, the right approach is individual accounts:

- **Short term**: provision individual API keys or use an identity provider with SSO (Google Workspace, Okta, etc.) via a library like NextAuth.js. This adds per-user login without building auth from scratch.
- **Longer term**: per-user accounts backed by a database enable audit trails, per-user extraction history, and role-based access if needed.

The current auth infrastructure (session cookies, proxy guard) is designed to slot a real identity provider in without changes to the rest of the app.

## Accuracy

Measured on a test set of 10 earnings PDFs (mix of call transcripts and press releases) against manually verified ground truth:

**~95% field-level accuracy** across 9 fields × 10 documents.

Methodology: each extracted field is compared semantically against the ground truth (e.g., "$17.1B" and "$17.1 billion" are treated as equivalent). A field is correct if it matches or is intentionally null (field not present in the source document).

Fields extracted: Company Name, Quarter, Total Revenue, EPS, Net Income, Operating Income, Gross Margin, Operating Expenses, Buybacks & Dividends.

Key factors affecting accuracy:
- **Press releases outperform call transcripts**: press releases contain structured income statement tables with explicit values. Pure call transcripts often omit fields like EPS and gross margin.
- **Only explicitly stated values are extracted**: the tool does not derive or calculate values from other fields (except one case: dividends inferred from total capital returned minus buybacks). This avoids plausible-looking hallucinations at the cost of leaving some fields blank.
- **Vision fallback for image-heavy PDFs**: PDFs that don't yield usable text are sent to Claude's document understanding API, which reads the full PDF visually. This recovers data from scanned or complex-layout documents but is slower and more expensive.

Without access to your historical data we can't measure accuracy on your specific corpus, but the extraction logic is prompt-driven and can be tuned as new document formats are encountered.

## Cost

API costs are low relative to analyst labor. Rough estimates at current Anthropic pricing:

- Text-path extraction (most transcripts): ~$0.01–0.03 per PDF
- Vision-path extraction (image-heavy PDFs): ~$0.05–0.15 per PDF

At 10 analysts processing, say, 20 PDFs each per week: ~200 PDFs/week → roughly $2–30/week in API costs. Compared to 200 × 30 min × $50/hr = $5,000/week in analyst time for manual entry, the tool pays for itself on the first document.

## Known Limitations

- **Per-share dividend rates in vision fallback**: When a transcript only mentions dividends as a per-share rate (e.g., "15 cents per share") and text extraction yields too few fields to skip the vision fallback, the vision model may compute an aggregate total using its parametric knowledge of the company's share count. This produces a plausible-looking but hallucinated dollar figure. The prompt instructs the model to ignore per-share rates, but this instruction is less reliable in the vision path. Affected: transcripts like Ford's that have minimal financial data. Mitigation: use the earnings press release PDF instead of the call transcript.

## What I'd Do With More Time

- **Individual authentication**: Replace the shared password with per-user accounts via NextAuth.js (Google Workspace SSO or email/password). Required for audit trails and any compliance use case.

- **Audit trail**: Log every extraction — user, timestamp, source PDF, extracted values, and any manual edits before export. A simple append-only database table covers this. Useful for accountability and for catching systematic extraction errors over time.

- **Confidence scoring**: Have the LLM flag fields it's uncertain about so the UI can highlight them for manual review. Right now every field looks the same whether the model is confident or guessing.

- **Full result persistence**: Completed results survive a reload via localStorage, but there's no durable storage. A simple database (SQLite or similar) would let users come back to previous extractions across sessions and devices.

- **More validation**: Cross-check relationships between fields (e.g., operating income should be less than revenue). Flag extractions that don't pass basic accounting identities.