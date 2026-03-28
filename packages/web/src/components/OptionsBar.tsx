import type { CompileOptions } from '../compiler';

interface Props {
  options: CompileOptions;
  onChange: (options: CompileOptions) => void;
}

export function OptionsBar({ options, onChange }: Props) {
  const toggle = (key: keyof CompileOptions) => {
    const next = { ...options, [key]: !options[key] };
    if (key === 'minify' && next.minify) next.prettyPrint = false;
    if (key === 'prettyPrint' && next.prettyPrint) next.minify = false;
    onChange(next);
  };

  return (
    <div className="options-bar">
      <label>
        <input type="checkbox" checked={options.kolbot} onChange={() => toggle('kolbot')} />
        Kolbot mode
      </label>
      <label>
        <input type="checkbox" checked={options.prettyPrint} onChange={() => toggle('prettyPrint')} />
        Pretty print
      </label>
      <label>
        <input type="checkbox" checked={options.minify} onChange={() => toggle('minify')} />
        Minify
      </label>
    </div>
  );
}
