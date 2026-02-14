import Anthropic from "@anthropic-ai/sdk";
import { ExtractedData } from "./types";
import { extractTextFromPDF } from "./pdf-parser";

const client = new Anthropic();

const EXTRACTION_PROMPT = `You are extracting financial data from an earnings call transcript or quarterly update PDF.

Extract the following fields. If a field is not found, use null.
Preserve the original formatting from the document (e.g., "$22.5B" not "22500000000").

Return ONLY valid JSON matching this schema, with no other text:
{
  "company_name": string | null,
  "quarter": string | null,
  "total_revenue": string | null,
  "earnings_per_share": number | null,
  "net_income": string | null,
  "operating_income": string | null,
  "gross_margin": number | null,
  "operating_expenses": string | null,
  "buybacks_and_dividends": string | null
}

Notes:
- For earnings_per_share, use the GAAP diluted EPS as a number (e.g., 1.59).
- For gross_margin, express as a decimal between 0 and 1 (e.g., 0.505 for 50.5%). If gross margin is not explicitly stated, calculate it as (total revenue - cost of sales) / total revenue.
- For buybacks_and_dividends, combine both if available (e.g., "$2.0B Buybacks, $0 Dividends"). Use null if neither is mentioned.
- Use the most recent quarter's data if multiple quarters are shown.
- For company_name, use the common company name (e.g., "Amazon.com, Inc.", "Tesla, Inc."), not ticker symbols.

Example output for Amazon Q1 2025 (net sales $155.7B, cost of sales $77.0B, so gross margin = (155.7-77.0)/155.7 ≈ 0.505):
{
  "company_name": "Amazon.com, Inc.",
  "quarter": "Q1 2025",
  "total_revenue": "$155.7B",
  "earnings_per_share": 1.59,
  "net_income": "$17.1B",
  "operating_income": "$18.4B",
  "gross_margin": 0.505,
  "operating_expenses": "$137.3B",
  "buybacks_and_dividends": null
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
  if (!data.company_name) return true;

  const nullCount = FINANCIAL_FIELDS.filter(
    (f) => data[f] === null || data[f] === undefined
  ).length;
  return nullCount >= 4;
}

function normalizeNumericField(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    // Strip dollar signs, commas, whitespace
    const cleaned = value.replace(/[$,\s]/g, "").trim();
    if (cleaned === "") return null;
    // Handle percentage strings like "46%" → 0.46
    if (cleaned.endsWith("%")) {
      const num = parseFloat(cleaned.slice(0, -1));
      return isNaN(num) ? null : num / 100;
    }
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}

function normalizeExtraction(raw: ExtractedData): ExtractedData {
  const data = { ...raw };

  // EPS: ensure plain number, strip $ if present
  data.earnings_per_share = normalizeNumericField(data.earnings_per_share);

  // Gross margin: ensure decimal 0-1, convert from percentage if needed
  let gm = normalizeNumericField(data.gross_margin);
  if (gm !== null && gm > 1) {
    gm = gm / 100;
  }
  data.gross_margin = gm;

  return data;
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

  return normalizeExtraction(parsed);
}

function handleAPIError(error: unknown): never {
  if (error instanceof Anthropic.APIError) {
    if (error.status === 429) {
      throw new Error(
        "Claude API rate limit exceeded. Please wait a moment and try again."
      );
    }
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

async function extractFromText(text: string): Promise<ExtractedData> {
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `${EXTRACTION_PROMPT}\n\nTranscript:\n${text}`,
        },
      ],
    });

    return parseResponse(response);
  } catch (error) {
    handleAPIError(error);
  }
}

async function extractFromFullPDF(pdfBuffer: Buffer): Promise<ExtractedData> {
  const base64PDF = pdfBuffer.toString("base64");

  try {
    const response = await client.messages.create({
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
    });

    return parseResponse(response);
  } catch (error) {
    handleAPIError(error);
  }
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
