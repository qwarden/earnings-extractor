export const EXTRACTION_PROMPT = `You are extracting financial data from an earnings call transcript or quarterly update PDF.

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
