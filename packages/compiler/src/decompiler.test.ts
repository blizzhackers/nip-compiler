import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Parser } from './parser.js';
import { decompileLine, decompileFile } from './decompiler.js';

const parser = new Parser();

function roundTrip(input: string): string {
  return decompileLine(parser.parseLine(input));
}

describe('Decompiler', () => {
  it('round-trips simple property line', () => {
    assert.strictEqual(roundTrip('[name] == ring'), '[name] == ring');
  });

  it('round-trips property + stat', () => {
    assert.strictEqual(
      roundTrip('[name] == ring # [dexterity] == 20'),
      '[name] == ring # [dexterity] == 20'
    );
  });

  it('round-trips AND conjunction', () => {
    assert.strictEqual(
      roundTrip('[name] == ring && [quality] == unique'),
      '[name] == ring && [quality] == unique'
    );
  });

  it('round-trips OR disjunction', () => {
    assert.strictEqual(
      roundTrip('[name] == ring || [name] == amulet'),
      '[name] == ring || [name] == amulet'
    );
  });

  it('round-trips != comparison', () => {
    assert.strictEqual(
      roundTrip('[flag] != ethereal'),
      '[flag] != ethereal'
    );
  });

  it('round-trips >= comparison', () => {
    assert.strictEqual(
      roundTrip('[quality] >= 4'),
      '[quality] >= 4'
    );
  });

  it('round-trips stat addition', () => {
    assert.strictEqual(
      roundTrip('[name] == ring # [strength] + [dexterity] >= 30'),
      '[name] == ring # [strength] + [dexterity] >= 30'
    );
  });

  it('round-trips with trailing comment', () => {
    assert.strictEqual(
      roundTrip('[name] == ring // soj'),
      '[name] == ring // soj'
    );
  });

  it('round-trips property + stat + tier', () => {
    assert.strictEqual(
      roundTrip('[type] == ring # [maxhp] > 0 # [tier] == 5'),
      '[type] == ring # [maxhp] > 0 # [tier] == 5'
    );
  });

  it('round-trips empty stat section with tier', () => {
    assert.strictEqual(
      roundTrip('[name] == foo # # [tier] == 2'),
      '[name] == foo # # [tier] == 2'
    );
  });

  it('round-trips negative number', () => {
    assert.strictEqual(
      roundTrip('[type] == armor # [tier] == -1'),
      '[type] == armor # [tier] == -1'
    );
  });

  it('round-trips complex real-world line', () => {
    const input = '[name] == ring && [quality] == rare # [fcr] == 10 && [tohit] >= 90 && [maxhp] >= 30 // bvc ring';
    const result = roundTrip(input);
    assert.strictEqual(result, input);
  });

  it('decompiles a file', () => {
    const input = '[name] == ring\n[name] == amulet';
    const file = parser.parseFile(input, 'test.nip');
    const result = decompileFile(file);
    assert.strictEqual(result, '[name] == ring\n[name] == amulet');
  });
});
