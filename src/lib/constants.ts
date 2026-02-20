import { ExtractedData } from "./types";

export const MAX_FILE_SIZE_MB = 20;
export const MAX_FILES_PER_REQUEST = 10;

export const FIELDS: { key: keyof ExtractedData; label: string }[] = [
  { key: "company_name", label: "Company Name" },
  { key: "quarter", label: "Quarter" },
  { key: "total_revenue", label: "Total revenue" },
  { key: "earnings_per_share", label: "Earnings per share" },
  { key: "net_income", label: "Net income" },
  { key: "operating_income", label: "Operating income" },
  { key: "gross_margin", label: "Gross margin" },
  { key: "operating_expenses", label: "Operating expenses" },
  { key: "buybacks_and_dividends", label: "Buybacks and dividends" },
];
