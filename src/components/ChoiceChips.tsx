"use client";

interface ChoiceChipsProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T[];
  onChange: (next: T[]) => void;
  multiple?: boolean;
}

// 登録画面のワンタップ入力用。single-select時はvalueは0または1要素の配列として扱う。
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  multiple = false,
}: ChoiceChipsProps<T>) {
  function toggle(option: T) {
    const isSelected = value.includes(option);
    if (multiple) {
      onChange(isSelected ? value.filter((v) => v !== option) : [...value, option]);
    } else {
      onChange(isSelected ? [] : [option]);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-neutral-600">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              className={`rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
                selected
                  ? "bg-amber-400 text-black"
                  : "bg-neutral-200 text-neutral-800 active:bg-neutral-300"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
