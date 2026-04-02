import { NipFileNode } from '../types.js';
import type * as ESTree from 'estree';
import { EmitterConfig } from './types.js';
import { EmitterAST } from './emitter-ast.js';
import * as escodegen from 'escodegen';

/**
 * Public API for NIP compilation. Thin wrapper around EmitterAST + escodegen.
 *
 * Usage:
 *   emit(files)              → JavaScript string
 *   emitWithSourceMap(files)  → { code, map } with inline source locations
 *   emitAST(files)            → raw ESTree Program (for custom code generation)
 *   generate(ast, opts)       → JS string from AST (with optional source map)
 *
 * The emitted code is a self-contained function that takes a helpers object
 * with checkQuantityOwned, me, and getBaseStat. It returns { checkItem, getTier, getMercTier }.
 */
export class Emitter {
  constructor(private config: EmitterConfig) {}


  /**
   * Emit an ESTree AST from the NIP files.
   * Use generate() to convert to JS code + source map.
   */
  emitAST(files: NipFileNode[]): ESTree.Program {
    const astEmitter = new EmitterAST(this.config);
    return astEmitter.emitAST(files);
  }

  /**
   * Generate JS code (+ optional source map) from an ESTree AST.
   */
  generate(
    ast: ESTree.Program,
    options?: { sourceMap?: boolean; pretty?: boolean; minify?: boolean; file?: string },
  ): { code: string; map?: string } {
    const compact = options?.minify || options?.pretty === false;
    const genOptions: Record<string, any> = {
      comment: !options?.minify,
      format: {
        indent: { style: compact ? '' : '  ' },
        compact,
        newline: options?.minify ? '' : '\n',
        semicolons: true,
      },
    };
    if (options?.sourceMap) {
      genOptions.sourceMap = true;
      genOptions.sourceMapWithCode = true;
      const result = escodegen.generate(ast, genOptions) as any;
      const mapObj = JSON.parse(result.map.toString());
      if (options.file) mapObj.file = options.file;
      return { code: result.code, map: JSON.stringify(mapObj) };
    }
    return { code: escodegen.generate(ast, genOptions) as string };
  }

  emit(files: NipFileNode[]): string {
    const ast = this.emitAST(files);
    const { code } = this.generate(ast, {
      pretty: this.config.prettyPrint,
      minify: this.config.minify,
    });
    return code;
  }

  emitWithSourceMap(files: NipFileNode[], outputFilename = 'checkItem.js'): { code: string; map: string } {
    const ast = this.emitAST(files);
    const { code, map } = this.generate(ast, {
      sourceMap: true,
      pretty: this.config.prettyPrint,
      minify: this.config.minify,
      file: outputFilename,
    });
    return { code, map: map! };
  }
}
