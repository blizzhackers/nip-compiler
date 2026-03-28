import { useCallback } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { CompileResult } from '../compiler';

interface Props {
  result: CompileResult | null;
}

export function OutputPanel({ result }: Props) {
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
    return (
      <div className="output-panel error">
        <h3>Compilation Error</h3>
        <pre>{result.error}</pre>
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
