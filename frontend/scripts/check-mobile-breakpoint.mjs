#!/usr/bin/env node
/**
 * Ensures `mobile.css` `--mobile-breakpoint`, `@media (max-width: …)`, and
 * `MOBILE_BREAKPOINT_FALLBACK` in `mobileBreakpoint.ts` stay aligned.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const mobileCss = readFileSync(join(root, 'src/mobile.css'), 'utf8');
const bpMatch = mobileCss.match(/--mobile-breakpoint:\s*(\d+)px/);
if (!bpMatch) {
  console.error('check-mobile-breakpoint: missing --mobile-breakpoint in src/mobile.css');
  process.exit(1);
}
const bp = bpMatch[1];

if (!mobileCss.includes(`@media (max-width: ${bp}px)`)) {
  console.error(
    `check-mobile-breakpoint: mobile.css @media must include (max-width: ${bp}px) to match --mobile-breakpoint`,
  );
  process.exit(1);
}

const tsPath = join(root, 'src/utils/mobileBreakpoint.ts');
const ts = readFileSync(tsPath, 'utf8');
const fbMatch = ts.match(/MOBILE_BREAKPOINT_FALLBACK\s*=\s*['"](\d+)px['"]/);
if (!fbMatch) {
  console.error('check-mobile-breakpoint: missing MOBILE_BREAKPOINT_FALLBACK in mobileBreakpoint.ts');
  process.exit(1);
}
if (fbMatch[1] !== bp) {
  console.error(
    `check-mobile-breakpoint: MOBILE_BREAKPOINT_FALLBACK (${fbMatch[1]}px) must equal --mobile-breakpoint (${bp}px)`,
  );
  process.exit(1);
}

console.log(`check-mobile-breakpoint: OK (${bp}px)`);
