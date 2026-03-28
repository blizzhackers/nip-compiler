import { Parser, Binder, Emitter, OutputFormat, d2Aliases } from '@blizzhackers/nip-compiler';

export interface CompileOptions {
  kolbot: boolean;
  prettyPrint: boolean;
  minify: boolean;
}

export interface NipFile {
  name: string;
  content: string;
}

export type CompileResult = CompileSuccess | CompileError;

interface CompileSuccess {
  success: true;
  code: string;
  ruleCount: number;
}

interface CompileError {
  success: false;
  error: string;
}

export function compile(files: NipFile[], options: CompileOptions): CompileResult {
  try {
    const parser = new Parser();
    const binder = new Binder();

    let ruleCount = 0;
    const parsed = files
      .filter(f => f.content.trim().length > 0)
      .map(f => {
        const ast = parser.parseFile(f.content, f.name);
        binder.bindFile(ast);
        ruleCount += ast.lines.filter(l => l.property || l.stats).length;
        return ast;
      });

    if (parsed.length === 0) {
      return { success: false, error: 'No files to compile' };
    }

    const emitter = new Emitter({
      aliases: d2Aliases,
      kolbotCompat: options.kolbot,
      prettyPrint: options.prettyPrint,
      minify: options.minify,
      includeSourceComments: true,
      outputFormat: options.kolbot ? OutputFormat.CJS : OutputFormat.IIFE,
    });

    const result = emitter.emitWithSourceMap(parsed, 'checkItem.js');
    // Inline the source map as base64 data URL
    const mapBase64 = btoa(result.map);
    const code = result.code.replace(
      /\/\/# sourceMappingURL=.*$/m,
      `//# sourceMappingURL=data:application/json;base64,${mapBase64}`,
    );
    return { success: true, code, ruleCount };
  } catch (e: any) {
    return { success: false, error: e.message ?? String(e) };
  }
}
