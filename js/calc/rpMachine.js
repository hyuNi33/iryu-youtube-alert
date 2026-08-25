/**
 * 환포 계산기 로직
 * datas/hanpo-table.csv에서 레벨별 환포 데이터 로딩
 */
import { loadCSV } from "../csv-loader.js";

let hanpoData = []; // { level, hanpo }
let loaded = false;

// 초월 배율 테이블
const TRANSCEND_MULTIPLIER = {
  0: 1,
  1: 1,
  2: 1.1,
  3: 1.15,
  4: 1.3,
  5: 1.4,
  6: 1.6,
  7: 1.8,
  8: 2,
  9: 2.3,
  10: 2.6
};

// 윤회 축복 배율
const REBIRTH_MULTIPLIER = {
  0: 1.05,
  1: 1.1,
  2: 1.2,
  3: 1.3,
  4: 1.45,
  5: 1.6,
  6: 2,
  7: 2.5,
  8: 3,
  9: 3.6,
  10: 4.3
};

// 모래시계 배율
function getHourglassMultiplier(level) {
  if (level <= 0) return 1;
  return 1 + level * 0.1;
}

export async function initHanpoData(basePath) {
  if (loaded) return;
  const rows = await loadCSV(basePath + "/datas/hanpo-table.csv");

  hanpoData = [];
  for (const row of rows) {
    const level = Number(row["레벨"]);
    const rawHanpo = String(row["환포"] || "").replace(/,/g, "").trim();
    const hanpo = Number(rawHanpo);
    if (Number.isFinite(level) && Number.isFinite(hanpo)) {
      hanpoData.push({ level, hanpo });
    }
  }

  hanpoData.sort((a, b) => a.level - b.level);
  loaded = true;
}

export function getTranscendMultiplier(level) {
  return TRANSCEND_MULTIPLIER[level] ?? 1;
}

export function getRebirthMultiplier(level) {
  return REBIRTH_MULTIPLIER[level] ?? 1;
}

/**
 * 특정 레벨의 환포 조회
 */
function getHanpoAtLevel(level) {
  const entry = hanpoData.find(e => e.level === level);
  return entry ? entry.hanpo : 0;
}

function applyFinalMultiplier(baseHanpo, finalMultiplier) {
  return Math.round(baseHanpo * finalMultiplier);
}

function applyRebirthMultiplier(finalAppliedHanpo, rebirthMult) {
  return Math.round(finalAppliedHanpo * rebirthMult);
}

function applyAllMultipliers(baseHanpo, finalMultiplier, rebirthMult) {
  return applyRebirthMultiplier(applyFinalMultiplier(baseHanpo, finalMultiplier), rebirthMult);
}

/**
 * 환포 계산
 * @param {Object} params
 * @param {number} params.targetHanpo - 원하는 환포 수치
 * @param {number} params.rpShopPercent - RP상점 환포 수치 (%)
 * @param {number} params.encyclopediaPercent - 도감 수치 (%)
 * @param {number} params.artifactRingPercent - 유물(반지) 수치 (%)
 * @param {number} params.vipPercent - VIP 수치 (%)
 * @param {number} params.transcendLevel - 초월 레벨 (0~10)
 * @param {boolean} params.rebirthBlessingEnabled - 윤회의 축복 적용 여부
 * @param {number} params.hourglassLevel - 모래시계 레벨 (0~50)
 * @param {number} params.currentLevel - 내 현재 레벨
 */
export function calculateHanpo(params) {
  const {
    targetHanpo, rpShopPercent, encyclopediaPercent,
    artifactRingPercent, vipPercent,
    transcendLevel, rebirthBlessingEnabled = true, hourglassLevel, currentLevel
  } = params;

  // 환포 배율 (D) = (100 + RP상점 + 도감 + 유물 + VIP) / 100
  const hanpoMultiplier = (100 + rpShopPercent + encyclopediaPercent + artifactRingPercent + vipPercent) / 100;

  // 초월 배율 (D1)
  const transcendMult = getTranscendMultiplier(transcendLevel);

  // 초월 환포 배율 (D2 = D * D1)
  const combinedMult = hanpoMultiplier * transcendMult;

  // 모래시계 배율 (X)
  const hourglassMult = getHourglassMultiplier(hourglassLevel);

  // 최종 배율 (R = D2 * X)
  const finalMultiplier = combinedMult * hourglassMult;

  // 윤회 축복 배율
  const rebirthMult = rebirthBlessingEnabled ? getRebirthMultiplier(transcendLevel) : 1;
  const appliedMultiplier = finalMultiplier * rebirthMult;

  // 획득 레벨 찾기
  const found = hanpoData.find(entry => applyAllMultipliers(entry.hanpo, finalMultiplier, rebirthMult) >= targetHanpo) || null;
  const acquiredLevel = found ? found.level : null;
  const acquiredBaseHanpo = found ? found.hanpo : 0;
  const acquiredFinalHanpo = applyFinalMultiplier(acquiredBaseHanpo, finalMultiplier);

  // 실제 획득 환포
  const actualHanpo = applyRebirthMultiplier(acquiredFinalHanpo, rebirthMult);

  // 현재 레벨 기본 환포
  const currentBaseHanpo = getHanpoAtLevel(currentLevel);

  const currentFinalHanpo = applyFinalMultiplier(currentBaseHanpo, finalMultiplier);
  const currentHanpoWithMult = applyRebirthMultiplier(currentFinalHanpo, rebirthMult);

  return {
    hanpoMultiplier,
    transcendMult,
    combinedMult,
    hourglassMult,
    finalMultiplier,
    appliedMultiplier,
    acquiredLevel,
    acquiredBaseHanpo,
    acquiredFinalHanpo,
    actualHanpo,
    currentLevel,
    currentBaseHanpo,
    currentFinalHanpo,
    currentHanpoWithMult,
    rebirthBlessingEnabled,
    rebirthMult,
  };
}
