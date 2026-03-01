const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'Рабочий Таблица.xlsx');
const OUTPUT_FILE = path.join(__dirname, 'clients-extracted.json');

// Normalize company name for deduplication
function normalize(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')       // collapse multiple spaces
    .replace(/[""«»]/g, '"')    // normalize quotes
    .replace(/\s*\.\s*$/g, ''); // remove trailing dots
}

// Clean phone number: keep digits and leading +
function cleanPhone(phone) {
  if (!phone) return '';
  let p = String(phone).trim();
  // Remove everything except digits, +, spaces, dashes, parens
  // Then normalize to just digits with optional leading +
  p = p.replace(/[^\d+\s\-()]/g, '').trim();
  if (!p) return '';
  return p;
}

// Check if a value looks like a valid company name (not empty, not a number, not a date)
function isValidCompanyName(val) {
  if (!val) return false;
  const s = String(val).trim();
  if (!s) return false;
  if (s.length < 2) return false;
  // Skip if it's purely numeric (likely a date serial or row number)
  if (/^\d+$/.test(s)) return false;
  // Skip common headers
  const lower = s.toLowerCase();
  const headers = ['фирма', 'номер', 'дата', 'описание', 'оператор', 'столбец', 'товар', 'фольга'];
  if (headers.some(h => lower === h || lower === h + ' ')) return false;
  return true;
}

