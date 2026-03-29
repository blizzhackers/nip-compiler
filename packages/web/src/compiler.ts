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
    const knownStats = new Set(Object.keys(d2Aliases.stat));
    const knownPropertyValues = new Map<string, Set<string>>([
      ['name', new Set(Object.keys(d2Aliases.classId))],
      ['classid', new Set(Object.keys(d2Aliases.classId))],
      ['type', new Set(Object.keys(d2Aliases.type))],
      ['quality', new Set(Object.keys(d2Aliases.quality))],
      ['flag', new Set(Object.keys(d2Aliases.flag))],
      ['color', new Set(Object.keys(d2Aliases.color))],
      ['class', new Set(Object.keys(d2Aliases.class))],
    ]);
    const binder = new Binder({
      knownStats,
      knownPropertyValues,
      propertyAliases: {
        name: d2Aliases.classId,
        classid: d2Aliases.classId,
        type: d2Aliases.type,
        quality: d2Aliases.quality,
      },
    });

    let ruleCount = 0;
    const errors: string[] = [];
    const parsed = files
      .filter(f => f.content.trim().length > 0)
      .map(f => {
        const ast = parser.parseFile(f.content, f.name);
        const result = binder.bindFile(ast);
        for (const diag of result.diagnostics) {
          if (diag.severity === 'error') {
            errors.push(`${f.name}:${diag.loc.line}: ${diag.message}`);
          }
        }
        ruleCount += ast.lines.filter(l => l.property || l.stats).length;
        return ast;
      });

    if (errors.length > 0) {
      return { success: false, error: errors.join('\n') };
    }

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
