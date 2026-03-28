import type { Monaco } from '@monaco-editor/react';
import { NIP_LANGUAGE_ID, nipLanguageDef, nipTheme } from './nip-language';

let registered = false;

export function setupMonaco(monaco: Monaco) {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: NIP_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(NIP_LANGUAGE_ID, nipLanguageDef);
  monaco.editor.defineTheme('nip-dark', nipTheme);
}
