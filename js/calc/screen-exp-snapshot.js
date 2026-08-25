import { initExpData, getExpNeedForLevel } from "./exp.js";
import { saveInputs, loadInputs } from "../storage.js";
import {
  copyRoiToCanvas,
  createRoiInteraction,
  drawCroppedFrame,
  drawRoiBox,
  formatNumber,
  startDisplayCapture,
  stopDisplayCapture
} from "./screen-exp-core.js";

await initExpData("../..");

if (new URLSearchParams(location.search).get("embed") === "1") {
  document.body.classList.add("measure-embed");
}

const IS_MEASURE_EMBED = document.body.classList.contains("measure-embed");

function postMeasureEmbedHeight() {
  if (!IS_MEASURE_EMBED || window.parent === window) return;
  requestAnimationFrame(() => {
    window.parent.postMessage({
      type: "iryuMeasureFrameHeight",
      height: document.documentElement.scrollHeight
    }, location.origin);
  });
}

if (IS_MEASURE_EMBED) {
  window.addEventListener("load", postMeasureEmbedHeight);
  window.addEventListener("resize", postMeasureEmbedHeight);
  window.addEventListener("message", event => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === "iryuMeasureRequestHeight") postMeasureEmbedHeight();
    if (event.data?.type === "iryuMeasureTheme" && event.data.theme) {
      document.documentElement.setAttribute("data-theme", event.data.theme);
    }
  });
  if (window.ResizeObserver) {
    new ResizeObserver(postMeasureEmbedHeight).observe(document.body);
  }
  setTimeout(postMeasureEmbedHeight, 300);
}

const video = document.getElementById("video");
const preview = document.getElementById("preview");
const previewCanvas = document.getElementById("previewCanvas");
const roiBox = document.getElementById("roiBox");
const startShotPanel = document.getElementById("startShotPanel");
const endShotPanel = document.getElementById("endShotPanel");
const startCanvas = document.getElementById("startCanvas");
const endCanvas = document.getElementById("endCanvas");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const startRatioEl = document.getElementById("startRatioMetric");
const endRatioEl = document.getElementById("endRatioMetric");
const elapsedEl = document.getElementById("elapsedMetric");
const gainedEl = document.getElementById("gainedMetric");
const averageEl = document.getElementById("averageMetric");
const ocrDebugCanvas = document.getElementById("ocrDebugCanvas");
const ocrDebugText = document.getElementById("ocrDebugText");
const INPUT_IDS = ["startLevel", "startExpValue", "endLevel", "endExpValue", "hourglassLevel", "elapsedMinutes", "measureSeconds"];
const STORAGE_KEY = "screenExpSnapshot";
const TESSERACT_WORKER_PATH = new URL("../vendor/tesseract/worker.min.js", import.meta.url).href;
const TESSERACT_CORE_PATH = new URL("../vendor/tesseract/core/", import.meta.url).href;
const TESSERACT_LANG_PATH = new URL("../vendor/tesseract/lang/", import.meta.url).href;
const MIN_OCR_EXP_DIGITS = 12;
const SNAPSHOT_CROP_TOP_RATIO = 0.82;

let stream = null;
let previewAnimation = null;
let startShot = null;
let endShot = null;
let startShotAt = 0;
let endShotAt = 0;
let measureTimer = null;
let measureStartedAt = 0;
let ocrWorkerPromise = null;

loadSavedInputs();
setupGuideToggle();

const roiTool = createRoiInteraction(preview, previewCanvas, roiBox, {
  onCommit: () => setStatus("영역을 지정했습니다. 숫자 텍스트만 들어왔는지 확인한 뒤 측정하세요.")
});

function setStatus(text) {
  statusEl.textContent = text;
}

function saveInputState() {
  const data = {};
  for (const id of INPUT_IDS) {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  }
  saveInputs(STORAGE_KEY, data);
}

