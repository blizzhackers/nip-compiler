import type { languages, Position, editor, IMarkdownString } from 'monaco-editor';
import { d2Aliases } from '@blizzhackers/nip-compiler';

const reverseClassId = new Map<number, string>();
for (const [name, id] of Object.entries(d2Aliases.classId)) {
  // Prefer longer names (human-readable) over short codes
  const existing = reverseClassId.get(id);
  if (!existing || name.length > existing.length) {
    reverseClassId.set(id, name);
  }
}

function findInfo(word: string): IMarkdownString | null {
  const lower = word.toLowerCase();

  // ClassID
  if (lower in d2Aliases.classId) {
    const id = d2Aliases.classId[lower];
    const fullName = reverseClassId.get(id);
    if (fullName && fullName !== lower) {
      return { value: `**Item code** \`${lower}\` → \`${fullName}\` — ClassID: \`${id}\`` };
    }
    return { value: `**Item** \`${lower}\` — ClassID: \`${id}\`` };
  }

  // Type
  if (lower in d2Aliases.type) {
    return { value: `**Type** \`${lower}\` — TypeID: \`${d2Aliases.type[lower]}\`` };
  }

  // Quality
  if (lower in d2Aliases.quality) {
    return { value: `**Quality** \`${lower}\` — ID: \`${d2Aliases.quality[lower]}\`` };
  }

  // Flag
  if (lower in d2Aliases.flag) {
    return { value: `**Flag** \`${lower}\` — 0x${d2Aliases.flag[lower].toString(16)}` };
  }

  // Stat
  if (lower in d2Aliases.stat) {
    const stat = d2Aliases.stat[lower];
    if (Array.isArray(stat)) {
      return { value: `**Stat** \`${lower}\` — getStatEx(${stat[0]}, ${stat[1]})` };
    }
    return { value: `**Stat** \`${lower}\` — getStatEx(${stat})` };
  }

  // Color
  if (lower in d2Aliases.color) {
    return { value: `**Color** \`${lower}\` — ID: \`${d2Aliases.color[lower]}\`` };
  }

  return null;
}

export function createHoverProvider(): languages.HoverProvider {
  return {
    provideHover(model: editor.ITextModel, position: Position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const info = findInfo(word.word);
      if (!info) return null;

      return {
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        },
        contents: [info],
      };
    },
  };
}
