/**
 * RP 스킬 계산 로직
 * datas/rpskill/ 디렉토리의 CSV에서 데이터 로딩
 */
import { loadCSV } from "../csv-loader.js";

let skillMeta = [];
let skillTables = {};
let loaded = false;

export async function initRPSkillData(basePath) {
  if (loaded) return;

  // 메타 정보 로딩
  const meta = await loadCSV(basePath + "/datas/rpskill/meta.csv");
  skillMeta = meta.map(row => ({
    tableKey: row.tableKey,
    name: row.skillName,
    maxLevels: Array.from({ length: 11 }, (_, i) => Number(row[`maxLevel${i}`]) || 0)
  }));

  // 각 테이블 CSV 로딩
  const loadPromises = skillMeta.map(async (skill) => {
    const rows = await loadCSV(basePath + `/datas/rpskill/${skill.tableKey}.csv`);
    skillTables[skill.tableKey] = rows;
  });

  await Promise.all(loadPromises);
  loaded = true;
}

export function getSkillMeta() {
  return skillMeta;
}

function findCumulativeColumn(rows) {
  if (rows.length === 0) return null;
  const headers = Object.keys(rows[0]);
  const priority = ["누적 RP", "누적 포인트", "누적 SP"];
  for (const key of priority) {
    if (headers.includes(key)) return key;
  }
  return headers.find(h => h.includes("누적")) || null;
}

function findLevelColumn(rows) {
  if (rows.length === 0) return null;
  const headers = Object.keys(rows[0]);
  return headers.find(h => h.trim() === "레벨") || headers[0];
}

function getCumulativeValue(tableKey, level) {
  if (!level || level <= 0) return 0;

  const rows = skillTables[tableKey];
  if (!rows) return 0;

  const cumCol = findCumulativeColumn(rows);
  const lvCol = findLevelColumn(rows);
  if (!cumCol || !lvCol) return 0;

  const row = rows.find(r => {
    const rowLevel = Number(String(r[lvCol]).replace(/,/g, ""));
    return rowLevel === Number(level);
  });
  if (!row) return 0;

  return Number(String(row[cumCol]).replace(/,/g, "")) || 0;
}

export function calcSkillCurrentRP(tableKey, currentLv, maxLv) {
  const current = Math.min(Math.max(Number(currentLv) || 0, 0), maxLv);
  return getCumulativeValue(tableKey, current);
}

export function calcSkillRP(tableKey, currentLv, targetLv, maxLv) {
  const current = Math.min(Math.max(Number(currentLv) || 0, 0), maxLv);
  const target = Math.min(Math.max(Number(targetLv) || 0, 0), maxLv);

  if (target <= current) return 0;

  const currentTotal = getCumulativeValue(tableKey, current);
  const targetTotal = getCumulativeValue(tableKey, target);

  return Math.max(0, targetTotal - currentTotal);
}
