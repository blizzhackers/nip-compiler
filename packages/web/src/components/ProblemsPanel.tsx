import type { Diagnostic } from '@blizzhackers/nip-compiler';
import type { CompileResult } from '../compiler';

interface Props {
  result: CompileResult | null;
  onNavigate: (file: string, line: number) => void;
}

export function ProblemsPanel({ result, onNavigate }: Props) {
  const warnings = result?.success ? result.warnings : [];
  const errors = !result ? [] : result.success ? [] : [result.error];

  const total = errors.length + warnings.length;

  if (total === 0) {
    return (
      <div className="problems-panel">
        <div className="problems-header">
          <span>Problems</span>
          <span className="problems-count">0</span>
        </div>
      </div>
    );
  }

  return (
    <div className="problems-panel">
      <div className="problems-header">
        <span>Problems</span>
        <span className="problems-count">{total}</span>
      </div>
      <div className="problems-list">
        {errors.map((err, i) => (
          <div key={`e-${i}`} className="problem-item problem-error">
            <span className="problem-icon">E</span>
            <span className="problem-message">{err}</span>
          </div>
        ))}
        {warnings.map((w, i) => (
          <ProblemRow key={`w-${i}`} diag={w} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

function ProblemRow({ diag, onNavigate }: { diag: Diagnostic; onNavigate: (file: string, line: number) => void }) {
  const file = diag.file ?? diag.loc.line.toString();
  const line = diag.line ?? diag.loc.line;
  const icon = diag.severity === 'warning' ? 'W' : 'I';
  const cls = diag.severity === 'warning' ? 'problem-warning' : 'problem-info';

  return (
    <div
      className={`problem-item ${cls}`}
      onClick={() => onNavigate(file, line)}
    >
      <span className="problem-icon">{icon}</span>
      <span className="problem-message">{diag.message}</span>
      <span className="problem-location">{file}:{line}</span>
    </div>
  );
}
