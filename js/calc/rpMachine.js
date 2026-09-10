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

// 입력 문자열을 정수 분자/분모로 변환한다. Number를 거치지 않는다.
// 빈 값, 음수, 잘못된 값은 기존 빈 입력과 같이 0으로 처리한다.
function decimalRatio(value) {
  const text = String(value ?? "").trim();
  const match = /^(?:\+)?(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return { n: 0n, d: 1n };
  const exponent = Number(match[2] || 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 1000 || text.length > 1000) return { n: 0n, d: 1n };
  const [integer, fraction = ""] = match[1].split(".");
  const n = BigInt((integer || "0") + fraction);
  const scale = fraction.length - exponent;
  return scale >= 0
    ? { n, d: 10n ** BigInt(scale) }
    : { n: n * 10n ** BigInt(-scale), d: 1n };
}

function addRatio(a, b) {
  return { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
}

function multiplyRatio(a, b) {
  return { n: a.n * b.n, d: a.d * b.d };
}

// Number 변환은 화면에 표시하는 참고용 배율에만 사용한다.
function displayRatio(ratio) {
  return Number(ratio.n) / Number(ratio.d);
}

export async function initHanpoData(basePath) {
  if (loaded) return;
  const rows = await loadCSV(basePath + "/datas/hanpo-table.csv");

  hanpoData = [];
  for (const row of rows) {
    const level = Number(row["레벨"]);
    const rawHanpo = String(row["환포"] || "").replace(/,/g, "").trim();
    if (Number.isFinite(level) && /^\d+$/.test(rawHanpo)) {
      hanpoData.push({ level, hanpo: BigInt(rawHanpo) });
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
  return entry ? entry.hanpo : 0n;
}

function applyFinalMultiplier(baseHanpo, finalMultiplier) {
  // 모든 배율을 적용한 뒤 마지막에 한 번만 반올림한다.
  const numerator = baseHanpo * finalMultiplier.n;
  const denominator = finalMultiplier.d;
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * 환포 계산 (반환되는 환포 값은 모두 BigInt)
 * @param {Object} params
 * @param {string|bigint|number} params.targetHanpo - 원하는 환포 수치
 * @param {string|number} params.rpShopPercent - RP상점 환포 수치 (%)
 * @param {string|number} params.encyclopediaPercent - 도감 수치 (%)
 * @param {string|number} params.artifactRingPercent - 유물(반지) 수치 (%)
 * @param {string|number} params.vipPercent - VIP 수치 (%)
 * @param {number} params.transcendLevel - 초월 레벨 (0~10)
 * @param {boolean} params.rebirthBlessingEnabled - 윤회의 축복 적용 여부
 * @param {string|number} params.hourglassLevel - 모래시계 레벨 (0~50)
 * @param {string|number} params.timeResonanceLevel - 시간의 공명 레벨 (레벨당 1%)
 * @param {number} params.currentLevel - 내 현재 레벨
 */
export function calculateHanpo(params) {
  const {
    targetHanpo, rpShopPercent, encyclopediaPercent,
    artifactRingPercent, vipPercent,
    transcendLevel, rebirthBlessingEnabled = true, hourglassLevel, currentLevel,
    timeResonanceLevel = 0
  } = params;

  // A~E를 정확하게 합산한 뒤 100으로 나눈다.
  const sum = [rpShopPercent, encyclopediaPercent, artifactRingPercent, vipPercent]
    .reduce((total, value) => addRatio(total, decimalRatio(value)), { n: 100n, d: 1n });
  const hanpoRatio = multiplyRatio(sum, { n: 1n, d: 100n });
  const hourglassRatio = addRatio({ n: 1n, d: 1n }, multiplyRatio(decimalRatio(hourglassLevel), { n: 1n, d: 10n }));
  const transcendRatio = decimalRatio(getTranscendMultiplier(transcendLevel));
  const rebirthRatio = decimalRatio(rebirthBlessingEnabled ? getRebirthMultiplier(transcendLevel) : 1);
  const resonanceInput = decimalRatio(timeResonanceLevel);
  const resonanceLevel = resonanceInput.n / resonanceInput.d;
  // 윤회의 축복이 없으면 공명도 1배로 처리한다.
  const resonanceRatio = rebirthBlessingEnabled ? { n: 100n + resonanceLevel, d: 100n } : { n: 1n, d: 1n };
  const combinedRatio = multiplyRatio(hanpoRatio, transcendRatio);
  const finalRatio = [hourglassRatio, transcendRatio, rebirthRatio, resonanceRatio]
    .reduce(multiplyRatio, hanpoRatio);
  const targetRatio = decimalRatio(targetHanpo);

  const hanpoMultiplier = displayRatio(hanpoRatio);
  const hourglassMult = displayRatio(hourglassRatio);
  const transcendMult = displayRatio(transcendRatio);
  const combinedMult = displayRatio(combinedRatio);
  const rebirthMult = displayRatio(rebirthRatio);
  const timeResonanceMult = displayRatio(resonanceRatio);
  const finalMultiplier = displayRatio(finalRatio);
  const appliedMultiplier = finalMultiplier;

  // 획득 레벨 찾기
  const found = hanpoData.find(entry => applyFinalMultiplier(entry.hanpo, finalRatio) * targetRatio.d >= targetRatio.n) || null;
  const acquiredLevel = found ? found.level : null;
  const acquiredBaseHanpo = found ? found.hanpo : 0n;
  const acquiredFinalHanpo = applyFinalMultiplier(acquiredBaseHanpo, finalRatio);

  // 실제 획득 환포
  const actualHanpo = acquiredFinalHanpo;

  // 현재 레벨 기본 환포
  const currentBaseHanpo = getHanpoAtLevel(currentLevel);

  const currentFinalHanpo = applyFinalMultiplier(currentBaseHanpo, finalRatio);
  const currentHanpoWithMult = currentFinalHanpo;

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
    timeResonanceMult,
  };
}
