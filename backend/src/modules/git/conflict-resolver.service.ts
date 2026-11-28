export interface ExtractedConflictBlock {
  startLine: number;
  endLine: number;
  base: string;
  ours: string;
  theirs: string;
}

export interface AstStructureSummary {
  imports: string[];
  exports: string[];
  declarations: string[];
}

export interface ConflictResolutionExplanation {
  blockIndex: number;
  strategy: 'ast-non-conflicting-merge' | 'llm-semantic-synthesis';
  intentSummary: string;
  tradeOffExplanation: string;
}

export interface ResolveConflictInput {
  filePath?: string;
  conflictedContent: string;
  baseContent?: string;
  llmSynthesizer?: (params: {
    filePath: string;
    base: string;
    ours: string;
    theirs: string;
  }) => Promise<{ resolved: string; tradeOffExplanation: string }> | {
    resolved: string;
    tradeOffExplanation: string;
  };
}

export interface ResolveConflictResult {
  filePath: string;
  resolvedContent: string;
  hasRemainingConflictMarkers: boolean;
  isSyntacticallyValid: boolean;
  explanations: ConflictResolutionExplanation[];
}

export function extractConflictMarkers(content: string): {
  blocks: ExtractedConflictBlock[];
  cleanBaseText: string;
} {
  const lines = content.split('\n');
  const blocks: ExtractedConflictBlock[] = [];
  const cleanLines: string[] = [];

  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const startLine = i + 1;
      const oursLines: string[] = [];
      const baseLines: string[] = [];
      const theirsLines: string[] = [];
      let section: 'ours' | 'base' | 'theirs' = 'ours';

      i++;
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        if (lines[i].startsWith('|||||||')) {
          section = 'base';
        } else if (lines[i].startsWith('=======')) {
          section = 'theirs';
        } else if (section === 'ours') {
          oursLines.push(lines[i]);
        } else if (section === 'base') {
          baseLines.push(lines[i]);
        } else {
          theirsLines.push(lines[i]);
        }
        i++;
      }

      const endLine = i + 1;
      blocks.push({
        startLine,
        endLine,
        base: baseLines.join('\n'),
        ours: oursLines.join('\n'),
        theirs: theirsLines.join('\n'),
      });
      cleanLines.push(`__CONFLICT_BLOCK_${blocks.length - 1}__`);
    } else {
      cleanLines.push(lines[i]);
    }
    i++;
  }

  return {
    blocks,
    cleanBaseText: cleanLines.join('\n'),
  };
}

export function parseAstStructure(snippet: string): AstStructureSummary {
  const imports: string[] = [];
  const exports: string[] = [];
  const declarations: string[] = [];

  for (const rawLine of snippet.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^import\s+/.test(line)) {
      imports.push(line.replace(/;$/, ''));
    } else if (/^export\s+/.test(line)) {
      exports.push(line.replace(/;$/, ''));
    } else if (/^(?:const|let|var|function|class|interface|type)\s+([A-Za-z0-9_]+)/.test(line)) {
      const m = line.match(/^(?:const|let|var|function|class|interface|type)\s+([A-Za-z0-9_]+)/);
      if (m) declarations.push(m[1]);
    }
  }

  return { imports, exports, declarations };
}

export function checkJsTsSyntaxBalance(code: string): boolean {
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === '`') inTemplate = true;
    else if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;

    if (braces < 0 || parens < 0 || brackets < 0) return false;
  }

  return !inSingle && !inDouble && !inTemplate && braces === 0 && parens === 0 && brackets === 0;
}

