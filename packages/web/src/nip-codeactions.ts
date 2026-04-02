import type { languages, editor, Range } from 'monaco-editor';
import { getAvailableRewrites, d2Aliases, resolveUnique, resolveSetItem, resolveSetName, setItems } from '@blizzhackers/nip-compiler';

export function createCodeActionProvider(monaco: typeof import('monaco-editor')): languages.CodeActionProvider {
  return {
    provideCodeActions(model: editor.ITextModel, range: Range) {
      const lineNumber = range.startLineNumber;
      const lineText = model.getLineContent(lineNumber);
      const col = range.startColumn;
      const actions: languages.CodeAction[] = [];

      // Existing NIP rewrites
      const rewrites = getAvailableRewrites(lineText, col, d2Aliases);
      for (const r of rewrites) {
        actions.push({
          title: r.description,
          kind: 'quickfix',
          edit: {
            edits: [{
              resource: model.uri,
              textEdit: {
                range: {
                  startLineNumber: lineNumber,
                  endLineNumber: lineNumber,
                  startColumn: 1,
                  endColumn: lineText.length + 1,
                } as Range,
                text: r.apply(),
              },
              versionId: model.getVersionId(),
            }],
          },
        });
      }

      // JIP quick actions — match on syntax, not language ID
      {
        // Expand [unique] == Name to NIP equivalent
        const uniqueMatch = lineText.match(/\[unique\]\s*==\s*(\w+)/);
        if (uniqueMatch) {
          const name = uniqueMatch[1];
          const result = resolveUnique(name);
          if (result) {
            const rest = lineText.replace(/\[unique\]\s*==\s*\w+/, '').trim();
            let nip = `[name] == ${result.classIdName} && [quality] == unique`;
            if (result.discriminator.length > 0) {
              const discStr = result.discriminator.map(d => `[${d.statName}] ${d.op} ${d.value}`).join(' && ');
              // If rest starts with # (user stats), merge discriminator in
              if (rest.startsWith('#')) {
                const afterHash = rest.slice(1).trim();
                // Check if there's a meta section (second #)
                const metaIdx = afterHash.indexOf('#');
                if (metaIdx >= 0) {
                  const userStats = afterHash.slice(0, metaIdx).trim();
                  const meta = afterHash.slice(metaIdx).trim();
                  nip += ` # ${discStr}${userStats ? ' && ' + userStats : ''} ${meta}`;
                } else {
                  nip += ` # ${discStr}${afterHash ? ' && ' + afterHash : ''}`;
                }
              } else {
                nip += ` # ${discStr}${rest ? ' ' + rest : ''}`;
              }
            } else if (rest) {
              nip += ` ${rest}`;
            }
            actions.push({
              title: `Expand to NIP: ${nip.length > 80 ? nip.slice(0, 77) + '...' : nip}`,
              kind: 'quickfix',
              edit: {
                edits: [{
                  resource: model.uri,
                  textEdit: {
                    range: {
                      startLineNumber: lineNumber,
                      endLineNumber: lineNumber,
                      startColumn: 1,
                      endColumn: lineText.length + 1,
                    } as Range,
                    text: nip,
                  },
                  versionId: model.getVersionId(),
                }],
              },
            });
          }
        }

        // Expand [set] == SetName into individual piece lines
        const setMatch = lineText.match(/\[set\]\s*==\s*(\w+)/);
        if (setMatch) {
          const name = setMatch[1];

          // Single set item → expand to NIP
          const setResult = resolveSetItem(name);
          if (setResult) {
            const rest = lineText.replace(/\[set\]\s*==\s*\w+/, '').trim();
            let nip = `[name] == ${setResult.classIdName} && [quality] == set`;
            if (setResult.discriminator.length > 0) {
              const discStr = setResult.discriminator.map(d => `[${d.statName}] ${d.op} ${d.value}`).join(' && ');
              if (rest.startsWith('#')) {
                const afterHash = rest.slice(1).trim();
                const metaIdx = afterHash.indexOf('#');
                if (metaIdx >= 0) {
                  nip += ` # ${discStr} && ${afterHash.slice(0, metaIdx).trim()} ${afterHash.slice(metaIdx).trim()}`;
                } else {
                  nip += ` # ${discStr}${afterHash ? ' && ' + afterHash : ''}`;
                }
              } else {
                nip += setResult.discriminator.length > 0 ? ` # ${discStr}` : '';
                if (rest) nip += ` ${rest}`;
              }
            } else if (rest) {
              nip += ` ${rest}`;
            }
            actions.push({
              title: `Expand to NIP: ${nip.length > 80 ? nip.slice(0, 77) + '...' : nip}`,
              kind: 'quickfix',
              edit: {
                edits: [{
                  resource: model.uri,
                  textEdit: {
                    range: {
                      startLineNumber: lineNumber,
                      endLineNumber: lineNumber,
                      startColumn: 1,
                      endColumn: lineText.length + 1,
                    } as Range,
                    text: nip,
                  },
                  versionId: model.getVersionId(),
                }],
              },
            });
          }

          // Full set name → expand to individual pieces
          const pieces = resolveSetName(name);
          if (pieces && pieces.length > 1) {
            const suffix = lineText.replace(/\[set\]\s*==\s*\w+/, '').trim();
            const expanded = pieces.map(key => {
              const item = setItems[key];
              if (!item) return '';
              const pascal = item.name.replace(/'/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim()
                .split(/\s+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
              return `[set] == ${pascal}${suffix ? ' ' + suffix : ''}`;
            }).filter(Boolean).join('\n');

            actions.push({
              title: `Expand to ${pieces.length} individual set pieces`,
              kind: 'quickfix',
              edit: {
                edits: [{
                  resource: model.uri,
                  textEdit: {
                    range: {
                      startLineNumber: lineNumber,
                      endLineNumber: lineNumber,
                      startColumn: 1,
                      endColumn: lineText.length + 1,
                    } as Range,
                    text: expanded,
                  },
                  versionId: model.getVersionId(),
                }],
              },
            });
          }
        }
      }

      return { actions, dispose() {} };
    },
  };
}
