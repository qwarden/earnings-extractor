import Anthropic from "@anthropic-ai/sdk";
import { ExtractedData } from "./types";
import { extractTextFromPDF } from "./pdf-parser";
import { EXTRACTION_PROMPT } from "@/prompts/extraction";

const client = new Anthropic();

const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514";

// Concurrency: text calls are cheap; vision calls are token-heavy and serialized.
const TEXT_CONCURRENCY = 3;
const VISION_CONCURRENCY = 1;
const POST_VISION_DELAY_MS = 5_000; // brief hold after each vision call to ease rate pressure

// Retry parameters for 429 rate-limit responses.
const RETRY_MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 15_000; // multiplied by attempt number (15s, 30s, 45s)
const RETRY_JITTER_MS = 5_000;      // random jitter added to avoid synchronized retries

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

const textSemaphore = new Semaphore(TEXT_CONCURRENCY);
const visionSemaphore = new Semaphore(VISION_CONCURRENCY);

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

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = RETRY_MAX_ATTEMPTS): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isRateLimit(error) && attempt < maxAttempts) {
        // Exponential backoff with jitter to avoid thundering herd
        const delay = RETRY_BASE_DELAY_MS * attempt + Math.random() * RETRY_JITTER_MS;
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
      model: CLAUDE_MODEL,
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
      model: CLAUDE_MODEL,
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
    await new Promise((r) => setTimeout(r, POST_VISION_DELAY_MS));
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
