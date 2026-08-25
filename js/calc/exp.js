/**
 * 경험치 계산 로직
 * datas/exp.csv에서 데이터를 로딩하여 레벨업 시간을 계산합니다.
 */
import { loadCSV } from "../csv-loader.js";

const MULTIPLIER_SCALE = 10n;
const MINUTE_MS = 60000n;
const FORECAST_EXP_SCALE = MINUTE_MS * MULTIPLIER_SCALE;

let expNeed = [0n];
let expTotal = [0n];
let loaded = false;

function parseIntegerBigInt(value, { allowZero = true } = {}) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = BigInt(text);
  if (!allowZero && parsed <= 0n) return null;
  return parsed;
}

function getHourglassMultiplierParts(hourglassLv) {
  return {
    numerator: BigInt(10 + hourglassLv),
    denominator: MULTIPLIER_SCALE,
    multiplier: 1 + (hourglassLv * 0.1)
  };
}

function scaledToNumber(value, scale = 1n) {
  return Number(value) / Number(scale);
}

export async function initExpData(basePath) {
  if (loaded) return;
  const rows = await loadCSV(basePath + "/datas/exp.csv");

  expNeed = [0n];
  expTotal = [0n];
  let sum = 0n;

  for (const row of rows) {
    const lv = Number(row.level);
    const exp = parseIntegerBigInt(row.expNeed, { allowZero: false });
    if (!Number.isInteger(lv) || exp === null) continue;

    expNeed[lv] = exp;
    sum += exp;
    expTotal[lv] = sum;
  }

  loaded = true;
}

export function getRequiredExpBetweenLevels(currentLv, targetLv) {
  currentLv = Number(currentLv);
  targetLv = Number(targetLv);

  if (!Number.isInteger(currentLv) || !Number.isInteger(targetLv)) {
    return { error: "레벨은 정수로 입력하세요." };
  }

  if (currentLv < 1 || targetLv < 1) {
    return { error: "레벨은 1 이상이어야 합니다." };
  }

  if (currentLv >= targetLv) {
    return { error: "목표 레벨은 현재 레벨보다 커야 합니다." };
  }

  if (targetLv - 1 >= expTotal.length) {
    return { error: "목표 레벨 데이터가 없습니다." };
  }

  const currentTotal = expTotal[currentLv - 1] || 0n;
  const targetTotal = expTotal[targetLv - 1] || 0n;

  return { currentLv, targetLv, requiredExp: targetTotal - currentTotal };
}

export function getExpNeedForLevel(level) {
  level = Number(level);

  if (!Number.isInteger(level) || level < 1) {
    return { error: "레벨은 1 이상의 정수로 입력하세요." };
  }

  const exp = expNeed[level];
  if (typeof exp !== "bigint" || exp <= 0n) {
    return { error: "해당 레벨의 경험치 데이터가 없습니다." };
  }

  return { level, expNeed: Number(exp), expNeedBigInt: exp };
}

export function calculateLevelUpTime(currentLv, targetLv, expPerMinute, hourglassLv) {
  const expPerMinuteBigInt = parseIntegerBigInt(expPerMinute, { allowZero: false });
  hourglassLv = Number(hourglassLv);

  if (expPerMinuteBigInt === null || !Number.isFinite(hourglassLv)) {
    return { error: "경험치와 모래시계 레벨은 숫자로 입력하세요." };
  }

  if (!Number.isInteger(hourglassLv) || hourglassLv < 0 || hourglassLv > 50) {
    return { error: "모래시계 레벨은 0~50 사이의 정수여야 합니다." };
  }

  const expInfo = getRequiredExpBetweenLevels(currentLv, targetLv);
  if (expInfo.error) return expInfo;

  const { numerator, denominator, multiplier } = getHourglassMultiplierParts(hourglassLv);
  const adjustedRequiredExpScaled = expInfo.requiredExp * numerator;
  const totalMinutes = scaledToNumber(adjustedRequiredExpScaled, denominator * expPerMinuteBigInt);
  const totalHours = totalMinutes / 60;
  const totalDays = totalMinutes / 1440;

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = Math.round(totalMinutes % 60);

  return {
    currentLv: expInfo.currentLv,
    targetLv: expInfo.targetLv,
    baseRequiredExp: expInfo.requiredExp,
    multiplier,
    requiredExpScaled: adjustedRequiredExpScaled,
    requiredExpScale: denominator,
    totalMinutes,
    totalHours,
    totalDays,
    days,
    hours,
    minutes
  };
}

