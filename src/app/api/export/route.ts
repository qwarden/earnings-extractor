import { NextRequest, NextResponse } from "next/server";
import { ExtractedData } from "@/lib/types";

interface ExportRow {
  data: ExtractedData;
}

const COLUMNS: { key: keyof ExtractedData; label: string }[] = [
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

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function POST(request: NextRequest) {
  const rows: ExportRow[] = await request.json();

  const header = COLUMNS.map((c) => c.label).join(",");

  const csvRows = rows.map((row) => {
    const dataCols = COLUMNS.map((c) => {
      const val = row.data[c.key];
      if (val === null || val === undefined) return "";
      if (c.key === "earnings_per_share" && typeof val === "number") {
        return `$${val.toFixed(2)}`;
      }
      if (c.key === "gross_margin" && typeof val === "number") {
        return `${Math.round(val * 100)}%`;
      }
      return escapeCSV(String(val));
    });

    return dataCols.join(",");
  });

  const csv = [header, ...csvRows].join("\n");

  const date = new Date().toISOString().slice(0, 10);
  const filename = `earnings_data_${date}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
