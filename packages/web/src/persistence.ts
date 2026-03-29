import { getDefaultFiles, type NipFileEntry } from './nip-files';
import type { CompileOptions } from './compiler';

const STORAGE_KEY = 'nip-compiler';

interface PersistedState {
  enabled: string[];
  customFiles: { name: string; content: string }[];
  options: CompileOptions;
}

export function saveState(files: NipFileEntry[], options: CompileOptions): void {
  try {
    const state: PersistedState = {
      enabled: files.filter(f => f.enabled).map(f => f.name),
      customFiles: files
        .filter(f => !f.builtin)
        .map(f => ({ name: f.name, content: f.content })),
      options,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function loadState(): { files: NipFileEntry[]; options: CompileOptions } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state: PersistedState = JSON.parse(raw);

    const defaults = getDefaultFiles();
    const enabledSet = new Set(state.enabled);

    // Restore enabled state on builtins
    const files: NipFileEntry[] = defaults.map(f => ({
      ...f,
      enabled: enabledSet.has(f.name),
    }));

    // Add custom files
    for (const cf of state.customFiles) {
      files.push({
        name: cf.name,
        content: cf.content,
        enabled: enabledSet.has(cf.name),
        builtin: false,
      });
    }

    return { files, options: state.options };
  } catch {
    return null;
  }
}
