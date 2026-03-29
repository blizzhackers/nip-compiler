import type { languages, editor, Range } from 'monaco-editor';
import { d2Aliases } from '@blizzhackers/nip-compiler';

const PROPERTY_ALIASES: Record<string, string> = {
  n: 'name', q: 'quality', id: 'classid', t: 'type',
  lvl: 'level', ilvl: 'level', f: 'flag', hc: 'hardcore',
  cl: 'classic', clvl: 'charlvl', mq: 'maxquantity',
};

const PROPERTY_ALIASES_REVERSE: Record<string, string[]> = {};
for (const [alias, full] of Object.entries(PROPERTY_ALIASES)) {
  if (!PROPERTY_ALIASES_REVERSE[full]) PROPERTY_ALIASES_REVERSE[full] = [];
  PROPERTY_ALIASES_REVERSE[full].push(alias);
}

// Build reverse maps: id → names
const classIdReverse = new Map<number, string[]>();
for (const [name, id] of Object.entries(d2Aliases.classId)) {
  if (!classIdReverse.has(id)) classIdReverse.set(id, []);
  classIdReverse.get(id)!.push(name);
}

const allAliasMaps: Record<string, Record<string, number>> = {
  name: d2Aliases.classId,
  classid: d2Aliases.classId,
  type: d2Aliases.type,
  quality: d2Aliases.quality,
  flag: d2Aliases.flag,
  color: d2Aliases.color,
  class: d2Aliases.class,
};

const allReverseMaps = new Map<string, Map<number, string[]>>();
for (const [kw, map] of Object.entries(allAliasMaps)) {
  const rev = new Map<number, string[]>();
  for (const [name, id] of Object.entries(map)) {
    if (!rev.has(id)) rev.set(id, []);
    rev.get(id)!.push(name);
  }
  allReverseMaps.set(kw, rev);
}

export function createCodeActionProvider(monaco: typeof import('monaco-editor')): languages.CodeActionProvider {
  return {
    provideCodeActions(model: editor.ITextModel, range: Range) {
      const line = model.getLineContent(range.startLineNumber);
      const word = model.getWordAtPosition({ lineNumber: range.startLineNumber, column: range.startColumn });
      if (!word) return { actions: [], dispose() {} };

      const token = word.word.toLowerCase();
      const wordRange = {
        startLineNumber: range.startLineNumber,
        endLineNumber: range.startLineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const actions: languages.CodeAction[] = [];
      const textBefore = line.substring(0, word.startColumn - 1);
      const inBracket = (textBefore.match(/\[/g)?.length ?? 0) > (textBefore.match(/\]/g)?.length ?? 0);

      if (inBracket) {
        // Inside brackets: property keyword alias rewrites
        if (token in PROPERTY_ALIASES) {
          const full = PROPERTY_ALIASES[token];
          actions.push(makeReplace(monaco, `Replace '${token}' with '${full}'`, wordRange, full, model));
        } else if (token in PROPERTY_ALIASES_REVERSE) {
          for (const alias of PROPERTY_ALIASES_REVERSE[token]) {
            actions.push(makeReplace(monaco, `Replace '${token}' with '${alias}'`, wordRange, alias, model));
          }
        }

        // Numeric stat ID → name, or name → ID
        const num = Number(token);
        if (!isNaN(num)) {
          // Number → find stat name
          for (const [name, stat] of Object.entries(d2Aliases.stat)) {
            const statId = Array.isArray(stat) ? stat[0] : stat;
            if (statId === num && !Array.isArray(stat)) {
              actions.push(makeReplace(monaco, `Replace stat ${num} with '${name}'`, wordRange, name, model));
              break;
            }
          }
        } else if (token in d2Aliases.stat) {
          const stat = d2Aliases.stat[token];
          if (!Array.isArray(stat)) {
            actions.push(makeReplace(monaco, `Replace '${token}' with stat ID ${stat}`, wordRange, String(stat), model));
          }
        }
      } else {
        // Outside brackets: value rewrites
        // Find which keyword this value belongs to
        const kwMatch = textBefore.match(/\[(\w+)\]\s*[!=<>]+\s*$/);
        const keyword = kwMatch ? (PROPERTY_ALIASES[kwMatch[1].toLowerCase()] ?? kwMatch[1].toLowerCase()) : null;

        if (keyword && keyword in allAliasMaps) {
          const map = allAliasMaps[keyword];
          const reverseMap = allReverseMaps.get(keyword);

          // Name → number
          if (token in map) {
            const id = map[token];
            actions.push(makeReplace(monaco, `Replace '${token}' with ID ${id}`, wordRange, String(id), model));

            // Name → alternative name (short code ↔ full name)
            if (reverseMap) {
              const alternatives = reverseMap.get(id)?.filter(n => n !== token) ?? [];
              for (const alt of alternatives) {
                actions.push(makeReplace(monaco, `Replace '${token}' with '${alt}'`, wordRange, alt, model));
              }
            }
          }

          // Number → name
          const num = Number(token);
          if (!isNaN(num) && reverseMap?.has(num)) {
            const names = reverseMap.get(num)!;
            for (const name of names) {
              actions.push(makeReplace(monaco, `Replace ${num} with '${name}'`, wordRange, name, model));
            }
          }
        }
      }

      return { actions, dispose() {} };
    },
  };
}

function makeReplace(
  monaco: typeof import('monaco-editor'),
  title: string,
  range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number },
  newText: string,
  model: editor.ITextModel,
): languages.CodeAction {
  return {
    title,
    kind: 'quickfix',
    edit: {
      edits: [{
        resource: model.uri,
        textEdit: { range: range as Range, text: newText },
        versionId: model.getVersionId(),
      }],
    },
  };
}
