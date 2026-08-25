/**
 * xlsx에서 뽑은 CSV에서 후행 빈 행 제거
 */
const fs = require("fs");
const path = require("path");
const { readCsvText, writeCsvFile } = require("./csv-utils");

const DATAS = path.join(__dirname, "..", "datas");

// xlsx에서 직접 뽑은 CSV들 (JS 추출 파일은 이미 깨끗함)
const FILES = [
  "hanpo-table.csv", "hanpo-calc.csv", "trait.csv", "sp-skill.csv",
  "artifact-info.csv", "tombstone.csv", "rpskill-raw.csv", "rpskill-perf.csv",
  "isekai-skill.csv", "isekai-perf.csv", "monster-stat.csv", "transcend.csv",
  "crit-formula.csv", "tips.csv", "rpskill-order.csv",
  "exp-calc-ref.csv", "artifact-calc-ref.csv", "rpskill-calc-ref.csv"
];

for (const file of FILES) {
  const filePath = path.join(DATAS, file);
  if (!fs.existsSync(filePath)) continue;

  const content = readCsvText(filePath);
  const lines = content.split("\n");

  // 후행 빈/쉼표만 있는 행 제거
  let lastNonEmpty = lines.length - 1;
  while (lastNonEmpty >= 0 && lines[lastNonEmpty].replace(/,/g, "").trim() === "") {
    lastNonEmpty--;
  }

  const cleaned = lines.slice(0, lastNonEmpty + 1).join("\n");
  writeCsvFile(filePath, cleaned);

  const removed = lines.length - lastNonEmpty - 1;
  if (removed > 0) {
    console.log(`${file}: ${lines.length}행 → ${lastNonEmpty + 1}행 (${removed}행 제거)`);
  }
}

console.log("정리 완료!");
