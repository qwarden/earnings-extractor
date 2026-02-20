"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ExtractedData, ValidationResult } from "@/lib/types";

interface ResultRow {
  id: string;
  filename: string;
  data: ExtractedData;
  validation?: ValidationResult;
}

interface FileProgress {
  filename: string;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
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

const MAX_FILE_SIZE_MB = parseInt(process.env.NEXT_PUBLIC_MAX_FILE_SIZE_MB || "20", 10);
const MAX_FILES_PER_REQUEST = 10;
const RESULTS_KEY = "extractionResults";
const PROGRESS_KEY = "extractionProgress";

function saveResults(data: ResultRow[]) {
  try { localStorage.setItem(RESULTS_KEY, JSON.stringify(data)); } catch {}
}

function saveProgress(data: FileProgress[]) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(data)); } catch {}
}

function friendlyError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429"))
    return "Rate limited — please wait a moment and try again";
  if (lower.includes("401") || lower.includes("api key") || lower.includes("unauthorized"))
    return "API authentication error — check server configuration";
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "Request timed out — try again";
  if (lower.includes("network")) return "Network error — check your connection";
  if (lower.includes("parse") || lower.includes("json"))
    return "Failed to parse extraction results";
  const cleaned = msg.replace(/\{[\s\S]*\}/g, "").trim();
  if (cleaned.length > 120) return cleaned.slice(0, 117) + "...";
  return cleaned || "Extraction failed";
}

function formatValue(_key: keyof ExtractedData, value: unknown) {
  if (value === null || value === undefined) return "N/A";
  return String(value);
}

export default function Home() {
  const [results, setResults] = useState<ResultRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [fileProgress, setFileProgress] = useState<FileProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const newIdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore persisted state on mount
  useEffect(() => {
    try {
      const savedResults = localStorage.getItem(RESULTS_KEY);
      if (savedResults) {
        const parsed: ResultRow[] = JSON.parse(savedResults);
        setResults(parsed.map((r) => ({ ...r, id: r.id ?? crypto.randomUUID() })));
      }
    } catch {}

    try {
      const savedProgress = localStorage.getItem(PROGRESS_KEY);
      if (savedProgress) {
        const restored: FileProgress[] = JSON.parse(savedProgress);
        const updated = restored.map((fp) =>
          fp.status !== "done"
            ? { ...fp, status: "error" as const, error: "Interrupted — re-upload to retry" }
            : fp
        );
        if (updated.length > 0) {
          setFileProgress(updated);
          saveProgress(updated);
        }
      }
    } catch {}
  }, []);

  // Warn before navigating away during processing
  useEffect(() => {
    if (!processing) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [processing]);

  const handleLogout = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  };

  const updateFileProgress = useCallback(
    (index: number, update: Partial<FileProgress>) => {
      setFileProgress((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...update };
        saveProgress(next);
        return next;
      });
    },
    []
  );

  const processOneFile = useCallback(
    async (file: File, index: number, id: string): Promise<ResultRow | null> => {
      const formData = new FormData();
      formData.append("files", file);

      updateFileProgress(index, { status: "processing" });

      try {
        const res = await fetch("/api/extract", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          let msg = "Extraction failed";
          try {
            msg = (await res.json()).error || msg;
          } catch {}
          updateFileProgress(index, { status: "error", error: msg });
          return null;
        }

        const rows: { filename: string; data: ExtractedData; validation?: ValidationResult }[] = await res.json();
        const row = rows[0];
        if (!row) return null;
        updateFileProgress(index, { status: "done" });
        return { ...row, id };
      } catch {
        updateFileProgress(index, { status: "error", error: "Request failed" });
        return null;
      }
    },
    [updateFileProgress]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
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
      setError(null);

      const progress: FileProgress[] = pdfFiles.map((f) => ({
        filename: f.name,
        status: "pending" as const,
      }));
      setFileProgress(progress);
      saveProgress(progress);

      const fileIds = pdfFiles.map(() => crypto.randomUUID());
      const successfulIds: string[] = [];

      await Promise.all(
        pdfFiles.map(async (file, i) => {
          const result = await processOneFile(file, i, fileIds[i]);
          if (result) {
            successfulIds.push(result.id);
            setResults((prev) => {
              const next = [result, ...prev];
              saveResults(next);
              return next;
            });
          }
        })
      );

      if (successfulIds.length > 0) {
        const idSet = new Set(successfulIds);
        setNewIds(idSet);
        if (newIdTimerRef.current) clearTimeout(newIdTimerRef.current);
        newIdTimerRef.current = setTimeout(() => setNewIds(new Set()), 4000);
      }

      setFileProgress((prev) => {
        const failed = prev.filter((fp) => fp.status === "error");
        if (failed.length > 0) {
          const details = failed
            .map((fp) => `${fp.filename}: ${friendlyError(fp.error || "Extraction failed")}`)
            .join("\n");
          setError(details);
          saveProgress(prev);
          return prev;
        }
        saveProgress([]);
        return [];
      });

      setProcessing(false);
    },
    [processOneFile]
  );

  const handleExport = async () => {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(results.map((r) => ({ data: r.data }))),
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
      } else {
        row.data[field] = raw as never;
      }

      updated[rowIndex] = row;
      saveResults(updated);
      return updated;
    });
    setEditing(null);
  };

  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-semibold">Earnings Data Extractor</h1>
        <button
          onClick={handleLogout}
          disabled={processing}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          if (!processing) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!processing) handleFiles(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          processing
            ? "border-gray-200 cursor-default"
            : dragOver
              ? "border-blue-500 bg-blue-50 cursor-pointer"
              : "border-gray-300 hover:border-gray-400 cursor-pointer"
        }`}
        onClick={() => !processing && fileInputRef.current?.click()}
      >
        {processing || fileProgress.length > 0 ? (
          <div className="space-y-2 text-left">
            {fileProgress.map((fp, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-700 truncate">
                  {fp.filename}
                </span>
                <span
                  className={`text-xs font-medium shrink-0 ${
                    fp.status === "pending"
                      ? "text-gray-400"
                      : fp.status === "processing"
                        ? "text-blue-600 animate-pulse"
                        : fp.status === "done"
                          ? "text-green-600"
                          : "text-red-600"
                  }`}
                >
                  {fp.status === "pending" && "Waiting..."}
                  {fp.status === "processing" && "Processing..."}
                  {fp.status === "done" && "Done"}
                  {fp.status === "error" && friendlyError(fp.error || "Extraction failed")}
                </span>
              </div>
            ))}
            {!processing && fileProgress.some((fp) => fp.status === "error") && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFileProgress([]);
                  saveProgress([]);
                  fileInputRef.current?.click();
                }}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 mt-2"
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <div className="text-gray-500 py-4">
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
          <span className="flex-1 whitespace-pre-line">{error}</span>
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
                onClick={() => { setResults([]); saveResults([]); }}
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
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-gray-700 truncate">
                        {row.filename}
                      </span>
                      {newIds.has(row.id) && (
                        <span className="shrink-0 text-xs font-semibold text-green-700 bg-green-100 rounded-full px-2 py-0.5">
                          New
                        </span>
                      )}
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
                              defaultValue={
                                row.data[f.key] === null || row.data[f.key] === undefined
                                  ? ""
                                  : String(row.data[f.key])
                              }
                              className="font-medium text-right w-full min-w-0 bg-white border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              onBlur={(e) =>
                                commitEdit(i, f.key, e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  commitEdit(i, f.key, e.currentTarget.value);
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
