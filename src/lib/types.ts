export interface ExtractedData {
  company_name: string | null;
  quarter: string | null;
  total_revenue: string | null;
  earnings_per_share: number | null;
  net_income: string | null;
  operating_income: string | null;
  gross_margin: number | null;
  operating_expenses: string | null;
  buybacks_and_dividends: string | null;
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}
