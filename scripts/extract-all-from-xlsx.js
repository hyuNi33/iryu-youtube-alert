/**
 * xlsx에서 모든 데이터를 올바르게 추출
 * 횡 배치 시트를 개별 CSV로 분리, 성능 컬럼 합침 처리
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const { writeCsvFile } = require("./csv-utils");

const ROOT = path.join(__dirname, "..");
const DATAS = path.join(ROOT, "datas");
const XLSX_FILE = path.join(ROOT, "건버드의 이류월드 계산기2026-04-17.xlsx");

const wb = XLSX.readFile(XLSX_FILE);

// ==============================
// 유틸
// ==============================
function getSheet(name) {
  return wb.Sheets[name];
}

function sheetToArray(sheet) {
  // raw: false → 셀 서식 유지 (퍼센트, 숫자 포맷 등)
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
}

function safeName(name) {
  return name.replace(/\[표\d+\]\s*/g, "").replace(/\s+/g, "_").replace(/[\/\\?*[\]<>|:"]/g, "").trim();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeCSV(filePath, headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.map(v => {
      const s = String(v ?? "").trim();
      return s.includes(",") || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(","));
  }
  writeCsvFile(filePath, lines.join("\n"));
}

// ==============================
// 횡 시트 파싱: 빈 컬럼으로 서브테이블 분리
// ==============================
function parseHorizontalSheet(sheetName, options = {}) {
  const { titleRow = 0, headerRow = null, mergePerf = false, perfLabel = "성능", skipPlaceholder = null } = options;
  const sheet = getSheet(sheetName);
  if (!sheet) { console.log(`  시트 없음: ${sheetName}`); return []; }

  const data = sheetToArray(sheet);
  if (data.length < 2) return [];

  const row0 = data[titleRow] || [];

  // 서브테이블 경계 찾기
  // headerRow가 있으면 헤더 행에서 그룹 감지 (타이틀 행은 1셀만 차지할 수 있으므로)
  const groupDetectRow = headerRow !== null ? (data[headerRow] || []) : row0;
  const groups = [];
  let start = null;
  for (let i = 0; i < groupDetectRow.length; i++) {
    const val = String(groupDetectRow[i] ?? "").trim();
    if (val !== "") {
      if (start === null) start = i;
    } else {
      if (start !== null) { groups.push({ start, end: i - 1 }); start = null; }
    }
  }
  if (start !== null) groups.push({ start, end: groupDetectRow.length - 1 });

  const tables = [];

  for (const g of groups) {
    // 타이틀: 그룹 범위 내에서 타이틀 행의 첫 번째 비어있지 않은 셀
    let title = "";
    for (let c = g.start; c <= g.end; c++) {
      const val = String(row0[c] ?? "").trim();
      if (val) { title = val; break; }
    }
    if (!title) continue;
    if (skipPlaceholder && skipPlaceholder(title)) continue;

    // 컬럼 헤더 결정
    let colHeaders;
    let dataStartRow;

    if (headerRow !== null) {
      // 별도의 헤더 행 사용
      colHeaders = [];
      for (let c = g.start; c <= g.end; c++) {
        colHeaders.push(String(data[headerRow]?.[c] ?? "").trim());
      }
      dataStartRow = headerRow + 1;
    } else {
      // 타이틀 행이 헤더 겸용
      colHeaders = [];
      for (let c = g.start; c <= g.end; c++) {
        colHeaders.push(String(row0[c] ?? "").trim());
      }
      dataStartRow = titleRow + 1;
    }

    // 후행 빈 컬럼 제거
    while (colHeaders.length > 0 && colHeaders[colHeaders.length - 1] === "") {
      colHeaders.pop();
      g.end--;
    }

    // 데이터 행 추출
    const rows = [];
    for (let r = dataStartRow; r < data.length; r++) {
      const row = data[r] || [];
      const values = [];
      let hasData = false;
      for (let c = g.start; c <= g.end; c++) {
        const val = String(row[c] ?? "").trim();
        values.push(val);
        if (val !== "") hasData = true;
      }
      if (hasData) rows.push(values);
    }

    if (rows.length === 0) continue;

    // 성능 컬럼 합치기 옵션
    if (mergePerf) {
      // 중복 컬럼명 인덱스 찾기
      const perfIndices = [];
      for (let i = 0; i < colHeaders.length; i++) {
        if (colHeaders[i] === perfLabel) perfIndices.push(i);
      }

      if (perfIndices.length > 1) {
        // 기본 컬럼 (성능 이전) + 성능 1개
        const baseCount = perfIndices[0];
        const newHeaders = colHeaders.slice(0, baseCount).concat([perfLabel]);
        const newRows = rows.map(row => {
          const base = row.slice(0, baseCount);
          const perfs = perfIndices.map(i => (row[i] || "").trim()).filter(v => v);
          base.push(perfs.join(" / "));
          return base;
        });
        tables.push({ title, headers: newHeaders, rows: newRows });
        continue;
      }
    }

    tables.push({ title, headers: colHeaders, rows });
  }

  return tables;
}

