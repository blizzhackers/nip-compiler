import type { languages, Position, editor } from 'monaco-editor';
import { d2Aliases } from '@blizzhackers/nip-compiler';

const propertyKeywords = [
  'name', 'type', 'quality', 'flag', 'class', 'level', 'charlvl',
  'prefix', 'suffix', 'color', 'ladder', 'hardcore', 'classic',
  'wsm', 'weaponspeed', 'minimumsockets', 'strreq', 'dexreq',
  '2handed', 'distance',
];

const propertyAliases: Record<string, string> = {
  n: 'name', q: 'quality', id: 'classid', t: 'type',
  lvl: 'level', ilvl: 'level', f: 'flag', hc: 'hardcore',
  cl: 'classic', clvl: 'charlvl', mq: 'maxquantity',
};

const metaKeywords = ['tier', 'merctier', 'maxquantity', 'mq'];

const statKeywords = Object.keys(d2Aliases.stat);
const classIdNames = Object.keys(d2Aliases.classId);
const typeNames = Object.keys(d2Aliases.type);
const qualityNames = Object.keys(d2Aliases.quality);
const flagNames = Object.keys(d2Aliases.flag);
const colorNames = Object.keys(d2Aliases.color);
const classNames = Object.keys(d2Aliases.class);

function toSuggestions(
  items: string[],
  kind: languages.CompletionItemKind,
  range: any,
  detail?: string,
): languages.CompletionItem[] {
  return items.map(label => ({
    label,
    kind,
    insertText: label,
    range,
    detail,
  }));
}

export function createCompletionProvider(monaco: typeof import('monaco-editor')): languages.CompletionItemProvider {
  return {
    triggerCharacters: ['[', '=', ' ', '#'],

    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const line = model.getLineContent(position.lineNumber);
      const textBefore = line.substring(0, position.column - 1);

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: languages.CompletionItem[] = [];
      const Kind = monaco.languages.CompletionItemKind;

      // Inside brackets: [keyword]
      const openBrackets = (textBefore.match(/\[/g)?.length ?? 0);
      const closeBrackets = (textBefore.match(/\]/g)?.length ?? 0);
      const inBracket = openBrackets > closeBrackets;

      // Section detection: count # outside brackets
      let hashCount = 0;
      let bracketDepth = 0;
      for (const ch of textBefore) {
        if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth--;
        else if (ch === '#' && bracketDepth === 0) hashCount++;
      }
      const inMeta = hashCount >= 2;
      const afterHash = hashCount >= 1;

      if (inBracket) {
        if (inMeta) {
          suggestions.push(...toSuggestions(metaKeywords, Kind.Property, range, 'meta'));
        } else if (afterHash) {
          suggestions.push(...toSuggestions(statKeywords, Kind.Field, range, 'stat'));
        } else {
          suggestions.push(...toSuggestions(propertyKeywords, Kind.Keyword, range, 'property'));
          // Also suggest aliases
          suggestions.push(...toSuggestions(Object.keys(propertyAliases), Kind.Keyword, range, 'alias'));
        }
      } else if (!afterHash || inMeta) {
        // Outside brackets in property/meta section — suggest values
        // Find the last [keyword] before the cursor
        const kwMatch = textBefore.match(/\[(\w+)\]\s*[!=<>]+\s*\w*$/);
        if (kwMatch) {
          const kw = kwMatch[1].toLowerCase();
          const resolved = propertyAliases[kw] ?? kw;
          switch (resolved) {
            case 'name': case 'classid':
              suggestions.push(...toSuggestions(classIdNames, Kind.Value, range, 'item'));
              break;
            case 'type':
              suggestions.push(...toSuggestions(typeNames, Kind.Value, range, 'type'));
              break;
            case 'quality':
              suggestions.push(...toSuggestions(qualityNames, Kind.Value, range, 'quality'));
              break;
            case 'flag':
              suggestions.push(...toSuggestions(flagNames, Kind.Value, range, 'flag'));
              break;
            case 'color':
              suggestions.push(...toSuggestions(colorNames, Kind.Value, range, 'color'));
              break;
            case 'class':
              suggestions.push(...toSuggestions(classNames, Kind.Value, range, 'class'));
              break;
          }
        }
      }

      return { suggestions };
    },
  };
}
