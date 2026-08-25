/**
 * 횡으로 배치된 CSV를 개별 파일로 분리
 * 빈 컬럼(,,)을 구분자로 서브테이블 감지
 */
const fs = require("fs");
const path = require("path");
const { readCsvText, writeCsvFile } = require("./csv-utils");

const DATAS = path.join(__dirname, "..", "datas");

// ==============================
// CSV 파싱
// ==============================
function parseLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { result.push(current); current = ""; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

function findColumnGroups(headerRow) {
  const groups = [];
  let start = null;
  for (let i = 0; i < headerRow.length; i++) {
    const val = (headerRow[i] || "").trim();
    if (val !== "") {
      if (start === null) start = i;
    } else {
      if (start !== null) {
        groups.push({ start, end: i - 1 });
        start = null;
      }
    }
  }
  if (start !== null) groups.push({ start, end: headerRow.length - 1 });
  // 후행 빈 컬럼 제거
  for (const g of groups) {
    while (g.end > g.start && (headerRow[g.end] || "").trim() === "") g.end--;
  }
  return groups;
}

/**
 * 횡 CSV를 분리하여 개별 파일로 저장
 * @param {string} csvFile - 원본 CSV 파일명
 * @param {string} outDir - 출력 디렉토리명
 * @param {Object} options
 * @param {number} [options.headerRows=1] - 헤더 행 수 (1: 제목=헤더, 2: 제목+컬럼헤더)
 * @param {Function} [options.filterGroup] - 그룹 필터 (title => boolean)
 */
function splitCSV(csvFile, outDir, options = {}) {
  const { headerRows = 1, filterGroup } = options;
  const csvPath = path.join(DATAS, csvFile);
  const outPath = path.join(DATAS, outDir);

  if (!fs.existsSync(csvPath)) {
    console.log(`  [건너뜀] ${csvFile} 없음`);
    return;
  }

  const text = readCsvText(csvPath);
  const lines = text.split("\n").filter(l => l.trim() !== "");
  if (lines.length < 2) return;

  const allRows = lines.map(l => parseLine(l));
  const row0 = allRows[0];
  const groups = findColumnGroups(row0);

  fs.mkdirSync(outPath, { recursive: true });

  const meta = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const { start, end } = groups[gi];
    const title = (row0[start] || "").trim();
    if (!title) continue;

    // 제목이 placeholder인 경우 건너뜀
    if (filterGroup && !filterGroup(title)) continue;

    // 컬럼 헤더 결정
    let colHeaders;
    let dataStart;
    if (headerRows >= 2 && allRows.length > 1) {
      colHeaders = [];
      for (let c = start; c <= end; c++) {
        colHeaders.push((allRows[1][c] || "").trim());
      }
      dataStart = 2;
    } else {
      colHeaders = [];
      for (let c = start; c <= end; c++) {
        colHeaders.push((row0[c] || "").trim());
      }
      dataStart = 1;
    }

    // 데이터 행 추출
    const dataRows = [];
    for (let r = dataStart; r < allRows.length; r++) {
      const row = allRows[r];
      const values = [];
      let hasData = false;
      for (let c = start; c <= end; c++) {
        const val = (row[c] || "").trim();
        values.push(val);
        if (val !== "") hasData = true;
      }
      if (hasData) dataRows.push(values);
    }

    if (dataRows.length === 0) continue;

    // 안전한 파일명 생성
    const safeName = title
      .replace(/\[표\d+\]\s*/g, "")
      .replace(/\s+/g, "_")
      .replace(/[\/\\?*[\]<>|:"]/g, "")
      .trim();

    const fileName = `${safeName}.csv`;

    // CSV 작성 (따옴표 포함된 값 처리)
    const csvLines = [colHeaders.join(",")];
    for (const row of dataRows) {
      csvLines.push(row.map(v => v.includes(",") ? `"${v}"` : v).join(","));
    }

    writeCsvFile(path.join(outPath, fileName), csvLines.join("\n"));
    meta.push({ name: title, file: fileName, rows: dataRows.length });
  }

  // meta.csv 작성
  const metaLines = ["name,file"];
  for (const m of meta) {
    metaLines.push(`"${m.name}",${m.file}`);
  }
  writeCsvFile(path.join(outPath, "meta.csv"), metaLines.join("\n"));

  console.log(`[${outDir}] ${meta.length}개 항목 분리 (${meta.map(m => m.name).join(", ")})`);
}

// ==============================
// 실행
// ==============================

// SP 스킬: 1행 = 제목+컬럼 (스킬명,LV,비용,성능)
splitCSV("sp-skill.csv", "sp-skill", {
  headerRows: 1,
  filterGroup: title => !title.startsWith("스킬명") // placeholder 제외
});

// 이세계 스킬 (코스트): 1행 = 제목, 데이터 행에 LV 포함
splitCSV("isekai-skill.csv", "isekai-skill", {
  headerRows: 1,
  filterGroup: title => !title.startsWith("스킬명")
});

// 이세계 스킬 성능: 1행 = 제목+성능헤더
splitCSV("isekai-perf.csv", "isekai-perf", {
  headerRows: 1,
  filterGroup: title => !title.startsWith("스킬명")
});

// RP 스킬 성능: 1행 = 스킬명, 2행 = 컬럼 헤더
splitCSV("rpskill-perf.csv", "rpskill-perf", {
  headerRows: 2
});

// RP 스킬 raw: 1행 = [표N] 스킬명, 2행 = 컬럼 헤더
splitCSV("rpskill-raw.csv", "rpskill-raw", {
  headerRows: 2,
  filterGroup: title => !title.includes("?") && title.length > 2
});

// 유물 정보: 1행 = 유물명+컬럼 (,레벨,효과,...)
splitCSV("artifact-info.csv", "artifact-info", {
  headerRows: 1
});

console.log("\n분리 완료!");
