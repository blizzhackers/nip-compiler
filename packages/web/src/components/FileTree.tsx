import { useRef, type ChangeEvent } from 'react';
import type { NipFileEntry } from '../nip-files';

interface Props {
  files: NipFileEntry[];
  activeIdx: number;
  diagnostics: { errors: number; warnings: number }[];
  onToggle: (idx: number) => void;
  onSelect: (idx: number) => void;
  onAdd: () => void;
  onUpload: (files: { name: string; content: string }[]) => void;
  onRemove: (idx: number) => void;
}

export function FileTree({ files, activeIdx, diagnostics, onToggle, onSelect, onAdd, onUpload, onRemove }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const uploaded: { name: string; content: string }[] = [];
    for (const file of Array.from(e.target.files ?? [])) {
      uploaded.push({ name: file.name, content: await file.text() });
    }
    if (uploaded.length > 0) onUpload(uploaded);
    e.target.value = '';
  };

  const builtins = files.filter(f => f.builtin);
  const custom = files.filter(f => !f.builtin);

  return (
    <div className="file-tree">
      <div className="tree-section">
        <div className="tree-header">pickit/</div>
        {builtins.map((f) => {
          const globalIdx = files.indexOf(f);
          const diag = diagnostics[globalIdx];
          return (
            <div
              key={f.name}
              className={`tree-item ${globalIdx === activeIdx ? 'active' : ''}`}
              onClick={() => onSelect(globalIdx)}
            >
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={e => { e.stopPropagation(); onToggle(globalIdx); }}
              />
              <span className="tree-name">{f.name}</span>
              {diag?.errors > 0 && <span className="badge badge-error">{diag.errors}</span>}
              {diag?.warnings > 0 && <span className="badge badge-warn">{diag.warnings}</span>}
            </div>
          );
        })}
      </div>

      {custom.length > 0 && (
        <div className="tree-section">
          <div className="tree-header">custom/</div>
          {custom.map(f => {
            const globalIdx = files.indexOf(f);
            const diag = diagnostics[globalIdx];
            return (
              <div
                key={`custom-${globalIdx}`}
                className={`tree-item ${globalIdx === activeIdx ? 'active' : ''}`}
                onClick={() => onSelect(globalIdx)}
              >
                <input
                  type="checkbox"
                  checked={f.enabled}
                  onChange={e => { e.stopPropagation(); onToggle(globalIdx); }}
                />
                <span className="tree-name">{f.name}</span>
                {diag?.errors > 0 && <span className="badge badge-error">{diag.errors}</span>}
                {diag?.warnings > 0 && <span className="badge badge-warn">{diag.warnings}</span>}
                <button
                  className="tree-remove"
                  onClick={e => { e.stopPropagation(); onRemove(globalIdx); }}
                >
                  x
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="tree-actions">
        <button onClick={onAdd}>+ New file</button>
        <button onClick={() => fileInputRef.current?.click()}>Upload .nip</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".nip"
          multiple
          hidden
          onChange={handleUpload}
        />
      </div>
    </div>
  );
}
