import type { Monaco } from '@monaco-editor/react';
import { NIP_LANGUAGE_ID, nipLanguageDef, nipTheme } from './nip-language';
import { createCompletionProvider } from './nip-completions';
import { createHoverProvider } from './nip-hover';

let registered = false;

export function setupMonaco(monaco: Monaco) {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: NIP_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(NIP_LANGUAGE_ID, nipLanguageDef);
  monaco.languages.registerCompletionItemProvider(NIP_LANGUAGE_ID, createCompletionProvider(monaco));
  monaco.languages.registerHoverProvider(NIP_LANGUAGE_ID, createHoverProvider());
  monaco.editor.defineTheme('nip-dark', nipTheme);
}
