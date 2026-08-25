import { startCapture, stopCapture } from "./calc/screen-exp.js";
import { saveInputs, loadInputs } from "./storage.js";

const STORAGE_KEY = "level_alert";
const ROI_STORAGE_KEY = "iryu_level_alert_roi";
const SAMPLE_INTERVAL_MS = 1000;
const OCR_SCALE = 4;
const REQUIRED_STABLE_COUNT = 10;
const REQUIRED_NON_BLACK_COUNT = 5;
const INITIAL_LEVEL_MIN_LIMIT = 300;
const TARGET_LEVEL_MARGIN = 50;
const LEVEL_JUMP_ABSOLUTE_MARGIN = 30;
const LEVEL_JUMP_RATIO = 1.5;
const ERROR_PIXEL_X = 50;
const ERROR_PIXEL_Y = 50;

const authBox = document.getElementById("levelAuthBox");
const targetLevelInput = document.getElementById("targetLevel");
const startCaptureBtn = document.getElementById("levelStartCaptureBtn");
const startWatchBtn = document.getElementById("levelStartWatchBtn");
const stopWatchBtn = document.getElementById("levelStopWatchBtn");
const stopAlertBtn = document.getElementById("levelStopAlertBtn");
const clearRoiBtn = document.getElementById("levelClearRoiBtn");
const previewWrap = document.getElementById("levelPreviewWrap");
const previewCanvas = document.getElementById("levelPreviewCanvas");
const video = document.getElementById("levelVideo");
const placeholder = document.getElementById("levelPlaceholder");
const cropCanvas = document.getElementById("levelCropCanvas");
const statusEl = document.getElementById("levelStatus");
const resultEl = document.getElementById("levelResult");
const alertOverlay = document.getElementById("levelAlertOverlay");
const alertOverlayTarget = document.getElementById("levelAlertOverlayTarget");
const alertOverlayCurrent = document.getElementById("levelAlertOverlayCurrent");
const rawPixelCanvas = document.createElement("canvas");
rawPixelCanvas.width = 1;
rawPixelCanvas.height = 1;
const rawPixelCtx = rawPixelCanvas.getContext("2d", { willReadFrequently: true });

let discordUser = null;
let stream = null;
let roi = null;
let dragStart = null;
let previewAnimation = null;
let watchTimer = null;
let watchInProgress = false;
let notified = false;
let ocrWorker = null;
let lastCandidateLevel = null;
let confirmedLevel = null;
let lastOcrText = "";
let alertAudioContext = null;
let watchStartedAt = null;
let watchStartLevel = null;
let targetCandidateLevel = null;
let targetStableCount = 0;
let lastRawPixelColor = null;
let errorNotified = false;
let nonBlackStableCount = 0;

loadSavedInputs();
renderDefaultResult();
checkAuth();

targetLevelInput.addEventListener("change", saveSettings);

