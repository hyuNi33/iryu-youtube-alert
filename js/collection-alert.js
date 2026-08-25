import { startCapture, stopCapture } from "./calc/screen-exp.js";
import { saveInputs, loadInputs } from "./storage.js";

const STORAGE_KEY = "collection_alert";
const ROI_STORAGE_KEY = "iryu_collection_alert_roi";
const SAMPLE_INTERVAL_MS = 1000;
const CROP_SCALE = 2;
const SCREEN_GUARD_WIDTH = 160;
const SCREEN_CHANGE_LIMIT = 35;
const REQUIRED_SCREEN_CHANGE_COUNT = 3;
const REQUIRED_STABLE_COUNT = 3;
const TEXT_DISAPPEAR_RATIO = 0.78;
const TEXT_MIN_BASELINE_SCORE = 12;
const TEXT_LOST_RATIO = 0.22;
const TEXT_REVEAL_RATIO = 2.2;
const STRONG_DIFF_RATIO = 2;
const LOCAL_ONLY_SCREEN_RATIO = 0.6;

const authBox = document.getElementById("collectionAuthBox");
const nameInput = document.getElementById("collectionName");
const thresholdInput = document.getElementById("collectionThreshold");
const startCaptureBtn = document.getElementById("collectionStartCaptureBtn");
const startWatchBtn = document.getElementById("collectionStartWatchBtn");
const stopWatchBtn = document.getElementById("collectionStopWatchBtn");
const stopAlertBtn = document.getElementById("collectionStopAlertBtn");
const clearRoiBtn = document.getElementById("collectionClearRoiBtn");
const previewWrap = document.getElementById("collectionPreviewWrap");
const previewCanvas = document.getElementById("collectionPreviewCanvas");
const video = document.getElementById("collectionVideo");
const placeholder = document.getElementById("collectionPlaceholder");
const cropCanvas = document.getElementById("collectionCropCanvas");
const statusEl = document.getElementById("collectionStatus");
const resultEl = document.getElementById("collectionResult");
const alertOverlay = document.getElementById("collectionAlertOverlay");
const alertBadge = alertOverlay.querySelector(".level-alert-badge");
const alertTitle = document.getElementById("collectionAlertTitle");
const alertDesc = document.getElementById("collectionAlertDesc");
const alertOverlayName = document.getElementById("collectionAlertOverlayName");
const alertOverlayDiff = document.getElementById("collectionAlertOverlayDiff");
const screenGuardCanvas = document.createElement("canvas");

let discordUser = null;
let stream = null;
let roi = null;
let dragStart = null;
let previewAnimation = null;
let watchTimer = null;
let watchInProgress = false;
let notified = false;
let baselineImage = null;
let screenBaselineImage = null;
let baselineTextScore = 0;
let stableCount = 0;
let screenChangeCount = 0;
let lastDiff = null;
let lastScreenDiff = null;
let lastTextScore = null;
let lastTextLostRatio = null;
let watchStartedAt = null;
let alertAudioContext = null;

loadSavedInputs();
renderDefaultResult();
checkAuth();

nameInput.addEventListener("change", saveSettings);
thresholdInput.addEventListener("change", saveSettings);
startCaptureBtn.addEventListener("click", startCollectionCapture);
startWatchBtn.addEventListener("click", startWatch);
stopWatchBtn.addEventListener("click", () => stopWatch("감시를 중지했습니다."));
stopAlertBtn.addEventListener("click", () => hideAlertOverlay("알림을 확인했습니다."));
clearRoiBtn.addEventListener("click", clearRoi);

previewWrap.addEventListener("pointerdown", startRoiDrag);
previewWrap.addEventListener("pointermove", moveRoiDrag);
previewWrap.addEventListener("pointerup", endRoiDrag);

window.addEventListener("keydown", event => {
  if (event.key !== "Delete" || !roi) return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) || event.target.isContentEditable) return;
  clearRoi();
});

async function checkAuth() {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) {
      discordUser = null;
      renderLoggedOut();
      return;
    }

    discordUser = await res.json();
    renderLoggedIn(discordUser);
  } catch (_) {
    discordUser = null;
    authBox.innerHTML = "API 연결 상태를 확인하지 못했습니다. 배포 환경에서 다시 시도해 주세요.";
  }
}

