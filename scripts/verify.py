#!/usr/bin/env python3
"""Compare tool's CSV export against the ground truth.

Usage:
  python3 scripts/verify.py <tool_export.csv>
  python3 scripts/verify.py <tool_export.csv> --ground-truth path/to/other.csv
"""

import csv
import os
import re
import sys
import argparse

DEFAULT_GROUND_TRUTH = os.path.join(os.path.dirname(__file__), "ground-truth.csv")
KEY_FIELDS = ("Company Name", "Quarter")

# Legal suffixes to strip when fuzzy-matching company names
_LEGAL_SUFFIXES = re.compile(
    r'\b(inc\.?|llc\.?|ltd\.?|plc\.?|corp\.?|co\.?|incorporated|limited|'
    r'company|group|holdings?|international|global)\b\.?',
    re.IGNORECASE,
)

def normalize_company(name: str) -> str:
    """Strip punctuation and legal suffixes for fuzzy matching."""
    n = name.lower()
    n = _LEGAL_SUFFIXES.sub('', n)
    n = re.sub(r'[^a-z0-9 ]', ' ', n)
    return re.sub(r'\s+', ' ', n).strip()


def load_csv(path: str) -> dict[tuple, dict]:
    rows = {}
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        reader.fieldnames = [h.strip() for h in reader.fieldnames]
        for row in reader:
            row = {k.strip(): (v.strip() if v is not None else "") for k, v in row.items() if k is not None}
            company = normalize_company(row.get("Company Name", ""))
            quarter  = row.get("Quarter", "").strip().lower()
            key = (company, quarter)
            rows[key] = row
    return rows


def normalize(val: str) -> str:
    """
    Normalize for semantic comparison:
    - lowercase, strip whitespace
    - convert longform amounts to shorthand ($17.1 billion -> $17.1b, $433 million -> $433m)
    - strip trailing zeros (1.0b -> 1b)
    - for buybacks/dividends: extract just the dollar amounts, drop labels
    """
    v = val.strip().lower()
    # billion/million -> b/m suffix
    v = re.sub(r'\$\s*([\d,.]+)\s*billion', lambda m: '$' + m.group(1).replace(',','') + 'b', v)
    v = re.sub(r'\$\s*([\d,.]+)\s*million', lambda m: '$' + m.group(1).replace(',','') + 'm', v)
    v = re.sub(r'\b([\d,.]+)\s*billion', lambda m: m.group(1).replace(',','') + 'b', v)
    v = re.sub(r'\b([\d,.]+)\s*million', lambda m: m.group(1).replace(',','') + 'm', v)
    # strip trailing zeros after decimal (17.10b -> 17.1b, 17.00b -> 17b)
    v = re.sub(r'(\d+\.\d*?)0+([bm%])', lambda m: m.group(1).rstrip('.') + m.group(2), v)
    # remove commas in numbers
    v = re.sub(r'(\d),(\d)', r'\1\2', v)
    # for buybacks/dividends fields: strip labels, keep only non-zero dollar amounts
    # "$1b buybacks, $0 dividends" -> "$1b" ; "$1b buybacks" -> "$1b"
    if re.search(r'buyback|dividend|repurchase', v):
        amounts = re.findall(r'\$[\d.]+[bm]?', v)
        amounts = [a for a in amounts if not re.match(r'^\$0\.?0*[bm]?$', a)]
        v = ', '.join(amounts)
    # normalize spaces
    v = re.sub(r'\s+', ' ', v).strip()
    return v


def compare(ground_truth_path: str, tool_path: str) -> None:
    gt = load_csv(ground_truth_path)
    tool = load_csv(tool_path)

    all_keys = sorted(set(gt) | set(tool))
    total_fields = 0
    correct_fields = 0

    for key in all_keys:
        company, quarter = key
        label = f"{company.title()} {quarter.upper()}"

        if key not in gt:
            print(f"\n[EXTRA] {label} — in tool output but not in ground truth")
            continue
        if key not in tool:
            print(f"\n[MISSING] {label} — in ground truth but not in tool output")
            continue

        gt_row = gt[key]
        tool_row = tool[key]
        all_cols = [c for c in gt_row if c not in KEY_FIELDS]

        mismatches = []
        for col in all_cols:
            gt_val = gt_row.get(col, "")
            tool_val = tool_row.get(col, "")
            total_fields += 1
            if normalize(gt_val) == normalize(tool_val):
                correct_fields += 1
            else:
                mismatches.append((col, gt_val, tool_val))

        if mismatches:
            print(f"\n[MISMATCH] {label}")
            for col, expected, got in mismatches:
                print(f"  {col}:")
                print(f"    expected: {expected!r}")
                print(f"    got:      {got!r}")
        else:
            print(f"[OK] {label}")

    if total_fields:
        pct = 100 * correct_fields / total_fields
        print(f"\nAccuracy: {correct_fields}/{total_fields} fields correct ({pct:.1f}%)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("tool_export", help="CSV exported from the tool")
    parser.add_argument("--ground-truth", default=DEFAULT_GROUND_TRUTH)
    args = parser.parse_args()

    compare(args.ground_truth, args.tool_export)
