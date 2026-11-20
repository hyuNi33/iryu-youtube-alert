import { loadCSV } from "../../js/csv-loader.js";
import { compactNumber } from "../../js/table-number.js";

const engine = window.IryuRP;
const dataPath = "../../datas";
const plannerNames = {
  "샤프": "샤프아이즈",
  "메용": "메이플 용사",
  "어드밴스드 콤보어택": "어드밴스드 콤보",
};

async function loadSkills() {
  const [meta, effectMeta] = await Promise.all([
    loadCSV(`${dataPath}/rpskill/meta.csv`),
    loadCSV(`${dataPath}/rpskill-perf/meta.csv`),
  ]);
  const effectFiles = new Map(effectMeta.map(row => [row.name, row.file]));
  const plan = engine.buildPlan({ initial: 0n, daily: 0n, period: 1 });
  const references = new Map(plan.skills.map((skill, index) => [
    skill.name, { step: skill.step, weight: plan.weights[index] },
  ]));

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
    const start = Number(row.maxLevel11);
    const reference = references.get(plannerNames[name] ?? name);
    const step = reference?.step ?? 1;
    return { row, name, start, costs, effects, step, reference };
  }));
}

function recommend(skills, stage, budget) {
  const targets = skills.map(skill => {
    const { row, start, step, costs, reference } = skill;
    const cap = Number(row[`maxLevel${stage}`]);
    const max = cap - (cap - start) % step;
    const baseline = costs.get(start);
    const limit = costs.get(max) - baseline;
    return { ...skill, max, baseline, limit, weight: reference?.weight ?? limit, level: start, spent: 0n };
  });

  // 상한까지 투자할 수 있는 스킬의 몫을 확정한 뒤 나머지 예산을 재배분한다.
  let remaining = budget;
  const resonance = Number(stage) >= 13
    ? targets.find(target => target.row.tableKey === "table37")
    : undefined;
  if (resonance) {
    while (resonance.level < resonance.max) {
      const next = resonance.level + 1;
      const cost = resonance.costs.get(next) - resonance.baseline;
      if (cost > budget) break;
      resonance.level = next;
      resonance.spent = cost;
    }
    remaining -= resonance.spent;
  }
  let active = targets.filter(target => target !== resonance && target.limit > 0n);
  while (active.length) {
    const totalWeight = active.reduce((sum, target) => sum + target.weight, 0n);
    const capped = active.filter(target => target.limit * totalWeight <= remaining * target.weight);
    if (!capped.length) {
      for (const target of active) target.quota = remaining * target.weight / totalWeight;
      break;
    }
    for (const target of capped) {
      target.quota = target.limit;
      remaining -= target.limit;
    }
    active = active.filter(target => target.quota === undefined);
  }

  for (const target of targets) {
    while (target.level + target.step <= target.max) {
      const next = target.level + target.step;
      const cost = target.costs.get(next) - target.baseline;
      if (target.quota === undefined || cost > target.quota) break;
      target.level = next;
      target.spent = cost;
    }
  }

  let left = budget - targets.reduce((sum, target) => sum + target.spent, 0n);
  // 30일 계획의 마지막 날 소진 옵션과 같은 방식으로 잔액을 사용한다.
  while (true) {
    let best;
    for (const target of targets) {
      const next = target.level + target.step;
      if (next > target.max) continue;
      const after = target.costs.get(next) - target.baseline;
      const extra = after - target.spent;
      if (extra > left) continue;
      if (!best || after * best.target.weight < best.after * target.weight) {
        best = { target, next, after, extra };
      }
    }
    if (!best) break;
    best.target.level = best.next;
    best.target.spent = best.after;
    left -= best.extra;
  }
  return { targets, left };
}

const element = id => document.getElementById(id);
const form = element("rp-form");
const results = element("rp-results");
const status = element("rp-status");
const storageKey = "iryu_rp_skill_recommend";
const fields = ["stage", "total", "unit"];
const format = amount => compactNumber(amount.toString()) + " RP";
const fullRP = amount => amount.toLocaleString("ko-KR") + " RP";

function showRP(node, amount) {
  node.textContent = format(amount);
  node.title = fullRP(amount);
}

function restoreInputs() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (typeof saved?.total === "string") form.elements.total.value = saved.total;
    if (["12", "13", "14"].includes(saved?.stage)) form.elements.stage.value = saved.stage;
    if (["RP", "경", "해"].includes(saved?.unit)) form.elements.unit.value = saved.unit;
  } catch {
    // 저장소를 사용할 수 없어도 계산은 가능하다.
  }
}

function saveInputs() {
  try {
    const values = Object.fromEntries(fields.map(name => [name, form.elements[name].value]));
    localStorage.setItem(storageKey, JSON.stringify(values));
  } catch {
    // 저장소를 사용할 수 없어도 계산은 가능하다.
  }
}

restoreInputs();
function handleInputChange() {
  saveInputs();
  results.hidden = true;
  if (!form.querySelector("button").disabled) {
    status.textContent = "";
    status.removeAttribute("title");
  }
}
form.addEventListener("input", handleInputChange);
form.addEventListener("change", handleInputChange);

async function initialize() {
  const skills = await loadSkills();
  const baseline = skills.reduce((sum, skill) => sum + skill.costs.get(skill.start), 0n);
  status.textContent = "";
  form.querySelector("button").disabled = false;

  form.addEventListener("submit", event => {
    event.preventDefault();
    saveInputs();
    results.hidden = true;
    status.removeAttribute("title");
    const inputs = new FormData(form);
    let total;
    try {
      total = engine.parseRP(inputs.get("total"), inputs.get("unit"));
    } catch {
      status.textContent = "선택한 단위에 맞는 0 이상의 누적 RP를 입력하세요.";
      return;
    }
    if (total < baseline) {
      status.textContent = `승천1까지 필요한 ${format(baseline)}보다 누적 RP가 ${format(baseline - total)} 부족합니다.`;
      status.title = `승천1까지 필요한 ${fullRP(baseline)}보다 누적 RP가 ${fullRP(baseline - total)} 부족합니다.`;
      return;
    }

    const budget = total - baseline;
    const { targets, left } = recommend(skills, inputs.get("stage"), budget);
    const upgrades = targets.filter(target => target.level > target.start);
    showRP(element("rp-baseline"), baseline);
    showRP(element("rp-budget"), budget);
    showRP(element("rp-spent"), budget - left);
    showRP(element("rp-left"), left);
    element("rp-rows").replaceChildren(...upgrades.map(target => {
      const row = document.createElement("tr");
      for (const value of [target.name, target.start, target.level]) {
        row.insertCell().textContent = value;
      }
      showRP(row.insertCell(), target.spent);
      row.insertCell().textContent = target.effects.get(target.level) || "효과 데이터 없음";
      return row;
    }));
    status.textContent = upgrades.length ? "" : "현재 예산으로 추가 강화할 수 있는 스킬이 없습니다.";
    results.hidden = false;
  });

  if (form.elements.total.value.trim()) form.requestSubmit();
}

initialize().catch(error => {
  console.error(error);
  status.textContent = "스킬 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.";
});
