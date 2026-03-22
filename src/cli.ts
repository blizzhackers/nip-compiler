#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { globSync } from 'node:fs';
import { Parser } from './parser.js';
import { Binder } from './binder.js';
import { Emitter } from './emitter/emitter.js';
import { d2Aliases } from './emitter/d2-aliases.js';
import { DispatchStrategy } from './emitter/types.js';
import { NipFileNode } from './types.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log(`Usage: nip-compile [options] <files...>

Options:
  -o, --output <file>      Output file (default: stdout)
  --strategy <type>        Dispatch strategy: switch (default) or lookup
  --pretty                 Pretty-print output
  --no-comments            Omit source comments
  --format <type>          Output format: iife (default), esm, cjs
  -h, --help               Show this help`);
  process.exit(0);
}

let output: string | null = null;
let strategy: DispatchStrategy = DispatchStrategy.Switch;
let pretty = false;
let comments = true;
let format = 'iife' as string;
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
  if (arg === '--no-comments') { comments = false; continue; }
  if (arg === '--format') { format = args[++i] as typeof format; continue; }
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
});

let js = emitter.emit(parsed);

if (format === 'esm') {
  js = js.replace(/^\(function\(helpers\)\{/, 'export default function(helpers){');
  js = js.replace(/\}\)$/, '}');
} else if (format === 'cjs') {
  js = js.replace(/^\(function\(helpers\)\{/, 'module.exports=function(helpers){');
  js = js.replace(/\}\)$/, '}');
}

if (output) {
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(resolve(output), js);
  console.error(`\nWritten ${output} (${(js.length / 1024).toFixed(1)}kb)`);
} else {
  process.stdout.write(js);
}
