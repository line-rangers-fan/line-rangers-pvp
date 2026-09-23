export const VISUAL_AUDIT_PERIODS = Object.freeze(["hour", "day", "week", "month"]);

export function assertComparisonBadgeState(period, health, state, context = "comparison") {
  if (!VISUAL_AUDIT_PERIODS.includes(period)) {
    throw new Error(`${context}: unknown comparison period ${JSON.stringify(period)}`);
  }

  const comparable = health?.comparison?.periods?.[period]?.comparable;
  if (typeof comparable !== "boolean") {
    throw new Error(`${context}: health is missing a valid ${period} comparable flag`);
  }

  const fields = ["rows", "badges", "pending", "sourcePending"];
  for (const field of fields) {
    if (!Number.isSafeInteger(state?.[field]) || state[field] < 0) {
      throw new Error(`${context}: invalid ${field} count in ${period} comparison state`);
    }
  }
  if (state.rows === 0) {
    throw new Error(`${context}: ${period} comparison has no rendered rows`);
  }
  if (state.badges !== state.rows) {
    throw new Error(
      `${context}: ${period} comparison badge count ${state.badges} does not match row count ${state.rows}`,
    );
  }

  const expectedPending = comparable ? 0 : state.rows;
  if (state.pending !== expectedPending) {
    throw new Error(
      `${context}: ${period} comparison has comparable=${comparable}, so expected ${expectedPending} history-pending badges but found ${state.pending}; state=${JSON.stringify(state)}`,
    );
  }
  if (state.sourcePending !== 0 && (state.sourcePending !== state.rows || !comparable)) {
    throw new Error(
      `${context}: invalid source-pending badge count for ${period}; comparable=${comparable}, state=${JSON.stringify(state)}`,
    );
  }

  return {comparable, expectedPending, ...state};
}