function loadSavedInputs() {
  const saved = loadInputs(STORAGE_KEY);
  if (!saved) return;
  for (const id of INPUT_IDS) {
    const el = document.getElementById(id);
    if (el && saved[id] !== undefined) el.value = saved[id];
  }
}

function setupGuideToggle() {
  const guide = document.getElementById("screenGuide");
  const button = document.getElementById("screenGuideToggleBtn");
  if (!guide || !button) return;

  button.addEventListener("click", () => {
    const collapsed = guide.classList.toggle("collapsed");
    button.setAttribute("aria-expanded", String(!collapsed));
    button.textContent = collapsed ? "펼치기" : "접기";
  });
}

function drawPreviewLoop() {
  if (!stream) return;
  try {
    drawCroppedFrame(video, previewCanvas, SNAPSHOT_CROP_TOP_RATIO);
    drawRoiBox(roiBox, previewCanvas, roiTool.getRoi());
  } catch {
    // ignore early frames
  }
  previewAnimation = requestAnimationFrame(drawPreviewLoop);
}

async function startCapture() {
  if (previewAnimation) cancelAnimationFrame(previewAnimation);
  stopDisplayCapture(stream);
  stream = await startDisplayCapture(video, 6);
  document.getElementById("placeholder").hidden = true;
  drawPreviewLoop();
  setStatus("미리보기에서 경험치 숫자 텍스트만 좁게 드래그하세요.");
}

function clearCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

function setShotPanelEmpty(panel, empty) {
  if (panel) panel.classList.toggle("shot-empty", empty);
}

function resetMeasurementView() {
  startShot = null;
  endShot = null;
  startShotAt = 0;
  endShotAt = 0;
  startRatioEl.textContent = "-";
  endRatioEl.textContent = "-";
  elapsedEl.textContent = "-";
  gainedEl.textContent = "-";
  averageEl.textContent = "-";
  clearCanvas(startCanvas);
  clearCanvas(endCanvas);
  clearCanvas(ocrDebugCanvas);
  ocrDebugText.textContent = "OCR 원문이 여기에 표시됩니다.";
  setShotPanelEmpty(startShotPanel, true);
  setShotPanelEmpty(endShotPanel, true);
  resultEl.textContent = "자동 측정 중입니다. 종료 캡처 후 시작/종료 현재 경험치를 입력하면 결과가 표시됩니다.";
}

async function requestOcr(kind, canvas) {
  const targetId = kind === "start" ? "startExpValue" : "endExpValue";
  const label = kind === "start" ? "시작" : "종료";
  setStatus(`${label} 캡처 OCR 인식 중...`);

  try {
    const worker = await getOcrWorker();
    const recognized = await recognizeExpFromCanvas(worker, canvas, label);
    const exp = recognized.exp;
    if (!exp) throw new Error("OCR 결과에서 현재 경험치를 찾지 못했습니다. 전처리 이미지를 확인하고 숫자 줄만 다시 지정해 주세요.");

    document.getElementById(targetId).value = exp;
    saveInputState();
    if (kind === "start") {
      startRatioEl.textContent = formatBigInt(BigInt(exp));
    } else {
      endRatioEl.textContent = formatBigInt(BigInt(exp));
    }
    setStatus(`${label} 현재 경험치 OCR 완료: ${formatBigInt(BigInt(exp))}`);
    if (startShot && endShot) calculate();
  } catch (error) {
    setStatus(`${label} OCR 실패: ${error.message} 수동으로 현재 경험치를 입력해 주세요.`);
  }
}

