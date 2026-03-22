export function formatError(source: string, line: number, col: number, message: string, filename?: string): string {
  const lines = source.split('\n');
  const lineIdx = line - 1;
  const prefix = filename ? `${filename}:${line}:${col}` : `${line}:${col}`;
  const parts: string[] = [];

  parts.push(`${prefix} - error: ${message}`);

  if (lineIdx >= 0 && lineIdx < lines.length) {
    const sourceLine = lines[lineIdx];
    parts.push('');
    // Line number gutter
    const gutter = String(line);
    parts.push(`  ${gutter} | ${sourceLine}`);
    parts.push(`  ${' '.repeat(gutter.length)} | ${' '.repeat(Math.max(0, col - 1))}^`);
  }

  return parts.join('\n');
}
