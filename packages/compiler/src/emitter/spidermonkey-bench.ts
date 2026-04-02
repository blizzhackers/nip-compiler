/**
 * Benchmark emitted code on SpiderMonkey (Firefox) and V8 (Chromium) via Playwright.
 * Runs the actual emitted JS natively in each browser — no VM, no eval wrappers.
 *
 * Usage: npx tsx src/emitter/spidermonkey-bench.ts
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { chromium, firefox, type Browser } from 'playwright';
import { Parser } from '../parser.js';
import { Binder } from '../binder.js';
import { Emitter } from './emitter.js';
import { DispatchStrategy } from './types.js';
import { d2Aliases } from './d2-aliases.js';

const ROOT = join(import.meta.dirname, '../..');
const parser = new Parser();
const binder = new Binder();
const nipDir = join(ROOT, 'nip');
const files = readdirSync(nipDir).filter(f => f.endsWith('.nip')).map(f => {
  const file = parser.parseFile(readFileSync(join(nipDir, f), 'utf-8'), f);
  binder.bindFile(file);
  return file;
});

function cid(n: string) { return d2Aliases.classId[n]; }
function qid(n: string) { return d2Aliases.quality[n]; }
function sid(n: string) { const s = d2Aliases.stat[n]; return Array.isArray(s) ? `${s[0]}_${s[1]}` : String(s); }

// Generate the emitted code for both strategies
const switchCode = new Emitter({ aliases: d2Aliases, includeSourceComments: false, dispatchStrategy: DispatchStrategy.Switch }).emit(files);
const objectCode = new Emitter({ aliases: d2Aliases, includeSourceComments: false, dispatchStrategy: DispatchStrategy.ObjectLookup }).emit(files);

// Build items from the cross-validation TEST_ITEMS
const testSrc = readFileSync(join(ROOT, 'src/emitter/cross-validation.test.ts'), 'utf-8');
const itemsMatch = testSrc.match(/const TEST_ITEMS[^=]*=\s*\[([\s\S]*?)\n\];/);
const rawItems: string = itemsMatch![1];

// Convert the TS items to plain JS — replace helper calls with values
let itemsJs = rawItems
  .replace(/: TestItem/g, '')
  .replace(/cid\('([^']+)'\)/g, (_, n) => String(d2Aliases.classId[n]))
  .replace(/qid\('([^']+)'\)/g, (_, n) => String(d2Aliases.quality[n]))
  .replace(/tid\('([^']+)'\)/g, (_, n) => String(d2Aliases.type[n]))
  .replace(/sidKey\('([^']+)'\)/g, (_, n) => {
    const s = d2Aliases.stat[n];
    return `'${Array.isArray(s) ? `${s[0]}_${s[1]}` : s}'`;
  })
  .replace(/\[sidKey\('([^']+)'\)\]/g, (_, n) => {
    const s = d2Aliases.stat[n];
    return `['${Array.isArray(s) ? `${s[0]}_${s[1]}` : s}']`;
  });

function buildPage(emittedCode: string, iterations: number): string {
  return `<!DOCTYPE html><html><body><script>
var helpers = {
  checkQuantityOwned: function() { return 0; },
  me: { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe' },
  getBaseStat: function() { return 0; }
};

var factory = ${emittedCode};
var mod = factory(helpers);

var items = [${itemsJs}].map(function(t) {
  var m = t.mock;
  var flags = m.flags !== undefined ? m.flags : 16;
  var stats = m.stats || {};
  var prefix = m._prefix || 0;
  var suffix = m._suffix || 0;
  return {
    classid: m.classid, quality: m.quality, itemType: m.itemType,
    ilvl: m.ilvl || 85, itemclass: m.itemclass || 0,
    getFlag: function(f) { return (flags & f) ? f : 0; },
    getStatEx: function(id, p) { var k = p !== undefined ? id+'_'+p : String(id); return stats[k] || 0; },
    getColor: function() { return 0; }, strreq: 0, dexreq: 0, onGroundOrDropping: true, distance: 5,
    getPrefix: function(v) { return v === prefix ? v : 0; },
    getSuffix: function(v) { return v === suffix ? v : 0; },
    getParent: function() { return null; }, isInStorage: false,
    fname: 'Test', mode: 0, location: 0
  };
});

// Warmup
for (var w = 0; w < 5000; w++) {
  for (var j = 0; j < items.length; j++) mod.checkItem(items[j]);
}

// Benchmark
var start = performance.now();
for (var i = 0; i < ${iterations}; i++) {
  for (var j = 0; j < items.length; j++) mod.checkItem(items[j]);
}
var elapsed = performance.now() - start;
var totalChecks = ${iterations} * items.length;
var opsPerSec = Math.round(totalChecks / (elapsed / 1000));

window.__result = { elapsed: elapsed, ops: opsPerSec, totalChecks: totalChecks };
</script></body></html>`;
}

async function benchBrowser(browser: Browser, label: string, code: string, iterations: number) {
  const page = await browser.newPage();
  const html = buildPage(code, iterations);
  await page.setContent(html, { waitUntil: 'load' });
  // Wait for benchmark to complete
  await page.waitForFunction('window.__result !== undefined', { timeout: 120000 });
  const result = await page.evaluate(() => (window as any).__result);
  await page.close();
  console.log(`  ${label.padEnd(16)} ${result.elapsed.toFixed(1)}ms (${result.ops.toLocaleString()} ops/s)`);
  return result;
}

// Load original NTIP source files
const aliasJs = readFileSync(join(ROOT, 'src/emitter/reference/NTItemAlias.js'), 'utf-8');
const parserJs = readFileSync(join(ROOT, 'src/emitter/reference/NTItemParser.js'), 'utf-8');

// Read nip lines for the original NTIP
const nipLines: string[] = [];
for (const f of readdirSync(nipDir).filter(f => f.endsWith('.nip'))) {
  const content = readFileSync(join(nipDir, f), 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith('//')) nipLines.push(trimmed);
  }
}

function buildOriginalPage(iterations: number): string {
  return `<!DOCTYPE html><html><body><script>
// Stubs for the original NTIP
var includeIfNotIncluded = function() {};
var ScriptError = Error;
var showConsole = function() {};
var Misc = { errorReport: function() {} };
var getTickCount = function() { return Date.now(); };
var getBaseStat = function() { return 0; };
var me = { charlvl: 90, ladder: 1, playertype: 0, gametype: 1, realm: 'europe', name: 'T', getItemsEx: function() { return []; } };
var sdk = {
  items: { mode: { inStorage: 0 }, flags: { Identified: 16 } },
  storage: { Stash: 0, Inventory: 0 },
  skills: { Valkyrie:32,Warmth:37,Inferno:41,FireBall:47,FireWall:51,Teleport:54,Meteor:56,FireMastery:61,Hydra:62,Zeal:106,Vengeance:111,Whirlwind:151,Berserk:152,ArcticBlast:230,Werebear:228 }
};

${aliasJs}
${parserJs}

// Add all nip lines
var nipLines = ${JSON.stringify(nipLines)};
for (var n = 0; n < nipLines.length; n++) {
  try { NTIP.addLine(nipLines[n], 'nip'); } catch(e) {}
}

var items = [
  { classid: ${cid('ring')}, quality: ${qid('unique')}, itemType: 10, stats: { '${sid('itemmaxmanapercent')}': 25 }, flags: 16 },
  { classid: ${cid('ring')}, quality: ${qid('rare')}, itemType: 10, stats: { '${sid('fcr')}': 10, '${sid('maxhp')}': 35 }, flags: 16 },
  { classid: ${cid('amulet')}, quality: ${qid('unique')}, itemType: 12, stats: { '${sid('strength')}': 5 }, flags: 16 },
  { classid: ${cid('berrune')}, quality: ${qid('normal')}, itemType: 36, stats: {}, flags: 16 },
  { classid: ${cid('monarch')}, quality: ${qid('normal')}, itemType: 2, stats: { '${sid('sockets')}': 4 }, flags: 16 },
  { classid: ${cid('shako')}, quality: ${qid('unique')}, itemType: 37, stats: { '31': 141 }, flags: 16 },
  { classid: 999, quality: ${qid('normal')}, itemType: 99, stats: {}, flags: 16 },
  { classid: ${cid('ring')}, quality: ${qid('unique')}, itemType: 10, stats: {}, flags: 0 },
  { classid: ${cid('archonplate')}, quality: ${qid('rare')}, itemType: 3, stats: {}, flags: 0 },
  { classid: ${cid('duskshroud')}, quality: ${qid('unique')}, itemType: 3, stats: {}, flags: 0 },
  { classid: ${cid('phaseblade')}, quality: ${qid('unique')}, itemType: 30, stats: { '${sid('sockets')}': 4 }, flags: 83886096 },
  { classid: ${cid('longsword')}, quality: ${qid('magic')}, itemType: 30, stats: {}, flags: 0 }
].map(function(m) {
  return {
    classid: m.classid, quality: m.quality, itemType: m.itemType, ilvl: 85, itemclass: 0,
    getFlag: function(f) { return (m.flags & f) ? f : 0; },
    getStatEx: function(id, p) { var k = p !== undefined ? id+'_'+p : String(id); return m.stats[k] || 0; },
    getColor: function() { return 0; }, strreq: 0, dexreq: 0, onGroundOrDropping: true, distance: 5,
    getPrefix: function() { return 0; }, getSuffix: function() { return 0; },
    getParent: function() { return null; }, isInStorage: false,
    fname: 'Test', mode: 0, location: 0
  };
});

// Warmup
for (var w = 0; w < 1000; w++) {
  for (var j = 0; j < items.length; j++) NTIP.CheckItem(items[j]);
}

// Benchmark
var start = performance.now();
for (var i = 0; i < ${iterations}; i++) {
  for (var j = 0; j < items.length; j++) NTIP.CheckItem(items[j]);
}
var elapsed = performance.now() - start;
var totalChecks = ${iterations} * items.length;
var opsPerSec = Math.round(totalChecks / (elapsed / 1000));

window.__result = { elapsed: elapsed, ops: opsPerSec, totalChecks: totalChecks };
</script></body></html>`;
}

async function benchOriginal(browser: Browser, iterations: number) {
  const page = await browser.newPage();
  const html = buildOriginalPage(iterations);
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__result !== undefined', { timeout: 120000 });
  const result = await page.evaluate(() => (window as any).__result);
  await page.close();
  console.log(`  ${'Original NTIP'.padEnd(16)} ${result.elapsed.toFixed(1)}ms (${result.ops.toLocaleString()} ops/s)`);
  return result;
}

async function run() {
  const iterations = 50000;
  const origIterations = 5000; // original is ~50x slower, use fewer iterations

  const oldFirefoxPath = '/Users/jaenster/Library/Caches/ms-playwright/firefox-1482/firefox/Nightly.app/Contents/MacOS/firefox';

  const browsers: [string, () => Promise<Browser>][] = [
    ['Firefox 137 (oldest)', () => firefox.launch({ executablePath: oldFirefoxPath })],
    ['Firefox 148 (current)', () => firefox.launch()],
    ['Chromium (V8)', () => chromium.launch()],
  ];

  for (const [name, launchFn] of browsers) {
    console.log(`\n=== ${name} ===`);
    const browser = await launchFn();

    const orig = await benchOriginal(browser, origIterations);
    const sw = await benchBrowser(browser, 'Switch', switchCode, iterations);
    const obj = await benchBrowser(browser, 'Object lookup', objectCode, iterations);

    console.log(`  Switch vs original:  ${(sw.ops / orig.ops).toFixed(1)}x`);
    console.log(`  Object vs original:  ${(obj.ops / orig.ops).toFixed(1)}x`);
    console.log(`  Switch/Object:       ${(obj.ops / sw.ops).toFixed(2)}`);
    await browser.close();
  }
}

run().catch(console.error);
