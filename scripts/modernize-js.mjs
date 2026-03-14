import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
]);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }

    if (fullPath.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

function isRelativeSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function withJsExtension(specifier) {
  if (!isRelativeSpecifier(specifier)) {
    return specifier;
  }

  if (specifier.endsWith('.js') || specifier.endsWith('.mjs') || specifier.endsWith('.cjs')) {
    return specifier;
  }

  return `${specifier}.js`;
}

function replaceVarKeywordOutsideStringsAndComments(source) {
  let result = '';
  let i = 0;

  let inLineComment = false;
  let inBlockComment = false;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let templateBraceDepth = 0;

  const isIdentChar = (ch) => /[A-Za-z0-9_$]/.test(ch);

  while (i < source.length) {
    const ch = source[i];
    const next = i + 1 < source.length ? source[i + 1] : '';

    if (inLineComment) {
      result += ch;
      if (ch === '\n') {
        inLineComment = false;
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      result += ch;
      if (ch === '*' && next === '/') {
        result += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i += 1;
      continue;
    }

    if (inSingle) {
      result += ch;
      if (ch === '\\\\' && next) {
        result += next;
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      i += 1;
      continue;
    }

    if (inDouble) {
      result += ch;
      if (ch === '\\\\' && next) {
        result += next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      i += 1;
      continue;
    }

    if (inTemplate) {
      result += ch;
      if (ch === '\\\\' && next) {
        result += next;
        i += 2;
        continue;
      }

      if (ch === '`' && templateBraceDepth === 0) {
        inTemplate = false;
        i += 1;
        continue;
      }

      if (ch === '$' && next === '{') {
        templateBraceDepth += 1;
        result += next;
        i += 2;
        continue;
      }

      if (ch === '{' && templateBraceDepth > 0) {
        templateBraceDepth += 1;
        i += 1;
        continue;
      }

      if (ch === '}' && templateBraceDepth > 0) {
        templateBraceDepth -= 1;
        i += 1;
        continue;
      }

      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      result += ch + next;
      i += 2;
      inLineComment = true;
      continue;
    }

    if (ch === '/' && next === '*') {
      result += ch + next;
      i += 2;
      inBlockComment = true;
      continue;
    }

    if (ch === "'") {
      result += ch;
      i += 1;
      inSingle = true;
      continue;
    }

    if (ch === '"') {
      result += ch;
      i += 1;
      inDouble = true;
      continue;
    }

    if (ch === '`') {
      result += ch;
      i += 1;
      inTemplate = true;
      templateBraceDepth = 0;
      continue;
    }

    if (source.startsWith('var', i)) {
      const before = i > 0 ? source[i - 1] : '';
      const after = i + 3 < source.length ? source[i + 3] : '';
      const isBoundaryBefore = !before || !isIdentChar(before);
      const isBoundaryAfter = !after || !isIdentChar(after);

      if (isBoundaryBefore && isBoundaryAfter) {
        result += 'let';
        i += 3;
        continue;
      }
    }

    result += ch;
    i += 1;
  }

  return result;
}

function transformCommonJsToEsm(source, { filename }) {
  const isBrowserScript = filename.includes(`${path.sep}public${path.sep}javascripts${path.sep}`);
  if (isBrowserScript) {
    return replaceVarKeywordOutsideStringsAndComments(source);
  }

  let working = source;

  // Convert `var x = require('y');` and `var x = require('y')(...);`
  const importLines = [];
  const consumedLines = new Set();
  const lines = working.split('\n');

  const requireAssignRe = /^\s*(?:var|let|const)\s+([A-Za-z_$][0-9A-Za-z_$]*)\s*=\s*require\((['"])([^'"]+)\2\)\s*;\s*$/;
  const requireCallAssignRe = /^\s*(?:var|let|const)\s+([A-Za-z_$][0-9A-Za-z_$]*)\s*=\s*require\((['"])([^'"]+)\2\)\s*\((.*)\)\s*;\s*$/;
  const dotenvConfigRe = /^\s*require\((['"])dotenv\1\)\.config\((.*)\)\s*;\s*$/;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let match = line.match(requireCallAssignRe);
    if (match) {
      const [, localName, , specifier, callArgs] = match;
      const importName = `${localName}Factory`;
      importLines.push(`import ${importName} from '${withJsExtension(specifier)}';`);
      importLines.push(`const ${localName} = ${importName}(${callArgs});`);
      consumedLines.add(index);
      continue;
    }

    match = line.match(requireAssignRe);
    if (match) {
      const [, localName, , specifier] = match;
      importLines.push(`import ${localName} from '${withJsExtension(specifier)}';`);
      consumedLines.add(index);
      continue;
    }

    match = line.match(dotenvConfigRe);
    if (match) {
      const [, , configArgs] = match;
      importLines.push(`import dotenv from 'dotenv';`);
      importLines.push(`dotenv.config(${configArgs});`);
      consumedLines.add(index);
    }
  }

  // If we found imports, rebuild file with imports at top.
  if (importLines.length) {
    const outLines = [];
    const seenImport = new Set();
    for (const importLine of importLines) {
      if (seenImport.has(importLine)) {
        continue;
      }
      seenImport.add(importLine);
      outLines.push(importLine);
    }

    // Preserve shebang if present.
    let startIndex = 0;
    if (lines[0] && lines[0].startsWith('#!')) {
      outLines.unshift(lines[0]);
      startIndex = 1;
    }

    // Preserve leading comment blocks after shebang.
    while (startIndex < lines.length && (lines[startIndex].trim() === '' || lines[startIndex].trim().startsWith('/**') || lines[startIndex].trim().startsWith('/*') || lines[startIndex].trim().startsWith('*') || lines[startIndex].trim().startsWith('//'))) {
      if (!consumedLines.has(startIndex)) {
        outLines.push(lines[startIndex]);
      }
      startIndex += 1;
      if (lines[startIndex - 1].trim().endsWith('*/')) {
        // allow leaving comment block state naturally
      }
    }

    // Ensure a blank line after imports unless next line is blank.
    if (outLines.length && outLines[outLines.length - 1].trim() !== '') {
      outLines.push('');
    }

    for (let index = startIndex; index < lines.length; index += 1) {
      if (consumedLines.has(index)) {
        continue;
      }
      outLines.push(lines[index]);
    }

    working = outLines.join('\n');
  }

  // Convert `module.exports = ...` to `export default ...`
  working = working.replace(/^\s*module\.exports\s*=\s*/m, 'export default ');

  // Replace remaining `var` keyword (outside strings/comments).
  working = replaceVarKeywordOutsideStringsAndComments(working);

  // If __dirname/__filename is used, add ESM-compatible shims.
  if (/\b__dirname\b|\b__filename\b/.test(working)) {
    const shimImport = `import { fileURLToPath } from 'node:url';`;
    const shimLines = [
      `const __filename = fileURLToPath(import.meta.url);`,
      `const __dirname = path.dirname(__filename);`,
      '',
    ].join('\n');

    if (!working.includes(shimImport)) {
      // Insert shimImport after existing imports (or at top).
      const wLines = working.split('\n');
      let insertAt = 0;
      if (wLines[0] && wLines[0].startsWith('#!')) {
        insertAt = 1;
      }
      while (insertAt < wLines.length && wLines[insertAt].startsWith('import ')) {
        insertAt += 1;
      }
      wLines.splice(insertAt, 0, shimImport);
      working = wLines.join('\n');
    }

    if (!working.includes('const __dirname =')) {
      const wLines = working.split('\n');
      let insertAt = 0;
      if (wLines[0] && wLines[0].startsWith('#!')) {
        insertAt = 1;
      }
      while (insertAt < wLines.length && wLines[insertAt].startsWith('import ')) {
        insertAt += 1;
      }
      if (wLines[insertAt] && wLines[insertAt].trim() !== '') {
        wLines.splice(insertAt, 0, '');
        insertAt += 1;
      }
      wLines.splice(insertAt, 0, shimLines);
      working = wLines.join('\n');
    }
  }

  return working;
}

const files = walk(PROJECT_ROOT);
let changed = 0;

for (const file of files) {
  if (file.endsWith('.cjs')) {
    continue;
  }

  const original = fs.readFileSync(file, 'utf8');
  const next = transformCommonJsToEsm(original, { filename: file });
  if (next !== original) {
    fs.writeFileSync(file, next, 'utf8');
    changed += 1;
  }
}

console.log(`Modernized ${changed} file(s).`);
