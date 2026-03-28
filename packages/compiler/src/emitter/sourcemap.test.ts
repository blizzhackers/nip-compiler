import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SourceMapBuilder } from './sourcemap.js';
import { Parser } from '../parser.js';
import { Binder } from '../binder.js';
import { Emitter } from './emitter.js';
import { d2Aliases } from './d2-aliases.js';

const parser = new Parser();
const binder = new Binder();

describe('SourceMapBuilder', () => {
  it('produces valid v3 source map', () => {
    const smb = new SourceMapBuilder();
    smb.addMapping(1, 0, 'test.nip', 0);
    smb.addMapping(5, 0, 'test.nip', 6);
    const map = smb.toJSON('out.js') as any;
    assert.strictEqual(map.version, 3);
    assert.strictEqual(map.file, 'out.js');
    assert.deepStrictEqual(map.sources, ['test.nip']);
    assert.strictEqual(typeof map.mappings, 'string');
  });

  it('registers multiple sources', () => {
    const smb = new SourceMapBuilder();
    smb.addMapping(1, 0, 'a.nip', 0);
    smb.addMapping(2, 0, 'b.nip', 0);
    const map = smb.toJSON('out.js') as any;
    assert.deepStrictEqual(map.sources, ['a.nip', 'b.nip']);
  });

  it('produces semicolon-separated lines', () => {
    const smb = new SourceMapBuilder();
    smb.addMapping(1, 0, 'test.nip', 0);
    smb.addMapping(3, 0, 'test.nip', 5);
    const map = smb.toJSON('out.js') as any;
    const lines = map.mappings.split(';');
    assert.ok(lines.length >= 3);
    assert.ok(lines[0].length > 0);
    assert.strictEqual(lines[1], '');
    assert.ok(lines[2].length > 0);
  });
});

describe('Emitter source map integration', () => {
  it('emitWithSourceMap produces code and map', () => {
    const file = parser.parseFile(
      '[name] == ring && [quality] == unique # [itemmaxmanapercent] == 25 // soj',
      'test.nip'
    );
    binder.bindFile(file);
    const emitter = new Emitter({ aliases: d2Aliases, includeSourceComments: true });
    const result = emitter.emitWithSourceMap([file], 'out.js');

    assert.ok(result.code.length > 0);
    assert.ok(result.map.length > 0);
    assert.ok(result.code.includes('//# sourceMappingURL=out.js.map'));

    const map = JSON.parse(result.map);
    assert.strictEqual(map.version, 3);
    assert.strictEqual(map.file, 'out.js');
    assert.ok(map.sources.includes('test.nip'));
    assert.ok(map.mappings.length > 0);
  });

  it('maps generated lines to correct source files', () => {
    const file1 = parser.parseFile('[name] == ring # [dexterity] == 20', 'a.nip');
    const file2 = parser.parseFile('[name] == amulet # [strength] == 5', 'b.nip');
    binder.bindFile(file1);
    binder.bindFile(file2);
    const emitter = new Emitter({ aliases: d2Aliases, includeSourceComments: true });
    const result = emitter.emitWithSourceMap([file1, file2], 'out.js');

    const map = JSON.parse(result.map);
    assert.ok(map.sources.includes('a.nip'));
    assert.ok(map.sources.includes('b.nip'));
  });

  it('produces mappings for real nip file', () => {
    const content = readFileSync(join(process.cwd(), 'nip/kolton.nip'), 'utf-8');
    const file = parser.parseFile(content, 'kolton.nip');
    binder.bindFile(file);
    const emitter = new Emitter({ aliases: d2Aliases, includeSourceComments: true });
    const result = emitter.emitWithSourceMap([file], 'kolton.js');

    const map = JSON.parse(result.map);
    assert.strictEqual(map.sources[0], 'kolton.nip');

    // Should have many mappings (one per rule at minimum)
    const mappingSegments = map.mappings.split(';').filter((s: string) => s.length > 0);
    assert.ok(mappingSegments.length > 50, `Expected >50 mapped lines, got ${mappingSegments.length}`);
  });
});
