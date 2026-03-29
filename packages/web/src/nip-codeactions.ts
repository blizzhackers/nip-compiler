import type { languages, editor, Range } from 'monaco-editor';
import { getAvailableRewrites, d2Aliases } from '@blizzhackers/nip-compiler';

export function createCodeActionProvider(monaco: typeof import('monaco-editor')): languages.CodeActionProvider {
  return {
    provideCodeActions(model: editor.ITextModel, range: Range) {
      const lineNumber = range.startLineNumber;
      const lineText = model.getLineContent(lineNumber);
      const col = range.startColumn;

      const rewrites = getAvailableRewrites(lineText, col, d2Aliases);
      if (rewrites.length === 0) return { actions: [], dispose() {} };

      const actions: languages.CodeAction[] = rewrites.map(r => ({
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
      }));

      return { actions, dispose() {} };
    },
  };
}