function main() {
  console.log('Reading file:', INPUT_FILE);
  const wb = XLSX.readFile(INPUT_FILE);

  // Map: normalized name -> { companyName (original casing), phone }
  const clientMap = new Map();

  function addClient(rawName, rawPhone) {
    const name = String(rawName || '').trim();
    if (!isValidCompanyName(name)) return;
    const key = normalize(name);
    if (!key) return;

    const phone = cleanPhone(rawPhone);

    if (clientMap.has(key)) {
      const existing = clientMap.get(key);
      // If existing has no phone but new one does, update
      if (!existing.phone && phone) {
        existing.phone = phone;
      }
      // Keep the longer/more detailed original name
      if (name.length > existing.companyName.length) {
        existing.companyName = name;
      }
    } else {
      clientMap.set(key, { companyName: name, phone: phone });
    }
  }

  // ============================================================
  // Sheet 1: "номера клиентов" - main call log (~1796 rows)
  //   Col B (index 1) = Company name
  //   Col C (index 2) = Phone number
  //   Col D (index 3) = Product interest (info only)
  //   Col U (index 20) = Right-side additional company names (no phones)
  // ============================================================
  const sheet1Name = wb.SheetNames[0]; // "номера клиентов "
  const ws1 = wb.Sheets[sheet1Name];
  const data1 = XLSX.utils.sheet_to_json(ws1, { header: 1, defval: '' });

  console.log(`\nProcessing sheet "${sheet1Name}" (${data1.length} rows)...`);

  let mainCount = 0;
  let rightSideCount = 0;

  for (let i = 4; i < data1.length; i++) { // skip header rows (0-3)
    const row = data1[i];

    // Main data: columns B and C
    const companyB = row[1];
    const phoneC = row[2];
    if (isValidCompanyName(companyB)) {
      addClient(companyB, phoneC);
      mainCount++;
    }

    // Right-side list: column U (company names without phones)
    const companyU = row[20];
    if (isValidCompanyName(companyU)) {
      addClient(companyU, '');
      rightSideCount++;
    }
  }

  console.log(`  Main entries (col B): ${mainCount}`);
  console.log(`  Right-side entries (col U): ${rightSideCount}`);

  // ============================================================
  // Sheet 2: "комила" (~989 rows)
  //   Col C (index 2) = Company name (фирма)
  //   Col D (index 3) = Phone number
  // ============================================================
  const sheet2Name = 'комила';
  if (wb.SheetNames.includes(sheet2Name)) {
    const ws2 = wb.Sheets[sheet2Name];
    const data2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: '' });
    console.log(`\nProcessing sheet "${sheet2Name}" (${data2.length} rows)...`);
    let count = 0;
    for (let i = 1; i < data2.length; i++) {
      const row = data2[i];
      const company = row[2];
      const phone = row[3];
      if (isValidCompanyName(company)) {
        addClient(company, phone);
        count++;
      }
    }
    console.log(`  Entries found: ${count}`);
  }

  // ============================================================
  // Sheet: "Дилноза отчет" (~1000 rows)
  //   Col C (index 2) = Company name
  //   Col D (index 3) = Phone number
  // ============================================================
  const sheet3Name = 'Дилноза отчет';
  if (wb.SheetNames.includes(sheet3Name)) {
    const ws3 = wb.Sheets[sheet3Name];
    const data3 = XLSX.utils.sheet_to_json(ws3, { header: 1, defval: '' });
    console.log(`\nProcessing sheet "${sheet3Name}" (${data3.length} rows)...`);
    let count = 0;
    for (let i = 1; i < data3.length; i++) {
      const row = data3[i];
      const company = row[2];
      const phone = row[3];
      if (isValidCompanyName(company)) {
        addClient(company, phone);
        count++;
      }
    }
    console.log(`  Entries found: ${count}`);
  }

  // ============================================================
  // Sheet: "конкуренты к" (~1000 rows)
  //   Col B (index 1) = Company name
  //   Col C (index 2) = Phone number
  // ============================================================
  const sheet4Name = 'конкуренты к';
  if (wb.SheetNames.includes(sheet4Name)) {
    const ws4 = wb.Sheets[sheet4Name];
    const data4 = XLSX.utils.sheet_to_json(ws4, { header: 1, defval: '' });
    console.log(`\nProcessing sheet "${sheet4Name}" (${data4.length} rows)...`);
    let count = 0;
    for (let i = 1; i < data4.length; i++) {
      const row = data4[i];
      const company = row[1];
      const phone = row[2];
      if (isValidCompanyName(company)) {
        addClient(company, phone);
        count++;
      }
    }
    console.log(`  Entries found: ${count}`);
  }

  // ============================================================
  // Sheet: "турк самаклей к" (~1001 rows)
  //   Col B (index 1) = Company name
  //   Col C (index 2) = Phone number
  // ============================================================
  const sheet5Name = 'турк самаклей к';
  if (wb.SheetNames.includes(sheet5Name)) {
    const ws5 = wb.Sheets[sheet5Name];
    const data5 = XLSX.utils.sheet_to_json(ws5, { header: 1, defval: '' });
    console.log(`\nProcessing sheet "${sheet5Name}" (${data5.length} rows)...`);
    let count = 0;
    for (let i = 2; i < data5.length; i++) { // row 0 is date, row 1 is header
      const row = data5[i];
      const company = row[1];
      const phone = row[2];
      if (isValidCompanyName(company)) {
        addClient(company, phone);
        count++;
      }
    }
    console.log(`  Entries found: ${count}`);
  }

  // ============================================================
  // Build final output
  // ============================================================
  const clients = Array.from(clientMap.values())
    .sort((a, b) => a.companyName.localeCompare(b.companyName, 'ru'));

  const withPhone = clients.filter(c => c.phone);
  const withoutPhone = clients.filter(c => !c.phone);

  console.log('\n========================================');
  console.log(`TOTAL UNIQUE COMPANIES: ${clients.length}`);
  console.log(`  With phone: ${withPhone.length}`);
  console.log(`  Without phone: ${withoutPhone.length}`);
  console.log('========================================');

  console.log('\n--- First 20 entries ---');
  for (let i = 0; i < Math.min(20, clients.length); i++) {
    const c = clients[i];
    console.log(`${i + 1}. ${c.companyName}${c.phone ? ' | ' + c.phone : ''}`);
  }

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(clients, null, 2), 'utf-8');
  console.log(`\nOutput written to: ${OUTPUT_FILE}`);
}

main();
