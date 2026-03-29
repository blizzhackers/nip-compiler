import { useCallback } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { CompileResult } from '../compiler';

interface Props {
  result: CompileResult | null;
  onNavigate?: (file: string, line: number) => void;
}

export function OutputPanel({ result, onNavigate }: Props) {
  const handleCopy = useCallback(() => {
    if (result?.success) {
      navigator.clipboard.writeText(result.code);
    }
  }, [result]);

  const handleDownload = useCallback(() => {
    if (!result?.success) return;
    const blob = new Blob([result.code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'checkItem.js';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  if (!result) {
    return (
      <div className="output-panel empty">
        Click Compile to generate output
      </div>
    );
  }

  if (!result.success) {
    const errorLines = result.error.split('\n');
    return (
      <div className="output-panel error">
        <h3>Compilation Error</h3>
        <div className="error-list">
          {errorLines.map((line, i) => {
            const match = line.match(/^(\S+\.nip):(\d+):\s*(.*)$/);
            if (match && onNavigate) {
              const [, file, lineNum, msg] = match;
              return (
                <div key={i} className="error-item" onClick={() => onNavigate(file, parseInt(lineNum))}>
                  <span className="error-loc">{file}:{lineNum}</span>
                  <span className="error-msg">{msg}</span>
                </div>
              );
            }
            return <div key={i} className="error-item">{line}</div>;
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="output-panel">
      <div className="output-header">
        <span className="output-stats">
          {result.ruleCount} rules, {(result.code.length / 1024).toFixed(1)} KB
        </span>
        <div className="output-actions">
          <button onClick={handleCopy}>Copy</button>
          <button onClick={handleDownload}>Download</button>
        </div>
      </div>
      <div className="output-editor">
        <MonacoEditor
          language="javascript"
          theme="nip-dark"
          value={result.code}
          options={{
            readOnly: true,
            fontSize: 12,
            fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            folding: true,
            renderWhitespace: 'none',
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
          }}
        />
      </div>
    </div>
  );
}
