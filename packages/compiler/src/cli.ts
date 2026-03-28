#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { globSync } from 'node:fs';
import { Parser } from './parser.js';
import { Binder } from './binder.js';
import { Emitter } from './emitter/emitter.js';
import { d2Aliases } from './emitter/d2-aliases.js';
import { DispatchStrategy, OutputFormat } from './emitter/types.js';
import { NipFileNode } from './types.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log(`Usage: nip-compile [options] <files...>

Options:
  -o, --output <file>      Output file (default: stdout)
  --strategy <type>        Dispatch strategy: switch (default) or lookup
  --pretty                 Pretty-print output
  --minify                 Strip comments and whitespace for smallest output
  --no-comments            Omit source comments
  --format <type>          Output format: iife (default), esm, cjs
  --kolbot                 Emit CJS with kolbot-compatible verbose format
  --sourcemap              Generate .map source map file
  -h, --help               Show this help`);
  process.exit(0);
}

let output: string | null = null;
let strategy: DispatchStrategy = DispatchStrategy.Switch;
let pretty = false;
let minify = false;
let comments = true;
let format: OutputFormat = OutputFormat.IIFE;
let kolbot = false;
let sourcemap = false;
const files: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-o' || arg === '--output') { output = args[++i]; continue; }
  if (arg === '--strategy') {
    const val = args[++i];
    strategy = val === 'lookup' ? DispatchStrategy.ObjectLookup : DispatchStrategy.Switch;
    continue;
  }
  if (arg === '--pretty') { pretty = true; continue; }
  if (arg === '--minify') { minify = true; comments = false; continue; }
  if (arg === '--kolbot') { kolbot = true; format = OutputFormat.CJS; continue; }
  if (arg === '--no-comments') { comments = false; continue; }
  if (arg === '--format') {
    const val = args[++i];
    format = val === 'esm' ? OutputFormat.ESM : val === 'cjs' ? OutputFormat.CJS : OutputFormat.IIFE;
    continue;
  }
  if (arg === '--sourcemap') { sourcemap = true; continue; }
  files.push(arg);
}

if (files.length === 0) {
  console.error('Error: no input files');
  process.exit(1);
}

const parser = new Parser();
const binder = new Binder();
const parsed: NipFileNode[] = [];
let errors = 0;

for (const file of files) {
  try {
    const content = readFileSync(resolve(file), 'utf-8');
    const name = basename(file);
    const ast = parser.parseFile(content, name);
    binder.bindFile(ast);
    parsed.push(ast);
    console.error(`  ${name}: ${ast.lines.length} rules`);
  } catch (e: any) {
    console.error(`  ERROR ${file}: ${e.message}`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`\n${errors} file(s) failed to parse`);
  process.exit(1);
}

const emitter = new Emitter({
  aliases: d2Aliases,
  includeSourceComments: comments,
  dispatchStrategy: strategy,
  prettyPrint: pretty,
  minify,
  kolbotCompat: kolbot,
  outputFormat: format,
});

const outputName = output ? basename(output) : 'checkItem.js';

if (sourcemap && output) {
  const result = emitter.emitWithSourceMap(parsed, outputName);
  const js = result.code;

  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(resolve(output), js);
  writeFileSync(resolve(output + '.map'), result.map);
  console.error(`\nWritten ${output} (${(js.length / 1024).toFixed(1)}kb)`);
  console.error(`Written ${output}.map (${(result.map.length / 1024).toFixed(1)}kb)`);
} else {
  const js = emitter.emit(parsed);

  if (output) {
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(resolve(output), js);
    console.error(`\nWritten ${output} (${(js.length / 1024).toFixed(1)}kb)`);
  } else {
    process.stdout.write(js);
  }
}
