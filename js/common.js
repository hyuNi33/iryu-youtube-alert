/**
 * common.js
 * 사이드바 동적 생성 + 네비게이션 + 테마 관리 + 공통 유틸
 */

// ==============================
// 메뉴 정의
// ==============================

const MENU = [
  { section: "홈" },
  { label: "홈", href: "/index.html" },
  { label: "가이드", href: "/pages/guide/guide.html" },

  { section: "계산기" },
  { label: "환포 계산기", href: "/pages/calc/rpMachine.html" },
  { label: "경험치 계산기", href: "/pages/calc/exp.html" },
  /*{ label: "유물 계산기", href: "/pages/calc/artifact.html" },*/
  { label: "RP 스킬 계산기", href: "/pages/calc/rpskill.html" },

  { section: "기능" },
  { label: "경험치 측정", href: "/pages/tools/exp-measure.html" },

  { section: "테이블" },
  { label: "초월정보", href: "/pages/tables/transcend.html" },
  { label: "몬스터DB", href: "/pages/tables/monster.html" },
  /*{ label: "몬스터체경비", href: "/pages/tables/monster-stat.html" },*/
  { label: "잡팁", href: "/pages/tables/tips.html" },
  { label: "RP스킬 투자순서", href: "/pages/tables/rpskill-order.html" },
  { label: "데일리 던전", href: "/pages/tables/town-defense.html" },
  { label: "슈던 사냥터 자리", href: "/pages/tables/super-dungeon-place.html" },
  { label: "SP 스킬", href: "/pages/tables/sp-skill.html" },
  { label: "RP 스킬", href: "/pages/tables/rpskill-perf.html" },
  { label: "유물", href: "/pages/tables/artifact-info.html" },
  { label: "환포표", href: "/pages/tables/hanpo.html" },
  { label: "이세계스킬", href: "/pages/tables/isekai-perf.html" },
];

// ==============================
// 기본 경로 계산
// ==============================

function getBasePath() {
  const path = location.pathname;
  // /index.html 또는 / → 루트
  if (path === "/" || path.endsWith("/index.html") || path === "/index.html") {
    return ".";
  }
  // /pages/calc/*.html 또는 /pages/tables/*.html → 2단계 위
  if (path.includes("/pages/")) {
    return "../..";
  }
  // 기본
  return ".";
}

// ==============================
// 테마 관리
// ==============================

function getThemePref() {
  return localStorage.getItem("iryu_theme") || "system";
}

function applyTheme(pref) {
  var resolved = pref;
  if (pref === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", resolved);
}

function setThemePref(theme) {
  localStorage.setItem("iryu_theme", theme);
  applyTheme(theme);
  updateThemeToggleUI();
}

function updateThemeToggleUI() {
  var current = getThemePref();
  document.querySelectorAll(".theme-toggle button").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.theme === current);
  });
}

function buildThemeToggle() {
  return '<div class="theme-toggle">'
    + '<button data-theme="light" title="라이트 모드" aria-label="라이트 모드">☀️</button>'
    + '<button data-theme="system" title="시스템 설정" aria-label="시스템 설정">🖥️</button>'
    + '<button data-theme="dark" title="다크 모드" aria-label="다크 모드">🌙</button>'
    + '</div>';
}

// ==============================
// 사이드바 생성
// ==============================

function buildSidebar() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;

  const basePath = getBasePath();
  const currentPath = location.pathname;

  let html = '<div class="sidebar-header">'
    + '<div class="logo">이류월드 계산기</div>'
    + '<button class="hamburger" id="hamburgerBtn" aria-label="메뉴 열기" aria-expanded="false">'
    + '<span class="hamburger-line"></span>'
    + '<span class="hamburger-line"></span>'
    + '<span class="hamburger-line"></span>'
    + '</button>'
    + '</div>\n<ul class="menu">\n';

  for (const item of MENU) {
    if (item.section) {
      html += `  <li class="menu-section">${item.section}</li>\n`;
      continue;
    }

    const href = basePath + item.href;

    // .html 유무에 관계없이 비교 (serve 등 clean URL 대응)
    const stripHtml = (p) => p.replace(/\.html$/, "");
    const isActive = stripHtml(currentPath).endsWith(stripHtml(item.href)) ||
      (item.href === "/index.html" && (currentPath === "/" || currentPath.endsWith("/")));
    const activeClass = isActive ? ' class="active"' : "";

    html += `  <li><a href="${href}"${activeClass}>${item.label}</a></li>\n`;
  }

  html += "</ul>";
  html += '<div class="sidebar-footer">'
    + buildThemeToggle()
    + '<button class="btn-clear-storage" onclick="clearStorageAndReload()">저장 데이터 초기화</button>'
    + '</div>';
  sidebar.innerHTML = html;

  // 햄버거 메뉴 토글 (모바일)
  const hamburger = document.getElementById("hamburgerBtn");
  if (hamburger) {
    hamburger.addEventListener("click", () => {
      sidebar.classList.toggle("menu-open");
      const isOpen = sidebar.classList.contains("menu-open");
      hamburger.setAttribute("aria-expanded", String(isOpen));
      hamburger.setAttribute("aria-label", isOpen ? "메뉴 닫기" : "메뉴 열기");
    });
  }

  // 테마 토글 이벤트
  document.querySelectorAll(".theme-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setThemePref(btn.dataset.theme);
    });
  });
  updateThemeToggleUI();
}

// ==============================
// 초기화
// ==============================

function clearStorageAndReload() {
  if (!confirm("저장된 모든 입력값이 초기화됩니다. 계속하시겠습니까?")) return;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith("iryu_")) keys.push(key);
  }
  keys.forEach(k => localStorage.removeItem(k));
  location.href = getBasePath() + "/index.html";
}

document.addEventListener("DOMContentLoaded", () => {
  buildSidebar();

  // number input 스크롤로 값 변경 방지
  document.addEventListener("wheel", (e) => {
    if (e.target.type === "number") e.target.blur();
  }, { passive: true });

  // 시스템 테마 변경 감지 (시스템 모드일 때 자동 반영)
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getThemePref() === "system") {
      applyTheme("system");
    }
  });
});

