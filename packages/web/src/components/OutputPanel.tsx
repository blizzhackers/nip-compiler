import { useCallback, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { CompileResult } from '../compiler';
import { NIP_LANGUAGE_ID } from '../nip-language';

interface Props {
  result: CompileResult | null;
  onNavigate?: (file: string, line: number) => void;
}

type OutputTab = 'js' | 'nip';

export function OutputPanel({ result, onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState<OutputTab>('js');

  const hasNip = result?.success && result.transpiledNip;
  const displayTab = hasNip ? activeTab : 'js';

  const handleCopy = useCallback(() => {
    if (!result?.success) return;
    const text = displayTab === 'nip' ? result.transpiledNip! : result.code;
    navigator.clipboard.writeText(text);
  }, [result, displayTab]);

  const handleDownload = useCallback(() => {
    if (!result?.success) return;
    const isNip = displayTab === 'nip';
    const text = isNip ? result.transpiledNip! : result.code;
    const blob = new Blob([text], { type: isNip ? 'text/plain' : 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isNip ? 'transpiled.nip' : 'checkItem.js';
    a.click();
    URL.revokeObjectURL(url);
  }, [result, displayTab]);

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
            const match = line.match(/^(\S+\.(?:nip|jip)):(\d+):\s*(.*)$/);
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
        {hasNip && (
          <div className="output-tabs">
            <button
              className={displayTab === 'js' ? 'active' : ''}
              onClick={() => setActiveTab('js')}
            >JavaScript</button>
            <button
              className={displayTab === 'nip' ? 'active' : ''}
              onClick={() => setActiveTab('nip')}
            >NIP (transpiled)</button>
          </div>
        )}
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
          language={displayTab === 'nip' ? NIP_LANGUAGE_ID : 'javascript'}
          theme="nip-dark"
          value={displayTab === 'nip' ? result.transpiledNip! : result.code}
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
