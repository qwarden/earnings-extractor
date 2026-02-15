import { ExtractedData, ValidationResult } from "./types";

/**
 * Parse a financial string like "$22.5B", "$150M", "$8.3 billion" into a number.
 * Returns null if unparseable.
 */
function parseFinancialString(value: string | null): number | null {
  if (!value) return null;

  const cleaned = value.replace(/[,$]/g, "").trim().toLowerCase();

  const match = cleaned.match(/^(-?\d+\.?\d*)\s*(trillion|billion|million|t|b|m)?$/);
  if (!match) return null;

  const num = parseFloat(match[1]);
  const suffix = match[2];

  const multipliers: Record<string, number> = {
    t: 1e12,
    trillion: 1e12,
    b: 1e9,
    billion: 1e9,
    m: 1e6,
    million: 1e6,
  };

  return num * (suffix ? multipliers[suffix] || 1 : 1);
}

export function validateExtraction(data: ExtractedData): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Required fields
  if (!data.company_name) errors.push("Missing company name");
  if (!data.quarter) errors.push("Missing quarter");

  // Gross margin range — parse string like "50.5%" or "0.505"
  if (data.gross_margin) {
    const gmStr = data.gross_margin.trim();
    let gm: number | null = null;
    if (gmStr.endsWith("%")) {
      gm = parseFloat(gmStr.slice(0, -1));
      if (!isNaN(gm)) gm = gm / 100;
    } else {
      gm = parseFloat(gmStr);
    }
    if (gm !== null && !isNaN(gm) && (gm < 0 || gm > 1)) {
      warnings.push(
        `Gross margin ${data.gross_margin} outside expected range 0-100%`
      );
    }
  }

  // EPS sanity — parse string like "$1.59" or "1.59"
  if (data.earnings_per_share) {
    const epsNum = parseFloat(data.earnings_per_share.replace(/[$,\s]/g, ""));
    if (!isNaN(epsNum) && Math.abs(epsNum) > 100) {
      warnings.push(
        `EPS of ${data.earnings_per_share} seems unusually high`
      );
    }
  }

  // Revenue should be positive
  const revenue = parseFinancialString(data.total_revenue);
  if (revenue !== null && revenue < 0) {
    warnings.push("Total revenue is negative");
  }

  // Net income should not exceed revenue
  const netIncome = parseFinancialString(data.net_income);
  if (revenue !== null && netIncome !== null && netIncome > revenue) {
    warnings.push("Net income exceeds total revenue");
  }

  // Check if we got basically no financial data
  const financialFields = [
    data.total_revenue,
    data.earnings_per_share,
    data.net_income,
    data.operating_income,
    data.gross_margin,
    data.operating_expenses,
    data.buybacks_and_dividends,
  ];
  const filledCount = financialFields.filter(
    (f) => f !== null && f !== undefined
  ).length;
  if (filledCount === 0) {
    warnings.push("No financial data was extracted");
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
