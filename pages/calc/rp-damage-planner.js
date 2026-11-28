import { damageAtStart, recommend, skillMaxLevel } from "./rp-skill-damage.js";
import { ascensionStages, readDamageProfile } from "./rp-skill-data.js";

// These are the indices used by existing daily completion records.
const existingSkillKeys = [
  "table11", "table29", "table12", "table14", "table15", "table25", "table16",
  "table26", "table27", "table18", "table22", "table30", "table32",
];
const resonanceKey = "table37";
const finishingBlowKey = "table38";
const genesisEchoKey = "table39";

function dailyTable(skill) {
  return Array.from({ length: 30 }, (_, index) => {
    const level = index + 1;
    const cumulative = skill.costs.get(level);
    const [damage, starlight = 0] = skill.damage.get(level);
    return { level, cumulative, cost: cumulative - skill.costs.get(index), damage,
      starlight, effect: skill.effects.get(level) };
  });
}

export function prepareDailyCatalog(data) {
  const byKey = new Map(data.map(skill => [skill.row.tableKey, skill]));
  return {
    data: data.filter(skill => skill.damage.size),
    stages: ascensionStages(data),
    byKey,
    foundationCost: data.reduce((sum, skill) => sum + skill.costs.get(skill.start), 0n),
    resonanceTable: dailyTable(byKey.get(resonanceKey)),
    finishingBlowTable: dailyTable(byKey.get(finishingBlowKey)),
    genesisEchoTable: dailyTable(byKey.get(genesisEchoKey)),
  };
}

function prepareCompletions(skills, completed, budgets, period) {
  const locks = Array.from({ length: period + 1 }, () => []);
  const lastDay = new Map();
  for (const item of completed) {
    const skill = skills[item.skill];
    if (!skill || !Number.isInteger(item.day) || item.day < 1 || !Number.isInteger(item.level)
      || item.level < skill.start || item.level > skill.maxLevel
      || (item.level - skill.start) % skill.step !== 0 || !skill.costs.has(item.level)) {
      throw Error("invalid-completed");
    }
    if (item.day > period || item.level === skill.start) continue;
    locks[item.day].push(item);
    lastDay.set(skill.key, Math.max(lastDay.get(skill.key) ?? 0, item.day));
  }
  const committed = [0n];
  const committedLevels = skills.map(skill => skill.start);
  for (let day = 1; day <= period; day++) {
    let total = committed[day - 1];
    for (const { skill: index, level } of locks[day]) {
      if (level <= committedLevels[index]) continue;
      const skill = skills[index];
      total += skill.costs.get(level) - skill.costs.get(committedLevels[index]);
      committedLevels[index] = level;
    }
    if (total > budgets[day]) throw Error("completed-over-budget");
    committed.push(total);
  }
  // Keep enough budget for recorded upgrades when their completion dates arrive.
  const allowance = budgets.map((budget, day) => budget - committed[day]);
  for (let day = period - 1; day >= 1; day--) {
    if (allowance[day + 1] < allowance[day]) allowance[day] = allowance[day + 1];
  }
  return { locks, lastDay, committed, allowance };
}

export function buildDamagePlan(engine, catalog, options) {
  const { initial, daily, period, ascensionStage = "2", completed = [],
    spendAllOnLastDay = false, damageSettings, goal } = options;
  const stage = Number(ascensionStage) + 10;
  if (!catalog.stages.includes(stage)) throw Error("invalid-ascension");
  const useResonance = stage === 12 && options.includeResonance === true;
  const resonanceLevel = stage > 12 ? 30 : useResonance ? options.resonanceLevel : 0;
  if (!Number.isInteger(resonanceLevel) || resonanceLevel < 0 || resonanceLevel > 30) {
    throw Error("invalid-resonance-level");
  }
  const { budgets, dailyIncome } = engine.buildIncomeSchedule(options);
  const visibleKeys = [...existingSkillKeys];
  if (useResonance || stage >= 13) visibleKeys.push(resonanceKey);
  if (stage >= 13) visibleKeys.push(finishingBlowKey);
  if (stage >= 14) visibleKeys.push(genesisEchoKey);
  const skills = visibleKeys.map((key, index) => {
    const source = catalog.byKey.get(key);
    const start = key === resonanceKey ? resonanceLevel : source.start;
    const maxLevel = skillMaxLevel(source, stage);
    const base = start + source.step <= maxLevel ? source.costs.get(start + source.step) - source.costs.get(start) : 0n;
    return { ...source, key, start, maxLevel, base, name: engine.SKILLS[index]?.name ?? source.name,
      kind: key === resonanceKey ? "resonance" : undefined };
  });
  const initialSkills = catalog.data.map(skill =>
    skill.row.tableKey === resonanceKey ? { ...skill, start: resonanceLevel } : skill);
  const initialCost = catalog.foundationCost + catalog.byKey.get(resonanceKey).costs.get(resonanceLevel);
  const { locks, lastDay, committed, allowance } = prepareCompletions(skills, completed, budgets, period);
  const currentLevels = new Map(initialSkills.map(skill => [skill.row.tableKey, skill.start]));
  const levels = skills.map(skill => [skill.start]);
  const totals = [0n], balances = [initial], gains = [{ normal: 0, boss: 0 }];
  let discretionarySpent = 0n;
  for (let day = 1; day <= period; day++) {
    for (const { skill: index, level } of locks[day]) {
      const { key } = skills[index];
      currentLevels.set(key, Math.max(currentLevels.get(key), level));
    }
    const frozen = new Set();
    if (!useResonance && stage === 12) frozen.add(resonanceKey);
    // A confirmed level stays on its recorded day. Further upgrades can begin the next day.
    for (const [key, last] of lastDay) if (last >= day) frozen.add(key);
    const daySkills = initialSkills.map(skill => ({ ...skill, start: currentLevels.get(skill.row.tableKey) }));
    const profile = readDamageProfile(damageSettings, stage, initialCost + budgets[day]);
    const baselineDamage = damageAtStart(initialSkills, profile);
    const available = allowance[day] - discretionarySpent;
    const result = recommend(daySkills, stage, available, profile, goal, {
      frozen, waitForBest: !(spendAllOnLastDay && day === period),
    });
    discretionarySpent += available - result.left;
    for (const target of result.upgrades) currentLevels.set(target.row.tableKey, target.level);
    for (const [index, skill] of skills.entries()) levels[index].push(currentLevels.get(skill.key));
    const total = committed[day] + discretionarySpent;
    totals.push(total);
    balances.push(budgets[day] - total);
    gains.push({ normal: result.damage.normal / baselineDamage.normal - 1,
      boss: result.damage.boss / baselineDamage.boss - 1 });
  }
  return { skills, ascensionStage, includeResonance: useResonance, resonanceTable: catalog.resonanceTable,
    period, initial, daily, levels, totals, balances, gains, budgets, dailyIncome, totalBudget: budgets[period] };
}