startCaptureBtn.addEventListener("click", startLevelCapture);
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
    <p class="level-alert-auth-text">Discord 인증 후 목표 도달 알림을 DM으로 받을 수 있습니다.</p>
    <p class="level-alert-auth-note">인증 없이 감시를 시작하면 목표 도달 시 브라우저 알림음만 울립니다.</p>
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
    <p class="level-alert-auth-text">목표 레벨 도달 시 이 계정으로 DM 알림을 발송합니다.</p>
  `;
}

function loadSavedInputs() {
  const saved = loadInputs(STORAGE_KEY);
  if (!saved) return;
  if (saved.targetLevel !== undefined) targetLevelInput.value = saved.targetLevel;
}

function saveSettings() {
  saveInputs(STORAGE_KEY, {
    targetLevel: targetLevelInput.value
  });
}

async function startLevelCapture() {
  try {
    stopWatch();
    stopCapture(stream);
    stream = await startCapture(video);
    placeholder.hidden = true;
    roi = null;
    startPreviewLoop();

    await waitForVideoReady();
    if (applyStoredRoi()) {
      setStatus("저장된 레벨 영역을 불러왔습니다. 필요하면 영역 삭제 후 다시 선택하세요.");
    } else {
      setStatus("화면 선택 완료. 레벨 숫자가 보이는 영역만 드래그하세요.");
    }

    const [track] = stream.getVideoTracks();
    track.addEventListener("ended", () => {
      stopWatch("화면 공유가 중지되었습니다.");
      sendErrorNotify("메이플 월드 창이 꺼진 것 같습니다!!");
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

  const targetLevel = Number(targetLevelInput.value);
  if (!Number.isInteger(targetLevel) || targetLevel < 1) {
    setStatus("알림받을 레벨은 1 이상의 정수로 입력하세요.");
    return;
  }
  if (!stream || !video.videoWidth) {
    setStatus("화면 선택이 필요합니다.");
    return;
  }
  if (!isValidRoi(roi)) {
    setStatus("레벨 숫자 영역을 먼저 지정하세요.");
    return;
  }

  await unlockAlertSound();

  notified = false;
  hideAlertOverlay();
  lastCandidateLevel = null;
  confirmedLevel = null;
  lastOcrText = "";
  watchStartedAt = Date.now();
  watchStartLevel = null;
  targetCandidateLevel = null;
  targetStableCount = 0;
  lastRawPixelColor = null;
  errorNotified = false;
  nonBlackStableCount = 0;
  stopWatch();
  try {
    await ensureOcrWorker();
  } catch (error) {
    setStatus(error.message || "OCR 엔진을 준비하지 못했습니다.");
    return;
  }

  setStatus("OCR 감시를 시작합니다.");
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
    const targetLevel = Number(targetLevelInput.value);
    lastRawPixelColor = sampleRawPixelColor(ERROR_PIXEL_X, ERROR_PIXEL_Y);
    if (updateNonBlackStableState(lastRawPixelColor)) {
      if (!errorNotified) {
        errorNotified = true;
        await sendErrorNotify("절전모드가 해제되었습니다!!! 마을로 팅겨있을 가능성 높음");
      }
      return;
    }
    const recognized = await recognizeLevel();
    if (recognized.error) {
      renderResult({ error: recognized.error });
      setStatus(recognized.error);
      return;
    }

    const targetCheck = updateTargetStableLevel(recognized.level, targetLevel);
    const reached = targetCheck.reached;
    renderResult({
      targetLevel,
      candidateLevel: recognized.level,
      confirmedLevel,
      targetStableCount: targetCheck.count,
      requiredStableCount: getRequiredStableCount(),
      text: lastOcrText,
      reached,
      verifyingTarget: targetCheck.verifyingTarget
    });

    if (!reached) {
      const verifyText = targetCheck.verifyingTarget ? ` / 목표 도달 검증 ${targetCheck.count}/${getRequiredStableCount()}` : "";
      setStatus(`감시 중... 현재 후보 LV ${recognized.level.toLocaleString("ko-KR")}${verifyText}`);
      return;
    }

    await sendLevelNotify(targetLevel, confirmedLevel);
  } finally {
    watchInProgress = false;
  }
}

async function ensureOcrWorker() {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract?.createWorker) {
    throw new Error("OCR 라이브러리를 불러오지 못했습니다. 네트워크 상태를 확인하세요.");
  }

  setStatus("OCR 엔진을 준비하는 중입니다. 첫 실행은 시간이 걸릴 수 있습니다.");
  ocrWorker = await window.Tesseract.createWorker("eng", 1, {
    logger: progress => {
      if (progress.status === "recognizing text") {
        setStatus(`OCR 인식 중... ${Math.round((progress.progress || 0) * 100)}%`);
      }
    }
  });
  await ocrWorker.setParameters({
    tessedit_char_whitelist: "0123456789LVlv. :",
    tessedit_pageseg_mode: "7"
  });
  return ocrWorker;
}

async function recognizeLevel() {
  if (!isValidRoi(roi)) return { error: "레벨 숫자 영역을 먼저 지정하세요." };

  drawPreprocessedCrop();
  const worker = await ensureOcrWorker();
  const { data } = await worker.recognize(cropCanvas);
  lastOcrText = String(data?.text || "").trim();
  const level = parseLevel(lastOcrText);
  const targetLevel = Number(targetLevelInput.value);

  if (!Number.isInteger(level) || level < 1) {
    return { error: `레벨 숫자를 인식하지 못했습니다. OCR 결과: ${lastOcrText || "없음"}` };
  }
  if (!isPlausibleLevel(level, targetLevel)) {
    return { error: `OCR 오인식으로 보이는 값은 무시했습니다: LV ${level.toLocaleString("ko-KR")} / OCR 결과: ${lastOcrText || "없음"}` };
  }

  return { level };
}

function drawPreprocessedCrop() {
  const normalized = normalizeRoi(roi);
  const width = Math.max(1, Math.round(normalized.width * OCR_SCALE));
  const height = Math.max(1, Math.round(normalized.height * OCR_SCALE));
  cropCanvas.width = width;
  cropCanvas.height = height;
  cropCanvas.style.width = Math.min(420, width) + "px";
  cropCanvas.style.height = Math.max(80, Math.round(height * Math.min(420, width) / width)) + "px";

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

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.8 + 128));
    const value = contrasted > 115 ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function parseLevel(text) {
  const normalized = String(text || "").replace(/[|Il]/g, "1");
  const lvMatch = normalized.match(/(?:lv|level)\s*[.:：-]?\s*(\d(?:\s*\d){0,4})/i);
  if (lvMatch) return Number(lvMatch[1].replace(/\s+/g, ""));

  const matches = normalized.match(/\d{1,5}/g);
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) return Number(matches[0]);

  const separatedDigits = normalized.trim().match(/^\D*(\d(?:\s+\d){1,4})\D*$/);
  if (separatedDigits) return Number(separatedDigits[1].replace(/\s+/g, ""));

  return null;
}

function isPlausibleLevel(level, targetLevel) {
  if (!Number.isInteger(level) || level < 1) return false;

  const expectedMax = getExpectedMaxLevel(targetLevel);
  const referenceLevel = confirmedLevel ?? lastCandidateLevel ?? watchStartLevel;
  if (!Number.isInteger(referenceLevel) || referenceLevel < 1) {
    return level <= expectedMax;
  }

  const jumpLimit = Math.max(
    referenceLevel + LEVEL_JUMP_ABSOLUTE_MARGIN,
    Math.ceil(referenceLevel * LEVEL_JUMP_RATIO)
  );
  return level <= expectedMax || level <= jumpLimit;
}

function getExpectedMaxLevel(targetLevel) {
  if (!Number.isInteger(targetLevel) || targetLevel < 1) return INITIAL_LEVEL_MIN_LIMIT;
  return Math.max(
    INITIAL_LEVEL_MIN_LIMIT,
    targetLevel + TARGET_LEVEL_MARGIN,
    Math.ceil(targetLevel * LEVEL_JUMP_RATIO)
  );
}

function updateTargetStableLevel(level, targetLevel) {
  if (watchStartLevel === null) watchStartLevel = level;
  lastCandidateLevel = level;

  if (level < targetLevel) {
    targetCandidateLevel = null;
    targetStableCount = 0;
    return { reached: false, count: 0, verifyingTarget: false };
  }

  if (level === targetCandidateLevel) {
    targetStableCount += 1;
  } else {
    targetCandidateLevel = level;
    targetStableCount = 1;
  }

  const requiredCount = getRequiredStableCount();
  const displayCount = Math.min(targetStableCount, requiredCount);
  if (targetStableCount >= requiredCount) {
    confirmedLevel = level;
    return { reached: true, count: requiredCount, verifyingTarget: true };
  }

  return { reached: false, count: displayCount, verifyingTarget: true };
}

async function sendLevelNotify(targetLevel, currentLevel) {
  stopWatch();
  notified = true;
  showAlertOverlay(targetLevel, currentLevel);
  await playAlertSound();

  if (!discordUser) {
    setStatus("목표 레벨 도달. 브라우저 알림음을 재생했습니다.");
    renderResult({
      targetLevel,
      confirmedLevel: currentLevel,
      text: lastOcrText,
      reached: true,
      notified: true,
      notifyMethod: "브라우저 알림음"
    });
    return;
  }

  setStatus("목표 레벨 도달. 브라우저 알림음 재생 후 Discord DM을 발송하는 중입니다.");

  const message = buildDiscordMessage(targetLevel, currentLevel);
  let res = null;
  try {
    res = await fetch("/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message })
    });
  } catch (_) {
    notified = false;
    setStatus("Discord DM 발송 요청에 실패했습니다. 브라우저 알림음은 재생했습니다.");
    renderResult({
      targetLevel,
      confirmedLevel: currentLevel,
      text: lastOcrText,
      reached: true,
      notified: true,
      notifyMethod: "브라우저 알림음"
    });
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
    notified = false;
    setStatus("Discord 세션이 만료되었습니다. 브라우저 알림음은 재생했습니다.");
    return;
  }
  if (!res.ok) {
    notified = false;
    const detail = data?.error === "dm_channel_failed"
      ? "DM 채널 생성에 실패했습니다. 정식 Discord 서버에 봇이 초대되어 있는지 확인해 주세요."
      : `DM 발송 실패: ${data?.error || res.status}`;
    setStatus(detail);
    renderResult({ error: detail });
    return;
  }

  setStatus("Discord DM 알림을 발송했습니다.");
  renderResult({
    targetLevel,
    confirmedLevel: currentLevel,
    text: lastOcrText,
    reached: true,
    notified: true,
    notifyMethod: "Discord DM + 브라우저 알림음"
  });
}

async function sendErrorNotify(message = "오류 발생!!") {
  stopWatch();
  notified = true;

  if (!discordUser) {
    setStatus(message);
    return;
  }

  let res = null;
  try {
    res = await fetch("/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message })
    });
  } catch (_) {
    setStatus(message);
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
    setStatus(message);
    return;
  }
  if (!res.ok) {
    setStatus(message);
    renderResult({
      error: data?.error === "dm_channel_failed"
        ? "DM 채널 생성에 실패했습니다. 정식 Discord 서버에 봇이 초대되어 있는지 확인해 주세요."
        : `DM 발송 실패: ${data?.error || res.status}`
    });
    return;
  }

  setStatus(message);
}

function buildDiscordMessage(targetLevel, currentLevel) {
  const startLevel = watchStartLevel ?? currentLevel;
  const elapsedMs = watchStartedAt ? Math.max(0, Date.now() - watchStartedAt) : 0;
  const elapsedText = formatElapsedDuration(elapsedMs);

  return [
    "## 이류월드 레벨업 알림",
    "목표 레벨에 도달했습니다.",
    "",
    `목표 레벨: **LV ${targetLevel.toLocaleString("ko-KR")}**`,
    `측정 시작 레벨: **LV ${startLevel.toLocaleString("ko-KR")}**`,
    `측정 종료 레벨: **LV ${currentLevel.toLocaleString("ko-KR")}**`,
    `총 걸린 시간: **${elapsedText}**`
  ].join("\n");
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

function startRoiDrag(event) {
  if (!stream || !video.videoWidth) return;
  dragStart = getVideoPoint(event);
  previewWrap.setPointerCapture(event.pointerId);
  setStatus("레벨 영역을 선택하는 중입니다.");
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
    setStatus("영역이 너무 작습니다. 레벨 숫자가 보이는 영역을 다시 드래그하세요.");
    return;
  }

  saveRoi();
  drawPreprocessedCrop();
  setStatus("레벨 영역 지정 완료. 감시를 시작하세요.");
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
  ctx.fillStyle = "rgba(255, 45, 45, 0.16)";
  ctx.strokeStyle = "#ff2d2d";
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
    drawPreprocessedCrop();
    return true;
  } catch (_) {
    removeStoredRoi();
    return false;
  }
}

function clearRoi() {
  roi = null;
  removeStoredRoi();
  cropCanvas.width = 0;
  cropCanvas.height = 0;
  setStatus("영역을 삭제했습니다. 레벨 숫자 영역을 다시 드래그하세요.");
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

function getRequiredStableCount() {
  return REQUIRED_STABLE_COUNT;
}

function sampleRawPixelColor(x, y) {
  if (!video.videoWidth || !video.videoHeight || !rawPixelCtx) return null;
  if (x < 0 || y < 0 || x >= video.videoWidth || y >= video.videoHeight) return null;

  rawPixelCtx.clearRect(0, 0, 1, 1);
  rawPixelCtx.drawImage(video, x, y, 1, 1, 0, 0, 1, 1);
  const data = rawPixelCtx.getImageData(0, 0, 1, 1).data;
  return {
    x,
    y,
    r: data[0],
    g: data[1],
    b: data[2]
  };
}

function renderDefaultResult() {
  resultEl.innerHTML = `
    <div class="result-section">
      <div class="result-row">
        <span class="result-label">현재 확정 레벨</span>
        <strong class="result-value">-</strong>
      </div>
      <div class="result-row">
        <span class="result-label">OCR 원문</span>
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

  const confirmed = state.confirmedLevel === null || state.confirmedLevel === undefined
    ? "-"
    : `LV ${Number(state.confirmedLevel).toLocaleString("ko-KR")}`;
  const candidate = state.candidateLevel === null || state.candidateLevel === undefined
    ? "-"
    : `LV ${Number(state.candidateLevel).toLocaleString("ko-KR")}`;
  const target = state.targetLevel ? `LV ${Number(state.targetLevel).toLocaleString("ko-KR")}` : "-";
  const notifyText = state.notified ? (state.notifyMethod || "알림 완료") : (state.reached ? "도달 감지" : "대기 중");
  const verifyText = state.verifyingTarget
    ? `${Math.min(state.targetStableCount || 0, state.requiredStableCount || getRequiredStableCount())} / ${state.requiredStableCount || getRequiredStableCount()}`
    : "목표 레벨 감지 대기";

  resultEl.innerHTML = `
    <div class="result-section">
      <div class="result-row">
        <span class="result-label">목표 레벨</span>
        <strong class="result-value highlight">${target}</strong>
      </div>
      <div class="result-row">
        <span class="result-label">현재 후보 레벨</span>
        <strong class="result-value">${candidate}</strong>
      </div>
      <div class="result-row">
        <span class="result-label">현재 확정 레벨</span>
        <strong class="result-value highlight">${confirmed}</strong>
      </div>
      <div class="result-row">
        <span class="result-label">목표 도달 검증</span>
        <strong class="result-value">${verifyText}</strong>
      </div>
      <div class="result-row">
        <span class="result-label">알림 상태</span>
        <strong class="result-value ${state.reached ? "highlight" : ""}">${notifyText}</strong>
      </div>
      <div class="result-row">
        <span class="result-label">OCR 원문</span>
        <strong class="result-value">${escapeHtml(state.text || "-")}</strong>
      </div>
    </div>
  `;
}

function isNonBlackPixel(pixel) {
  return !!pixel && (pixel.r !== 0 || pixel.g !== 0 || pixel.b !== 0);
}

function updateNonBlackStableState(pixel) {
  if (!isNonBlackPixel(pixel)) {
    nonBlackStableCount = 0;
    return false;
  }

  nonBlackStableCount += 1;
  return nonBlackStableCount >= REQUIRED_NON_BLACK_COUNT;
}

function setStatus(message) {
  statusEl.textContent = message;
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
    // 알림음 초기화 실패는 OCR 감시 자체를 막지 않습니다.
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

  [880, 1174.66, 1567.98, 1174.66, 1567.98, 2093].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const noteStart = startedAt + index * 0.42;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    oscillator.connect(gain);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.32);
  });

  window.setTimeout(() => gain.disconnect(), 3200);
}

function showAlertOverlay(targetLevel, currentLevel) {
  alertOverlayTarget.textContent = `LV ${Number(targetLevel).toLocaleString("ko-KR")}`;
  alertOverlayCurrent.textContent = `LV ${Number(currentLevel).toLocaleString("ko-KR")}`;
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

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  }[char]));
}
