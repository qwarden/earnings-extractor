"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ExtractedData, ValidationResult } from "@/lib/types";

interface ResultRow {
  filename: string;
  data: ExtractedData;
  validation?: ValidationResult;
}

interface EditingCell {
  row: number;
  field: keyof ExtractedData;
}

const FIELD_LABELS: { key: keyof ExtractedData; label: string }[] = [
  { key: "company_name", label: "Company Name" },
  { key: "quarter", label: "Quarter" },
  { key: "total_revenue", label: "Total Revenue" },
  { key: "earnings_per_share", label: "EPS" },
  { key: "net_income", label: "Net Income" },
  { key: "operating_income", label: "Operating Income" },
  { key: "gross_margin", label: "Gross Margin" },
  { key: "operating_expenses", label: "Operating Expenses" },
  { key: "buybacks_and_dividends", label: "Buybacks & Dividends" },
];

const NUMERIC_FIELDS: Set<keyof ExtractedData> = new Set([
  "earnings_per_share",
  "gross_margin",
]);

const MAX_FILE_SIZE_MB = 20;
const MAX_FILES_PER_REQUEST = 10;

export default function Home() {
  const [results, setResults] = useState<ResultRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogout = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  };

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const allFiles = Array.from(files);
    const pdfFiles = allFiles.filter((f) => f.type === "application/pdf");
    if (pdfFiles.length === 0) {
      setError("Please upload PDF files.");
      return;
    }

    if (pdfFiles.length > MAX_FILES_PER_REQUEST) {
      setError(`Maximum ${MAX_FILES_PER_REQUEST} files per upload.`);
      return;
    }

    const oversized = pdfFiles.filter(
      (f) => f.size > MAX_FILE_SIZE_MB * 1024 * 1024
    );
    if (oversized.length > 0) {
      setError(
        `Files too large (max ${MAX_FILE_SIZE_MB}MB): ${oversized.map((f) => f.name).join(", ")}`
      );
      return;
    }

    setProcessing(true);
    setFileCount(pdfFiles.length);
    setError(null);

    const formData = new FormData();
    pdfFiles.forEach((f) => formData.append("files", f));

    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Extraction failed");
      }

      const data: ResultRow[] = await res.json();
      setResults((prev) => [...prev, ...data]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setProcessing(false);
      setFileCount(0);
    }
  }, []);

  const handleExport = async () => {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        results.map((r) => ({ data: r.data, validation: r.validation }))
      ),
    });

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const disposition = res.headers.get("Content-Disposition") || "";
    const filenameMatch = disposition.match(/filename="(.+)"/);
    a.download = filenameMatch ? filenameMatch[1] : "earnings_data.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const commitEdit = (rowIndex: number, field: keyof ExtractedData, raw: string) => {
    setResults((prev) => {
      const updated = [...prev];
      const row = { ...updated[rowIndex], data: { ...updated[rowIndex].data } };

      if (raw.trim() === "") {
        row.data[field] = null as never;
      } else if (NUMERIC_FIELDS.has(field)) {
        const num = parseFloat(raw);
        row.data[field] = (isNaN(num) ? raw : num) as never;
      } else {
        row.data[field] = raw as never;
      }

      updated[rowIndex] = row;
      return updated;
    });
    setEditing(null);
  };

  const getRawValue = (key: keyof ExtractedData, value: unknown): string => {
    if (value === null || value === undefined) return "";
    return String(value);
  };

  const formatValue = (key: keyof ExtractedData, value: unknown) => {
    if (value === null || value === undefined) return "N/A";
    if (key === "earnings_per_share" && typeof value === "number") {
      return `$${value.toFixed(2)}`;
    }
    if (key === "gross_margin" && typeof value === "number") {
      return `${Math.round(value * 100)}%`;
    }
    return String(value);
  };

  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-semibold">Earnings Data Extractor</h1>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          Logout
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-8">
        Upload earnings call PDFs to extract financial data into a structured
        table.
      </p>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      {/* Upload zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-gray-400"
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        {processing ? (
          <div className="text-gray-500">
            <div className="animate-spin inline-block w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full mb-3" />
            <p>
              Extracting data from {fileCount}{" "}
              {fileCount === 1 ? "PDF" : "PDFs"}...
            </p>
          </div>
        ) : (
          <div className="text-gray-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mx-auto mb-3 text-gray-400"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-lg mb-1">
              Drop PDF files here or click to upload
            </p>
            <p className="text-sm">
              Up to {MAX_FILES_PER_REQUEST} PDFs, {MAX_FILE_SIZE_MB}MB each
            </p>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mt-4 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600 shrink-0"
            aria-label="Dismiss error"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Results cards */}
      {results.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">
              Extracted Data ({results.length}{" "}
              {results.length === 1 ? "file" : "files"})
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setResults([])}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Clear
              </button>
              <button
                onClick={handleExport}
                className="px-4 py-2 bg-black text-white text-sm rounded hover:bg-gray-800 transition-colors"
              >
                Export CSV
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {results.map((row, i) => {
              const v = row.validation;
              const hasErrors = v && v.errors.length > 0;
              const hasWarnings = v && v.warnings.length > 0;
              return (
                <div
                  key={i}
                  className="border border-gray-200 rounded-lg overflow-hidden"
                >
                  {/* Card header */}
                  <div
                    className={`flex items-center justify-between px-5 py-3 border-b ${
                      hasErrors
                        ? "bg-red-50 border-red-200"
                        : hasWarnings
                          ? "bg-yellow-50 border-yellow-200"
                          : "bg-gray-50 border-gray-200"
                    }`}
                  >
                    <span className="text-sm font-medium text-gray-700 truncate">
                      {row.filename}
                    </span>
                    {v && (hasErrors || hasWarnings) ? (
                      <details className="cursor-pointer">
                        <summary
                          className={`text-xs font-medium ${
                            hasErrors ? "text-red-600" : "text-yellow-600"
                          }`}
                        >
                          {hasErrors
                            ? `${v.errors.length} error${v.errors.length > 1 ? "s" : ""}`
                            : `${v.warnings.length} warning${v.warnings.length > 1 ? "s" : ""}`}
                        </summary>
                        <ul className="mt-1 text-xs space-y-0.5 absolute bg-white border rounded-lg p-3 shadow-md z-10 max-w-xs">
                          {v.errors.map((e, j) => (
                            <li key={`e-${j}`} className="text-red-600">
                              {e}
                            </li>
                          ))}
                          {v.warnings.map((w, j) => (
                            <li key={`w-${j}`} className="text-yellow-600">
                              {w}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <span className="text-xs text-green-600 font-medium">
                        OK
                      </span>
                    )}
                  </div>

                  {/* Card body — two-column label/value grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0">
                    {FIELD_LABELS.map((f, fi) => {
                      const isEditing =
                        editing?.row === i && editing?.field === f.key;
                      return (
                        <div
                          key={f.key}
                          className={`flex justify-between items-center px-5 py-2.5 text-sm ${
                            fi < FIELD_LABELS.length - 1
                              ? "sm:border-b border-gray-100"
                              : ""
                          } ${fi % 2 === 0 && fi < FIELD_LABELS.length - 1 ? "sm:border-r border-gray-100" : ""}`}
                        >
                          <span className="text-gray-500 shrink-0 mr-3">
                            {f.label}
                          </span>
                          {isEditing ? (
                            <input
                              autoFocus
                              defaultValue={getRawValue(
                                f.key,
                                row.data[f.key]
                              )}
                              className="font-medium text-right w-full min-w-0 bg-white border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              onBlur={(e) =>
                                commitEdit(i, f.key, e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  commitEdit(
                                    i,
                                    f.key,
                                    e.currentTarget.value
                                  );
                                } else if (e.key === "Escape") {
                                  setEditing(null);
                                }
                              }}
                            />
                          ) : (
                            <span
                              className="font-medium text-right cursor-pointer hover:bg-gray-100 rounded px-2 py-0.5 -mr-2 transition-colors"
                              title="Click to edit"
                              onClick={() =>
                                setEditing({ row: i, field: f.key })
                              }
                            >
                              {formatValue(f.key, row.data[f.key])}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
