import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { compile, type CompileOptions, type CompileResult } from './compiler';
import { getDefaultFiles, type NipFileEntry } from './nip-files';
import { saveState, loadState } from './persistence';
import { getFileDiagnostics } from './use-diagnostics';
import { FileTree } from './components/FileTree';
import { Editor, type EditorHandle } from './components/Editor';
import { OutputPanel } from './components/OutputPanel';
import { OptionsBar } from './components/OptionsBar';
import { ResizeHandle } from './components/ResizeHandle';
import { ResizeHandleH } from './components/ResizeHandleH';
import { ProblemsPanel } from './components/ProblemsPanel';
import './App.css';

const defaultOptions: CompileOptions = { kolbot: true, prettyPrint: true, minify: false };

export function App() {
  const [files, setFiles] = useState<NipFileEntry[]>(() => {
    const saved = loadState();
    return saved ? saved.files : getDefaultFiles();
  });
  const [activeIdx, setActiveIdx] = useState(0);
  const [options, setOptions] = useState<CompileOptions>(() => {
    const saved = loadState();
    return saved ? saved.options : defaultOptions;
  });
  const [result, setResult] = useState<CompileResult | null>(null);

  // Persist state to localStorage
  useEffect(() => { saveState(files, options); }, [files, options]);

  // Auto-compile on change (debounced)
  const compileTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(compileTimer.current);
    compileTimer.current = setTimeout(() => {
      const enabled = files.filter(f => f.enabled);
      if (enabled.length > 0) {
        setResult(compile(enabled, options));
      }
    }, 500);
    return () => clearTimeout(compileTimer.current);
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

  const handleNavigate = useCallback((file: string, line: number) => {
    const idx = files.findIndex(f => f.name === file);
    if (idx >= 0) {
      setActiveIdx(idx);
      // If same file, reveal immediately. If switching, queue it.
      if (idx === activeIdx) {
        editorRef.current?.revealLine(line);
      } else {
        pendingLine.current = line;
      }
    }
  }, [files, activeIdx]);

  useEffect(() => {
    if (pendingLine.current !== null) {
      const line = pendingLine.current;
      pendingLine.current = null;
      setTimeout(() => editorRef.current?.revealLine(line), 50);
    }
  }, [activeIdx]);

  const handleRename = useCallback((idx: number, name: string) => {
    setFiles(prev => prev.map((f, i) => i === idx ? { ...f, name } : f));
  }, []);

  const fileDiagnostics = useMemo(() =>
    files.map(f => getFileDiagnostics(f.content, f.name)),
    [files],
  );

  const active = files[activeIdx] ?? files[0];
  const mainRef = useRef<HTMLDivElement>(null);
  const [editorWidth, setEditorWidth] = useState<number | null>(null);
  const [problemsHeight, setProblemsHeight] = useState(150);
  const [dropping, setDropping] = useState(false);
  const editorRef = useRef<EditorHandle>(null);
  const pendingLine = useRef<number | null>(null);

  const handleProblemsResize = useCallback((deltaY: number) => {
    setProblemsHeight(prev => Math.max(50, Math.min(500, prev - deltaY)));
  }, []);

  const handleResize = useCallback((deltaX: number) => {
    setEditorWidth(prev => {
      const main = mainRef.current;
      if (!main) return prev;
      const available = main.clientWidth - 200 - 4; // sidebar + handle
      const current = prev ?? available / 2;
      return Math.max(200, Math.min(available - 200, current + deltaX));
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropping(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropping(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const uploaded: { name: string; content: string }[] = [];
    for (const file of Array.from(e.dataTransfer.files)) {
      if (file.name.endsWith('.nip')) {
        uploaded.push({ name: file.name, content: await file.text() });
      }
    }
    if (uploaded.length > 0) handleUpload(uploaded);
  }, [handleUpload]);

  return (
    <div
      className={`app ${dropping ? 'dropping' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="header">
        <h1>NIP Compiler</h1>
        <span className="header-sub">Compile .nip pickit files to optimized JavaScript</span>
        <a className="header-gh" href="https://github.com/blizzhackers/nip-compiler" target="_blank" rel="noopener">GitHub</a>
      </header>

      <div className="main" ref={mainRef} style={{
        gridTemplateColumns: editorWidth
          ? `200px ${editorWidth}px 4px 1fr`
          : '200px 3fr 4px 2fr',
      }}>
        <aside className="sidebar">
          <FileTree
            files={files}
            activeIdx={activeIdx}
            diagnostics={fileDiagnostics}
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
          <div className="editor-wrapper">
            <Editor
              ref={editorRef}
              value={active?.content ?? ''}
              onChange={handleContentChange}
              filename={active?.name ?? 'untitled.nip'}
            />
          </div>
          <ResizeHandleH onResize={handleProblemsResize} />
          <div className="problems-wrapper" style={{ height: problemsHeight }}>
            <ProblemsPanel result={result} onNavigate={handleNavigate} />
          </div>
        </section>

        <ResizeHandle onResize={handleResize} />

        <section className="output-section">
          <div className="compile-bar">
            <OptionsBar options={options} onChange={setOptions} />
          </div>
          <OutputPanel result={result} />
        </section>
      </div>
    </div>
  );
}
