import type { languages } from 'monaco-editor';

export const NIP_LANGUAGE_ID = 'nip';

export const nipLanguageDef: languages.IMonarchLanguage = {
  defaultToken: '',
  ignoreCase: true,

  keywords: [
    'name', 'type', 'quality', 'flag', 'class', 'level', 'charlvl',
    'prefix', 'suffix', 'color', 'ladder', 'hardcore', 'classic',
    'wsm', 'weaponspeed', 'minimumsockets', 'strreq', 'dexreq',
    '2handed', 'distance', 'europe', 'uswest', 'useast', 'asia',
  ],

  metaKeywords: ['tier', 'merctier', 'maxquantity'],

  operators: ['==', '!=', '>=', '<=', '>', '<', '&&', '||', '+', '-', '*', '/'],

  tokenizer: {
    root: [
      // Line comment
      [/\/\/.*$/, 'comment'],

      // Block comment
      [/\/\*/, 'comment', '@blockComment'],

      // Section separator
      [/#/, 'delimiter.hash'],

      // Bracketed keywords
      [/\[/, 'delimiter.bracket', '@keyword'],

      // Parenthesized group
      [/[()]/, 'delimiter.parenthesis'],

      // Numbers (including negative)
      [/-?\d+(\.\d+)?([eE][+-]?\d+)?/, 'number'],

      // Operators
      [/[=!<>&|+\-*/]+/, 'operator'],

      // Identifiers (item names, quality names, etc.)
      [/[a-zA-Z_][\w']*(\.\w+)*/, {
        cases: {
          'in|notin': 'keyword.flow',
          '@default': 'identifier',
        },
      }],

      // Commas
      [/,/, 'delimiter.comma'],

      // Whitespace
      [/\s+/, 'white'],
    ],

    keyword: [
      [/[^\]]+/, 'variable.name'],
      [/\]/, 'delimiter.bracket', '@pop'],
    ],

    blockComment: [
      [/[^*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/./, 'comment'],
    ],
  },
};

export const nipTheme: { base: 'vs-dark'; inherit: boolean; rules: { token: string; foreground?: string; fontStyle?: string }[]; colors: Record<string, string> } = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '4a5568', fontStyle: 'italic' },
    { token: 'variable.name', foreground: '9cdcfe' },
    { token: 'delimiter.bracket', foreground: '569cd6' },
    { token: 'delimiter.hash', foreground: 'f59e0b' },
    { token: 'delimiter.parenthesis', foreground: '8b949e' },
    { token: 'delimiter.comma', foreground: '8b949e' },
    { token: 'number', foreground: 'f59e0b' },
    { token: 'operator', foreground: 'c084fc' },
    { token: 'identifier', foreground: '60a5fa' },
    { token: 'keyword.flow', foreground: 'c084fc' },
  ],
  colors: {
    'editor.background': '#0a0e14',
    'editor.foreground': '#b3b1ad',
    'editor.lineHighlightBackground': '#111820',
    'editor.selectionBackground': '#1a3a5c',
    'editorLineNumber.foreground': '#2a2f3a',
    'editorLineNumber.activeForeground': '#4a5568',
    'editorCursor.foreground': '#aeafad',
    'editor.selectionHighlightBackground': '#1a3a5c55',
  },
};
