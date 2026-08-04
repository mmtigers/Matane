import type { Budget } from "@/types/models";

const BUDGET_MIDPOINT: Record<Budget, number> = {
  "〜3k": 1500,
  "〜5k": 4000,
  "〜10k": 7500,
  "10k〜": 12000,
};

// budgetは範囲選択(ChoiceChips)のため、実額ではなく代表値からの概算平均を返す。
export function estimateAverageBudget(budgets: Budget[]): number | null {
  if (budgets.length === 0) return null;
  const total = budgets.reduce((sum, budget) => sum + BUDGET_MIDPOINT[budget], 0);
  return Math.round(total / budgets.length);
}
