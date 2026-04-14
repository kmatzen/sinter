import { useState, useEffect, useRef } from 'react';

interface Props {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

// Safe math expression evaluator — no eval/Function, just recursive descent parsing.
// Supports: + - * / ( ) and numbers (including decimals and negatives)
function evalExpression(expr: string): number | null {
  const tokens = expr.match(/(\d+\.?\d*|\.\d+|[+\-*/()])/g);
  if (!tokens || tokens.length === 0) return null;
  const t = tokens;
  let pos = 0;

  function peek(): string | undefined { return t[pos]; }
  function next(): string { return t[pos++]; }

  function parseExpr(): number {
    let result = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const right = parseTerm();
      result = op === '+' ? result + right : result - right;
    }
    return result;
  }

  function parseTerm(): number {
    let result = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const right = parseFactor();
      result = op === '*' ? result * right : result / right;
    }
    return result;
  }

  function parseFactor(): number {
    if (peek() === '(') {
      next();
      const result = parseExpr();
      if (peek() === ')') next();
      return result;
    }
    if (peek() === '-') {
      next();
      return -parseFactor();
    }
    const val = parseFloat(next());
    if (isNaN(val)) return 0;
    return val;
  }

  try {
    const result = parseExpr();
    if (pos < tokens.length) return null;
    if (!isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

export function NumberInput({ label, value, unit = 'mm', min, max, step = 1, onChange }: Props) {
  const [localValue, setLocalValue] = useState(String(value));
  const [isExpr, setIsExpr] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(String(value));
      setIsExpr(false);
    }
  }, [value, isFocused]);

  const commit = () => {
    const exprResult = evalExpression(localValue);
    let num = exprResult !== null ? exprResult : parseFloat(localValue);

    if (isNaN(num)) {
      setLocalValue(String(value));
      setIsExpr(false);
      return;
    }
    if (min !== undefined) num = Math.max(min, num);
    if (max !== undefined) num = Math.min(max, num);
    num = Math.round(num * 1000) / 1000;

    setLocalValue(String(num));
    setIsExpr(false);
    if (num !== value) onChange(num);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocalValue(v);
    setIsExpr(/[+\-*/()]/.test(v) && !/^-?\d*\.?\d*$/.test(v));
  };

  const showSlider = min !== undefined && max !== undefined;
  const fillPct = showSlider ? ((value - min!) / (max! - min!)) * 100 : 0;

  return (
    <div className="mb-1">
      <div
        className="flex items-center h-7 rounded"
        style={{
          background: isFocused ? 'var(--bg-surface)' : 'transparent',
          border: `1px solid ${isFocused ? 'var(--border-default)' : 'transparent'}`,
          transition: 'background 0.1s, border-color 0.1s',
        }}
        onMouseEnter={(e) => { if (!isFocused) e.currentTarget.style.background = 'var(--bg-surface)'; }}
        onMouseLeave={(e) => { if (!isFocused) e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Drag-to-adjust label */}
        <span
          className="text-[11px] w-[72px] shrink-0 pl-2 pr-1 select-none truncate"
          style={{
            color: isDragging ? 'var(--accent)' : 'var(--text-muted)',
            cursor: 'ew-resize',
            fontWeight: 400,
            letterSpacing: '0.01em',
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startVal = value;
            // Match slider sensitivity: full range over ~200px drag distance
            const pixelScale = (min !== undefined && max !== undefined)
              ? (max - min) / 200
              : step * 0.3;
            setIsDragging(true);
            document.body.style.cursor = 'ew-resize';
            const onMove = (ev: PointerEvent) => {
              const delta = (ev.clientX - startX) * pixelScale;
              let v = startVal + delta;
              if (min !== undefined) v = Math.max(min, v);
              if (max !== undefined) v = Math.min(max, v);
              onChange(Math.round(v * 1000) / 1000);
            };
            const onUp = () => {
              setIsDragging(false);
              document.body.style.cursor = '';
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          }}
        >{label}</span>

        {/* Value input */}
        <input
          ref={inputRef}
          type="text"
          value={localValue}
          onChange={handleChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => { setIsFocused(false); commit(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commit(); inputRef.current?.blur(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); onChange(value + step); }
            if (e.key === 'ArrowDown') { e.preventDefault(); onChange(value - step); }
          }}
          aria-label={label}
          className="flex-1 min-w-0 bg-transparent text-right pr-0.5 py-0 text-[12px] font-mono focus:outline-none"
          style={{ color: isExpr ? 'var(--accent)' : 'var(--text-primary)', border: 'none' }}
        />

        {/* Unit badge */}
        {unit && (
          <span className="text-[10px] pr-2 shrink-0 font-mono" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
            {unit}
          </span>
        )}
      </div>

      {/* Slider track */}
      {showSlider && (
        <div className="px-2 pt-0.5 pb-1">
          <div className="relative h-[3px] rounded-full" style={{ background: 'var(--bg-elevated)' }}>
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${fillPct}%`, background: 'var(--accent)', opacity: 0.5 }}
            />
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => onChange(parseFloat(e.target.value))}
              aria-label={`${label} slider`}
              className="absolute inset-0 w-full opacity-0 cursor-pointer"
              style={{ height: '12px', top: '-4px' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