function renderLoggedOut() {
  authBox.innerHTML = `
    <p class="level-alert-auth-text">Discord 인증 후 도감 획득 알림을 DM으로 받을 수 있습니다.</p>
    <p class="level-alert-auth-note">인증 없이도 감지 시 브라우저 알림음과 화면 알림은 동작합니다.</p>
    <a class="btn-discord" href="/api/auth/login">Discord 인증</a>
  `;
}

function renderLoggedIn(user) {
  const name = escapeHtml(user.global_name || user.username || user.id);
  authBox.innerHTML = `
    <div class="result-row">
      <span class="result-label">연결 계정</span>
      <strong class="result-value highlight">${name}</strong>
    </div>
    <p class="level-alert-auth-text">획득 감지 시 이 계정으로 DM 알림을 보냅니다.</p>
  `;
}

function loadSavedInputs() {
  const saved = loadInputs(STORAGE_KEY);
  if (!saved) return;
  if (saved.name !== undefined) nameInput.value = saved.name;
  if (saved.threshold !== undefined) thresholdInput.value = saved.threshold;
}

function saveSettings() {
  saveInputs(STORAGE_KEY, {
    name: nameInput.value,
    threshold: thresholdInput.value
  });
}

async function startCollectionCapture() {
  try {
    stopWatch();
    stopCapture(stream);
    stream = await startCapture(video);
    placeholder.hidden = true;
    roi = null;
    baselineImage = null;
    screenBaselineImage = null;
    baselineTextScore = 0;
    stableCount = 0;
    screenChangeCount = 0;
    startPreviewLoop();

    await waitForVideoReady();
    if (applyStoredRoi()) {
      setStatus("저장된 도감 영역을 불러왔습니다. 필요하면 영역 삭제 후 다시 지정하세요.");
    } else {
      setStatus("화면 선택 완료. 도감 카드의 미획득 표시 영역을 드래그하세요.");
    }

    const [track] = stream.getVideoTracks();
    track.addEventListener("ended", () => {
      stopWatch("화면 공유가 중지되었습니다.");
      stopPreviewLoop();
      stream = null;
      roi = null;
      placeholder.hidden = false;
      renderDefaultResult();
    });
  } catch (error) {
    setStatus(error.message || "화면 선택을 취소했습니다.");
  }
}

async function startWatch() {
  saveSettings();

  if (!stream || !video.videoWidth) {
    setStatus("화면 선택이 필요합니다.");
    return;
  }
  if (!isValidRoi(roi)) {
    setStatus("도감 카드 영역을 먼저 지정하세요.");
    return;
  }

  await unlockAlertSound();

  notified = false;
  stableCount = 0;
  screenChangeCount = 0;
  lastDiff = null;
  lastScreenDiff = null;
  lastTextScore = null;
  lastTextLostRatio = null;
  watchStartedAt = Date.now();
  hideAlertOverlay();
  stopWatch();
  captureBaseline();
  renderResult({ diff: 0, textScore: baselineTextScore, stableCount: 0, reached: false });
  setStatus("도감 감시를 시작합니다. 미획득 표시가 사라지면 알림을 보냅니다.");

  await runWatchSample();
  if (notified) return;
  watchTimer = setInterval(runWatchSample, SAMPLE_INTERVAL_MS);
}

function stopWatch(message) {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
  watchInProgress = false;
  if (message) setStatus(message);
}