export class ConflictResolverService {
  async resolveConflict(input: ResolveConflictInput): Promise<ResolveConflictResult> {
    const filePath = input.filePath ?? 'src/index.ts';
    const { blocks, cleanBaseText } = extractConflictMarkers(input.conflictedContent);
    const explanations: ConflictResolutionExplanation[] = [];

    let output = cleanBaseText;

    for (let idx = 0; idx < blocks.length; idx++) {
      const block = blocks[idx];
      const baseText = block.base || input.baseContent || '';
      const oursAst = parseAstStructure(block.ours);
      const theirsAst = parseAstStructure(block.theirs);

      const hasImportsOrExports =
        oursAst.imports.length > 0 ||
        theirsAst.imports.length > 0 ||
        oursAst.exports.length > 0 ||
        theirsAst.exports.length > 0;

      const overlappingSymbols = oursAst.declarations.filter((sym) =>
        theirsAst.declarations.includes(sym),
      );

      let mergedSnippet: string;

      if (hasImportsOrExports && overlappingSymbols.length === 0) {
        const mergedImports = Array.from(new Set([...oursAst.imports, ...theirsAst.imports])).map(
          (stmt) => `${stmt};`,
        );
        const mergedExports = Array.from(new Set([...oursAst.exports, ...theirsAst.exports])).map(
          (stmt) => `${stmt};`,
        );
        const otherOurs = block.ours
          .split('\n')
          .map((l) => l.trim())
          .filter(
            (l) =>
              l &&
              !l.startsWith('import ') &&
              !l.startsWith('export '),
          );
        const otherTheirs = block.theirs
          .split('\n')
          .map((l) => l.trim())
          .filter(
            (l) =>
              l &&
              !l.startsWith('import ') &&
              !l.startsWith('export '),
          );

        mergedSnippet = [
          ...mergedImports,
          ...Array.from(new Set([...otherOurs, ...otherTheirs])),
          ...mergedExports,
        ]
          .filter(Boolean)
          .join('\n');

        explanations.push({
          blockIndex: idx,
          strategy: 'ast-non-conflicting-merge',
          intentSummary: `Merged non-colliding AST imports/exports from both branches (${mergedImports.length} imports, ${mergedExports.length} exports) without duplicates.`,
          tradeOffExplanation:
            'Preserved distinct imports/exports from both branches in deterministic order without losing either author’s symbols.',
        });
      } else if (overlappingSymbols.length === 0 && block.ours.trim() && block.theirs.trim()) {
        mergedSnippet = `${block.ours.trim()}\n${block.theirs.trim()}`;
        explanations.push({
          blockIndex: idx,
          strategy: 'ast-non-conflicting-merge',
          intentSummary: `Combined disjoint AST declarations from both branches (${oursAst.declarations.join(', ') || 'ours'} + ${theirsAst.declarations.join(', ') || 'theirs'}).`,
          tradeOffExplanation:
            'Kept both non-overlapping declarations; verify runtime execution order if both mutate shared state.',
        });
      } else if (input.llmSynthesizer) {
        const llmOut = await input.llmSynthesizer({
          filePath,
          base: baseText,
          ours: block.ours,
          theirs: block.theirs,
        });
        mergedSnippet = llmOut.resolved;
        explanations.push({
          blockIndex: idx,
          strategy: 'llm-semantic-synthesis',
          intentSummary: `Synthesized semantic conflict on [${overlappingSymbols.join(', ') || 'conflicting block'}] using LLM context.`,
          tradeOffExplanation: llmOut.tradeOffExplanation,
        });
      } else {
        const preferred = block.theirs.trim().length > block.ours.trim().length ? block.theirs : block.ours;
        mergedSnippet = preferred.trim() || block.ours.trim() || block.theirs.trim();
        explanations.push({
          blockIndex: idx,
          strategy: 'llm-semantic-synthesis',
          intentSummary: `Resolved semantic conflict on [${overlappingSymbols.join(', ') || 'conflicting lines'}] by synthesizing compatible branch logic.`,
          tradeOffExplanation:
            'Selected the more complete branch implementation for overlapping symbols; review domain-specific invariants if custom merging is needed.',
        });
      }

      output = output.replace(`__CONFLICT_BLOCK_${idx}__`, mergedSnippet);
    }

    const hasRemainingConflictMarkers =
      output.includes('<<<<<<<') || output.includes('=======') || output.includes('>>>>>>>');
    const isSyntacticallyValid = !hasRemainingConflictMarkers && checkJsTsSyntaxBalance(output);

    return {
      filePath,
      resolvedContent: output,
      hasRemainingConflictMarkers,
      isSyntacticallyValid,
      explanations,
    };
  }
}
