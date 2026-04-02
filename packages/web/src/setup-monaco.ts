import type { Monaco } from '@monaco-editor/react';
import { NIP_LANGUAGE_ID, JIP_LANGUAGE_ID, nipLanguageDef, nipTheme } from './nip-language';
import { createCompletionProvider } from './nip-completions';
import { createHoverProvider } from './nip-hover';
import { createCodeActionProvider } from './nip-codeactions';

let registered = false;

export function setupMonaco(monaco: Monaco) {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: NIP_LANGUAGE_ID });
  monaco.languages.register({ id: JIP_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(NIP_LANGUAGE_ID, nipLanguageDef);
  monaco.languages.setMonarchTokensProvider(JIP_LANGUAGE_ID, nipLanguageDef);
  const completions = createCompletionProvider(monaco);
  monaco.languages.registerCompletionItemProvider(NIP_LANGUAGE_ID, completions);
  monaco.languages.registerCompletionItemProvider(JIP_LANGUAGE_ID, completions);
  const hover = createHoverProvider();
  monaco.languages.registerHoverProvider(NIP_LANGUAGE_ID, hover);
  monaco.languages.registerHoverProvider(JIP_LANGUAGE_ID, hover);
  const codeActions = createCodeActionProvider(monaco);
  monaco.languages.registerCodeActionProvider(NIP_LANGUAGE_ID, codeActions);
  monaco.languages.registerCodeActionProvider(JIP_LANGUAGE_ID, codeActions);
  monaco.editor.defineTheme('nip-dark', nipTheme);
}
