const damageSkills = {
  table11: "sharp",
  table12: "berserk",
  table14: "shadowPartner",
  table15: "mapleWarrior",
  table16: "advancedCombo",
  table17: "finalAttack",
  table25: "sharpness",
  table26: "demonsFury",
  table27: "greed",
  table18: "criticalReinforce",
  table22: "vitalChain",
  table29: "heroesEcho",
  table30: "advancedFinalAttack",
  table32: "gravitas",
  table37: "resonance",
  table38: "finishingBlow",
  table39: "genesisEcho",
};

const percent = value => 1 + value / 100;
const chance = value => Math.min(1, value / 100);
const vitalChainAverage = (5.19 - 1) / (10.91 - 1);
const finishingBlowAverage = 0.25;

function gravitasBonus(skillLevel, characterLevel) {
  // 캐릭터 Lv.806에서 관록 Lv.47 약 +34%, Lv.56 +43.7%.
  const bonusAt806 = 34 + (skillLevel - 47) * (43.7 - 34) / (56 - 47);
  return Math.max(0, bonusAt806) * characterLevel / 806;
}

export function readDamageEffect(tableKey, record) {
  const skill = damageSkills[tableKey];
  if (!skill) return undefined;
  const level = Number(record["레벨"]);
  const text = record["최종 데미지"] || record["효과"];
  const values = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*%/g), match => Number(match[1]));
  switch (skill) {
    case "berserk":
    case "advancedCombo":
      // 계산 이미지의 고레벨 효과는 기존 CSV의 백분율에서 100을 뺀 값이다.
      return [values[0] - 100];
    case "demonsFury":
      // 계산 이미지의 Lv.60 +40%와 초기 스킬표의 비율을 적용한다.
      return [level * 2 / 3];
    case "greed":
    case "finishingBlow":
      return [values.at(-1)];
    case "gravitas":
      return [level];
    default:
      return values;
  }
}

export function damageEffectText(target, profile) {
  const skill = damageSkills[target.row.tableKey];
  const effect = target.damage.get(target.level)?.[0];
  if (skill === "berserk" || skill === "advancedCombo") {
    return `최종 데미지 +${effect}%`;
  }
  if (skill === "demonsFury") return `보스 데미지 +${effect.toFixed(2)}%`;
  if (skill === "gravitas") {
    return `캐릭터 Lv.${profile.characterLevel} 기준 최종 데미지 약 +${gravitasBonus(effect, profile.characterLevel).toFixed(2)}%`;
  }
  if (skill === "greed") {
    const applied = Math.min(effect, profile.greedLimit);
    return `보유 메소 기준 최종 데미지 +${applied.toFixed(2)}% (상한 +${effect}%)`;
  }
  return target.effects.get(target.level) || "효과 데이터 없음";
}

export function ascensionBonus(total) {
  // 승천 정보 페이지의 승천 4 표본값(%). 창세의 잔향에만 사용한다.
  const milestones = [[0, 0], [40, 84], [100, 166], [300, 311], [1000, 509], [5000, 800]];
  const rp = Number(total) / 1e20;
  for (let index = 1; index < milestones.length; index++) {
    const [highRP, highBonus] = milestones[index];
    if (rp > highRP) continue;
    const [lowRP, lowBonus] = milestones[index - 1];
    return lowBonus + (highBonus - lowBonus) * (rp - lowRP) / (highRP - lowRP);
  }
  return milestones.at(-1)[1];
}

function criticalAverage(effects, profile) {
  const [sharpRate, sharpDamage] = effects.sharp;
  const [superRate, superDamage] = effects.sharpness;
  const rawChance = (profile.criticalRate + sharpRate) / 100;
  const reinforce = percent(rawChance * effects.criticalReinforce[0]);
  const criticalHit = percent(profile.criticalDamage + sharpDamage) * reinforce * profile.criticalMultiplier;
  const superHit = profile.superCriticalMultiplier * percent(superDamage);
  const averageCriticalHit = criticalHit * (1 + chance(profile.superCriticalRate + superRate) * (superHit - 1));
  return 1 + Math.min(1, rawChance) * (averageCriticalHit - 1);
}

