// Convert integer, scientific, and Korean-unit values without floating-point rounding.
const units = ["", "만", "억", "조", "경", "해", "자", "양", "구", "간", "정", "재", "극", "항하사", "아승기", "나유타", "불가사의", "무량대수"];

export function integerDigits(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (/^\d+$/.test(text)) return BigInt(text).toString();

  const scientific = text.match(/^(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/);
  if (scientific) {
    const fraction = scientific[2] || "";
    const exponent = Number(scientific[3]);
    if (exponent > 1000) return null;
    const digits = scientific[1] + fraction;
    const shift = exponent - fraction.length;
    if (shift >= 0) return BigInt(digits + "0".repeat(shift)).toString();
    if (/[^0]/.test(digits.slice(shift))) return null;
    return BigInt(digits.slice(0, shift) || "0").toString();
  }

  const parts = text.match(/\d+(?:\.\d+)?\s*[^\d\s.]+/g);
  if (!parts || parts.join("").replace(/\s/g, "") !== text.replace(/\s/g, "")) return null;
  let total = 0n;
  for (const part of parts) {
    const [, whole, fraction = "", unit] = part.match(/^(\d+)(?:\.(\d+))?\s*(\S+)$/);
    const index = units.indexOf(unit);
    if (index < 1 || fraction.length > index * 4) return null;
    total += BigInt(whole + fraction) * 10n ** BigInt(index * 4 - fraction.length);
  }
  return total.toString();
}

export function fullNumber(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function compactNumber(digits) {
  const groups = [];
  for (let end = digits.length, index = 0; end > 0; end -= 4, index++) {
    const group = Number(digits.slice(Math.max(0, end - 4), end));
    if (group) groups.unshift(`${group}${units[index] || ""}`);
  }
  return groups.slice(0, 2).join(" ") || "0";
}
