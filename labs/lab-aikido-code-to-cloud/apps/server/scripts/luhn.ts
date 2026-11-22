export function luhnValid(pan: string): boolean {
  if (!/^\d+$/.test(pan)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = pan.length - 1; i >= 0; i--) {
    let d = Number(pan[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Appends the Luhn check digit to a partial PAN (without check digit). */
export function withLuhnDigit(partial: string): string {
  for (let c = 0; c <= 9; c++) {
    if (luhnValid(partial + c)) return partial + c;
  }
  throw new Error("unreachable");
}
