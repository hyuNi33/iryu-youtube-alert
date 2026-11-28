import { loadCSV } from "../../js/csv-loader.js";
import { ascensionBonus, readDamageEffect } from "./rp-skill-damage.js";

const dataPath = "../../datas";

export async function loadSkills() {
  const [meta, effectMeta] = await Promise.all([
    loadCSV(`${dataPath}/rpskill/meta.csv`),
    loadCSV(`${dataPath}/rpskill-perf/meta.csv`),
  ]);
  const effectFiles = new Map(effectMeta.map(row => [row.name, row.file]));

  return Promise.all(meta.map(async row => {
    const name = row.skillName;
    const effectFile = effectFiles.get(name === "환포" ? "환포증가" : name);
    const [costRows, effectRows] = await Promise.all([
      loadCSV(`${dataPath}/rpskill/${row.tableKey}.csv`),
      effectFile ? loadCSV(`${dataPath}/rpskill-perf/${effectFile}`) : [],
    ]);
    const costs = new Map(costRows.map(record => [
      Number(record["레벨"]), BigInt((record["누적 RP"] ?? record["누적 포인트"] ?? record["누적 비용"]).replaceAll(",", "")),
    ]));
    costs.set(0, 0n);
    const effects = new Map(effectRows.map(record => [Number(record["레벨"]), record["효과"]]));
    const damage = new Map();
    for (const record of effectRows) {
      const effect = readDamageEffect(row.tableKey, record);
      if (effect) damage.set(Number(record["레벨"]), effect);
    }
    const start = Number(row.maxLevel11);
    const step = row.tableKey === "table11" ? 2 : 1;
    const lastLevel = damage.size ? Math.min(Math.max(...costs.keys()), Math.max(...damage.keys())) : 0;
    return { row, name, start, costs, effects, damage, step, lastLevel };
  }));
}

export function ascensionStages(skills) {
  return Object.keys(skills[0]?.row ?? {})
    .map(name => Number(name.match(/^maxLevel(\d+)$/)?.[1]))
    .filter(stage => Number.isSafeInteger(stage) && stage >= 12)
    .sort((a, b) => a - b);
}

export function populateAscensionStages(select, stages, offset = 0) {
  const previous = select.value;
  select.replaceChildren(...stages.map(stage => new Option(`승천${stage - 10}`, String(stage - offset))));
  if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
}

export function readDamageProfile(values, stage, total) {
  const number = name => Number(values[name]);
  const column = Number(stage);
  let stageBonus = 0;
  if (column >= 14 && values.ascensionBonus) stageBonus = number("ascensionBonus");
  else if (column === 14) stageBonus = ascensionBonus(total);
  return {
    criticalRate: number("criticalRate"),
    criticalDamage: number("criticalDamage"),
    criticalMultiplier: number("criticalMultiplier"),
    superCriticalRate: number("superCriticalRate"),
    superCriticalMultiplier: number("superCriticalMultiplier"),
    finalAttackExtraRate: number("finalAttackExtraRate"),
    finalAttackMultiplier: number("finalAttackMultiplier"),
    greedLimit: Math.floor(number("meso") / 50) / 100,
    characterLevel: number("characterLevel"),
    ascensionBonus: stageBonus,
  };
}
