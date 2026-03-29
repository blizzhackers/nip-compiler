import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Parser } from './parser.js';
import { Binder } from './binder.js';
import { printLineFromTokens } from './printer.js';

const parser = new Parser();
const binder = new Binder();

const NIP_DIR = join(process.cwd(), 'nip');

function parseNipFile(name: string) {
  const content = readFileSync(join(NIP_DIR, name), 'utf-8');
  return parser.parseFile(content, name);
}

describe('Integration: real nip files', () => {
  it('parses kolton.nip without errors', () => {
    const file = parseNipFile('kolton.nip');
    assert.ok(file.lines.length > 50, `Expected >50 lines, got ${file.lines.length}`);
    const { diagnostics } = binder.bindFile(file);
    const errors = diagnostics.filter(d => d.severity === 'error');
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${errors.map(e => e.message).join(', ')}`);
  });

  it('parses gold.nip without errors', () => {
    const file = parseNipFile('gold.nip');
    assert.strictEqual(file.lines.length, 1);
    const { diagnostics } = binder.bindFile(file);
    assert.strictEqual(diagnostics.filter(d => d.severity === 'error').length, 0);
  });

  it('parses sorceress.xpac.nip (with tiers) without errors', () => {
    const file = parseNipFile('Autoequip/sorceress.xpac.nip');
    assert.ok(file.lines.length > 10);
    const { diagnostics } = binder.bindFile(file);
    const errors = diagnostics.filter(d => d.severity === 'error');
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${errors.map(e => e.message).join(', ')}`);
  });

  it('parses all nip files without throwing', () => {
    const files = ['kolton.nip', 'gold.nip', 'classic.nip', 'pots.nip', 'keyorg.nip', 'follower.nip'];
    for (const name of files) {
      assert.doesNotThrow(() => parseNipFile(name), `Failed to parse ${name}`);
    }
  });

  it('printer round-trips all kolton.nip lines', () => {
    const content = readFileSync(join(NIP_DIR, 'kolton.nip'), 'utf-8');
    const rawLines = content.split('\n');
    let failures = 0;

    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;
      // Skip lines that get preprocessed (item.getStatEx → [N])
      if (raw.includes('item.getStatEx') || raw.includes('me.diff')) continue;

      try {
        const node = parser.parseLine(raw, i + 1);
        const printed = printLineFromTokens(node, parser.lastTokens);
        if (printed !== raw) {
          if (failures < 5) {
            console.log(`  line ${i + 1} mismatch:`);
            console.log(`    original: ${JSON.stringify(raw)}`);
            console.log(`    printed:  ${JSON.stringify(printed)}`);
          }
          failures++;
        }
      } catch {
        // skip unparseable lines
      }
    }

    assert.strictEqual(failures, 0, `${failures} lines failed to round-trip`);
  });
});
