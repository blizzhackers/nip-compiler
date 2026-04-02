import { Parser, Binder, Emitter, OutputFormat, DispatchStrategy, d2Aliases, DiagnosticAnalyzer, Analyzer, Grouper, printLine } from '@blizzhackers/nip-compiler';
import type { Diagnostic, JipLanguage } from '@blizzhackers/nip-compiler';

export interface CompileOptions {
  kolbot: boolean;
  prettyPrint: boolean;
  minify: boolean;
  dispatchStrategy: 'switch' | 'object-lookup';
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
  warnings: Diagnostic[];
  transpiledNip?: string;
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
    const binderOptions = {
      knownStats,
      knownPropertyValues,
      propertyAliases: {
        name: d2Aliases.classId,
        classid: d2Aliases.classId,
        type: d2Aliases.type,
        quality: d2Aliases.quality,
      },
    };

    let ruleCount = 0;
    const errors: string[] = [];
    const parsed = files
      .filter(f => f.content.trim().length > 0)
      .map(f => {
        const language: JipLanguage = f.name.endsWith('.jip') ? 'jip' : 'nip';
        const binder = new Binder({ ...binderOptions, language });
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

    // Generate transpiled NIP for any .jip files (after binder rewrites AST)
    const hasJip = files.some(f => f.name.endsWith('.jip'));
    let transpiledNip: string | undefined;
    if (hasJip) {
      const nipLines: string[] = [];
      for (const file of parsed) {
        if (!file.filename.endsWith('.jip')) continue;
        nipLines.push(`// ${file.filename}`);
        for (const line of file.lines) {
          if (line.property || line.stats) {
            const nip = printLine(line);
            nipLines.push(nip + (line.comment ? ' // ' + line.comment.trim() : ''));
          }
        }
      }
      transpiledNip = nipLines.join('\n');
    }

    const emitter = new Emitter({
      aliases: d2Aliases,
      kolbotCompat: options.kolbot,
      prettyPrint: options.prettyPrint,
      minify: options.minify,
      includeSourceComments: true,
      outputFormat: options.kolbot ? OutputFormat.CJS : OutputFormat.IIFE,
      dispatchStrategy: options.dispatchStrategy === 'object-lookup'
        ? DispatchStrategy.ObjectLookup : DispatchStrategy.Switch,
    });

    // Cross-file semantic analysis
    const analyzer = new Analyzer(d2Aliases);
    const grouper = new Grouper(d2Aliases);
    const allLines = parsed.flatMap(f =>
      f.lines
        .filter(l => l.property || l.stats)
        .map((l, i) => analyzer.analyze(l, i, f.filename))
    );
    const plan = grouper.group(allLines);
    const diagAnalyzer = new DiagnosticAnalyzer();
    const warnings = diagAnalyzer.analyze(plan, allLines);

    const result = emitter.emitWithSourceMap(parsed, 'checkItem.js');
    const mapBase64 = btoa(result.map);
    const code = result.code.replace(
      /\/\/# sourceMappingURL=.*$/m,
      `//# sourceMappingURL=data:application/json;base64,${mapBase64}`,
    );
    return { success: true, code, ruleCount, warnings, transpiledNip };
  } catch (e: any) {
    return { success: false, error: e.message ?? String(e) };
  }
}