async function recognizeExpFromCanvas(worker, sourceCanvas, label) {
  const attempts = [
    { mode: "brightText", title: "선택 영역 숫자 강조", crop: "none", psm: window.Tesseract.PSM.SINGLE_LINE },
    { mode: "threshold", title: "선택 영역 흑백", crop: "none", psm: window.Tesseract.PSM.SINGLE_LINE },
    { mode: "brightText", title: "글자 행 자동 추출", crop: "textBand", psm: window.Tesseract.PSM.SINGLE_LINE },
    { mode: "inverted", title: "글자 행 반전", crop: "textBand", psm: window.Tesseract.PSM.SINGLE_LINE },
    { mode: "brightText", title: "줄 원본 RAW", crop: "none", psm: window.Tesseract.PSM.RAW_LINE },
    { mode: "original", title: "원본 확대", crop: "none", psm: window.Tesseract.PSM.SINGLE_LINE }
  ];
  const results = [];
  let best = { exp: "", text: "", title: "", canvas: null };

  for (const attempt of attempts) {
    setStatus(`${label} OCR 인식 중... ${attempt.title}`);
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789,/",
      tessedit_pageseg_mode: attempt.psm || window.Tesseract.PSM.SINGLE_LINE,
      classify_bln_numeric_mode: "1",
      user_defined_dpi: "300"
    });
    const source = attempt.crop === "textBand" ? cropLikelyNumberBand(sourceCanvas) : sourceCanvas;
    const image = preprocessOcrCanvas(source, attempt.mode);
    const result = await worker.recognize(image);
    const text = result.data?.text || "";
    const exp = parseOcrExp(text);
    results.push(`${attempt.title}:\n${text.trim() || "(비어 있음)"}`);
    if (!best.canvas || scoreOcrExp(exp, text) > scoreOcrExp(best.exp, best.text)) {
      best = { exp, text, title: attempt.title, canvas: image };
    }
  }

  if (best.canvas) copyCanvasForDebug(best.canvas, ocrDebugCanvas);
  ocrDebugText.textContent = `${label} OCR 원문 (${best.title || "후보 없음"}):\n${results.join("\n\n")}`;
  return best;
}

async function getOcrWorker() {
  if (!window.Tesseract?.createWorker) {
    throw new Error("Tesseract.js 로컬 파일을 불러오지 못했습니다.");
  }
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const worker = await window.Tesseract.createWorker("eng", 1, {
        workerPath: TESSERACT_WORKER_PATH,
        corePath: TESSERACT_CORE_PATH,
        langPath: TESSERACT_LANG_PATH,
        logger: message => {
          if (message.status === "recognizing text" && Number.isFinite(message.progress)) {
            setStatus(`OCR 인식 중... ${Math.round(message.progress * 100)}%`);
          }
        }
      });
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789,/",
        tessedit_pageseg_mode: window.Tesseract.PSM.SINGLE_LINE,
        classify_bln_numeric_mode: "1",
        user_defined_dpi: "300"
      });
      return worker;
    })();
  }
  return ocrWorkerPromise;
}

function preprocessOcrCanvas(sourceCanvas, mode = "threshold") {
  const scale = Math.min(10, Math.max(6, Math.ceil(1800 / Math.max(1, sourceCanvas.width))));
  const canvas = document.createElement("canvas");
  const pad = 24;
  canvas.width = Math.max(1, (sourceCanvas.width * scale) + (pad * 2));
  canvas.height = Math.max(1, (sourceCanvas.height * scale) + (pad * 2));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, pad, pad, sourceCanvas.width * scale, sourceCanvas.height * scale);

  if (mode === "original") return canvas;

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (mode === "brightText") {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const isWhiteText = max >= 165 && max - min <= 88;
      const isPaleGreenText = r >= 150 && g >= 175 && b >= 105 && max - min <= 112;
      const isBrightText = isWhiteText || isPaleGreenText;
      const value = isBrightText ? 0 : 255;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
      continue;
    }
    const gray = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
    const darkText = gray >= 120 ? 0 : 255;
    const value = mode === "inverted" ? 255 - darkText : darkText;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return trimBinaryCanvas(removeLongHorizontalLines(canvas));
}

