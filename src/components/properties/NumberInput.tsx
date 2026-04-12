import { useState, useEffect } from 'react';

interface Props {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

// Simple expression evaluator: supports +, -, *, /, parentheses, and numbers
function evalExpression(expr: string): number | null {
  try {
    // Only allow digits, operators, parentheses, dots, spaces
    if (!/^[\d\s+\-*/().]+$/.test(expr)) return null;
    // Use Function instead of eval for slightly better safety
    const result = new Function(`return (${expr})`)();
    if (typeof result === 'number' && isFinite(result)) return result;
    return null;
  } catch {
    return null;
  }
}

export function NumberInput({ label, value, unit = 'mm', min, max, step = 1, onChange }: Props) {
  const [localValue, setLocalValue] = useState(String(value));
  const [isExpr, setIsExpr] = useState(false);

  useEffect(() => {
    setLocalValue(String(value));
    setIsExpr(false);
  }, [value]);

  const commit = () => {
    // Try as expression first
    const exprResult = evalExpression(localValue);
    let num = exprResult !== null ? exprResult : parseFloat(localValue);

    if (isNaN(num)) {
      setLocalValue(String(value));
      setIsExpr(false);
      return;
    }
    if (min !== undefined) num = Math.max(min, num);
    if (max !== undefined) num = Math.min(max, num);

    // Round to avoid floating point noise
    num = Math.round(num * 1000) / 1000;

    setLocalValue(String(num));
    setIsExpr(false);
    if (num !== value) onChange(num);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocalValue(v);
    // Show expression indicator if it contains operators
    setIsExpr(/[+\-*/()]/.test(v) && !/^-?\d*\.?\d*$/.test(v));
  };

  return (
    <div className="flex items-center gap-2 mb-2">
      <label className="text-xs text-zinc-400 w-24 text-right shrink-0">{label}</label>
      <div className="flex items-center flex-1 relative">
        <input
          type="text"
          value={localValue}
          onChange={handleChange}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            // Arrow up/down to increment
            if (e.key === 'ArrowUp') { e.preventDefault(); onChange(value + step); }
            if (e.key === 'ArrowDown') { e.preventDefault(); onChange(value - step); }
          }}
          className={`w-full bg-zinc-700 border rounded px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-blue-500 ${isExpr ? 'border-amber-500' : 'border-zinc-600'}`}
        />
        {isExpr && (
          <span className="absolute right-8 text-[9px] text-amber-400">expr</span>
        )}
        {unit && <span className="text-xs text-zinc-500 ml-1.5 shrink-0">{unit}</span>}
      </div>
    </div>
  );
}
