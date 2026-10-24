const fs = require("fs");

const UTF8_BOM = "\uFEFF";

function stripBom(text) {
  return text.replace(/^\uFEFF/, "");
}

function addBom(text) {
  return text.startsWith(UTF8_BOM) ? text : UTF8_BOM + text;
}

function readCsvText(filePath) {
  return stripBom(fs.readFileSync(filePath, "utf-8"));
}

function writeCsvFile(filePath, text) {
  fs.writeFileSync(filePath, addBom(text), "utf-8");
}

function integerText(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  const match = text.match(/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return null;
  const fraction = match[2] || "";
  const exponent = Number(match[3] || 0);
  if (Math.abs(exponent) > 1000) return null;
  const digits = match[1] + fraction;
  const shift = exponent - fraction.length;
  if (shift >= 0) return BigInt(digits + "0".repeat(shift)).toString();
  if (/[^0]/.test(digits.slice(shift))) return null;
  return BigInt(digits.slice(0, shift) || "0").toString();
}

module.exports = {
  integerText,
  addBom,
  readCsvText,
  stripBom,
  writeCsvFile,
};
