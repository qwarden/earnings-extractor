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
| `NEXT_PUBLIC_MAX_FILE_SIZE_MB` | No | `20` | Max upload size per file |

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
│   ├── pdf-parser.ts    — pdf-parse text extraction
│   ├── llm-extractor.ts — Claude API with text→vision fallback
│   └── validator.ts     — financial data sanity checks
└── Proxy (proxy.ts)
    └── Auth guard (redirects unauthenticated users)
```

## Product Decisions

- **Inline editing before export**: LLM extraction won't be 100% accurate. Rather than forcing users to fix things in Excel after the fact, they can click any value and correct it in the browser before exporting. This felt important given the client's team is currently doing manual data entry — the tool should reduce their work, not create a different kind of it.

- **Text-first extraction with vision fallback**: The tool tries cheap text extraction first, then falls back to sending the full PDF to Claude's document understanding only when needed (text too short, or too many fields came back empty). This keeps API costs low for well-formatted transcripts while still handling image-heavy or complex-layout PDFs.

- **Password auth**: The problem statement mentions a single client team. A shared password is appropriate for that scope.

- **Per-file progress tracking**: Extraction takes 10–30 seconds per file, so each file shows its own status rather than a single spinner for the whole batch. Up to 5 files process concurrently.

- **Friendly error surfacing**: Server-side errors (rate limits, API failures) are translated into plain-language messages shown next to the file that failed, rather than only appearing in server logs.

- **Interrupted upload recovery**: If the page reloads mid-processing, incomplete files are marked as "Interrupted" with a Retry button. A lightweight alternative to a server-side job queue, which would be overkill for this use case.

## What I'd Do With More Time

- **Confidence scoring**: Have the LLM flag fields it's uncertain about so the UI can highlight them for manual review. Right now every field looks the same whether the model is confident or guessing.

- **Full result persistence**: Completed results survive a reload via localStorage, but there's no durable storage. A simple database (SQLite or similar) would let users come back to previous extractions across sessions and devices.

- **More validation**: Cross-check relationships between fields (e.g., operating income should be less than revenue, operating expenses + operating income should roughly equal revenue). Flag extractions that don't pass basic accounting identities.