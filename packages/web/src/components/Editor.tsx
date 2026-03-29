import { useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import MonacoEditor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { NIP_LANGUAGE_ID } from '../nip-language';
import { setupMonaco } from '../setup-monaco';
import { useDiagnostics } from '../use-diagnostics';

interface Props {
  value: string;
  onChange: (value: string) => void;
  filename: string;
}

export interface EditorHandle {
  revealLine: (line: number) => void;
}

export const Editor = forwardRef<EditorHandle, Props>(({ value, onChange, filename }, ref) => {
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  useImperativeHandle(ref, () => ({
    revealLine(line: number) {
      const ed = editorRef.current;
      if (!ed) return;
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
      ed.focus();
    },
  }));

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    setupMonaco(monaco);
    monacoRef.current = monaco;
  }, []);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
  }, []);

  useDiagnostics(monacoRef, editorRef, value, filename);

  return (
    <MonacoEditor
      language={NIP_LANGUAGE_ID}
      theme="nip-dark"
      value={value}
      onChange={v => onChange(v ?? '')}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        fontSize: 13,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        minimap: { enabled: false },
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        renderWhitespace: 'none',
        tabSize: 2,
        wordBasedSuggestions: 'off',
        quickSuggestions: { other: true, strings: false, comments: false },
        suggestOnTriggerCharacters: true,
        automaticLayout: true,
        glyphMargin: true,
        folding: false,
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      }}
    />
  );
});
