/**
 * 기존 JS 데이터 파일에서 깨끗한 CSV 추출
 * - exp.js → datas/exp.csv
 * - artifacts.js → datas/artifacts/meta.csv + levels.csv
 * - rpskill.js → datas/rpskill/meta.csv + table1~20.csv
 */
const fs = require("fs");
const path = require("path");
const { writeCsvFile } = require("./csv-utils");

const ROOT = path.join(__dirname, "..");
const DATAS = path.join(ROOT, "datas");

// ==============================
// 1. exp.js → exp.csv
// ==============================
function extractExp() {
  const src = fs.readFileSync(path.join(ROOT, "exp.js"), "utf-8");
  const rawMatch = src.match(/const raw = `([\s\S]*?)`;/);
  if (!rawMatch) throw new Error("exp.js에서 raw 데이터를 찾을 수 없음");

  const lines = rawMatch[1].trim().split("\n").filter(l => l.trim());
  const rows = [["level", "expNeed"]];

  for (const line of lines) {
    const [lv, exp] = line.split(",").map(s => s.trim());
    rows.push([lv, exp]);
  }

  const csv = rows.map(r => r.join(",")).join("\n");
  writeCsvFile(path.join(DATAS, "exp.csv"), csv);
  console.log(`[exp] ${rows.length - 1}행 → datas/exp.csv`);
}

// ==============================
// 2. artifacts.js → artifacts/meta.csv + levels.csv
// ==============================
function extractArtifacts() {
  // artifacts.js를 실행해서 window.ARTIFACTS를 가져옴
  const window = {};
  const src = fs.readFileSync(path.join(ROOT, "artifacts.js"), "utf-8");
  eval(src);

  const artifacts = window.ARTIFACTS;
  const keys = Object.keys(artifacts);

  // meta.csv
  const metaRows = [["id", "name", "effect", "maxLevel", "type", "sameAs"]];
  // levels.csv
  const levelRows = [["id", "level", "need", "cumStone", "unlockGem", "cumGem"]];

  for (const key of keys) {
    const art = artifacts[key];
    metaRows.push([
      art.id,
      `"${(art.name || "").replace(/"/g, '""')}"`,
      `"${(art.effect || "").replace(/"/g, '""')}"`,
      art.maxLevel || "",
      art.type || "normal",
      art.sameAs || ""
    ]);

    if (art.levels) {
      for (const [lv, data] of Object.entries(art.levels)) {
        levelRows.push([
          art.id,
          lv,
          data.need || 0,
          data.cumStone || 0,
          data.unlockGem || 0,
          data.cumGem || 0
        ]);
      }
    }
  }

  const dir = path.join(DATAS, "artifacts");
  fs.mkdirSync(dir, { recursive: true });
  writeCsvFile(path.join(dir, "meta.csv"), metaRows.map(r => r.join(",")).join("\n"));
  writeCsvFile(path.join(dir, "levels.csv"), levelRows.map(r => r.join(",")).join("\n"));
  console.log(`[artifacts] meta: ${metaRows.length - 1}행, levels: ${levelRows.length - 1}행`);
}

// ==============================
// 3. rpskill.js → rpskill/meta.csv + table1~20.csv
// ==============================
function extractRPSkill() {
  const src = fs.readFileSync(path.join(ROOT, "rpskill.js"), "utf-8");
  // ES module → CommonJS로 변환하여 eval
  const cjsSrc = src.replace("export default skillTables;", "module.exports = skillTables;");

  // 임시 파일로 저장 후 require
  const tmpFile = path.join(__dirname, "_tmp_rpskill.js");
  fs.writeFileSync(tmpFile, cjsSrc, "utf-8");
  const skillTables = require(tmpFile);
  fs.unlinkSync(tmpFile);

  const dir = path.join(DATAS, "rpskill");
  fs.mkdirSync(dir, { recursive: true });

  // 스킬 메타 정보 (rpskillcalc.js의 skills 배열에서)
  const skillMeta = [
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

  // meta.csv
  const metaRows = [["tableKey", "skillName", "maxLevel"]];
  for (const s of skillMeta) {
    metaRows.push([s.tableKey, `"${s.name}"`, s.max]);
  }
  writeCsvFile(path.join(dir, "meta.csv"), metaRows.map(r => r.join(",")).join("\n"));

  // 각 테이블 CSV
  for (const [key, table] of Object.entries(skillTables)) {
    if (!table.headers || !table.rows) continue;

    const headers = table.headers;
    const csvRows = [headers.join(",")];

    for (const row of table.rows) {
      const values = headers.map(h => {
        const val = row[h];
        if (val === undefined || val === null) return "";
        return String(val);
      });
      csvRows.push(values.join(","));
    }

    writeCsvFile(path.join(dir, `${key}.csv`), csvRows.join("\n"));
    console.log(`[rpskill] ${key}: ${table.rows.length}행`);
  }

  console.log(`[rpskill] meta: ${skillMeta.length}행`);
}

// ==============================
// 실행
// ==============================
try {
  extractExp();
  extractArtifacts();
  extractRPSkill();
  console.log("\n모든 JS 데이터 CSV 변환 완료!");
} catch (e) {
  console.error("오류:", e.message);
  process.exit(1);
}
