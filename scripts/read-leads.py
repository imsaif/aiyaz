# Reads the private lead tracker and prints [{"company": ..., "facts": ...}] as JSON.
# Read-only: scheduled jobs write the tracker, so this never writes back to it.
import csv
import json
import sys

FACTS = "Aiyaz brief facts (each with source)"

# Since 2026-10-26 the lead tracker is data/clients.csv in the private find-money repo,
# with the facts in an `aiyaz_facts` column. The old .xlsx path below still works.
if sys.argv[1].endswith(".csv"):
    with open(sys.argv[1], newline="", encoding="utf-8") as fh:
        out = [{"company": r["company"].strip(), "facts": r["aiyaz_facts"]}
               for r in csv.DictReader(fh)
               if (r.get("company") or "").strip() and (r.get("aiyaz_facts") or "").strip()]
    print(json.dumps(out))
    sys.exit(0)

import openpyxl  # noqa: E402 - only the legacy .xlsx tracker needs it

wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
ws = wb["Leads"]
rows = ws.iter_rows(values_only=True)
header = None
for row in rows:
    if row and "Company" in row and FACTS in row:
        header = list(row)
        break
if header is None:
    sys.exit(f"no header row with 'Company' and {FACTS!r}")
ci, fi = header.index("Company"), header.index(FACTS)
out = []
for row in rows:
    company, facts = row[ci], row[fi]
    if company and facts:
        out.append({"company": str(company).strip(), "facts": str(facts)})
print(json.dumps(out))
