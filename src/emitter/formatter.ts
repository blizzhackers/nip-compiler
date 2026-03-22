export function formatJs(js: string, indentStr = '  '): string {
  const lines = js.split('\n');
  const out: string[] = [];
  let depth = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { out.push(''); continue; }

    // Decrease indent before lines that close a block
    const closers = countLeading(line, '}');
    depth = Math.max(0, depth - closers);

    // Case/break get dedented one level from their switch body
    if (line.startsWith('case ') || line.startsWith('default:')) {
      out.push(indentStr.repeat(Math.max(0, depth - 1)) + line);
    } else {
      out.push(indentStr.repeat(depth) + line);
    }

    // Increase indent after lines that open a block
    const openers = countChar(line, '{') - countChar(line, '}');
    depth = Math.max(0, depth + openers);
  }

  return out.join('\n');
}

function countLeading(s: string, ch: string): number {
  let n = 0;
  for (const c of s) {
    if (c === ch) n++;
    else break;
  }
  return n;
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) {
    if (c === ch) n++;
  }
  return n;
}
