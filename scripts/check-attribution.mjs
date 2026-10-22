/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
// Verifies that MenuAI's attribution is intact. Run by `npm test` and CI.
// Usage: node scripts/check-attribution.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/diamondrubinny/menuai';
const CODE_DIRS = ['src', 'server', 'scripts', 'tests', 'e2e'];
const CODE_FILE = /\.(ts|tsx|js|mjs|css)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (CODE_FILE.test(name)) out.push(path);
  }
  return out;
}

/** Returns a list of problems (empty when everything is in place). */
export function checkAttribution(root = '.') {
  const problems = [];
  const read = (p) => readFileSync(join(root, p), 'utf8');
  const has = (p) => existsSync(join(root, p));

  const files = CODE_DIRS.filter((d) => has(d)).flatMap((d) => walk(join(root, d)));
  files.push(join(root, 'vite.config.ts'), join(root, 'playwright.config.ts'));
  for (const file of files) {
    const head = readFileSync(file, 'utf8').split('\n').slice(0, 8).join('\n');
    if (!head.includes('@license') || !head.includes(REPO) || !head.includes('AGPL-3.0') || !head.includes('Powered by MenuAI')) {
      problems.push(`missing MenuAI license header: ${file.slice(root.length).replace(/^\//, '') || file}`);
    }
  }

  const required = [
    ['LICENSE', ['GNU AFFERO GENERAL PUBLIC LICENSE', 'Version 3']],
    ['NOTICE', ['MenuAI', REPO, 'Powered by MenuAI', 'Section 7', 'Diamond Rubinny']],
    ['src/core/brand.ts', [REPO, "name: 'MenuAI'", 'CREDIT_LINE', 'CREDIT_COMMENT']],
    ['src/renderer/MenuRenderer.tsx', ['data-ma-credit', 'BRAND.repo', 'creditText(locale)']],
    ['src/pages/SiteFooter.tsx', ['data-ma-credit', 'BRAND.name']],
    ['src/core/exportHtml.ts', ['CREDIT_COMMENT', 'BRAND.repo']],
    ['server/src/main.ts', ['CREDIT_LINE']],
    ['server/src/cli.ts', ['CREDIT_LINE']],
    ['server/src/mail/templates.ts', ['CREDIT_LINE']],
    ['index.html', [REPO]],
  ];
  for (const [file, needles] of required) {
    if (!has(file)) {
      problems.push(`missing file: ${file}`);
      continue;
    }
    const text = read(file);
    for (const n of needles) if (!text.includes(n)) problems.push(`${file}: attribution removed (expected "${n}")`);
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = checkAttribution();
  if (problems.length) {
    console.error('MenuAI attribution check failed:\n' + problems.map((p) => `  - ${p}`).join('\n'));
    console.error('\nMenuAI is open source (AGPL-3.0 with attribution terms). Its notices and the "Powered by MenuAI" credit must be kept. See NOTICE.');
    process.exit(1);
  }
  console.log('MenuAI attribution: OK');
}
