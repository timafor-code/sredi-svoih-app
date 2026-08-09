#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const ts = require('typescript');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

registerTypeScriptRequireHook();

const { parshaNameRu } = require(path.join(repoRoot, 'src/lib/hebcalRu.ts'));

const cases = [
  ['Lech-Lecha', 'Лех-Леха', 'canonical hyphenated parsha'],
  ['Bereshit', 'Берешит', 'normal parsha'],
  ['Matot-Masei', 'Матот-Масей', 'combined parsha'],
];

for (const [name, expected, description] of cases) {
  const actual = parshaNameRu(name);

  if (actual !== expected) {
    console.error(
      `Parsha content validation failed for ${description}: expected "${expected}", got "${actual}"`,
    );
    process.exit(1);
  }
}

console.log(`Parsha content validation passed (${cases.length} cases)`);

function registerTypeScriptRequireHook() {
  Module._extensions['.ts'] = function compileTypeScriptModule(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: filename,
    });

    module._compile(outputText, filename);
  };
}