function averageDamage(effects, profile) {
  const [ascension] = effects.genesisEcho;
  const baseAttack = percent(effects.heroesEcho[0]) * percent(effects.mapleWarrior[0]);
  const finalDamage = percent(effects.berserk[0])
    * percent(effects.advancedCombo[0])
    * percent(effects.resonance[0])
    * percent(gravitasBonus(effects.gravitas[0], profile.characterLevel))
    * percent(Math.min(effects.greed[0], profile.greedLimit))
    * percent(effects.vitalChain[0] * vitalChainAverage)
    * percent(effects.finishingBlow[0] * finishingBlowAverage)
    * percent(profile.ascensionBonus * percent(ascension));
  const directDamage = baseAttack * finalDamage * criticalAverage(effects, profile);
  const shadowDamage = directDamage * effects.shadowPartner[0] / 100;
  const [finalAttackRateBonus, finalAttackDamageBonus] = effects.advancedFinalAttack;
  const finalAttackRate = chance(effects.finalAttack[0] + profile.finalAttackExtraRate + finalAttackRateBonus);
  const finalAttackDamage = directDamage * finalAttackRate * profile.finalAttackMultiplier * percent(finalAttackDamageBonus);
  const normal = directDamage + shadowDamage + finalAttackDamage;
  return { normal, boss: normal * percent(effects.demonsFury[0]) };
}

const noEffect = [0, 0];

function effectsAtStart(skills) {
  return Object.fromEntries(skills.filter(skill => damageSkills[skill.row.tableKey]).map(skill => [
    damageSkills[skill.row.tableKey], skill.damage.get(skill.start) ?? noEffect,
  ]));
}

export function damageAtStart(skills, profile) {
  return averageDamage(effectsAtStart(skills), profile);
}

export function skillMaxLevel(skill, stage) {
  for (let current = Number(stage); current >= 11; current--) {
    const cap = skill.row[`maxLevel${current}`];
    if (/^\d+$/.test(cap)) return Math.min(Number(cap), skill.lastLevel ?? Infinity);
  }
  return skill.start;
}

export function recommend(skills, stage, budget, profile, goal, { frozen = new Set(), waitForBest = false } = {}) {
  const targets = skills.filter(skill => damageSkills[skill.row.tableKey]).map(skill => {
    const cap = skillMaxLevel(skill, stage);
    const max = cap - (cap - skill.start) % skill.step;
    return { ...skill, type: damageSkills[skill.row.tableKey], max, level: skill.start, spent: 0n };
  });
  const effects = effectsAtStart(targets);
  const baseline = averageDamage(effects, profile);
  const upgrades = new Set();
  let left = budget;

  function buy(target, next, cost) {
    target.level = next;
    target.spent += cost;
    effects[target.type] = target.damage.get(next);
    left -= cost;
    upgrades.add(target);
  }

  if (Number(stage) >= 13) {
    const resonance = targets.find(target => target.type === "resonance");
    for (let next = resonance.level + 1; next <= resonance.max; next++) {
      const cost = resonance.costs.get(next) - resonance.costs.get(resonance.level);
      if (cost > left) break;
      buy(resonance, next, cost);
    }
  }

  // 한 번 강화할 때마다 크리티컬 확률과 리인포스 같은 상호작용을 다시 평가한다.
  let damage = averageDamage(effects, profile);
  while (left > 0n) {
    let best;
    for (const target of targets) {
      const next = target.level + target.step;
      if (next > target.max || frozen.has(target.row.tableKey)) continue;
      const cost = target.costs.get(next) - target.costs.get(target.level);
      if (!waitForBest && cost > left) continue;
      const previous = effects[target.type];
      effects[target.type] = target.damage.get(next);
      const after = averageDamage(effects, profile);
      effects[target.type] = previous;
      const efficiency = Math.log(after[goal] / damage[goal]) / Number(cost);
      if (efficiency > (best?.efficiency ?? 0)) best = { target, next, cost, after, efficiency };
    }
    if (!best || best.cost > left) break;
    buy(best.target, best.next, best.cost);
    damage = best.after;
  }

  return {
    upgrades: [...upgrades],
    left,
    damage,
    normalGain: damage.normal / baseline.normal - 1,
    bossGain: damage.boss / baseline.boss - 1,
  };
}
