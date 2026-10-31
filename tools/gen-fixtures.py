"""Generate typed JSON fixtures from the two planning spreadsheets.
Run: python3 tools/gen-fixtures.py   (needs openpyxl)"""
import json, openpyxl, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = root / "docs" / "source"
out = root / "packages" / "permissions" / "src" / "data"
out.mkdir(parents=True, exist_ok=True)

# ---- Roles x Areas
ws = openpyxl.load_workbook(src / "Roles-and-Access-Matrix.xlsx", data_only=True)["Roles x Areas"]
rows = [list(r) for r in ws.iter_rows(values_only=True)]
hi = next(i for i, r in enumerate(rows) if r[0] == "Role")
areas = [a for a in rows[hi][1:] if a and a not in ("Areas", "Total", "Can approve")]
areas = areas[:24]
matrix = {}
for r in rows[hi + 1:]:
    if not r[0] or r[0].startswith(("Shading", "Changes")):
        break
    matrix[r[0]] = {a: (r[1 + i] or "") for i, a in enumerate(areas) if r[1 + i]}
(out / "roles-matrix.json").write_text(json.dumps({"areas": areas, "roles": matrix}, indent=1))

# ---- Approval limits
ws = openpyxl.load_workbook(src / "Roles-and-Access-Matrix.xlsx", data_only=True)["Approval limits"]
rows = [r for r in ws.iter_rows(values_only=True)]
hi = next(i for i, r in enumerate(rows) if r[0] == "Control")
limits = []
for r in rows[hi + 1:]:
    if not r[0]:
        continue
    limits.append({"control": r[0].replace("PLACEHOLDER: ", ""), "placeholder": r[0].startswith("PLACEHOLDER"),
                   "actor": r[1], "limit": r[2], "unit": r[3], "above": r[4]})
(out / "approval-limits.json").write_text(json.dumps(limits, indent=1))

# ---- Screen inventory
ws = openpyxl.load_workbook(src / "Screen-Inventory.xlsx", data_only=True)["Screens"]
rows = [r for r in ws.iter_rows(values_only=True)]
hi = next(i for i, r in enumerate(rows) if r[0] == "ID")
all_roles = list(matrix.keys())
alias = {"Rider": ["Rider / courier"], "Stock roles": ["Warehouse officer", "Stock controller"], "MD": ["MD / Executive"],
         "Others": [], "All staff": all_roles, "All": all_roles, "Customer": []}
screens = []
for r in rows[hi + 1:]:
    if not r[0]:
        continue
    roles = []
    for part in [p.strip() for p in str(r[3]).split(",")]:
        roles += alias.get(part, [part] if part in matrix else [])
    screens.append({"id": r[0], "area": r[1], "title": r[2], "roles": sorted(set(roles)), "erpnext": r[4],
                    "verdict": r[5], "pattern": r[6], "device": r[7], "offline": r[8], "scope": r[9], "sprint": r[10]})
(out / "screens.json").write_text(json.dumps(screens, indent=1))
print(len(areas), "areas;", len(matrix), "roles;", len(limits), "limits;", len(screens), "screens;",
      sum(s["scope"] == "MVP" for s in screens), "MVP")
