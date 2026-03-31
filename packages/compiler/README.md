# @blizzhackers/nip-compiler

NIP file lexer, parser, binder, and code emitter for Diablo 2 item filtering. Compiles `.nip` pickit rules into optimized JavaScript via ESTree AST + escodegen — **50x faster** than kolbot's runtime `NTItemParser`.

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
    │
    ▼
  Lexer     → Token stream
    │
    ▼
  Parser    → AST (NipFileNode → NipLineNode → ExprNode)
    │
    ▼
  Binder    → Resolves aliases, validates keywords/values, reports diagnostics
    │
    ▼
  Analyzer  → Extracts dispatch keys (classid, type, quality)
    │
    ▼
  Grouper   → Groups rules by dispatch key into quality buckets
    │
    ▼
  Emitter   → ESTree AST via emitter-ast.ts + codegen-ast.ts
    │
    ▼
  escodegen → JavaScript code + source maps from AST node .loc
```

### Optimizations in emitted code

- **Switch dispatch** on classid and type (O(1) jump table vs O(n) scan)
- **Quality sub-dispatch** — quality ranges (`<= superior`) expanded to `case 1: case 2: case 3:` labels; OR conditions likewise
- **Function splitting** — each classid dispatch body is its own function, keeping `_ci` small enough for V8's TurboFan JIT (jump tables, inlining). Without this, `_ci` exceeds TurboFan's bytecode limit and stays on Maglev
- **Stat hoisting** — `getStatEx` calls used 2+ times across rules lifted to `const _hN` at group scope; per-rule local hoisting via `_lN` for stats used 2+ times within one expression
- **Lazy hoisted vars** — declarations emitted just before the first rule that uses them, so early-returning rules skip unnecessary `getStatEx` calls
- **Flag condition grouping** — consecutive rules sharing a flag condition (`[flag] == ethereal`) grouped under one `if(getFlag())` block
- **Complementary if/else** — `flag`/`!flag` and `<`/`>=` pairs chained as if/else instead of separate if blocks
- **Merged case labels** — classids with identical rule bodies share one case body with fallthrough labels
- **Unid bail** — skip magical stat checks on unidentified items, return "maybe". Only fires after ALL property conditions (including flags) pass, matching the original NTIP behavior. Base stats (defense, damage, durability) are always readable and evaluated even on unid items
- **Selectivity reordering** — AND conditions sorted by selectivity (`==` first, then `!=`, ranges, OR) for faster short-circuit
- **Dead code elimination** — unconditional matches cut unreachable rules; consecutive returns after a match are pruned
- **`const`/`let`** — hints to JIT for register allocation; `|0` coercion for int32 smi path

## Kolbot integration

The `--kolbot` flag emits a module that self-registers:

```js
// In Pickit.init() — one line:
require("pickit/compiled/checkItem.js");
```

The compiled module calls `NTIP.addCompiled()` on load. `CheckItem`, `GetTier`, and `GetMercTier` check compiled rules first, then fall through to `NTIP_CheckList` for inline rules. Custom `entryList` callers (Runewords, ShopBot) bypass compiled automatically.

## Tests

```bash
npm test                    # 335 tests
```

Cross-validated against the original `NTItemParser.js` with 110 test items covering quality ranges, eth/non-eth complement chains, unidentified items with base stats, rune ranges, runewords, prefix/suffix, and edge cases — 0 mismatches.