async function runWatchSample() {
  if (watchInProgress || notified) return;
  watchInProgress = true;

  try {
    const diff = compareCurrentToBaseline();
    lastDiff = diff;
    if (diff === null) {
      renderResult({ error: "기준 이미지를 만들지 못했습니다. 영역을 다시 지정해 주세요." });
      setStatus("기준 이미지를 만들지 못했습니다. 영역을 다시 지정해 주세요.");
      return;
    }

    const textScore = getCurrentTextScore();
    lastTextScore = textScore;
    const textLostRatio = getCurrentTextLostRatio();
    lastTextLostRatio = textLostRatio;
    const screenDiff = compareScreenToBaseline();
    lastScreenDiff = screenDiff;
    if (screenDiff !== null && screenDiff >= SCREEN_CHANGE_LIMIT) {
      screenChangeCount += 1;
    } else {
      screenChangeCount = 0;
    }
    if (screenChangeCount >= REQUIRED_SCREEN_CHANGE_COUNT) {
      stableCount = 0;
      renderResult({
        diff,
        screenDiff,
        textScore,
        textLostRatio,
        stableCount,
        screenChangeCount,
        threshold: getThreshold(),
        reached: false,
        warning: "도감창 닫힘 또는 화면 전환 감지"
      });
      await sendScreenChangeNotify(diff, screenDiff);
      return;
    }

    const threshold = getThreshold();
    const acquiredCandidate = isCollectionAcquiredCandidate(diff, threshold, screenDiff, textScore, textLostRatio);
    if (acquiredCandidate) {
      stableCount += 1;
    } else {
      stableCount = 0;
    }

    const reached = stableCount >= REQUIRED_STABLE_COUNT;
    renderResult({ diff, screenDiff, textScore, textLostRatio, stableCount, screenChangeCount, threshold, reached });

    if (!reached) {
      const textStatus = acquiredCandidate ? "획득 변화 확인 중" : "미획득 표시 유지";
      const screenStatus = screenChangeCount > 0 ? `, 화면 전환 확인 ${screenChangeCount}/${REQUIRED_SCREEN_CHANGE_COUNT}` : "";
      setStatus(`감시 중... 변화량 ${diff.toFixed(1)} / ${threshold}, ${textStatus}, 검증 ${stableCount}/${REQUIRED_STABLE_COUNT}${screenStatus}`);
      return;
    }

    await sendCollectionNotify(diff);
  } finally {
    watchInProgress = false;
  }
}

function captureBaseline() {
  baselineImage = readCropImage();
  screenBaselineImage = readScreenGuardImage();
  baselineTextScore = getUnobtainedTextScore(baselineImage);
}

function compareCurrentToBaseline() {
  if (!baselineImage) return null;
  const current = readCropImage();
  if (!current || current.width !== baselineImage.width || current.height !== baselineImage.height) return null;

  const a = baselineImage.data;
  const b = current.data;
  let total = 0;
  for (let i = 0; i < a.length; i += 4) {
    total += Math.abs(a[i] - b[i]);
    total += Math.abs(a[i + 1] - b[i + 1]);
    total += Math.abs(a[i + 2] - b[i + 2]);
  }
  return total / (a.length / 4 * 3);
}

function getCurrentTextScore() {
  const current = readCropImage();
  if (!current) return null;
  return getUnobtainedTextScore(current);
}

function getCurrentTextLostRatio() {
  const current = readCropImage();
  if (!current || !baselineImage) return null;
  return getTextLostRatio(baselineImage, current);
}

function isCollectionAcquiredCandidate(diff, threshold, screenDiff, textScore, textLostRatio) {
  if (diff < threshold) return false;
  return isUnobtainedTextGone(textScore, textLostRatio) ||
    isObtainedCardRevealed(diff, threshold, textScore) ||
    isStrongLocalCardChange(diff, threshold, screenDiff);
}

function isUnobtainedTextGone(textScore, textLostRatio) {
  if (!Number.isFinite(textScore)) return false;
  if (baselineTextScore < TEXT_MIN_BASELINE_SCORE) return false;
  return textScore <= baselineTextScore * TEXT_DISAPPEAR_RATIO ||
    (Number.isFinite(textLostRatio) && textLostRatio >= TEXT_LOST_RATIO);
}

function isObtainedCardRevealed(diff, threshold, textScore) {
  if (!Number.isFinite(textScore) || baselineTextScore < TEXT_MIN_BASELINE_SCORE) return false;
  const brightReveal = textScore >= baselineTextScore * TEXT_REVEAL_RATIO;
  const strongDiff = diff >= threshold * STRONG_DIFF_RATIO;
  return brightReveal && strongDiff;
}

function isStrongLocalCardChange(diff, threshold, screenDiff) {
  const strongDiff = diff >= threshold * STRONG_DIFF_RATIO;
  const screenLooksStable = !Number.isFinite(screenDiff) || screenDiff < SCREEN_CHANGE_LIMIT * LOCAL_ONLY_SCREEN_RATIO;
  return strongDiff && screenLooksStable;
}