function saveTables(outDir, tables) {
  ensureDir(path.join(DATAS, outDir));

  const meta = [];
  for (const t of tables) {
    const fileName = safeName(t.title) + ".csv";
    writeCSV(path.join(DATAS, outDir, fileName), t.headers, t.rows);
    meta.push({ name: t.title, file: fileName, rows: t.rows.length });
  }

  // meta.csv
  const metaLines = ["name,file"];
  for (const m of meta) {
    metaLines.push(`"${m.name}",${m.file}`);
  }
  writeCsvFile(path.join(DATAS, outDir, "meta.csv"), metaLines.join("\n"));

  console.log(`[${outDir}] ${tables.length}개 항목 (${meta.map(m => `${m.name}(${m.rows}행)`).join(", ")})`);
}

// ==============================
// 1. SP 스킬
// ==============================
console.log("\n=== SP 스킬 ===");
const spTables = parseHorizontalSheet("sp스킬", {
  titleRow: 0,
  mergePerf: true,
  perfLabel: "성능",
  skipPlaceholder: t => t === "스킬명"
});

// 파워스트라이크 하단 불필요 데이터 제거
for (const t of spTables) {
  if (t.title === "파워스트라이크") {
    t.rows = t.rows.filter(row => {
      const lv = String(row[1] || "").trim();
      return lv !== "" && !isNaN(Number(lv));
    });
  }
}

saveTables("sp-skill", spTables);

// ==============================
// 2. 이세계 스킬 (성능 포함)
// ==============================
console.log("\n=== 이세계스킬 ===");
const isekaiTables = parseHorizontalSheet("이세계스킬 성능", {
  titleRow: 0,
  mergePerf: false,
  skipPlaceholder: t => t === "스킬명"
});
saveTables("isekai-perf", isekaiTables);

// ==============================
// 3. RP 스킬 성능
// ==============================
console.log("\n=== RP 스킬 성능 ===");
const rpPerfTables = parseHorizontalSheet("RP스킬 성능", {
  titleRow: 0,
  headerRow: 1,
  mergePerf: false
});
saveTables("rpskill-perf", rpPerfTables);

// ==============================
// 4. 유물 정보
// ==============================
console.log("\n=== 유물 정보 ===");
const artifactTables = parseHorizontalSheet("유물", {
  titleRow: 0,
  mergePerf: false
});
saveTables("artifact-info", artifactTables);

// ==============================
// 5. RP 스킬 (계산기용) - 기존 rpskill/ 디렉토리
// 이건 "RP스킬" 시트에서 추출
// ==============================
console.log("\n=== RP 스킬 (계산기용) ===");
const rpCalcTables = parseHorizontalSheet("RP스킬", {
  titleRow: 0,
  headerRow: 1,
  mergePerf: false,
  skipPlaceholder: t => t.includes("?") || t.length <= 2
});

