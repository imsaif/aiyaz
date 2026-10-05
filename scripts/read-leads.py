# Reads the private lead tracker and prints [{"company": ..., "facts": ...}] as JSON.
# Read-only: scheduled jobs write the tracker, so this never writes back to it.
import json
import sys

import openpyxl

FACTS = "Aiyaz brief facts (each with source)"

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