function removeLongHorizontalLines(sourceCanvas) {
  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  const rowsToClear = new Set();

  for (let y = 0; y < canvas.height; y++) {
    let darkCount = 0;
    let run = 0;
    let longestRun = 0;
    for (let x = 0; x < canvas.width; x++) {
      const i = ((y * canvas.width) + x) * 4;
      const dark = data[i] < 128;
      if (dark) {
        darkCount++;
        run++;
        if (run > longestRun) longestRun = run;
      } else {
        run = 0;
      }
    }
    if (darkCount > canvas.width * 0.35 && longestRun > canvas.width * 0.28) {
      for (let offset = -2; offset <= 2; offset++) {
        const row = y + offset;
        if (row >= 0 && row < canvas.height) rowsToClear.add(row);
      }
    }
  }

  for (const y of rowsToClear) {
    for (let x = 0; x < canvas.width; x++) {
      const i = ((y * canvas.width) + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function trimBinaryCanvas(sourceCanvas) {
  const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const { data } = image;
  let minX = sourceCanvas.width;
  let minY = sourceCanvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < sourceCanvas.height; y++) {
    for (let x = 0; x < sourceCanvas.width; x++) {
      const i = ((y * sourceCanvas.width) + x) * 4;
      if (data[i] < 128) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return sourceCanvas;

  const pad = 18;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  const width = Math.min(sourceCanvas.width - x, (maxX - minX + 1) + (pad * 2));
  const height = Math.min(sourceCanvas.height - y, (maxY - minY + 1) + (pad * 2));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const out = canvas.getContext("2d", { willReadFrequently: true });
  out.fillStyle = "#fff";
  out.fillRect(0, 0, width, height);
  out.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
  return canvas;
}

function cropLikelyNumberBand(sourceCanvas) {
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;
  const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, sourceWidth, sourceHeight);
  const { data } = image;
  const rowScores = [];

  for (let y = 0; y < sourceHeight; y++) {
    let bright = 0;
    let longRun = 0;
    let run = 0;
    for (let x = 0; x < sourceWidth; x++) {
      const i = ((y * sourceWidth) + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const looksLikeText = max >= 132 && (max - min <= 118 || g >= r * 1.02);
      if (looksLikeText) {
        bright++;
        run++;
        if (run > longRun) longRun = run;
      } else {
        run = 0;
      }
    }
    const linePenalty = longRun > sourceWidth * 0.35 ? sourceWidth * 0.4 : 0;
    rowScores.push(Math.max(0, bright - linePenalty));
  }

  const maxScore = Math.max(...rowScores);
  if (maxScore <= 0) return sourceCanvas;
  const threshold = Math.max(3, maxScore * 0.32);
  const activeRows = rowScores
    .map((score, index) => score >= threshold ? index : -1)
    .filter(index => index >= 0);
  if (!activeRows.length) return sourceCanvas;

  const runs = [];
  let start = activeRows[0];
  let end = activeRows[0];
  for (let i = 1; i < activeRows.length; i++) {
    if (activeRows[i] <= end + 2) {
      end = activeRows[i];
    } else {
      runs.push({ start, end });
      start = activeRows[i];
      end = activeRows[i];
    }
  }
  runs.push({ start, end });

  const best = runs
    .map(run => ({
      ...run,
      score: rowScores.slice(run.start, run.end + 1).reduce((sum, score) => sum + score, 0)
    }))
    .sort((a, b) => b.score - a.score)[0];
  const pad = Math.max(4, Math.round(sourceHeight * 0.12));
  const y = Math.max(0, best.start - pad);
  const bottom = Math.min(sourceHeight, best.end + pad + 1);
  const height = Math.max(1, bottom - y);
  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = height;
  const out = canvas.getContext("2d", { willReadFrequently: true });
  out.drawImage(sourceCanvas, 0, y, sourceWidth, height, 0, 0, sourceWidth, height);
  return canvas;
}

function copyCanvasForDebug(sourceCanvas, targetCanvas) {
  if (!targetCanvas) return;
  targetCanvas.width = sourceCanvas.width;
  targetCanvas.height = sourceCanvas.height;
  const ctx = targetCanvas.getContext("2d");
  ctx.drawImage(sourceCanvas, 0, 0);
}

function parseOcrExp(text) {
  const normalized = String(text || "")
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[，.]/g, ",");
  const candidates = extractOcrExpCandidates(normalized);
  return candidates[0]?.exp || "";
}

function extractOcrExpCandidates(text) {
  const slashIndex = text.indexOf("/");
  const denominatorExp = slashIndex >= 0
    ? repairCommaGroupedDigits(text.slice(slashIndex + 1).match(/\d[\d,\s]{1,}\d|\d{2,}/)?.[0] || "")
    : "";
  const denominatorDigits = denominatorExp.length;
  const denominatorValue = safeBigInt(denominatorExp);
  const parts = slashIndex >= 0
    ? [{ text: text.slice(0, slashIndex), beforeSlash: true }]
    : [{ text, beforeSlash: false }];

  const seen = new Set();
  const candidates = [];
  for (const part of parts) {
    for (const match of part.text.matchAll(/\d[\d,\s]{1,}\d|\d{2,}/g)) {
      const raw = match[0].replace(/\s+/g, "");
      const exp = repairCommaGroupedDigits(raw);
      if (exp.length < 2 || seen.has(`${part.beforeSlash}:${exp}:${raw}`)) continue;
      seen.add(`${part.beforeSlash}:${exp}:${raw}`);

      const merged = splitMergedExpCandidate(raw);
      const commaCount = (raw.match(/,/g) || []).length;
      const hasGroupedCommas = /\d{1,3}(,\d{3}){2,}/.test(raw);
      const startsWithZeroNoise = /^0\d{12,}/.test(exp);
      if (startsWithZeroNoise && !hasGroupedCommas) continue;
      if (startsWithZeroNoise && commaCount < 6) continue;
      if (!part.beforeSlash && exp.length > 24 && !merged) continue;

      const candidateExp = normalizeCurrentExpCandidate(merged || exp, denominatorDigits, denominatorValue);
      if (candidateExp.length < 2) continue;
      const candidateValue = safeBigInt(candidateExp);
      if (denominatorValue !== null && candidateValue !== null && candidateValue > denominatorValue) continue;
      let score = candidateExp.length;
      if (candidateExp.length < exp.length) score += 22;
      if (part.beforeSlash) score += 10;
      if (merged) score += 26;
      if (hasGroupedCommas) score += 18;
      score += Math.min(commaCount, 8) * 2;
      if (denominatorDigits > 0 && candidateExp.length <= denominatorDigits) score += 16;
      if (candidateExp.length >= 18) score += 8;
      if (startsWithZeroNoise) score -= 30;
      candidates.push({ exp: candidateExp, score });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function normalizeCurrentExpCandidate(exp, denominatorDigits, denominatorValue = null) {
  let value = String(exp || "").replace(/\D/g, "");
  if (denominatorDigits > 0 && value.length > denominatorDigits) {
    value = value.slice(value.length - denominatorDigits);
  }
  if (denominatorValue !== null && value.length === denominatorDigits && value.length > 1) {
    const currentValue = safeBigInt(value);
    const withoutFirst = value.slice(1).replace(/^0+(?=\d)/, "");
    const trimmedValue = safeBigInt(withoutFirst);
    if (currentValue !== null && currentValue > denominatorValue && trimmedValue !== null && trimmedValue <= denominatorValue) {
      value = withoutFirst;
    }
  }
  return value.replace(/^0+(?=\d{13,})/, "");
}

function safeBigInt(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  try {
    return BigInt(digits);
  } catch {
    return null;
  }
}

function repairCommaGroupedDigits(raw) {
  const text = String(raw || "").replace(/\s+/g, "");
  if (!text.includes(",")) return text.replace(/\D/g, "");

  const inputGroups = text.split(",")
    .map((group, index, groups) => {
      const digits = group.replace(/\D/g, "");
      const isLastGroup = index === groups.length - 1;
      if (isLastGroup && index > 0 && digits.length > 3 && digits.length <= 5) {
        return digits.slice(0, 3);
      }
      return digits;
    })
    .filter(Boolean);
  if (!inputGroups.length) return "";

  const splitGroups = [];
  inputGroups.forEach((group, index) => {
    if (group.length <= 3) {
      splitGroups.push(group);
      return;
    }

    let cursor = 0;
    const firstSize = index === 0 ? (group.length % 3 || 3) : 3;
    splitGroups.push(group.slice(cursor, cursor + firstSize));
    cursor += firstSize;
    while (cursor < group.length) {
      splitGroups.push(group.slice(cursor, cursor + 3));
      cursor += 3;
    }
  });

  const repaired = [];
  for (let i = 0; i < splitGroups.length; i++) {
    const group = splitGroups[i];
    const next = splitGroups[i + 1] || "";
    const isShortMiddleNoise = i > 0 && i < splitGroups.length - 1 && group.length < 3 && next.startsWith(group);
    const isTrailingNoise = i > 0 && i === splitGroups.length - 1 && group.length < 3;
    if (isShortMiddleNoise || isTrailingNoise) continue;
    repaired.push(group);
  }

  return repaired.join("").replace(/^0+(?=\d{13,})/, "");
}

function splitMergedExpCandidate(raw) {
  const groups = raw.split(",");
  if (groups.length < 4) return "";
  for (let i = 1; i < groups.length - 2; i++) {
    const group = groups[i];
    if (!/^\d{4,6}$/.test(group)) continue;
    const leftPart = group.slice(0, 3);
    const candidate = [...groups.slice(0, i), leftPart].join("").replace(/\D/g, "");
    if (candidate.length >= 2) return candidate;
  }
  return "";
}

function scoreOcrExp(exp, text) {
  if (!exp) return 0;
  let score = exp.length;
  if (exp.length >= 18) score += 8;
  if (String(text || "").includes("/")) score += 6;
  if (/^0{2,}/.test(exp)) score -= 18;
  if (exp.length > 24) score -= 40;
  return score;
}

function takeShot(kind) {
  if (!stream) {
    setStatus("먼저 화면을 선택하세요.");
    return;
  }
  const roi = roiTool.getRoi();
  if (!roi) {
    setStatus("경험치 숫자 텍스트 영역을 먼저 지정하세요.");
    return;
  }

  drawCroppedFrame(video, previewCanvas, SNAPSHOT_CROP_TOP_RATIO);

  if (kind === "start") {
    copyRoiToCanvas(previewCanvas, startCanvas, roi, { padX: 4, padY: 2 });
    setShotPanelEmpty(startShotPanel, false);
    startShot = { roi: { ...roi } };
    startShotAt = Date.now();
    startRatioEl.textContent = getFormattedInputExp("startExpValue") || "캡처 완료";
    setStatus("시작 캡처 완료. 시작 현재 경험치를 입력하세요.");
    requestOcr("start", startCanvas);
  } else {
    copyRoiToCanvas(previewCanvas, endCanvas, roi, { padX: 4, padY: 2 });
    setShotPanelEmpty(endShotPanel, false);
    endShot = { roi: { ...roi } };
    endShotAt = Date.now();
    endRatioEl.textContent = getFormattedInputExp("endExpValue") || "캡처 완료";
    setStatus("종료 캡처 완료. 종료 현재 경험치를 입력하세요.");
    requestOcr("end", endCanvas);
  }
  updateElapsedMetric();
}

function getMeasureSeconds() {
  const seconds = Number(document.getElementById("measureSeconds").value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
}

function startAutoMeasure() {
  if (!stream) {
    setStatus("먼저 화면을 선택하세요.");
    return;
  }
  if (!roiTool.getRoi()) {
    setStatus("경험치 숫자 텍스트 영역을 먼저 지정하세요.");
    return;
  }

  stopAutoMeasure(false);
  resetMeasurementView();

  takeShot("start");
  if (!startShot) return;

  const seconds = getMeasureSeconds();
  measureStartedAt = Date.now();
  document.getElementById("elapsedMinutes").value = "";
  saveInputState();
  setStatus(`자동 측정 중... ${seconds}초 후 종료 캡처합니다.`);

  measureTimer = setTimeout(() => {
    measureTimer = null;
    takeShot("end");
    if (endShot && getFormattedInputExp("startExpValue") && getFormattedInputExp("endExpValue")) calculate();
  }, seconds * 1000);
}

function stopAutoMeasure(showStatus = true) {
  if (measureTimer) clearTimeout(measureTimer);
  measureTimer = null;
  measureStartedAt = 0;
  if (showStatus) setStatus("자동 측정을 중지했습니다.");
}

function updateElapsedMetric() {
  const minutes = getElapsedMinutes();
  elapsedEl.textContent = minutes > 0 ? `${minutes.toFixed(2)}분` : "-";
}

function getElapsedMinutes() {
  const manual = Number(document.getElementById("elapsedMinutes").value);
  if (Number.isFinite(manual) && manual > 0) return manual;
  if (startShotAt && endShotAt && endShotAt > startShotAt) return (endShotAt - startShotAt) / 60000;
  return 0;
}

function getHourglassMultiplier() {
  const hourglass = Number(document.getElementById("hourglassLevel").value);
  if (!Number.isInteger(hourglass) || hourglass < 0 || hourglass > 50) {
    return { error: "모래시계 레벨은 0~50 사이로 입력하세요." };
  }
  return { level: hourglass, numerator: BigInt(10 + hourglass), denominator: 10n, multiplier: 1 + hourglass * 0.1 };
}

function parseExpInput(id, label) {
  const raw = String(document.getElementById(id).value || "").split("/")[0].trim();
  const digits = raw.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(digits)) return { error: `${label}는 숫자로 입력하세요.` };
  return { value: BigInt(digits) };
}

function formatBigInt(value) {
  return value.toLocaleString("ko-KR");
}

function getFormattedInputExp(id) {
  const parsed = parseExpInput(id, "");
  return parsed.error ? "" : formatBigInt(parsed.value);
}

function getAdjustedLevelNeed(level, hourglass) {
  const info = getExpNeedForLevel(level);
  if (info.error) return info;
  return {
    level: info.level,
    need: info.expNeedBigInt * hourglass.numerator / hourglass.denominator
  };
}

function calculateGainedExp(startLevel, endLevel, startExp, endExp, hourglass) {
  if (endLevel < startLevel) return { error: "종료 레벨은 시작 레벨보다 낮을 수 없습니다." };

  if (endLevel === startLevel) {
    if (endExp < startExp) return { error: "같은 레벨에서는 종료 현재 경험치가 시작 현재 경험치보다 크거나 같아야 합니다." };
    return { gained: endExp - startExp };
  }

  const startNeed = getAdjustedLevelNeed(startLevel, hourglass);
  if (startNeed.error) return startNeed;
  if (startExp > startNeed.need) return { error: "시작 현재 경험치가 시작 레벨 필요 경험치보다 큽니다." };

  let gained = startNeed.need - startExp;

  for (let level = startLevel + 1; level < endLevel; level++) {
    const info = getAdjustedLevelNeed(level, hourglass);
    if (info.error) return info;
    gained += info.need;
  }

  const endNeed = getAdjustedLevelNeed(endLevel, hourglass);
  if (endNeed.error) return endNeed;
  if (endExp > endNeed.need) return { error: "종료 현재 경험치가 종료 레벨 필요 경험치보다 큽니다." };
  gained += endExp;
  return { gained };
}

function calculate() {
  const startLevel = Number(document.getElementById("startLevel").value);
  const endLevelInput = document.getElementById("endLevel").value;
  const endLevel = endLevelInput === "" ? startLevel : Number(endLevelInput);
  if (!Number.isInteger(startLevel) || startLevel < 1 || !Number.isInteger(endLevel) || endLevel < 1) {
    setStatus("시작/종료 레벨을 올바르게 입력하세요.");
    return;
  }
  if (!startShot || !endShot) {
    setStatus("시작 캡처와 종료 캡처를 모두 찍어야 합니다.");
    return;
  }
  const startExp = parseExpInput("startExpValue", "시작 현재 경험치");
  if (startExp.error) {
    setStatus(startExp.error);
    return;
  }
  const endExp = parseExpInput("endExpValue", "종료 현재 경험치");
  if (endExp.error) {
    setStatus(endExp.error);
    return;
  }
  const hourglass = getHourglassMultiplier();
  if (hourglass.error) {
    setStatus(hourglass.error);
    return;
  }
  const elapsedMinutes = getElapsedMinutes();
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes <= 0) {
    setStatus("측정 시간을 입력하거나, 시작/종료 캡처 사이에 시간이 지나야 합니다.");
    return;
  }

  const calculated = calculateGainedExp(startLevel, endLevel, startExp.value, endExp.value, hourglass);
  if (calculated.error) {
    setStatus(calculated.error);
    return;
  }

  const average = Number(calculated.gained) / elapsedMinutes;
  startRatioEl.textContent = formatBigInt(startExp.value);
  endRatioEl.textContent = formatBigInt(endExp.value);
  gainedEl.textContent = formatBigInt(calculated.gained);
  averageEl.textContent = `${formatNumber(average)} / 분`;
  elapsedEl.textContent = `${elapsedMinutes.toFixed(2)}분`;
  resultEl.innerHTML = `
    <div class="result-section">
      <div class="result-title">시작/종료 비교 결과</div>
      <div class="result-row"><span class="result-label">시작 현재 경험치</span><strong class="result-value">${formatBigInt(startExp.value)}</strong></div>
      <div class="result-row"><span class="result-label">종료 현재 경험치</span><strong class="result-value">${formatBigInt(endExp.value)}</strong></div>
      <div class="result-row"><span class="result-label">레벨업 계산 배율</span><strong class="result-value">LV ${hourglass.level} / ${hourglass.multiplier.toFixed(1)}배</strong></div>
      <div class="result-row"><span class="result-label">획득 경험치</span><strong class="result-value">${formatBigInt(calculated.gained)}</strong></div>
      <div class="summary-box">1분당 경험치: <strong>${formatNumber(average)}</strong></div>
    </div>
  `;
  setStatus("비교 계산 완료");
}

document.getElementById("captureBtn").addEventListener("click", () => startCapture().catch(error => setStatus(error.message)));
document.getElementById("measureBtn").addEventListener("click", startAutoMeasure);
document.getElementById("calcBtn").addEventListener("click", calculate);
document.getElementById("stopMeasureBtn").addEventListener("click", () => stopAutoMeasure(true));
document.getElementById("clearBtn").addEventListener("click", () => {
  roiTool.clearRoi();
  setStatus("영역을 지웠습니다.");
});
document.getElementById("elapsedMinutes").addEventListener("input", updateElapsedMetric);
document.getElementById("startExpValue").addEventListener("input", () => {
  startRatioEl.textContent = getFormattedInputExp("startExpValue") || "-";
});
document.getElementById("endExpValue").addEventListener("input", () => {
  endRatioEl.textContent = getFormattedInputExp("endExpValue") || "-";
});
for (const id of INPUT_IDS) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("input", saveInputState);
    el.addEventListener("change", saveInputState);
  }
}

window.addEventListener("beforeunload", () => stopDisplayCapture(stream));
