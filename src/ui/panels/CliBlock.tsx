// The generated CLI script with copy and download.
import { useState, type ReactNode } from 'react';

function highlight(line: string, key: number): ReactNode {
  if (line.startsWith('#')) {
    return (
      <span key={key} className="c">
        {line}
      </span>
    );
  }
  const set = line.match(/^(set)(\s+)(\S+)(\s*=\s*)(.*)$/);
  if (set) {
    return (
      <span key={key}>
        <span className="k">{set[1]}</span>
        {set[2]}
        <span className="n">{set[3]}</span>
        {set[4]}
        <span className="v">{set[5]}</span>
      </span>
    );
  }
  return (
    <span key={key} className="k">
      {line}
    </span>
  );
}

export function CliBlock({ script, fileName }: { script: string; fileName: string }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const lines = script.split('\n');
  const commandCount = lines.filter((l) => l.trim() && !l.startsWith('#')).length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied('idle'), 2200);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([script], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div>
      <div className="cli-toolbar">
        <strong className="grow">
          CLI script <span className="hint tabular">({commandCount} commands)</span>
        </strong>
        <button type="button" className="btn primary" onClick={copy}>
          {copied === 'done' ? 'Copied ✓' : copied === 'failed' ? 'Copy blocked: select the text' : 'Copy to clipboard'}
        </button>
        <button type="button" className="btn" onClick={download}>
          Download .txt
        </button>
      </div>
      <pre className="cli" tabIndex={0} aria-label="Generated CLI script">
        {lines.map((line, i) => (
          <span key={i}>
            {highlight(line, i)}
            {'\n'}
          </span>
        ))}
      </pre>
      <p className="hint">Betaflight App → CLI tab → paste → Enter. The last line saves and reboots.</p>
    </div>
  );
}
