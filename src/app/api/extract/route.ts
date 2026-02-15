import { NextRequest, NextResponse } from "next/server";
import { extractFromPDF } from "@/lib/llm-extractor";
import { validateExtraction } from "@/lib/validator";

const MAX_FILE_SIZE = parseInt(process.env.NEXT_PUBLIC_MAX_FILE_SIZE_MB || "20", 10) * 1024 * 1024;

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("files") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    return NextResponse.json(
      { error: `"${file.name}" is not a PDF file` },
      { status: 400 }
    );
  }

  if (file.size === 0) {
    return NextResponse.json(
      { error: `"${file.name}" is empty` },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `"${file.name}" exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit` },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const data = await extractFromPDF(buffer);
    const validation = validateExtraction(data);
    return NextResponse.json([{ filename: file.name, data, validation }]);
  } catch (error) {
    console.error("Extraction failed:", error);
    const message =
      error instanceof Error ? error.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
