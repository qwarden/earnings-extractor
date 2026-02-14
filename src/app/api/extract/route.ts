import { NextRequest, NextResponse } from "next/server";
import { extractFromPDF } from "@/lib/llm-extractor";
import { validateExtraction } from "@/lib/validator";
import { processBatch } from "@/lib/concurrency";

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || "20", 10) * 1024 * 1024;
const MAX_FILES = parseInt(process.env.MAX_FILES_PER_REQUEST || "10", 10);

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const files = formData.getAll("files") as File[];

  if (files.length === 0) {
    return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  }

  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Maximum ${MAX_FILES} files per request` },
      { status: 400 }
    );
  }

  // Validate each file
  for (const file of files) {
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
  }

  try {
    const results = await processBatch(files, async (file) => {
      const buffer = Buffer.from(await file.arrayBuffer());
      const data = await extractFromPDF(buffer);
      const validation = validateExtraction(data);
      return { filename: file.name, data, validation };
    });

    return NextResponse.json(results);
  } catch (error) {
    console.error("Extraction failed:", error);
    const message =
      error instanceof Error ? error.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
