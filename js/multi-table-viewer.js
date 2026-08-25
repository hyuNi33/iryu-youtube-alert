/**
 * multi-table-viewer.js
 * meta.csv 기반 드롭다운 선택 뷰어
 * 디렉토리 내 meta.csv에서 항목 목록을 읽고, 드롭다운으로 선택하면 해당 CSV를 로딩/표시
 */
import { loadCSV } from "./csv-loader.js";

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function formatCompactNumber(value) {
  const cleaned = String(value || "").replace(/,/g, "").trim();
  if (!/^\d+$/.test(cleaned)) return value || "";

  let text = BigInt(cleaned).toString();
  if (text === "0") return "0";

  const units = ["", "만", "억", "조", "경", "해", "자", "양", "구", "간", "정", "재", "극", "항하사", "아승기", "나유타", "불가사의", "무량대수"];
  const groups = [];

  while (text.length > 0) {
    groups.unshift(text.slice(-4));
    text = text.slice(0, -4);
  }

  const parts = [];
  groups.forEach((group, index) => {
    const groupValue = Number(group);
    if (!groupValue) return;
    const unit = units[groups.length - 1 - index] || "";
    parts.push(`${groupValue}${unit}`);
  });

  if (parts.length <= 2) return parts.join(" ");
  return parts.slice(0, 2).join(" ");
}

function showTableTip(anchor, title, value) {
  const existingPopover = document.querySelector(".table-tip-popover");
  if (existingPopover && existingPopover.dataset.anchorId === anchor.dataset.tipAnchorId) {
    existingPopover.remove();
    return;
  }

  document.querySelectorAll(".table-tip-popover").forEach(el => el.remove());

  if (!anchor.dataset.tipAnchorId) {
    anchor.dataset.tipAnchorId = `table-tip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  const popover = document.createElement("div");
  popover.className = "table-tip-popover";
  popover.dataset.anchorId = anchor.dataset.tipAnchorId;
  popover.innerHTML = `
    <div class="table-tip-title">${escapeHtml(title || "상세보기")}</div>
    <div class="table-tip-value">${escapeHtml(value || "")}</div>
  `;
  document.body.appendChild(popover);

  const rect = anchor.getBoundingClientRect();
  const gap = 8;
  const left = Math.min(
    window.scrollX + rect.left,
    window.scrollX + document.documentElement.clientWidth - popover.offsetWidth - 12
  );
  const top = window.scrollY + rect.bottom + gap;

  popover.style.left = `${Math.max(window.scrollX + 12, left)}px`;
  popover.style.top = `${top}px`;

  const close = event => {
    if (popover.contains(event.target) || anchor.contains(event.target)) return;
    popover.remove();
    document.removeEventListener("click", close);
  };

  setTimeout(() => document.addEventListener("click", close), 0);
}

/**
 * 드롭다운 기반 멀티 테이블 렌더링
 * @param {string} dirPath - meta.csv가 있는 디렉토리 경로 (예: "../../datas/sp-skill")
 * @param {string} containerId - 컨테이너 ID
 * @param {Object} [options]
 * @param {string[]} [options.compactNumberColumns] - 축약 표시 후 클릭 상세를 제공할 숫자 컬럼
 */
export async function renderMultiTable(dirPath, containerId, options = {}) {
  const { compactNumberColumns = [] } = options;
  const compactNumberColumnSet = new Set(compactNumberColumns);
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "데이터 로딩 중...";

  let meta;
  try {
    meta = await loadCSV(dirPath + "/meta.csv");
  } catch (e) {
    container.innerHTML = `<p style="color:red">메타 데이터 로딩 실패: ${e.message}</p>`;
    return;
  }

  if (meta.length === 0) {
    container.innerHTML = "<p>데이터가 없습니다.</p>";
    return;
  }

  // UI 구성
  container.innerHTML = "";

  // 드롭다운
  const selectWrap = document.createElement("div");
  selectWrap.style.marginBottom = "16px";

  const select = document.createElement("select");
  select.className = "table-dropdown";

  for (const item of meta) {
    const opt = document.createElement("option");
    opt.value = item.file;
    opt.textContent = item.desc ? `${item.name} / ${item.desc}` : item.name;
    select.appendChild(opt);
  }

  selectWrap.appendChild(select);
  container.appendChild(selectWrap);

  // 테이블 영역
  const tableArea = document.createElement("div");
  tableArea.id = containerId + "_table";
  container.appendChild(tableArea);

  // 선택 변경 시 로딩
  async function loadSelected() {
    const file = select.value;
    tableArea.innerHTML = "로딩 중...";

    try {
      const rows = await loadCSV(dirPath + "/" + file);
      if (rows.length === 0) {
        tableArea.innerHTML = "<p>데이터가 없습니다.</p>";
        return;
      }

      const headers = Object.keys(rows[0]);
      // 빈 컬럼 필터
      const activeHeaders = headers.filter(h =>
        rows.some(row => row[h] !== undefined && row[h] !== "")
      );

      let html = '<div class="table-container"><table class="data-table"><thead><tr>';
      for (const h of activeHeaders) {
        html += `<th>${escapeHtml(h)}</th>`;
      }
      html += "</tr></thead><tbody>";

      for (const row of rows) {
        html += "<tr>";
        for (const h of activeHeaders) {
          const value = row[h] || "";
          if (compactNumberColumnSet.has(h) && value) {
            html += `<td><button type="button" class="table-tip-trigger" data-tip-title="${escapeAttr(h)} 상세" data-tip-value="${escapeAttr(value)}">${escapeHtml(formatCompactNumber(value))}</button></td>`;
          } else {
            html += `<td>${escapeHtml(value)}</td>`;
          }
        }
        html += "</tr>";
      }

      html += "</tbody></table></div>";
      html += `<div class="table-info">${rows.length}행</div>`;
      tableArea.innerHTML = html;

      tableArea.querySelectorAll(".table-tip-trigger").forEach(button => {
        button.addEventListener("click", event => {
          event.stopPropagation();
          showTableTip(button, button.dataset.tipTitle, button.dataset.tipValue);
        });
      });
    } catch (e) {
      tableArea.innerHTML = `<p style="color:red">로딩 실패: ${e.message}</p>`;
    }
  }

  select.addEventListener("change", loadSelected);
  loadSelected(); // 첫 번째 항목 자동 로딩
}
