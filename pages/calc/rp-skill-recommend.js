import { compactNumber } from "../../js/table-number.js";
import { damageEffectText, recommend } from "./rp-skill-damage.js";
import { ascensionStages, loadSkills, populateAscensionStages, readDamageProfile } from "./rp-skill-data.js";

const engine = window.IryuRP;
const skillDisplayOrder = new Map([
  "resonance",
  "sharp",
  "heroesEcho",
  "berserk",
  "shadowPartner",
  "mapleWarrior",
  "sharpness",
  "advancedCombo",
  "demonsFury",
  "greed",
  "criticalReinforce",
  "vitalChain",
  "advancedFinalAttack",
  "gravitas",
  "finishingBlow",
  "genesisEcho",
].map((type, index) => [type, index]));

const element = id => document.getElementById(id);
const form = element("rp-form");
const results = element("rp-results");
const status = element("rp-status");
const storageKey = "iryu_rp_skill_recommend";
const fields = [
  "stage", "total", "unit", "goal", "criticalRate", "criticalDamage", "criticalMultiplier",
  "superCriticalRate", "superCriticalMultiplier", "meso", "characterLevel", "ascensionBonus",
  "finalAttackExtraRate", "finalAttackMultiplier",
];
const format = amount => compactNumber(amount.toString()) + " RP";
const fullRP = amount => amount.toLocaleString("ko-KR") + " RP";
const formatGain = new Intl.NumberFormat("ko-KR", {
  style: "percent",
  signDisplay: "exceptZero",
  maximumFractionDigits: 2,
});

function showRP(node, amount) {
  node.textContent = format(amount);
  node.title = fullRP(amount);
}

function showSummaryRP(id, amount) {
  const button = element(id);
  const detail = element(id + "-detail");
  showRP(button, amount);
  detail.textContent = fullRP(amount);
  detail.hidden = true;
  button.setAttribute("aria-expanded", "false");
}

document.querySelectorAll(".rp-summary button[aria-controls]").forEach(button => {
  button.addEventListener("click", () => {
    const detail = element(button.getAttribute("aria-controls"));
    detail.hidden = !detail.hidden;
    button.setAttribute("aria-expanded", String(!detail.hidden));
  });
});

function restoreInputs() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    for (const name of fields) {
      if (typeof saved?.[name] !== "string") continue;
      const field = form.elements[name];
      const defaultValue = field.value;
      field.value = saved[name];
      if (!field.validity.valid || (field.tagName === "SELECT" && !field.value)) field.value = defaultValue;
    }
  } catch {
    // 저장소를 사용할 수 없어도 계산은 가능하다.
  }
}

function updateAscensionBonusField() {
  const visible = Number(form.elements.stage.value) >= 14;
  element("rp-ascension-bonus-field").hidden = !visible;
  form.elements.ascensionBonus.disabled = !visible;
}

function saveInputs() {
  try {
    const values = Object.fromEntries(fields.map(name => [name, form.elements[name].value]));
    localStorage.setItem(storageKey, JSON.stringify(values));
  } catch {
    // 저장소를 사용할 수 없어도 계산은 가능하다.
  }
}

function handleInputChange(event) {
  if (event.target === form.elements.stage) updateAscensionBonusField();
  saveInputs();
  results.hidden = true;
  if (!form.querySelector("button").disabled) {
    status.textContent = "";
    status.removeAttribute("title");
  }
}
form.addEventListener("input", handleInputChange);
form.addEventListener("change", handleInputChange);
form.addEventListener("invalid", event => {
  const details = event.target.closest("details");
  if (details) details.open = true;
}, true);

async function initialize() {
  const skills = await loadSkills();
  populateAscensionStages(form.elements.stage, ascensionStages(skills));
  restoreInputs();
  updateAscensionBonusField();
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
    const stage = inputs.get("stage");
    const goal = inputs.get("goal");
    const profile = readDamageProfile(Object.fromEntries(inputs), stage, total);
    const { upgrades, left, normalGain, bossGain } = recommend(skills, stage, budget, profile, goal);
    showSummaryRP("rp-baseline", baseline);
    showSummaryRP("rp-budget", budget);
    showSummaryRP("rp-spent", budget - left);
    showSummaryRP("rp-left", left);
    element("rp-normal-gain").textContent = formatGain.format(normalGain);
    element("rp-boss-gain").textContent = formatGain.format(bossGain);
    element("rp-normal-result").classList.toggle("rp-summary-highlight", goal === "normal");
    element("rp-boss-result").classList.toggle("rp-summary-highlight", goal === "boss");
    const orderedUpgrades = [...upgrades].sort((a, b) =>
      (skillDisplayOrder.get(a.type) ?? skillDisplayOrder.size) -
      (skillDisplayOrder.get(b.type) ?? skillDisplayOrder.size)
    );
    element("rp-rows").replaceChildren(...orderedUpgrades.map(target => {
      const row = document.createElement("tr");
      for (const value of [target.name, target.start, target.level]) {
        row.insertCell().textContent = value;
      }
      showRP(row.insertCell(), target.spent);
      row.insertCell().textContent = damageEffectText(target, profile);
      return row;
    }));
    status.textContent = upgrades.length ? "" : "현재 예산으로 선택한 대상의 예상 데미지를 높일 수 있는 강화가 없습니다.";
    results.hidden = false;
  });

  if (form.elements.total.value.trim()) form.requestSubmit();
}

initialize().catch(error => {
  console.error(error);
  status.textContent = "스킬 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.";
});