function getUnobtainedTextScore(image) {
  if (!image) return 0;

  const { width, height, data } = image;
  const startX = Math.floor(width * 0.08);
  const endX = Math.ceil(width * 0.92);
  const startY = Math.floor(height * 0.18);
  const endY = Math.ceil(height * 0.86);
  let score = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const i = (y * width + x) * 4;
      if (isUnobtainedTextPixel(data, i)) score += 1;
    }
  }

  return score;
}

function getTextLostRatio(baseline, current) {
  if (!baseline || !current || baseline.width !== current.width || baseline.height !== current.height) return null;

  const { width, height } = baseline;
  const startX = Math.floor(width * 0.08);
  const endX = Math.ceil(width * 0.92);
  const startY = Math.floor(height * 0.18);
  const endY = Math.ceil(height * 0.86);
  let baselineBright = 0;
  let lostBright = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const i = (y * width + x) * 4;
      if (!isUnobtainedTextPixel(baseline.data, i)) continue;
      baselineBright += 1;
      if (!isUnobtainedTextPixel(current.data, i)) lostBright += 1;
    }
  }

  if (baselineBright < TEXT_MIN_BASELINE_SCORE) return null;
  return lostBright / baselineBright;
}

function isUnobtainedTextPixel(data, i) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max >= 135 && min >= 95 && max - min <= 80;
}

function compareScreenToBaseline() {
  if (!screenBaselineImage) return null;
  const current = readScreenGuardImage();
  if (!current || current.width !== screenBaselineImage.width || current.height !== screenBaselineImage.height) return null;
  return getAverageImageDiff(screenBaselineImage, current);
}

function readScreenGuardImage() {
  if (!video.videoWidth || !video.videoHeight) return null;

  const width = SCREEN_GUARD_WIDTH;
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  screenGuardCanvas.width = width;
  screenGuardCanvas.height = height;

  const ctx = screenGuardCanvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function getAverageImageDiff(aImage, bImage) {
  const a = aImage.data;
  const b = bImage.data;
  let total = 0;
  for (let i = 0; i < a.length; i += 4) {
    total += Math.abs(a[i] - b[i]);
    total += Math.abs(a[i + 1] - b[i + 1]);
    total += Math.abs(a[i + 2] - b[i + 2]);
  }
  return total / (a.length / 4 * 3);
}

function readCropImage() {
  if (!isValidRoi(roi)) return null;

  const normalized = normalizeRoi(roi);
  const width = Math.max(1, Math.round(normalized.width * CROP_SCALE));
  const height = Math.max(1, Math.round(normalized.height * CROP_SCALE));
  cropCanvas.width = width;
  cropCanvas.height = height;
  cropCanvas.style.width = Math.min(420, width) + "px";
  cropCanvas.style.height = Math.max(90, Math.round(height * Math.min(420, width) / width)) + "px";

  const ctx = cropCanvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    video,
    normalized.x,
    normalized.y,
    normalized.width,
    normalized.height,
    0,
    0,
    width,
    height
  );
  return ctx.getImageData(0, 0, width, height);
}

async function sendCollectionNotify(diff) {
  stopWatch();
  notified = true;
  const name = getCollectionName();
  showAlertOverlay({
    badge: "COLLECTED",
    title: "도감 획득 감지!",
    desc: "선택 영역에서 미획득 표시가 사라진 것으로 보입니다.",
    name,
    diff
  });
  await playAlertSound();

  if (!discordUser) {
    setStatus("도감 획득을 감지했습니다. 브라우저 알림음만 재생했습니다.");
    renderResult({ diff, textScore: lastTextScore, textLostRatio: lastTextLostRatio, stableCount: REQUIRED_STABLE_COUNT, reached: true, notified: true, notifyMethod: "브라우저 알림음" });
    return;
  }

  setStatus("도감 획득을 감지했습니다. Discord DM을 보내는 중입니다.");

  let res = null;
  try {
    res = await fetch("/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: buildDiscordMessage(name, diff) })
    });
  } catch (_) {
    setStatus("Discord DM 요청에 실패했습니다. 브라우저 알림음은 재생했습니다.");
    renderResult({ diff, textScore: lastTextScore, textLostRatio: lastTextLostRatio, stableCount: REQUIRED_STABLE_COUNT, reached: true, notified: true, notifyMethod: "브라우저 알림음" });
    return;
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }

  if (res.status === 401) {
    discordUser = null;
    renderLoggedOut();
    setStatus("Discord 세션이 만료되었습니다. 브라우저 알림음만 재생했습니다.");
    return;
  }
  if (!res.ok) {
    const detail = data?.error === "dm_channel_failed"
      ? "DM 채널 생성에 실패했습니다. 공식 Discord 서버에 봇이 초대되어 있는지 확인해 주세요."
      : `DM 발송 실패: ${data?.error || res.status}`;
    setStatus(detail);
    renderResult({ error: detail });
    return;
  }

  setStatus("Discord DM 알림을 발송했습니다.");
  renderResult({ diff, textScore: lastTextScore, textLostRatio: lastTextLostRatio, stableCount: REQUIRED_STABLE_COUNT, reached: true, notified: true, notifyMethod: "Discord DM + 브라우저 알림음" });
}

