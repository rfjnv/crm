import XLSX from 'xlsx';

for (const file of ['../29.12.2025.xlsx', '../28.02.2026.xlsx']) {
  console.log(`\n=== ${file} ===`);
  const wb = XLSX.readFile(file);
  const allManagers = new Set<string>();

  for (let i = 0; i < wb.SheetNames.length; i++) {
    const sheet = wb.Sheets[wb.SheetNames[i]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });

    for (const row of rows) {
      const mgr = row[3]; // COL_MANAGER = 3
      if (mgr != null && String(mgr).trim()) {
        allManagers.add(String(mgr).trim().toLowerCase());
      }
    }
  }

  console.log('Unique managers:', [...allManagers].sort());
}
