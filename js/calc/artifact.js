/**
 * 유물 계산 로직
 * datas/artifacts/ 디렉토리의 CSV에서 데이터 로딩
 */
import { loadCSV } from "../csv-loader.js";

let ARTIFACTS = {};
let ARTIFACT_KEYS = [];
let loaded = false;

export async function initArtifactData(basePath) {
  if (loaded) return;

  const [metaRows, levelRows] = await Promise.all([
    loadCSV(basePath + "/datas/artifacts/meta.csv"),
    loadCSV(basePath + "/datas/artifacts/levels.csv")
  ]);

  // 메타 정보 구축
  for (const row of metaRows) {
    ARTIFACTS[row.id] = {
      id: row.id,
      name: row.name,
      effect: row.effect,
      maxLevel: Number(row.maxLevel) || 0,
      type: row.type || "normal",
      sameAs: row.sameAs || "",
      levels: {}
    };
  }

  // 레벨 데이터 구축
  for (const row of levelRows) {
    const art = ARTIFACTS[row.id];
    if (!art) continue;

    art.levels[Number(row.level)] = {
      need: Number(row.need) || 0,
      cumStone: Number(row.cumStone) || 0,
      unlockGem: Number(row.unlockGem) || 0,
      cumGem: Number(row.cumGem) || 0
    };
  }

  ARTIFACT_KEYS = Object.keys(ARTIFACTS);
  loaded = true;
}

export function getArtifactKeys() {
  return ARTIFACT_KEYS;
}

export function getArtifacts() {
  return ARTIFACTS;
}

// sameAs 처리
function getArtifact(id) {
  const art = ARTIFACTS[id];
  if (!art) return null;

  if (art.sameAs) {
    const base = ARTIFACTS[art.sameAs];
    if (!base) return null;
    return { ...base, id: art.id, name: art.name, effect: art.effect || base.effect };
  }

  return art;
}

function getLevelData(artifact, level) {
  return artifact.levels[level] || null;
}

function getStoneCostBetween(artifact, fromLevel, toLevel) {
  const fromData = getLevelData(artifact, fromLevel);
  const toData = getLevelData(artifact, toLevel);
  if (!fromData || !toData) return 0;
  return toData.cumStone - fromData.cumStone;
}

function findReachableLevel(artifact, stone) {
  let low = 0, high = artifact.maxLevel, answer = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const cost = getStoneCostBetween(artifact, 0, mid);
    if (cost <= stone) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer;
}

function getMaxCost(artifact) {
  return getStoneCostBetween(artifact, 0, artifact.maxLevel);
}

function equalDistributeWithCaps(totalStone, rows) {
  for (const row of rows) row.allocated = 0;

  let remain = totalStone;
  let active = rows.slice();

  while (active.length > 0 && remain > 0) {
    const share = Math.floor(remain / active.length);

    if (share <= 0) {
      for (const row of active) {
        if (remain <= 0) break;
        if (row.allocated < row.cap) {
          row.allocated += 1;
          remain -= 1;
        }
      }
      break;
    }

    let progressed = false;
    for (const row of active) {
      const room = row.cap - row.allocated;
      if (room <= 0) continue;
      const give = Math.min(share, room);
      if (give > 0) {
        row.allocated += give;
        remain -= give;
        progressed = true;
      }
    }

    active = active.filter(row => row.allocated < row.cap);
    if (!progressed) break;
  }
}

function pullEvenlyFromDonors(donors, amount) {
  if (amount <= 0) return true;
  if (!donors || donors.length === 0) return false;

  const totalAvailable = donors.reduce((sum, row) => sum + row.allocated, 0);
  if (totalAvailable < amount) return false;

  let need = amount;

  while (need > 0) {
    const active = donors.filter(row => row.allocated > 0);
    if (active.length === 0) return false;

    const share = Math.floor(need / active.length);

    if (share <= 0) {
      for (const row of active) {
        if (need <= 0) break;
        if (row.allocated > 0) {
          row.allocated -= 1;
          need -= 1;
        }
      }
      continue;
    }

    let removedThisRound = 0;
    for (const row of active) {
      const take = Math.min(share, row.allocated);
      if (take > 0) {
        row.allocated -= take;
        need -= take;
        removedThisRound += take;
      }
    }

    if (removedThisRound <= 0) {
      for (const row of active) {
        if (need <= 0) break;
        if (row.allocated > 0) {
          row.allocated -= 1;
          need -= 1;
          removedThisRound += 1;
        }
      }
      if (removedThisRound <= 0) return false;
    }
  }

  return true;
}

export function getArtifactMaxLevel(id) {
  const artifact = getArtifact(id);
  return artifact ? artifact.maxLevel : 0;
}

/**
 * 추천 알고리즘: 매 반복마다 다음 1레벨 비용이 가장 싼 유물을 우선 레벨업
 * @param {number} remainingStone - 잔여 수호자의 돌
 * @param {object} currentLevels - { artifactId: currentLevel }
 * @returns {{ steps: Array<{name, from, to, cost, remaining}>, remainingStone: number }}
 */
export function recommendArtifactUpgrades(remainingStone, currentLevels) {
  const levels = { ...currentLevels };
  let stone = remainingStone;
  const steps = [];

  while (stone > 0) {
    const candidates = [];
    for (const id of Object.keys(levels)) {
      const artifact = getArtifact(id);
      if (!artifact || levels[id] <= 0 || levels[id] >= artifact.maxLevel) continue;
      const nextLevelData = getLevelData(artifact, levels[id] + 1);
      if (!nextLevelData || nextLevelData.need <= 0) continue;
      candidates.push({
        id,
        name: ARTIFACTS[id].name,
        fromLevel: levels[id],
        toLevel: levels[id] + 1,
        cost: nextLevelData.need
      });
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));

    const best = candidates[0];
    if (best.cost > stone) break;

    stone -= best.cost;
    levels[best.id] = best.toLevel;
    steps.push({
      name: best.name,
      from: best.fromLevel,
      to: best.toLevel,
      cost: best.cost,
      remaining: stone
    });
  }

  return { steps, remainingStone: stone };
}

export function distributeArtifactStones(totalStone, artifactIds) {
  if (!Array.isArray(artifactIds) || artifactIds.length === 0) {
    throw new Error("선택된 유물이 없습니다.");
  }

  const rows = artifactIds.map((id, index) => {
    const artifact = getArtifact(id);
    if (!artifact) throw new Error(`유물을 찾을 수 없음: ${id}`);

    return {
      no: index + 1,
      id,
      name: artifact.name,
      artifact,
      cap: getMaxCost(artifact),
      allocated: 0, used: 0, level: 0, remain: 0, isMax: false
    };
  });

  equalDistributeWithCaps(totalStone, rows);

  for (const row of rows) {
    row.level = findReachableLevel(row.artifact, row.allocated);
    row.used = getStoneCostBetween(row.artifact, 0, row.level);
    row.remain = row.allocated - row.used;
    row.isMax = row.allocated >= row.cap;
  }

  const usedStone = rows.reduce((sum, row) => sum + row.used, 0);

  return {
    totalStone,
    usedStone,
    remainingStone: totalStone - usedStone,
    artifactCount: rows.length,
    rows: rows.map(row => ({
      no: row.no,
      name: row.name,
      allocatedStone: row.allocated,
      reachedLevel: row.level,
      usedStone: row.used,
      remainStone: row.remain,
      maxCheck: row.level >= row.artifact.maxLevel ? "O" : "X"
    }))
  };
}