async function sendScreenChangeNotify(diff, screenDiff) {
  stopWatch();
  notified = true;
  const name = getCollectionName();
  const message = "도감창이 닫혔거나 화면이 크게 바뀐 것으로 보여 감시를 멈췄습니다.";
  showAlertOverlay({
    badge: "SCREEN CHANGED",
    title: "화면 전환 감지",
    desc: message,
    name,
    diff: screenDiff
  });
  await playAlertSound();

  const resultState = {
    diff,
    screenDiff,
    textScore: lastTextScore,
    textLostRatio: lastTextLostRatio,
    stableCount: 0,
    screenChangeCount,
    threshold: getThreshold(),
    reached: false,
    warning: "도감창 닫힘 또는 화면 전환 감지"
  };

  if (!discordUser) {
    setStatus(`${message} 브라우저 알림음만 재생했습니다.`);
    renderResult({ ...resultState, notified: true, notifyMethod: "브라우저 알림음" });
    return;
  }

  setStatus(`${message} Discord DM을 보내는 중입니다.`);

  let res = null;
  try {
    res = await fetch("/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: buildScreenChangeDiscordMessage(name, diff, screenDiff) })
    });
  } catch (_) {
    setStatus(`${message} Discord DM 요청에는 실패했습니다.`);
    renderResult({ ...resultState, notified: true, notifyMethod: "브라우저 알림음" });
    return;
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }

  if (res.status === 401) {
    discordUser = null;
    renderLoggedOut();
    setStatus(`${message} Discord 세션이 만료되어 브라우저 알림음만 재생했습니다.`);
    renderResult({ ...resultState, notified: true, notifyMethod: "브라우저 알림음" });
    return;
  }
  if (!res.ok) {
    const detail = data?.error === "dm_channel_failed"
      ? "DM 채널 생성에 실패했습니다. 공식 Discord 서버에 봇이 초대되어 있는지 확인해 주세요."
      : `DM 발송 실패: ${data?.error || res.status}`;
    setStatus(detail);
    renderResult({ ...resultState, error: detail });
    return;
  }

  setStatus(`${message} Discord DM 알림을 발송했습니다.`);
  renderResult({ ...resultState, notified: true, notifyMethod: "Discord DM + 브라우저 알림음" });
}

function buildDiscordMessage(name, diff) {
  const elapsedMs = watchStartedAt ? Math.max(0, Date.now() - watchStartedAt) : 0;
  return [
    "## 이류월드 도감 획득 알림",
    "도감의 미획득 표시가 사라진 것으로 감지했습니다.",
    "",
    `도감 이름: **${name}**`,
    `감지 변화량: **${diff.toFixed(1)}**`,
    `감시 시간: **${formatElapsedDuration(elapsedMs)}**`
  ].join("\n");
}

function buildScreenChangeDiscordMessage(name, diff, screenDiff) {
  const elapsedMs = watchStartedAt ? Math.max(0, Date.now() - watchStartedAt) : 0;
  return [
    "## 이류월드 도감 감시 중지 알림",
    "도감창이 닫혔거나 화면이 크게 바뀐 것으로 보여 감시를 멈췄습니다.",
    "",
    `도감 이름: **${name}**`,
    `선택 영역 변화량: **${diff.toFixed(1)}**`,
    `화면 전체 변화량: **${screenDiff.toFixed(1)}**`,
    `감시 시간: **${formatElapsedDuration(elapsedMs)}**`
  ].join("\n");
}