export function calculateLevelAtMinutes(currentLv, currentExp, expPerMinute, hourglassLv, minutesUntil, maxLevel = null) {
  currentLv = Number(currentLv);
  const currentExpBigInt = parseIntegerBigInt(currentExp || "0");
  const expPerMinuteBigInt = parseIntegerBigInt(expPerMinute, { allowZero: false });
  hourglassLv = Number(hourglassLv);
  minutesUntil = Number(minutesUntil);
  maxLevel = maxLevel === null || maxLevel === "" || maxLevel === undefined ? null : Number(maxLevel);

  if (!Number.isInteger(currentLv) || currentLv < 1) {
    return { error: "현재 레벨은 1 이상의 정수로 입력하세요." };
  }
  if (currentExpBigInt === null) {
    return { error: "현재 경험치는 0 이상인 숫자로 입력하세요." };
  }
  if (expPerMinuteBigInt === null) {
    return { error: "1분당 경험치는 0보다 커야 합니다." };
  }
  if (!Number.isInteger(hourglassLv) || hourglassLv < 0 || hourglassLv > 50) {
    return { error: "모래시계 레벨은 0~50 사이의 정수여야 합니다." };
  }
  if (!Number.isFinite(minutesUntil) || minutesUntil < 0) {
    return { error: "목표 시각을 올바르게 입력하세요." };
  }
  if (currentLv >= expNeed.length) {
    return { error: "현재 레벨 데이터가 없습니다." };
  }
  if (maxLevel !== null) {
    if (!Number.isInteger(maxLevel) || maxLevel < 1) {
      return { error: "현재 나의 만렙은 1 이상의 정수로 입력하세요." };
    }
    if (maxLevel >= expNeed.length) {
      return { error: "현재 나의 만렙 데이터가 없습니다." };
    }
    if (currentLv > maxLevel) {
      return { error: "현재 레벨은 현재 나의 만렙보다 클 수 없습니다." };
    }
  }

  const { numerator, denominator, multiplier } = getHourglassMultiplierParts(hourglassLv);
  const elapsedMs = BigInt(Math.max(0, Math.round(minutesUntil * Number(MINUTE_MS))));

  if (maxLevel !== null && currentLv === maxLevel) {
    return {
      currentLv,
      currentExp: currentExpBigInt,
      level: maxLevel,
      expInLevelScaled: 0n,
      expInLevelScale: FORECAST_EXP_SCALE,
      nextLevelExpScaled: 0n,
      nextLevelExpScale: FORECAST_EXP_SCALE,
      expPercent: 100,
      totalGainedExpScaled: 0n,
      totalGainedExpScale: FORECAST_EXP_SCALE,
      minutesUntil,
      multiplier,
      reachedMaxLevel: true,
      cappedByMaxLevel: true,
      minutesToMaxLevel: 0
    };
  }

  const currentNeed = expNeed[currentLv];
  if (typeof currentNeed !== "bigint" || currentNeed <= 0n) {
    return { error: "현재 레벨의 경험치 데이터가 없습니다." };
  }
  if (currentExpBigInt * denominator >= currentNeed * numerator) {
    return { error: "현재 경험치는 현재 레벨의 필요 경험치보다 작아야 합니다." };
  }

  let level = currentLv;
  let expInLevelScaled = (currentExpBigInt * FORECAST_EXP_SCALE) + (expPerMinuteBigInt * elapsedMs * denominator);
  const totalGainedExpScaled = expPerMinuteBigInt * elapsedMs * denominator;
  let expUntilMaxLevelScaled = null;

  if (maxLevel !== null) {
    expUntilMaxLevelScaled = (currentNeed * numerator * MINUTE_MS) - (currentExpBigInt * FORECAST_EXP_SCALE);
    for (let lv = currentLv + 1; lv < maxLevel; lv++) {
      const need = expNeed[lv];
      if (typeof need !== "bigint" || need <= 0n) {
        return { error: "현재 나의 만렙까지 필요한 경험치 데이터가 없습니다." };
      }
      expUntilMaxLevelScaled += need * numerator * MINUTE_MS;
    }
  }

  const minutesToMaxLevel = maxLevel === null
    ? null
    : scaledToNumber(expUntilMaxLevelScaled, FORECAST_EXP_SCALE * expPerMinuteBigInt);
  const cappedByMaxLevel = maxLevel !== null && minutesToMaxLevel <= minutesUntil;

  if (cappedByMaxLevel) {
    return {
      currentLv,
      currentExp: currentExpBigInt,
      level: maxLevel,
      expInLevelScaled: 0n,
      expInLevelScale: FORECAST_EXP_SCALE,
      nextLevelExpScaled: 0n,
      nextLevelExpScale: FORECAST_EXP_SCALE,
      expPercent: 100,
      totalGainedExpScaled: expUntilMaxLevelScaled,
      totalGainedExpScale: FORECAST_EXP_SCALE,
      minutesUntil: minutesToMaxLevel,
      multiplier,
      reachedMaxLevel: true,
      cappedByMaxLevel: true,
      minutesToMaxLevel
    };
  }

  let reachedMaxLevel = false;

  while (level < expNeed.length && (maxLevel === null || level < maxLevel)) {
    const needForLevel = expNeed[level];
    if (typeof needForLevel !== "bigint" || needForLevel <= 0n) {
      reachedMaxLevel = true;
      break;
    }

    const needForLevelScaled = needForLevel * numerator * MINUTE_MS;
    if (expInLevelScaled < needForLevelScaled) break;
    expInLevelScaled -= needForLevelScaled;
    level += 1;
  }

  const nextNeed = expNeed[level];
  const hasNextLevelData = typeof nextNeed === "bigint" && nextNeed > 0n && !reachedMaxLevel && (maxLevel === null || level < maxLevel);
  const nextNeedScaled = hasNextLevelData ? nextNeed * numerator * MINUTE_MS : 0n;
  const expPercent = hasNextLevelData ? scaledToNumber(expInLevelScaled * 10000n, nextNeedScaled) / 100 : 100;

  return {
    currentLv,
    currentExp: currentExpBigInt,
    level,
    expInLevelScaled: hasNextLevelData ? expInLevelScaled : 0n,
    expInLevelScale: FORECAST_EXP_SCALE,
    nextLevelExpScaled: hasNextLevelData ? nextNeedScaled : 0n,
    nextLevelExpScale: FORECAST_EXP_SCALE,
    expPercent,
    totalGainedExpScaled,
    totalGainedExpScale: FORECAST_EXP_SCALE,
    minutesUntil,
    multiplier,
    reachedMaxLevel: !hasNextLevelData,
    cappedByMaxLevel: false,
    minutesToMaxLevel
  };
}

