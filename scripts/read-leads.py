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
        out = []
        for r in csv.DictReader(fh):
            if not (r.get("company") or "").strip() or not (r.get("aiyaz_facts") or "").strip():
                continue
            # Cards the research already answers, prefilled on the page (optional columns).
            cards = {k: (r.get(col) or "").strip() for k, col in
                     (("aiFeature", "aiyaz_ai_feature"), ("users", "aiyaz_users"), ("stage", "aiyaz_stage"))}
            row = {"company": r["company"].strip(), "facts": r["aiyaz_facts"],
                   "cards": {k: v for k, v in cards.items() if v}}
            # Proof on their page: "src | caption; src | caption" and "href | label".
            ev = [p.split("|", 1) for p in (r.get("aiyaz_evidence") or "").split(";") if "|" in p]
            if ev:
                row["evidence"] = [{"src": s.strip(), "caption": c.strip()} for s, c in ev]
            fl = (r.get("aiyaz_file") or "").split("|", 1)
            if len(fl) == 2:
                row["file"] = {"href": fl[0].strip(), "label": fl[1].strip()}
            out.append(row)
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