// rpskill/ 디렉토리에 tableN.csv 형태로 저장 (기존 계산기 호환)
const rpSkillMeta = [
  { name: "부스트", max: 2, tableKey: "table1" },
  { name: "경험치", max: 200, tableKey: "table2" },
  { name: "강화 확률 증가", max: 10, tableKey: "table3" },
  { name: "SP 증가량", max: 1200, tableKey: "table4" },
  { name: "장비 제한 레벨 감소", max: 24, tableKey: "table5" },
  { name: "샤프", max: 55, tableKey: "table6" },
  { name: "버서크", max: 55, tableKey: "table7" },
  { name: "쉐도우 파트너", max: 55, tableKey: "table8" },
  { name: "환포", max: 40, tableKey: "table9" },
  { name: "비홀더버프", max: 4, tableKey: "table10" },
  { name: "타겟", max: 1, tableKey: "table11" },
  { name: "강화횟수", max: 1, tableKey: "table12" },
  { name: "메용", max: 40, tableKey: "table13" },
  { name: "원거리마스터리", max: 25, tableKey: "table14" },
  { name: "어드밴스드 콤보어택", max: 55, tableKey: "table15" },
  { name: "파이널어택", max: 10, tableKey: "table16" },
  { name: "너클마스터리", max: 25, tableKey: "table17" },
  { name: "크리티컬 리인포스", max: 40, tableKey: "table18" },
  { name: "오브마스터리", max: 30, tableKey: "table19" },
  { name: "아드레날린 부스터", max: 20, tableKey: "table20" }
];

ensureDir(path.join(DATAS, "rpskill"));

// rpCalcTables를 순서대로 매핑 (표1=table1, 표2=table2, ...)
for (let i = 0; i < Math.min(rpCalcTables.length, rpSkillMeta.length); i++) {
  const t = rpCalcTables[i];
  const meta = rpSkillMeta[i];
  writeCSV(path.join(DATAS, "rpskill", `${meta.tableKey}.csv`), t.headers, t.rows);
  console.log(`  ${meta.tableKey} (${meta.name}): ${t.rows.length}행`);
}

// meta.csv
const rpMetaLines = ["tableKey,skillName,maxLevel"];
for (const m of rpSkillMeta) {
  rpMetaLines.push(`${m.tableKey},"${m.name}",${m.max}`);
}
writeCsvFile(path.join(DATAS, "rpskill", "meta.csv"), rpMetaLines.join("\n"));
console.log(`  meta.csv: ${rpSkillMeta.length}항목`);

// ==============================
// 6. 경험치 데이터 (단일 테이블)
// ==============================
console.log("\n=== 경험치 ===");
const expSheet = getSheet("경험치계산기");
if (expSheet) {
  const expData = sheetToArray(expSheet);
  const expRows = [];
  for (let r = 1; r < expData.length; r++) {
    const row = expData[r];
    const lv = Number(row[0]);
    const exp = Number(String(row[1] ?? "").replace(/,/g, "").trim());
    if (Number.isFinite(lv) && lv >= 1 && Number.isFinite(exp) && exp > 0) {
      expRows.push([lv, exp]);
    }
  }
  writeCSV(path.join(DATAS, "exp.csv"), ["level", "expNeed"], expRows);
  console.log(`[exp] ${expRows.length}행`);
}

// ==============================
// 7. 유물 계산기용 데이터 (기존 artifacts/ 디렉토리는 JS에서 추출한 것이라 유지)
// ==============================
console.log("\n=== 유물 계산기용 (기존 유지) ===");
console.log("[artifacts] 기존 meta.csv + levels.csv 유지 (JS 추출 데이터가 정확)");

// ==============================
// 완료
// ==============================
console.log("\n모든 데이터 추출 완료!");
