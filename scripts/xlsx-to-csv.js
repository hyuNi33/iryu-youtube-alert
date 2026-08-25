/**
 * xlsx → CSV 변환 스크립트
 * 사용법: node scripts/xlsx-to-csv.js
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const { writeCsvFile } = require("./csv-utils");

const XLSX_FILE = path.join(__dirname, "..", "건버드의 이류월드 계산기2026-04-17.xlsx");
const DATAS_DIR = path.join(__dirname, "..", "datas");

// 시트명 → CSV 파일명 매핑
const SHEET_MAP = {
  "환포표": "hanpo-table.csv",
  "특성": "trait.csv",
  "sp스킬": "sp-skill.csv",
  "유물": "artifact-info.csv",
  "비석지키기": "tombstone.csv",
  "RP스킬": "rpskill-raw.csv",          // 원본 데이터 (참고용)
  "RP스킬 성능": "rpskill-perf.csv",
  "이세계스킬": "isekai-skill.csv",
  "이세계스킬 성능": "isekai-perf.csv",
  "체경비 참고만": "monster-stat.csv",
  "초월정보": "transcend.csv",
  "크뎀계산식": "crit-formula.csv",
  "잡팁": "tips.csv",
  "초반용 rp스킬 투자순서": "rpskill-order.csv",
  // 계산기 시트
  "환포LV계산기": "hanpo-calc.csv",
  "경험치계산기": "exp-calc-ref.csv",     // 참고용
  "유물계산기": "artifact-calc-ref.csv",   // 참고용
  "스킬RP계산기": "rpskill-calc-ref.csv",  // 참고용
};

// 제외 시트
const EXCLUDE_SHEETS = ["자사,자줍", "Sheet1"];

function main() {
  if (!fs.existsSync(XLSX_FILE)) {
    console.error("xlsx 파일을 찾을 수 없습니다:", XLSX_FILE);
    process.exit(1);
  }

  const workbook = XLSX.readFile(XLSX_FILE);
  console.log("시트 목록:", workbook.SheetNames);

  for (const sheetName of workbook.SheetNames) {
    if (EXCLUDE_SHEETS.includes(sheetName)) {
      console.log(`  [건너뜀] ${sheetName}`);
      continue;
    }

    const csvFileName = SHEET_MAP[sheetName];
    if (!csvFileName) {
      console.log(`  [매핑없음] ${sheetName} — 기본 파일명으로 저장`);
      const fallbackName = sheetName.replace(/[\/\\?*[\]]/g, "_") + ".csv";
      exportSheet(workbook, sheetName, path.join(DATAS_DIR, fallbackName));
      continue;
    }

    const outputPath = path.join(DATAS_DIR, csvFileName);
    exportSheet(workbook, sheetName, outputPath);
  }

  console.log("\n완료!");
}

function exportSheet(workbook, sheetName, outputPath) {
  const sheet = workbook.Sheets[sheetName];
  const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ",", RS: "\n" });

  // 빈 시트 체크
  const lines = csv.split("\n").filter(line => line.trim() !== "");
  if (lines.length === 0) {
    console.log(`  [빈시트] ${sheetName}`);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  writeCsvFile(outputPath, csv);
  console.log(`  [변환] ${sheetName} → ${path.relative(DATAS_DIR, outputPath)} (${lines.length}행)`);
}

main();