/**
 * 사이클 최적화 계산
 * LV 1에서 시작하여 주어진 시간 동안 사냥 + 소탕으로 도달 가능한 최고 레벨 산출
 */
export function calculateCycleLevel(expPerMinute, hourglassLv, sweepExp, sweepCount, totalHours) {
  const expPerMinuteBigInt = parseIntegerBigInt(expPerMinute, { allowZero: false });
  hourglassLv = Number(hourglassLv);
  const sweepExpBigInt = parseIntegerBigInt(sweepExp);
  sweepCount = Number(sweepCount);
  totalHours = Number(totalHours);

  if (expPerMinuteBigInt === null) {
    return { error: "1분당 경험치는 0보다 커야 합니다." };
  }
  if (!Number.isInteger(hourglassLv) || hourglassLv < 0 || hourglassLv > 50) {
    return { error: "모래시계 레벨은 0~50 사이의 정수여야 합니다." };
  }
  if (sweepExpBigInt === null) {
    return { error: "소탕 경험치는 0 이상이어야 합니다." };
  }
  if (!Number.isInteger(sweepCount) || sweepCount < 1 || sweepCount > 3) {
    return { error: "소탕 횟수는 1~3 사이의 정수여야 합니다." };
  }
  if (!Number.isFinite(totalHours) || totalHours <= 0) {
    return { error: "총 시간은 0보다 커야 합니다." };
  }

  const { numerator, denominator, multiplier } = getHourglassMultiplierParts(hourglassLv);
  const totalHuntingExp = expPerMinuteBigInt * BigInt(totalHours) * 60n;
  const sweepSets = Math.max(1, Math.floor(totalHours / 24));
  const totalSweepExp = sweepExpBigInt * BigInt(sweepCount) * BigInt(sweepSets);
  const grandTotalExp = totalHuntingExp + totalSweepExp;

  let cycleLevel = 1;
  for (let lv = 1; lv < expTotal.length; lv++) {
    if ((expTotal[lv] * numerator) <= (grandTotalExp * denominator)) {
      cycleLevel = lv + 1;
    } else {
      break;
    }
  }

  return {
    cycleLevel,
    grandTotalExp,
    totalHuntingExp,
    totalSweepExp,
    multiplier,
    sweepSets
  };
}
