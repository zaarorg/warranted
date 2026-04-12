"use client";

const KEYWORDS = [
  "permit",
  "forbid",
  "when",
  "unless",
  "principal",
  "action",
  "resource",
  "context",
  "in",
  "true",
  "false",
];

export function CedarSourceViewer({ source }: { source: string }) {
  return (
    <pre className="bg-muted/50 border rounded-md p-4 text-sm font-mono overflow-x-auto leading-relaxed">
      {source.split("\n").map((line, i) => (
        <div key={i} className="flex">
          <span className="w-8 shrink-0 text-right pr-3 text-muted-foreground select-none">
            {i + 1}
          </span>
          <span>{highlightLine(line)}</span>
        </div>
      ))}
    </pre>
  );
}

function highlightLine(line: string): React.ReactNode {
  if (line.trimStart().startsWith("//")) {
    return <span className="text-muted-foreground italic">{line}</span>;
  }

  const parts: React.ReactNode[] = [];
  // Split by word boundaries while preserving whitespace and punctuation
  const tokens = line.split(/(\b|\s+)/);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (KEYWORDS.includes(token)) {
      parts.push(
        <span key={i} className="text-blue-600 dark:text-blue-400 font-semibold">
          {token}
        </span>,
      );
    } else if (token.startsWith('"') || token.startsWith("'")) {
      parts.push(
        <span key={i} className="text-green-600 dark:text-green-400">
          {token}
        </span>,
      );
    } else {
      parts.push(token);
    }
  }
  return <>{parts}</>;
}