function getCollectionName() {
  return nameInput.value.trim() || "선택한 도감";
}

function getThreshold() {
  const value = Number(thresholdInput.value);
  if (!Number.isFinite(value)) return 18;
  return Math.max(5, Math.min(80, value));
}

function renderDefaultResult() {
  resultEl.innerHTML = `
    <div class="result-section">
      <div class="result-row">
        <span class="result-label">변화량</span>
        <strong class="result-value">-</strong>
      </div>
      <div class="result-row">
        <span class="result-label">획득 검증</span>
        <strong class="result-value">-</strong>
      </div>
    </div>
  `;
}

function renderResult(state) {
  if (state.error) {
    resultEl.innerHTML = `
      <div class="result-section">
        <div class="result-row">
          <span class="result-label">감시 오류</span>
          <strong class="result-value screen-exp-warning">${escapeHtml(state.error)}</strong>
        </div>
      </div>
    `;
    return;
  }

  const diff = Number.isFinite(state.diff) ? state.diff.toFixed(1) : "-";
  const screenDiff = Number.isFinite(state.screenDiff) ? state.screenDiff.toFixed(1) : "-";
  const textScore = Number.isFinite(state.textScore) ? Math.round(state.textScore).toLocaleString("ko-KR") : "-";
  const baselineText = baselineTextScore ? Math.round(baselineTextScore).toLocaleString("ko-KR") : "-";
  const textLost = Number.isFinite(state.textLostRatio) ? `${Math.round(state.textLostRatio * 100)}%` : "-";
  const textReveal = baselineTextScore && Number.isFinite(state.textScore) ? `${(state.textScore / baselineTextScore).toFixed(1)}x` : "-";
  const threshold = state.threshold || getThreshold();
  const count = Math.min(state.stableCount || 0, REQUIRED_STABLE_COUNT);
  const screenCount = Math.min(state.screenChangeCount || 0, REQUIRED_SCREEN_CHANGE_COUNT);
  const notifyText = state.notified ? (state.notifyMethod || "알림 완료") : (state.reached ? "획득 감지" : (state.warning || "대기 중"));
  const warningRow = state.warning ? `
      <div class="result-row">
        <span class="result-label">화면 상태</span>
        <strong class="result-value screen-exp-warning">${escapeHtml(state.warning)}</strong>
      </div>
  ` : "";

  resultEl.innerHTML = `
    <div class="result-section">
      <div class="result-row">
        <span class="result-label">도감 이름</span>
        <strong class="result-value highlight">${escapeHtml(getCollectionName())}</strong>
      </div>
      <div class="result-row">
        <span class="result-label">변화량</span>
        <strong class="result-value">${diff} / ${threshold}</strong>
      </div>
      <div class="result-row">
        <span class="result-label">화면 전체 변화</span>
        <strong class="result-value">${screenDiff} / ${SCREEN_CHANGE_LIMIT}</strong>
      </div>
      <div class="result-row">
        <span class="result-label">화면 전환 검증</span>
        <strong class="result-value">${screenCount} / ${REQUIRED_SCREEN_CHANGE_COUNT}</strong>
      </div>
      <div class="result-row">
        <span class="result-label">미획득 표시</span>
        <strong class="result-value">${textScore} / ${baselineText}</strong>
      </div>
      <div class="result-row">
        <span class="result-label">표시 사라짐</span>
        <strong class="result-value">${textLost} / ${Math.round(TEXT_LOST_RATIO * 100)}%</strong>
      </div>
      <div class="result-row">
        <span class="result-label">카드 밝아짐</span>
        <strong class="result-value">${textReveal} / ${TEXT_REVEAL_RATIO.toFixed(1)}x</strong>
      </div>
      <div class="result-row">
        <span class="result-label">획득 검증</span>
        <strong class="result-value">${count} / ${REQUIRED_STABLE_COUNT}</strong>
      </div>
      <div class="result-row">
        <span class="result-label">알림 상태</span>
        <strong class="result-value ${state.reached ? "highlight" : ""}">${notifyText}</strong>
      </div>
      ${warningRow}
    </div>
  `;
}

