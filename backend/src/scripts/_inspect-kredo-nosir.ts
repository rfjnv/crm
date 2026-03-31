import * as XLSX from "xlsx";
import * as path from "path";

const filePath = path.resolve("c:/Users/Noutbuk savdosi/CRM/29.12.2025.xlsx");
const wb = XLSX.readFile(filePath);

console.log("=== Available sheets ===");
console.log(wb.SheetNames.join("\n"));
console.log("");

const targetSheets = ["октябрь 2025", "ноябрь 2025", "декабрь 2025"];
const SEP = "================================================================================";

for (const sheetName of targetSheets) {
  const actualName = wb.SheetNames.find(
    (s) => s.trim().toLowerCase() === sheetName.toLowerCase()
  );

  if (!actualName) {
    console.log("\n>>> Sheet " + sheetName + " NOT FOUND <<<\n");
    continue;
  }

  const ws = wb.Sheets[actualName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  console.log("\n" + SEP);
  console.log("SHEET: " + actualName + "  (total rows: " + rows.length + ")");
  console.log(SEP);

  if (rows.length > 0) {
    console.log("\n--- HEADER (row 0) ---");
    rows[0].forEach((val: any, ci: number) => {
      if (val !== "" && val !== null && val !== undefined) {
        console.log("  col[" + ci + "] = " + JSON.stringify(val));
      }
    });
    if (rows.length > 1) {
      console.log("--- HEADER (row 1) ---");
      rows[1].forEach((val: any, ci: number) => {
        if (val !== "" && val !== null && val !== undefined) {
          console.log("  col[" + ci + "] = " + JSON.stringify(val));
        }
      });
    }
  }

  const keywords = ["кредо", "носир"];
  let matchCount = 0;

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const rowStr = row.map((c: any) => String(c).toLowerCase()).join(" ");
    const matches = keywords.some((kw) => rowStr.includes(kw));

    if (matches) {
      matchCount++;
      console.log("\n--- MATCH at row " + ri + " ---");
      row.forEach((val: any, ci: number) => {
        const display = val === "" ? "(empty)" : JSON.stringify(val);
        console.log("  col[" + ci + "] = " + display);
      });
    }
  }

  if (matchCount === 0) {
    console.log("\n  (no rows matched)");
  } else {
    console.log("\n  Total matches in sheet: " + matchCount);
  }
}
