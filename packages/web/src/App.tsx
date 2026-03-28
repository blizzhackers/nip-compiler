import { useState, useCallback } from 'react';
import { compile, type CompileOptions, type CompileResult } from './compiler';
import { getDefaultFiles, type NipFileEntry } from './nip-files';
import { FileTree } from './components/FileTree';
import { Editor } from './components/Editor';
import { OutputPanel } from './components/OutputPanel';
import { OptionsBar } from './components/OptionsBar';
import './App.css';

export function App() {
  const [files, setFiles] = useState<NipFileEntry[]>(getDefaultFiles);
  const [activeIdx, setActiveIdx] = useState(0);
  const [options, setOptions] = useState<CompileOptions>({
    kolbot: true,
    prettyPrint: true,
    minify: false,
  });
  const [result, setResult] = useState<CompileResult | null>(null);

  const handleCompile = useCallback(() => {
    const enabled = files.filter(f => f.enabled);
    setResult(compile(enabled, options));
  }, [files, options]);

  const handleToggle = useCallback((idx: number) => {
    setFiles(prev => prev.map((f, i) => i === idx ? { ...f, enabled: !f.enabled } : f));
  }, []);

  const handleSelect = useCallback((idx: number) => {
    setActiveIdx(idx);
  }, []);

  const handleContentChange = useCallback((content: string) => {
    setFiles(prev => prev.map((f, i) => i === activeIdx ? { ...f, content } : f));
  }, [activeIdx]);

  const handleAddFile = useCallback(() => {
    const name = `custom${files.filter(f => !f.builtin).length + 1}.nip`;
    setFiles(prev => [...prev, { name, content: '', enabled: true, builtin: false }]);
    setActiveIdx(files.length);
  }, [files]);

  const handleUpload = useCallback((uploaded: { name: string; content: string }[]) => {
    const newFiles = uploaded.map(f => ({ ...f, enabled: true, builtin: false }));
    setFiles(prev => [...prev, ...newFiles]);
    setActiveIdx(files.length + uploaded.length - 1);
  }, [files]);

  const handleRemove = useCallback((idx: number) => {
    const f = files[idx];
    if (f.builtin) return;
    setFiles(prev => prev.filter((_, i) => i !== idx));
    setActiveIdx(prev => Math.min(prev, files.length - 2));
  }, [files]);

  const handleRename = useCallback((idx: number, name: string) => {
    setFiles(prev => prev.map((f, i) => i === idx ? { ...f, name } : f));
  }, []);

  const active = files[activeIdx] ?? files[0];

  return (
    <div className="app">
      <header className="header">
        <h1>NIP Compiler</h1>
        <span className="header-sub">Compile .nip pickit files to optimized JavaScript</span>
      </header>

      <div className="main">
        <aside className="sidebar">
          <FileTree
            files={files}
            activeIdx={activeIdx}
            onToggle={handleToggle}
            onSelect={handleSelect}
            onAdd={handleAddFile}
            onUpload={handleUpload}
            onRemove={handleRemove}
          />
        </aside>

        <section className="editor-section">
          <div className="editor-header">
            <input
              className="filename-input"
              value={active?.name ?? ''}
              onChange={e => handleRename(activeIdx, e.target.value)}
              disabled={active?.builtin}
            />
            <span className="line-count">
              {active?.content.split('\n').length ?? 0} lines
            </span>
          </div>
          <Editor
            value={active?.content ?? ''}
            onChange={handleContentChange}
            filename={active?.name ?? 'untitled.nip'}
          />
        </section>

        <section className="output-section">
          <div className="compile-bar">
            <OptionsBar options={options} onChange={setOptions} />
            <button className="compile-btn" onClick={handleCompile}>
              Compile ({files.filter(f => f.enabled).length} files)
            </button>
          </div>
          <OutputPanel result={result} />
        </section>
      </div>
    </div>
  );
}
