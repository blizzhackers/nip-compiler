# NIP Compiler

Compile Diablo 2 `.nip` pickit files into optimized JavaScript. Drop-in replacement for kolbot's runtime NIP parser — **36x faster**.

**[Try it online](https://blizzhackers.github.io/nip-compiler/)**

## What is this?

If you use [kolbot](https://github.com/blizzhackers/kolbot) for Diablo 2, your pickit system loads `.nip` files at runtime and checks every item against hundreds of rules by scanning them one by one. This compiler takes those same `.nip` files and produces a single optimized JavaScript file that uses switch dispatch instead of linear scanning.

### How to use

1. Go to **[blizzhackers.github.io/nip-compiler](https://blizzhackers.github.io/nip-compiler/)**
2. Your default pickit files are pre-loaded — check/uncheck the ones you want
3. Upload your own `.nip` files or paste rules inline
4. Click **Compile**
5. Download `checkItem.js` and drop it into your kolbot `pickit/compiled/` folder
6. ~~Add `require("pickit/compiled/checkItem.js");` to your `Pickit.init()`~~ *(kolbot integration in development)*

The compiler validates your rules as you type — unknown item names, stat keywords, and syntax errors show up as red squigglies in the editor.

### Features

- NIP syntax highlighting with autocomplete for item names, stats, qualities
- Live error checking against the full D2 alias database
- Kolbot-compatible output (self-registers via `NTIP.addCompiled`)
- Inline source maps for debugging
- Pretty-print or minified output

## Packages

| Package | Description |
|-|-|
| [`packages/compiler`](packages/compiler/) | The NIP parser, binder, and code emitter |
| [`packages/web`](packages/web/) | The web SPA (this site) |

## Development

```bash
pnpm install
pnpm dev          # start web dev server
pnpm test         # run compiler tests
pnpm build        # build everything
```
