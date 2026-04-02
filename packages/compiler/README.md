# @blizzhackers/nip-compiler

NIP file lexer, parser, binder, and code emitter for Diablo 2 item filtering. Compiles `.nip` pickit rules into optimized JavaScript via ESTree AST + escodegen — **157x faster** than kolbot's runtime `NTItemParser` on SpiderMonkey (Firefox), **219x** on V8 (Chromium).

## Install

```bash
npm install @blizzhackers/nip-compiler
```

## CLI

```bash
# Basic compilation
nip-compile pickit/*.nip -o checkItem.js

# Kolbot mode (CJS, self-registers via NTIP.addCompiled)
nip-compile --kolbot -o pickit/compiled/checkItem.js pickit/*.nip

# Pretty-print
nip-compile --pretty -o checkItem.js pickit/*.nip

# Minified
nip-compile --minify -o checkItem.min.js pickit/*.nip

# With source maps
nip-compile --pretty --sourcemap -o checkItem.js pickit/*.nip
```

### Options

| Flag | Description |
|-|-|
| `-o, --output <file>` | Output file (default: stdout) |
| `--kolbot` | Emit CJS with kolbot-compatible format |
| `--pretty` | Pretty-print output |
| `--minify` | Strip comments and whitespace |
| `--no-comments` | Omit source comments |
| `--format <type>` | Output format: `iife` (default), `esm`, `cjs` |
| `--sourcemap` | Generate `.map` source map file |

## API

```ts
import { Parser, Binder, Emitter, d2Aliases, OutputFormat } from '@blizzhackers/nip-compiler';

const parser = new Parser();
const binder = new Binder();

// Parse
const ast = parser.parseFile('[name] == berrune', 'runes.nip');
const { diagnostics } = binder.bindFile(ast);

// Emit
const emitter = new Emitter({
  aliases: d2Aliases,
  kolbotCompat: true,
  prettyPrint: true,
  outputFormat: OutputFormat.CJS,
});
const js = emitter.emit([ast]);
```

## Architecture

```
.nip source
    |
    v
  Lexer     -> Token stream
    |
    v
  Parser    -> AST (NipFileNode -> NipLineNode -> ExprNode)
    |
    v
  Binder    -> Resolves aliases, validates keywords/values, reports diagnostics
    |
    v
  Analyzer  -> Extracts dispatch keys, expands [type] to classids
    |
    v
  Grouper   -> Groups rules by classid + quality
    |
    v
  Emitter   -> ESTree AST via emitter-ast.ts + codegen-ast.ts
    |
    v
  escodegen -> JavaScript code + source maps from AST node .loc
```

## Why it's fast

The original `NTItemParser` (kolbot/d2bs) checks items by iterating **all rules** for every item. With 807 rules, that's ~1000 property reads per item — even for junk items nobody wants.

We compile rules into a dispatch table indexed by `classid | (quality << 10)`. Checking an item is:

1. **One Uint16Array read** — `_mi[classid | (quality << 10)]` (raw memory, no type checks)
2. **One switch jump** — handler index to direct function call
3. **5-20 stat checks** in the handler (or zero for no-match)

For junk items (the vast majority in-game): step 1 returns 0, step 2 hits `case 0: break`, done. **Zero `getStatEx` calls, zero `getFlag` calls.** In d2bs, where `getStatEx` crosses the JS-to-C++ boundary, this means zero native calls for items we don't care about.

### Per-item cost comparison

| | Original NTIP | Compiled |
|-|-|-|
| Junk item (no match) | ~1000 property reads | **1 array read** |
| Matching item (e.g. SoJ) | ~430 reads + stat calls | **15 reads** (29x fewer) |
| Unid unique ring | ~1020 reads | **9 reads** (113x fewer) |

### Benchmarks (Playwright, 215 items, 9 nip files)

| Engine | Original NTIP | Switch dispatch | Object lookup | Object vs Original |
|-|-|-|-|-|
| Firefox 137 (SpiderMonkey) | 127K ops/s | 5.7M ops/s | **19.9M ops/s** | **157x** |
| Firefox 148 | 120K ops/s | 7.3M ops/s | **22.5M ops/s** | **189x** |
| Chromium (V8) | 102K ops/s | 16.7M ops/s | **22.2M ops/s** | **219x** |

