import Anthropic from "@anthropic-ai/sdk";
import { ExtractedData } from "./types";
import { extractTextFromPDF } from "./pdf-parser";

const client = new Anthropic();

// Semaphore: limits how many Claude API calls run concurrently.
// Prevents thundering-herd rate limit hits when many files are uploaded at once.
class Semaphore {
  private queue: (() => void)[] = [];
  private running = 0;
  constructor(private concurrency: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
}

// Text calls: up to 3 concurrent. Vision calls: 1 at a time (token-heavy).
const textSemaphore = new Semaphore(3);
const visionSemaphore = new Semaphore(1);

const EXTRACTION_PROMPT = `You are extracting financial data from an earnings call transcript or quarterly update PDF.

Extract the following fields. If a field is not found, use null.
Format dollar amounts in human-readable shorthand (e.g., "$25.5B", "$924M"). Use the most precise unit that avoids unnecessary decimals: prefer "$924M" over "$0.9B", prefer "$1.2B" over "$1,200M". If the document presents numbers in a specific unit (e.g., "in millions" or "in thousands"), apply that scale and convert to shorthand.

Return ONLY valid JSON matching this schema, with no other text:
{
  "company_name": string | null,
  "quarter": string | null,
  "total_revenue": string | null,
  "earnings_per_share": string | null,
  "net_income": string | null,
  "operating_income": string | null,
  "gross_margin": string | null,
  "operating_expenses": string | null,
  "buybacks_and_dividends": string | null
}

Notes:
- For earnings_per_share, format as a dollar string (e.g., "$1.59"). Use the GAAP diluted EPS.
- For gross_margin, format as a percentage string (e.g., "50.6%"). Extract directly only if explicitly stated in the document. Do not calculate it from other fields.
- For net_income, extract directly only if explicitly stated in the document. Do not calculate it from other fields.
- For operating_income, extract GAAP operating income only if explicitly stated. Do not extract adjusted figures (e.g., "adjusted EBIT", "adjusted operating income"). Do not calculate it from other fields.
- For operating_expenses, extract directly only if explicitly stated in the document (e.g., "total operating expenses of $X", "total expenses were $X", "expenses of $X"). Do not calculate it from other fields.
- For buybacks_and_dividends, format as "$X Buybacks, $Y Dividends", omitting whichever is unknown. Use null if neither can be determined.
  * When total capital returned to shareholders and the buyback portion are both stated, calculate dividends = total − buybacks. E.g., "returned $2.8B to shareholders including $1.75B of buybacks" → "$1.75B Buybacks, $1.05B Dividends".
  * Only include aggregate dollar totals explicitly stated in the document. Ignore per-share dividend rates entirely — treat "15 cents per share" as if it were not there. Only a sentence like "paid $X in dividends" or "dividends totaled $X" counts.
- Use the most recent quarter's data if multiple quarters are shown.
- For company_name, use the common company name (e.g., "Amazon.com, Inc.", "Tesla, Inc."), not ticker symbols.

Example output for a company that returned $2.8B to shareholders including $1.75B of buybacks (dividends = $2.8B − $1.75B = $1.05B):
{
  "company_name": "Example Corp",
  "quarter": "Q1 2025",
  "total_revenue": "$21.6B",
  "earnings_per_share": "$1.96",
  "net_income": "$4.1B",
  "operating_income": null,
  "gross_margin": null,
  "operating_expenses": "$13.4B",
  "buybacks_and_dividends": "$1.75B Buybacks, $1.05B Dividends"
}`;

const FINANCIAL_FIELDS = [
  "total_revenue",
  "earnings_per_share",
  "net_income",
  "operating_income",
  "gross_margin",
  "operating_expenses",
  "buybacks_and_dividends",
] as const;

function needsFallback(data: ExtractedData): boolean {
  // Can't identify the company at all — vision may do better
  if (!data.company_name) return true;

  // If we found the company and at least 2 financial fields, text extraction worked.
  // Missing fields are simply absent from the transcript; vision won't find them either.
  const foundCount = FINANCIAL_FIELDS.filter(
    (f) => data[f] !== null && data[f] !== undefined
  ).length;
  return foundCount < 2;
}

function parseResponse(response: Anthropic.Message): ExtractedData {
  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  let parsed: ExtractedData;
  try {
    parsed = JSON.parse(textBlock.text) as ExtractedData;
  } catch {
    // Try to extract JSON from the response if it has surrounding text
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]) as ExtractedData;
      } catch {
        throw new Error(
          "Failed to parse extraction response as JSON"
        );
      }
    } else {
      throw new Error("Failed to parse extraction response as JSON");
    }
  }

  return parsed;
}

function isRateLimit(error: unknown): boolean {
  return error instanceof Anthropic.APIError && error.status === 429;
}

function throwAPIError(error: unknown): never {
  if (error instanceof Anthropic.APIError) {
    if (error.status === 401) {
      throw new Error(
        "Invalid Anthropic API key. Check your ANTHROPIC_API_KEY environment variable."
      );
    }
    if (error.status === 400) {
      throw new Error(`Claude API request error: ${error.message}`);
    }
    throw new Error(`Claude API error (${error.status}): ${error.message}`);
  }
  throw error;
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isRateLimit(error) && attempt < maxAttempts) {
        // Exponential backoff with jitter to avoid thundering herd
        const base = 15000 * attempt;
        const jitter = Math.random() * 5000;
        const delay = base + jitter;
        console.warn(`Rate limited — retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt}/${maxAttempts})`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throwAPIError(error);
      }
    }
  }
  throw new Error("Max retries exceeded");
}

async function extractFromText(text: string): Promise<ExtractedData> {
  return textSemaphore.run(() => withRetry(() =>
    client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `${EXTRACTION_PROMPT}\n\nTranscript:\n${text}`,
        },
      ],
    }).then(parseResponse)
  ));
}

async function extractFromFullPDF(pdfBuffer: Buffer): Promise<ExtractedData> {
  const base64PDF = pdfBuffer.toString("base64");

  return visionSemaphore.run(async () => {
    const result = await withRetry(() => client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64PDF,
              },
            },
            {
              type: "text",
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    }).then(parseResponse));
    // Hold the slot briefly so back-to-back vision calls don't jam the rate limit
    await new Promise((r) => setTimeout(r, 5000));
    return result;
  });
}

export async function extractFromPDF(
  pdfBuffer: Buffer
): Promise<ExtractedData> {
  // Try cheap text extraction first
  let text: string;
  try {
    text = await extractTextFromPDF(pdfBuffer);
  } catch {
    // pdf-parse failed entirely — go straight to full PDF
    console.warn("PDF text extraction failed, falling back to vision-based extraction");
    return extractFromFullPDF(pdfBuffer);
  }

  // If text is too short, it's likely an image-heavy PDF
  if (text.trim().length < 100) {
    console.warn("Extracted text too short (<100 chars), falling back to vision-based extraction");
    return extractFromFullPDF(pdfBuffer);
  }

  // Try extracting from text (cheap path)
  const result = await extractFromText(text);

  // If too many fields are missing, fall back to full PDF
  if (needsFallback(result)) {
    console.warn("Text extraction returned too many null fields, falling back to vision-based extraction");
    return extractFromFullPDF(pdfBuffer);
  }

  return result;
}
