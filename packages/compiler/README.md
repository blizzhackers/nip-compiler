# @blizzhackers/nip-compiler

NIP file lexer, parser, binder, and code emitter for Diablo 2 item filtering. Compiles `.nip` pickit rules into optimized JavaScript with switch dispatch — 36x faster than kolbot's runtime `NTItemParser`.

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
  Emitter   → Generates JavaScript with switch dispatch, hoisted stats,
              condition grouping, if/else chains, merged case labels
```

### Optimizations in emitted code

- **Switch dispatch** on classid and type (O(1) lookup vs O(n) scan)
- **Quality sub-dispatch** within each classid/type bucket
- **Stat hoisting** — shared `getStatEx` calls lifted to top of quality group
- **Condition grouping** — rules sharing `[quality] <= 3` etc. under one `if` block
- **Complementary if/else** — `<40` / `>=40` pairs, flag/!flag inversions
- **Merged case labels** — OR dispatch `[name] == X || [name] == Y` shares one body
- **Unid bail** — skip magical stat checks on unidentified items, return "maybe"
- **Selectivity reordering** — `==` checks before `>=` for faster short-circuit
- **`const`/`let`** — hints to SpiderMonkey JIT for register allocation

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

Cross-validated against the original `NTItemParser.js` across 31,320 item combinations — 0 missed picks, 0 false positives.
