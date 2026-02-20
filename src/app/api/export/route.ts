import { NextRequest, NextResponse } from "next/server";
import { ExtractedData } from "@/lib/types";
import { FIELDS } from "@/lib/constants";

interface ExportRow {
  data: ExtractedData;
}

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function POST(request: NextRequest) {
  const rows: ExportRow[] = await request.json();

  const header = FIELDS.map((c) => c.label).join(",");

  const csvRows = rows.map((row) => {
    const dataCols = FIELDS.map((c) => {
      const val = row.data[c.key];
      if (val === null || val === undefined) return "";
      return escapeCSV(String(val));
    });

    return dataCols.join(",");
  });

  const csv = [header, ...csvRows].join("\n");

  const date = new Date().toISOString().slice(0, 10);
  const id = Math.random().toString(36).slice(2, 6);
  const filename = `earnings_data_${date}_${id}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