SpiderMonkey is the target engine (d2bs uses it). Object lookup is **3.5x faster than switch** on SpiderMonkey because the `Uint16Array` read + switch jump table avoids the overhead of SpiderMonkey's sparse array dispatch.

## Optimizations in emitted code

### Dispatch

- **Uint16Array + switch jump table** — `_mi[classid|(quality<<10)]` returns a handler index; `switch(_ix)` dispatches via jump table. SpiderMonkey compiles dense integer switches to jump tables. The Uint16Array read is a raw memory access with no type checks or hole checks.
- **Type-to-classid expansion** — `[type] == armor` is expanded to all 45 armor classids at compile time, eliminating the runtime type switch entirely. Handler dedup across classids ensures no code bloat.
- **Quality range expansion** — `[quality] <= superior` becomes `case 1: case 2: case 3:` switch labels instead of `if (_q <= 3)`.
- **Impossible quality filtering** — uses D2 item type data (`d2-type-map.ts`) to skip handlers for impossible quality combos. Charms can only be magic/unique, runes/gems/potions are always normal, jewels are magic/rare/unique only. The OG NTIP would blindly match a "rare charm" — we don't even emit code for it.

### Stat evaluation

- **Group-level stat hoisting** — `getStatEx` calls used 2+ times across rules in the same quality group are lifted to `const _hN` declarations, avoiding redundant native calls.
- **Per-rule local hoisting** — stats used 2+ times within a single rule's expression get their own `_lN` variable.
- **Selectivity reordering** — AND conditions sorted by selectivity (`==` first, then `!=`, ranges, OR) for faster short-circuit failure.
- **Complementary if/else** — `flag`/`!flag` and `<`/`>=` pairs chained as if/else instead of separate if blocks, avoiding redundant `getFlag` calls.

### Unidentified item handling

- **Two-pass base/magical split** — base stats (defense, damage, durability) are always readable, even on unidentified items. Base-stat rules run first. Only magical-stat rules trigger the unid bail (`return -1` = "maybe, ID this item").
- **Per-flag-group unid bail** — flag checks (ethereal, runeword) are property conditions that must pass before unid bail fires. Each flag group gets its own bail inside the condition, matching original NTIP behavior.
- **Quality-aware base stats** — sockets (stat 194) are readable on normal/superior quality items. Quality <= 3 items are always identified in-game, so _id checks are skipped entirely.

### Code structure

- **Handler dedup** — classids sharing identical rule sets (e.g., all 45 armor classids from type expansion) share one handler function. Source signature-based dedup across classids.
- **Dead code elimination** — unconditional matches cut unreachable rules. Dead returns after early returns are pruned. Unused `_c`/`_q`/`_t` declarations skipped per handler.
- **Packed source table** — verbose mode decodes file and line from a packed `_s` array: `(line << _b) | fileId`. Dynamic bit width based on file count. No array-of-arrays.
- **ESTree AST** — code generated via proper AST construction + escodegen, enabling source maps, formatting control, and structural optimizations that string concatenation can't do.

### SpiderMonkey-specific

- **Dense Uint16Array** — dispatch index stored in a `Uint16Array` (raw typed memory). SpiderMonkey marks regular sparse arrays as "holey" which adds per-access checks. Typed arrays avoid this entirely — **57% faster** than dense `Array.fill(0)` on Firefox.
- **`|0` coercion** — signals int32 type to SpiderMonkey's type inference system, avoiding double-to-int conversions.

## Kolbot integration

The `--kolbot` flag emits a module that self-registers:

```js
// In Pickit.init() — one line:
require("pickit/compiled/checkItem.js");
```

The compiled module calls `NTIP.addCompiled()` on load. `CheckItem`, `GetTier`, and `GetMercTier` check compiled rules first, then fall through to `NTIP_CheckList` for inline rules. Custom `entryList` callers (Runewords, ShopBot) bypass compiled automatically.

## Tests

```bash
npm test
```

- 223 cross-validation tests against the original `NTItemParser.js` with 215 items covering quality ranges, eth/non-eth complement chains, unidentified items with base stats, rune ranges, runewords, prefix/suffix, tier calculations, maxquantity, junk items, and edge cases — **0 mismatches**.
- 6 tests verify we *intentionally differ* from the OG NTIP by rejecting impossible quality combinations (rare charms, magic runes, unique gold) that the original would blindly match.
- Playwright benchmark suite runs on Firefox (SpiderMonkey) and Chromium (V8) for cross-engine performance validation.
