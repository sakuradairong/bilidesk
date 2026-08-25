export function adjacentRegionRid(
  chips: { rid: number }[],
  currentRid: number,
  delta: -1 | 1,
): number {
  if (chips.length === 0) return currentRid;
  const index = chips.findIndex((chip) => chip.rid === currentRid);
  if (index < 0) return chips[0]!.rid;
  const from = index;
  const next = (from + delta + chips.length) % chips.length;
  return chips[next]!.rid;
}

export function regionRidForDigit(
  chips: { rid: number }[],
  digit: number,
): number | null {
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) return null;
  return chips[digit - 1]?.rid ?? null;
}
