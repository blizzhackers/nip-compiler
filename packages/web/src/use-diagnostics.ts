import { useEffect, useRef } from 'react';
import type { editor } from 'monaco-editor';
import { Parser, Binder, d2Aliases } from '@blizzhackers/nip-compiler';

const parser = new Parser();

const knownStats = new Set(Object.keys(d2Aliases.stat));
const knownPropertyValues = new Map<string, Set<string>>([
  ['name', new Set(Object.keys(d2Aliases.classId))],
  ['classid', new Set(Object.keys(d2Aliases.classId))],
  ['type', new Set(Object.keys(d2Aliases.type))],
  ['quality', new Set(Object.keys(d2Aliases.quality))],
  ['flag', new Set(Object.keys(d2Aliases.flag))],
  ['color', new Set(Object.keys(d2Aliases.color))],
  ['class', new Set(Object.keys(d2Aliases.class))],
]);
const binder = new Binder({ knownStats, knownPropertyValues });

export function useDiagnostics(
  monacoRef: React.MutableRefObject<typeof import('monaco-editor') | null>,
  editorRef: React.MutableRefObject<editor.IStandaloneCodeEditor | null>,
  content: string,
  filename: string,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const monaco = monacoRef.current;
      const ed = editorRef.current;
      if (!monaco || !ed) return;

      const model = ed.getModel();
      if (!model) return;

      const markers: editor.IMarkerData[] = [];

      try {
        const ast = parser.parseFile(content, filename);
        const result = binder.bindFile(ast);

        for (const diag of result.diagnostics) {
          markers.push({
            severity: diag.severity === 'error'
              ? monaco.MarkerSeverity.Error
              : monaco.MarkerSeverity.Warning,
            message: diag.message,
            startLineNumber: diag.loc.line,
            startColumn: diag.loc.col,
            endLineNumber: diag.loc.line,
            endColumn: diag.loc.col + 10,
          });
        }
      } catch (e: any) {
        // Parse error — extract line/col if available
        const line = e.line ?? 1;
        const col = e.col ?? 1;
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: e.message ?? String(e),
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: col + 20,
        });
      }

      monaco.editor.setModelMarkers(model, 'nip', markers);
    }, 300); // debounce 300ms

    return () => clearTimeout(timerRef.current);
  }, [content, filename, monacoRef, editorRef]);
}
