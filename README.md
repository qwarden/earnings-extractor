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

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude |
| `APP_PASSWORD` | No | — | If set, enables password login |
| `APP_SECRET` | No | `APP_PASSWORD` | Secret for signing session cookies |
| `RATE_LIMIT_MAX` | No | `20` | Max extraction requests per IP per window |
| `RATE_LIMIT_WINDOW_MS` | No | `3600000` | Rate limit window (default 1 hour) |
| `MAX_FILE_SIZE_MB` | No | `20` | Max upload size per file |
| `MAX_FILES_PER_REQUEST` | No | `10` | Max files per upload batch |
| `MAX_CONCURRENT_EXTRACTIONS` | No | `3` | Concurrent Claude API calls |

## Approach

This project was built with heavy use of Claude Code (Anthropic's AI coding tool). I used it to scaffold, implement, and iterate on the entire codebase. My role was directing the approach, making product decisions, reviewing output, and catching issues — essentially working like a tech lead with a very fast junior engineer.

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
│   ├── POST /api/extract — accepts PDFs, returns extracted JSON
│   ├── POST /api/export  — accepts JSON, returns CSV
│   └── POST/DELETE /api/auth — session management
├── Core
│   ├── pdf-parser.ts    — pdf-parse text extraction
│   ├── llm-extractor.ts — Claude API with text→vision fallback
│   ├── validator.ts     — financial data sanity checks
│   └── concurrency.ts   — worker pool for batch processing
└── Proxy (proxy.ts)
    ├── Auth guard (redirects unauthenticated users)
    └── Rate limiting on /api/extract
```

## Product Decisions

- **Inline editing before export**: LLM extraction won't be 100% accurate. Rather than forcing users to fix things in Excel after the fact, they can click any value and correct it in the browser before exporting. This felt important given the client's team is currently doing manual data entry — the tool should reduce their work, not create a different kind of it.

- **Card layout instead of a wide table**: 9+ data columns in a table means horizontal scrolling. Cards show one file per card with a label/value grid that's easier to scan.

- **CSV export matching the client's format**: Column headers and value formatting (EPS as `$1.59`, gross margin as `51%`) match the style of the provided sample spreadsheet. CSV was chosen over XLSX because it opens everywhere and doesn't require extra dependencies.

- **Password auth**: The problem statement mentions a single client team. A shared password is appropriate for that scope — no need for a user management system.

## What I'd Do With More Time

- **Accuracy benchmarking**: Run the tool against all sample PDFs, compare output to manually verified values, and measure field-level accuracy. This is how I'd prove the 90% target and identify which fields need prompt tuning.

- **Confidence scoring**: Have the LLM flag fields it's uncertain about so the UI can highlight them for manual review. Right now every field looks the same whether the model is confident or guessing.

- **Result persistence**: Currently results are lost on page refresh. Adding a simple database (SQLite or similar) would let users come back to previous extractions.

- **Streaming progress**: Right now the UI shows a spinner until all files in a batch are done. Streaming individual file results as they complete would be a better experience for larger batches.

- **More validation**: Cross-check relationships between fields (e.g., operating income should be less than revenue, operating expenses + operating income should roughly equal revenue). Flag extractions that don't pass basic accounting identities.

- **Per-company prompt tuning**: Different companies present data differently. With enough examples, you could detect the company format and use a tailored prompt.

## Open Questions

Things I'd want to clarify before building further:

- **How many people will use this, and how often?** A small team uploading a few PDFs a week is a very different product than multiple teams processing hundreds. Affects whether in-memory storage is fine or if we need a real database, job queue, etc.
- **Where does this get deployed?** Their own servers, a cloud provider, someone's machine? Determines how much infrastructure work is needed beyond the Docker container.
- **Is CSV output sufficient, or do they need Excel specifically?** The sample output was an `.xlsx` file. CSV opens in Excel but doesn't support cell formatting, multiple sheets, etc.
- **How is 90% accuracy measured?** Per field, per file, or overall? Who decides what the "correct" value is? Some fields are ambiguous (e.g., gross margin isn't always stated and has to be calculated).
- **Any concerns about sending earnings data to an external API?** The tool sends PDF content to Anthropic's Claude API for extraction. If this data is sensitive or pre-release, that might be a compliance issue worth discussing.
- **Do they need an audit trail?** Who extracted what, when, and what edits were made before export. Important for finance teams in regulated environments.
