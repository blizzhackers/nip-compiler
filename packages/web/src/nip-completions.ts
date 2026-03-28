import type { languages, Position, editor } from 'monaco-editor';
import { d2Aliases } from '@blizzhackers/nip-compiler';

const propertyKeywords = [
  'name', 'type', 'quality', 'flag', 'class', 'level', 'charlvl',
  'prefix', 'suffix', 'color', 'ladder', 'hardcore', 'classic',
  'wsm', 'weaponspeed', 'minimumsockets', 'strreq', 'dexreq',
  '2handed', 'distance',
];

const metaKeywords = ['tier', 'merctier', 'maxquantity'];

const statKeywords = Object.keys(d2Aliases.stat);
const classIdNames = Object.keys(d2Aliases.classId);
const typeNames = Object.keys(d2Aliases.type);
const qualityNames = Object.keys(d2Aliases.quality);
const flagNames = Object.keys(d2Aliases.flag);

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
    triggerCharacters: ['[', '=', ' '],

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
      const inBracket = (textBefore.match(/\[/g)?.length ?? 0) > (textBefore.match(/\]/g)?.length ?? 0);

      // After # = stat section
      const afterHash = textBefore.includes('#');
      // After second # = meta section
      const hashCount = (textBefore.match(/#/g) || []).length;
      const inMeta = hashCount >= 2;

      if (inBracket) {
        if (inMeta) {
          suggestions.push(...toSuggestions(metaKeywords, Kind.Property, range, 'meta'));
        } else if (afterHash) {
          suggestions.push(...toSuggestions(statKeywords, Kind.Field, range, 'stat'));
        } else {
          suggestions.push(...toSuggestions(propertyKeywords, Kind.Keyword, range, 'property'));
        }
      } else {
        // After == or != — suggest values based on the preceding keyword
        const kwMatch = textBefore.match(/\[(\w+)\]\s*[!=<>]=?\s*$/);
        if (kwMatch) {
          const kw = kwMatch[1].toLowerCase();
          switch (kw) {
            case 'name': case 'classid':
              suggestions.push(...toSuggestions(classIdNames, Kind.Value, range, 'classid'));
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
          }
        }
      }

      return { suggestions };
    },
  };
}
