/**
 * storage.js
 * 로컬스토리지 기반 사용자 입력값 저장/복원 유틸
 */

const STORAGE_PREFIX = "iryu_";

/**
 * 계산기 입력값 저장
 * @param {string} pageKey - 페이지 식별자 (예: "rpMachine", "exp")
 * @param {object} data - 저장할 데이터 객체
 */
export function saveInputs(pageKey, data) {
  try {
    localStorage.setItem(STORAGE_PREFIX + pageKey, JSON.stringify(data));
  } catch (_) {
    // 스토리지 용량 초과 등 — 무시
  }
}

/**
 * 계산기 입력값 복원
 * @param {string} pageKey - 페이지 식별자
 * @returns {object|null} 저장된 데이터 또는 null
 */
export function loadInputs(pageKey) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + pageKey);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

/**
 * 모든 저장 데이터 삭제
 */
export function clearAll() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  keys.forEach(k => localStorage.removeItem(k));
}