function startRoiDrag(event) {
  if (!stream || !video.videoWidth) return;
  dragStart = getVideoPoint(event);
  previewWrap.setPointerCapture(event.pointerId);
  setStatus("도감 영역을 선택하는 중입니다.");
}

function moveRoiDrag(event) {
  if (!dragStart) return;
  const end = getVideoPoint(event);
  roi = makeRoi(dragStart, end);
}

function endRoiDrag(event) {
  if (!dragStart) return;
  const end = getVideoPoint(event);
  roi = normalizeRoi(makeRoi(dragStart, end));
  dragStart = null;

  if (!isValidRoi(roi)) {
    roi = null;
    removeStoredRoi();
    setStatus("영역이 너무 작습니다. 미획득 표시가 들어가도록 다시 드래그하세요.");
    return;
  }

  saveRoi();
  readCropImage();
  setStatus("도감 영역 지정 완료. 감시 시작을 누르면 현재 화면을 기준으로 비교합니다.");
}

function makeRoi(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function getVideoPoint(event) {
  const rect = previewCanvas.getBoundingClientRect();
  const viewX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  const viewY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  return {
    x: viewX * video.videoWidth / rect.width,
    y: viewY * video.videoHeight / rect.height
  };
}

function drawPreviewFrame() {
  if (!stream || !video.videoWidth || !video.videoHeight) {
    previewAnimation = requestAnimationFrame(drawPreviewFrame);
    return;
  }

  const cssWidth = Math.max(1, previewWrap.clientWidth);
  const cssHeight = Math.max(220, Math.min(520, cssWidth * video.videoHeight / video.videoWidth));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const canvasWidth = Math.round(cssWidth * dpr);
  const canvasHeight = Math.round(cssHeight * dpr);

  if (previewCanvas.width !== canvasWidth || previewCanvas.height !== canvasHeight) {
    previewCanvas.width = canvasWidth;
    previewCanvas.height = canvasHeight;
    previewCanvas.style.width = cssWidth + "px";
    previewCanvas.style.height = cssHeight + "px";
  }

  const ctx = previewCanvas.getContext("2d");
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
  drawRoi(ctx, canvasWidth, canvasHeight);
  previewAnimation = requestAnimationFrame(drawPreviewFrame);
}

function drawRoi(ctx, canvasWidth, canvasHeight) {
  if (!roi || !video.videoWidth || !video.videoHeight) return;
  const x = roi.x / video.videoWidth * canvasWidth;
  const y = roi.y / video.videoHeight * canvasHeight;
  const width = roi.width / video.videoWidth * canvasWidth;
  const height = roi.height / video.videoHeight * canvasHeight;
  const lineWidth = Math.max(2, 2 * (window.devicePixelRatio || 1));

  ctx.save();
  ctx.fillStyle = "rgba(61, 220, 151, 0.18)";
  ctx.strokeStyle = "#3ddc97";
  ctx.lineWidth = lineWidth;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

function startPreviewLoop() {
  stopPreviewLoop();
  previewAnimation = requestAnimationFrame(drawPreviewFrame);
}

function stopPreviewLoop() {
  if (!previewAnimation) return;
  cancelAnimationFrame(previewAnimation);
  previewAnimation = null;
}

function saveRoi() {
  if (!isValidRoi(roi)) return;
  localStorage.setItem(ROI_STORAGE_KEY, JSON.stringify({
    ratioX: roi.x / video.videoWidth,
    ratioY: roi.y / video.videoHeight,
    ratioWidth: roi.width / video.videoWidth,
    ratioHeight: roi.height / video.videoHeight
  }));
}

function applyStoredRoi() {
  try {
    const saved = JSON.parse(localStorage.getItem(ROI_STORAGE_KEY) || "null");
    if (!saved || !video.videoWidth || !video.videoHeight) return false;
    const candidate = normalizeRoi({
      x: saved.ratioX * video.videoWidth,
      y: saved.ratioY * video.videoHeight,
      width: saved.ratioWidth * video.videoWidth,
      height: saved.ratioHeight * video.videoHeight
    });
    if (!isValidRoi(candidate)) return false;
    roi = candidate;
    readCropImage();
    return true;
  } catch (_) {
    removeStoredRoi();
    return false;
  }
}

function clearRoi() {
  roi = null;
  baselineImage = null;
  screenBaselineImage = null;
  stableCount = 0;
  screenChangeCount = 0;
  removeStoredRoi();
  cropCanvas.width = 0;
  cropCanvas.height = 0;
  setStatus("영역을 삭제했습니다. 도감 카드 영역을 다시 드래그하세요.");
}

function removeStoredRoi() {
  localStorage.removeItem(ROI_STORAGE_KEY);
}

function normalizeRoi(value) {
  if (!value || !video.videoWidth || !video.videoHeight) return null;
  const x = Math.max(0, Math.min(video.videoWidth, value.x));
  const y = Math.max(0, Math.min(video.videoHeight, value.y));
  const width = Math.max(0, Math.min(value.width, video.videoWidth - x));
  const height = Math.max(0, Math.min(value.height, video.videoHeight - y));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function isValidRoi(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) &&
    Number.isFinite(value.width) && Number.isFinite(value.height) &&
    value.width >= 20 && value.height >= 12 &&
    video.videoWidth && video.videoHeight &&
    value.x >= 0 && value.y >= 0 &&
    value.x + value.width <= video.videoWidth &&
    value.y + value.height <= video.videoHeight;
}

function getAlertAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!alertAudioContext) alertAudioContext = new AudioContextClass();
  return alertAudioContext;
}

