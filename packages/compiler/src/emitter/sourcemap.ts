const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlq(value: number): string {
  let vlq = value < 0 ? ((-value) << 1) + 1 : (value << 1);
  let result = '';
  do {
    let digit = vlq & 0x1f;
    vlq >>>= 5;
    if (vlq > 0) digit |= 0x20;
    result += VLQ_CHARS[digit];
  } while (vlq > 0);
  return result;
}

export interface SourceMapping {
  generatedLine: number;
  generatedCol: number;
  sourceIndex: number;
  sourceLine: number;
  sourceCol: number;
}

export class SourceMapBuilder {
  private sources: string[] = [];
  private sourceIndexMap = new Map<string, number>();
  private sourcesContent: (string | null)[] = [];
  private mappings: SourceMapping[] = [];

  addSource(filename: string, content?: string): number {
    let idx = this.sourceIndexMap.get(filename);
    if (idx !== undefined) return idx;
    idx = this.sources.length;
    this.sources.push(filename);
    this.sourcesContent.push(content ?? null);
    this.sourceIndexMap.set(filename, idx);
    return idx;
  }

  addMapping(generatedLine: number, generatedCol: number, sourceFile: string, sourceLine: number, sourceCol = 0): void {
    const sourceIndex = this.addSource(sourceFile);
    this.mappings.push({ generatedLine, generatedCol, sourceIndex, sourceLine, sourceCol });
  }

  toJSON(file: string): object {
    // Sort by generated line, then column
    this.mappings.sort((a, b) => a.generatedLine - b.generatedLine || a.generatedCol - b.generatedCol);

    // Group mappings by generated line
    const lineGroups = new Map<number, SourceMapping[]>();
    for (const m of this.mappings) {
      if (!lineGroups.has(m.generatedLine)) lineGroups.set(m.generatedLine, []);
      lineGroups.get(m.generatedLine)!.push(m);
    }

    // Find max generated line
    let maxLine = 0;
    for (const m of this.mappings) {
      if (m.generatedLine > maxLine) maxLine = m.generatedLine;
    }

    // Encode VLQ mappings
    let prevGenCol = 0;
    let prevSource = 0;
    let prevSourceLine = 0;
    let prevSourceCol = 0;
    const lineStrings: string[] = [];

    for (let line = 1; line <= maxLine; line++) {
      const group = lineGroups.get(line);
      if (!group) {
        lineStrings.push('');
        continue;
      }

      prevGenCol = 0;
      const segments: string[] = [];
      for (const m of group) {
        let segment = '';
        segment += encodeVlq(m.generatedCol - prevGenCol);
        segment += encodeVlq(m.sourceIndex - prevSource);
        segment += encodeVlq(m.sourceLine - prevSourceLine);
        segment += encodeVlq(m.sourceCol - prevSourceCol);
        prevGenCol = m.generatedCol;
        prevSource = m.sourceIndex;
        prevSourceLine = m.sourceLine;
        prevSourceCol = m.sourceCol;
        segments.push(segment);
      }
      lineStrings.push(segments.join(','));
    }

    return {
      version: 3,
      file,
      sources: this.sources,
      sourcesContent: this.sourcesContent,
      mappings: lineStrings.join(';'),
    };
  }

  toString(file: string): string {
    return JSON.stringify(this.toJSON(file));
  }
}