async function unlockAlertSound() {
  const audioContext = getAlertAudioContext();
  if (!audioContext) return;
  try {
    if (audioContext.state === "suspended") await audioContext.resume();
    const startedAt = audioContext.currentTime;
    const gain = audioContext.createGain();
    const oscillator = audioContext.createOscillator();
    gain.gain.setValueAtTime(0.0001, startedAt);
    oscillator.frequency.setValueAtTime(440, startedAt);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startedAt);
    oscillator.stop(startedAt + 0.03);
    window.setTimeout(() => gain.disconnect(), 100);
  } catch (_) {
    // 알림음 초기화 실패는 감시 시작을 막지 않습니다.
  }
}

async function playAlertSound() {
  const audioContext = getAlertAudioContext();
  if (!audioContext) return;
  try {
    if (audioContext.state === "suspended") await audioContext.resume();
  } catch (_) {
    return;
  }

  const startedAt = audioContext.currentTime;
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(0.0001, startedAt);
  gain.gain.exponentialRampToValueAtTime(0.32, startedAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 3);
  gain.connect(audioContext.destination);

  [784, 987.77, 1318.51, 1760, 1318.51, 1975.53].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const noteStart = startedAt + index * 0.38;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    oscillator.connect(gain);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.28);
  });

  window.setTimeout(() => gain.disconnect(), 3200);
}

function showAlertOverlay(options) {
  alertBadge.textContent = options.badge;
  alertTitle.textContent = options.title;
  alertDesc.textContent = options.desc;
  alertOverlayName.textContent = options.name;
  alertOverlayDiff.textContent = options.diff.toFixed(1);
  alertOverlay.classList.add("show");
  alertOverlay.setAttribute("aria-hidden", "false");
  stopAlertBtn.focus({ preventScroll: true });
}

function hideAlertOverlay(message) {
  alertOverlay.classList.remove("show");
  alertOverlay.setAttribute("aria-hidden", "true");
  if (message) setStatus(message);
}

function waitForVideoReady() {
  if (video.videoWidth && video.videoHeight) return Promise.resolve();
  return new Promise(resolve => {
    video.addEventListener("loadedmetadata", resolve, { once: true });
  });
}

function formatElapsedDuration(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days.toLocaleString("ko-KR")}일`);
  if (hours > 0) parts.push(`${hours.toLocaleString("ko-KR")}시간`);
  if (minutes > 0) parts.push(`${minutes.toLocaleString("ko-KR")}분`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds.toLocaleString("ko-KR")}초`);
  return parts.join(" ");
}

function setStatus(message) {
  statusEl.textContent = message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  }[char]));
}
