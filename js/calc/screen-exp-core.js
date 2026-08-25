export function formatNumber(value) {
  return Math.round(Number(value) || 0).toLocaleString("ko-KR");
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(3)}%`;
}

export async function startDisplayCapture(videoEl, frameRate = 8) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("이 브라우저는 화면 캡처를 지원하지 않습니다.");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate },
    audio: false
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

export function stopDisplayCapture(stream) {
  if (!stream) return;
  stream.getTracks().forEach(track => track.stop());
}

export function drawCroppedFrame(videoEl, canvasEl, cropTopRatio = 0.68) {
  const sourceWidth = videoEl.videoWidth;
  const sourceHeight = videoEl.videoHeight;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("캡처 화면이 아직 준비되지 않았습니다.");
  }

  const sourceY = Math.floor(sourceHeight * cropTopRatio);
  const sourceCropHeight = Math.max(1, sourceHeight - sourceY);
  canvasEl.width = sourceWidth;
  canvasEl.height = sourceCropHeight;

  const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(videoEl, 0, sourceY, sourceWidth, sourceCropHeight, 0, 0, sourceWidth, sourceCropHeight);
  return ctx;
}

export function copyCanvas(sourceCanvas, targetCanvas) {
  targetCanvas.width = sourceCanvas.width;
  targetCanvas.height = sourceCanvas.height;
  const ctx = targetCanvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);
}

export function copyRoiToCanvas(sourceCanvas, targetCanvas, roi, options = {}) {
  let normalized = normalizeRoi(roi, sourceCanvas.width, sourceCanvas.height);
  if (!normalized) return false;

  const padX = Math.max(0, Math.round(options.padX ?? 0));
  const padY = Math.max(0, Math.round(options.padY ?? 0));
  const minHeight = Math.max(0, Math.round(options.minHeight ?? 0));

  if (padX || padY || minHeight > normalized.height) {
    const extraHeight = Math.max(0, minHeight - normalized.height);
    const growTop = Math.floor(extraHeight / 2) + padY;
    const growBottom = Math.ceil(extraHeight / 2) + padY;
    const x = Math.max(0, normalized.x - padX);
    const y = Math.max(0, normalized.y - growTop);
    const right = Math.min(sourceCanvas.width, normalized.x + normalized.width + padX);
    const bottom = Math.min(sourceCanvas.height, normalized.y + normalized.height + growBottom);
    normalized = { x, y, width: right - x, height: bottom - y };
  }

  targetCanvas.width = normalized.width;
  targetCanvas.height = normalized.height;
  const ctx = targetCanvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(
    sourceCanvas,
    normalized.x,
    normalized.y,
    normalized.width,
    normalized.height,
    0,
    0,
    normalized.width,
    normalized.height
  );
  return true;
}

export function normalizeRoi(roi, maxWidth, maxHeight) {
  if (!roi) return null;
  const x = Math.max(0, Math.min(roi.x, maxWidth));
  const y = Math.max(0, Math.min(roi.y, maxHeight));
  const width = Math.max(0, Math.min(roi.width, maxWidth - x));
  const height = Math.max(0, Math.min(roi.height, maxHeight - y));
  if (width < 16 || height < 5) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

export function pointToCanvas(event, canvasEl) {
  const rect = canvasEl.getBoundingClientRect();
  const scaleX = canvasEl.width / rect.width;
  const scaleY = canvasEl.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

export function drawRoiBox(boxEl, canvasEl, roi) {
  const normalized = normalizeRoi(roi, canvasEl.width, canvasEl.height);
  if (!normalized || !canvasEl.width) {
    boxEl.classList.remove("show");
    return;
  }

  const rect = canvasEl.getBoundingClientRect();
  const scaleX = rect.width / canvasEl.width;
  const scaleY = rect.height / canvasEl.height;
  boxEl.style.left = `${normalized.x * scaleX}px`;
  boxEl.style.top = `${normalized.y * scaleY}px`;
  boxEl.style.width = `${normalized.width * scaleX}px`;
  boxEl.style.height = `${normalized.height * scaleY}px`;
  boxEl.classList.add("show");
}

export function createRoiInteraction(previewEl, canvasEl, boxEl, callbacks = {}) {
  let dragStart = null;
  let roiStart = null;
  let mode = "draw";
  let currentRoi = null;

  function setRoi(nextRoi) {
    currentRoi = normalizeRoi(nextRoi, canvasEl.width, canvasEl.height);
    drawRoiBox(boxEl, canvasEl, currentRoi);
    callbacks.onChange?.(currentRoi);
  }

  function getRoi() {
    return currentRoi;
  }

  function clearRoi() {
    currentRoi = null;
    drawRoiBox(boxEl, canvasEl, null);
    callbacks.onChange?.(null);
  }

  function isInside(point, roi) {
    return roi &&
      point.x >= roi.x &&
      point.x <= roi.x + roi.width &&
      point.y >= roi.y &&
      point.y <= roi.y + roi.height;
  }

  previewEl.addEventListener("pointerdown", event => {
    if (!canvasEl.width) return;
    const point = pointToCanvas(event, canvasEl);
    dragStart = point;
    roiStart = currentRoi ? { ...currentRoi } : null;
    mode = isInside(point, currentRoi) ? "move" : "draw";
    if (mode === "draw") {
      currentRoi = { x: point.x, y: point.y, width: 0, height: 0 };
      drawRoiBox(boxEl, canvasEl, currentRoi);
    }
    previewEl.setPointerCapture(event.pointerId);
  });

  previewEl.addEventListener("pointermove", event => {
    if (!dragStart) return;
    const point = pointToCanvas(event, canvasEl);
    if (mode === "move" && roiStart) {
      setRoi({
        x: roiStart.x + point.x - dragStart.x,
        y: roiStart.y + point.y - dragStart.y,
        width: roiStart.width,
        height: roiStart.height
      });
      return;
    }

    const x = Math.min(point.x, dragStart.x);
    const y = Math.min(point.y, dragStart.y);
    setRoi({
      x,
      y,
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y)
    });
  });

  previewEl.addEventListener("pointerup", event => {
    if (dragStart && previewEl.hasPointerCapture(event.pointerId)) {
      previewEl.releasePointerCapture(event.pointerId);
    }
    dragStart = null;
    roiStart = null;
    currentRoi = normalizeRoi(currentRoi, canvasEl.width, canvasEl.height);
    drawRoiBox(boxEl, canvasEl, currentRoi);
    callbacks.onCommit?.(currentRoi);
  });

  window.addEventListener("resize", () => drawRoiBox(boxEl, canvasEl, currentRoi));

  return { setRoi, getRoi, clearRoi, redraw: () => drawRoiBox(boxEl, canvasEl, currentRoi) };
}

export function detectClassicRatio(canvasEl, roi) {
  const normalized = normalizeRoi(roi, canvasEl.width, canvasEl.height);
  if (!normalized) return { error: "경험치 바 영역을 먼저 지정하세요." };

  const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(normalized.x, normalized.y, normalized.width, normalized.height);
  const columns = getColumnAverages(image.data, normalized.width, normalized.height);
  const sampleSize = Math.max(4, Math.floor(columns.length * 0.08));
  const filledSample = averageColors(columns.slice(0, sampleSize));
  const emptySample = averageColors(columns.slice(-sampleSize));

  let filledUntil = -1;
  let gap = 0;
  const maxGap = Math.max(5, Math.floor(columns.length * 0.045));
  for (let i = 0; i < columns.length; i++) {
    const color = columns[i];
    const filledDistance = colorDistance(color, filledSample);
    const emptyDistance = colorDistance(color, emptySample);
    if (filledDistance <= emptyDistance) {
      filledUntil = i;
      gap = 0;
    } else {
      gap++;
      if (filledUntil >= 0 && gap > maxGap) break;
    }
  }

  if (filledUntil < 0) return { error: "경험치 바 진행률을 감지하지 못했습니다." };
  return {
    ratio: clamp((filledUntil + 1) / columns.length, 0, 1),
    confidence: 0.65,
    method: "classic",
    roi: normalized
  };
}

export function detectSmartRatio(canvasEl, roi) {
  const normalized = normalizeRoi(roi, canvasEl.width, canvasEl.height);
  if (!normalized) return { error: "경험치 바 영역을 먼저 지정하세요." };

  const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(normalized.x, normalized.y, normalized.width, normalized.height);
  const { data, width, height } = image;
  const yStart = Math.floor(height * 0.14);
  const yEnd = Math.max(yStart + 1, Math.ceil(height * 0.86));
  const sampleHeight = yEnd - yStart;
  const columns = [];

  for (let x = 0; x < width; x++) {
    let green = 0;
    let track = 0;
    let edge = 0;
    let prevLum = null;
    for (let y = yStart; y < yEnd; y++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (isExpGreen(r, g, b)) green++;
      if (isExpGreen(r, g, b) || isExpTrack(r, g, b)) track++;
      const lum = getLuminance(r, g, b);
      if (prevLum !== null) edge += Math.abs(lum - prevLum);
      prevLum = lum;
    }
    columns.push({
      greenRatio: green / sampleHeight,
      trackRatio: track / sampleHeight,
      edgeScore: edge / sampleHeight
    });
  }

  const trackColumns = columns.map((column, index) => column.trackRatio > 0.16 ? index : -1).filter(index => index >= 0);
  if (trackColumns.length < Math.max(20, width * 0.25)) {
    return detectClassicRatio(canvasEl, normalized);
  }

  const left = Math.max(0, Math.min(...trackColumns) - 1);
  const right = Math.min(width - 1, Math.max(...trackColumns) + 1);
  const span = right - left + 1;
  const smoothed = [];
  const radius = Math.max(1, Math.floor(span * 0.012));
  for (let x = left; x <= right; x++) {
    let total = 0;
    let count = 0;
    for (let n = x - radius; n <= x + radius; n++) {
      if (n < left || n > right) continue;
      total += columns[n].greenRatio;
      count++;
    }
    smoothed.push(total / count);
  }

  const greenPeak = Math.max(...smoothed);
  if (greenPeak < 0.12) {
    return { error: "초록색 경험치 진행 영역을 충분히 찾지 못했습니다." };
  }

  const threshold = Math.max(0.08, greenPeak * 0.42);
  let filledUntil = -1;
  let holes = 0;
  const maxHoles = Math.max(3, Math.floor(span * 0.035));
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] >= threshold) {
      filledUntil = i;
      holes = 0;
    } else if (filledUntil >= 0) {
      holes++;
      if (holes > maxHoles) break;
    }
  }

  if (filledUntil < 0) return { error: "경험치 바 진행률을 감지하지 못했습니다." };

  const edgeScore = columns.slice(left, right + 1).reduce((sum, column) => sum + column.edgeScore, 0) / span;
  const trackCoverage = trackColumns.length / width;
  const confidence = clamp(0.45 + greenPeak * 0.35 + trackCoverage * 0.25 - Math.min(edgeScore / 260, 0.16), 0.25, 0.98);

  return {
    ratio: clamp((filledUntil + 1) / span, 0, 1),
    confidence,
    method: "smart",
    roi: normalized,
    debug: { greenPeak, trackCoverage, edgeScore }
  };
}

export async function captureRatioBatch(videoEl, previewCanvas, workCanvas, roi, detector, options = {}) {
  const count = options.count ?? 5;
  const delayMs = options.delayMs ?? 70;
  const cropTopRatio = options.cropTopRatio ?? 0.68;
  const ratios = [];
  const confidences = [];
  let lastError = "";

  for (let i = 0; i < count; i++) {
    drawCroppedFrame(videoEl, previewCanvas, cropTopRatio);
    copyCanvas(previewCanvas, workCanvas);
    const detected = detector(workCanvas, roi);
    if (detected.error) {
      lastError = detected.error;
    } else {
      ratios.push(detected.ratio);
      confidences.push(detected.confidence ?? 0.5);
    }
    if (i < count - 1) await delay(delayMs);
  }

  if (ratios.length < Math.ceil(count * 0.6)) {
    return { error: lastError || "진행률을 안정적으로 계산하지 못했습니다." };
  }

  const ratio = median(ratios);
  const spread = Math.max(...ratios) - Math.min(...ratios);
  const confidence = median(confidences) * clamp(1 - spread * 8, 0.35, 1);
  return { ratio, spread, confidence, samples: ratios.length };
}

export function autoDetectExpRoi(canvasEl) {
  if (!canvasEl.width || !canvasEl.height) {
    return { error: "화면 선택 후 자동 찾기를 눌러 주세요." };
  }

  const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvasEl;
  const image = ctx.getImageData(0, 0, width, height).data;
  const rowScores = [];

  for (let y = 0; y < height; y++) {
    let score = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = image[idx];
      const g = image[idx + 1];
      const b = image[idx + 2];
      if (isExpGreen(r, g, b)) score += 2;
      else if (isExpTrack(r, g, b)) score += 1;
    }
    rowScores.push(score);
  }

  const rowThreshold = Math.max(8, width * 0.025);
  const rowRuns = getRuns(rowScores.map((score, index) => score >= rowThreshold ? index : -1).filter(index => index >= 0));
  if (!rowRuns.length) return { error: "경험치 바를 자동으로 찾지 못했습니다." };

  const bestRun = rowRuns
    .map(run => ({ ...run, score: sumRange(rowScores, run.start, run.end) }))
    .sort((a, b) => b.score - a.score)[0];
  const yPadding = Math.max(2, Math.round((bestRun.end - bestRun.start + 1) * 0.35));
  const yStart = Math.max(0, bestRun.start - yPadding);
  const yEnd = Math.min(height - 1, bestRun.end + yPadding);
  const colScores = [];

  for (let x = 0; x < width; x++) {
    let score = 0;
    for (let y = yStart; y <= yEnd; y++) {
      const idx = (y * width + x) * 4;
      const r = image[idx];
      const g = image[idx + 1];
      const b = image[idx + 2];
      if (isExpGreen(r, g, b)) score += 2;
      else if (isExpTrack(r, g, b)) score += 1;
    }
    colScores.push(score);
  }

  const colThreshold = Math.max(2, (yEnd - yStart + 1) * 0.16);
  const colRuns = getRuns(colScores.map((score, index) => score >= colThreshold ? index : -1).filter(index => index >= 0));
  if (!colRuns.length) return { error: "경험치 바의 가로 영역을 찾지 못했습니다." };

  const bestCol = colRuns
    .filter(run => run.end - run.start + 1 >= width * 0.12)
    .map(run => ({ ...run, score: sumRange(colScores, run.start, run.end) }))
    .sort((a, b) => b.score - a.score)[0] || colRuns.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];

  return {
    roi: normalizeRoi({
      x: Math.max(0, bestCol.start - 3),
      y: yStart,
      width: Math.min(width - bestCol.start, bestCol.end - bestCol.start + 7),
      height: yEnd - yStart + 1
    }, width, height)
  };
}

function getColumnAverages(data, width, height) {
  const columns = [];
  const yStart = Math.floor(height * 0.12);
  const yEnd = Math.max(yStart + 1, Math.ceil(height * 0.88));
  const sampleHeight = yEnd - yStart;
  for (let x = 0; x < width; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = yStart; y < yEnd; y++) {
      const idx = (y * width + x) * 4;
      r += data[idx];
      g += data[idx + 1];
      b += data[idx + 2];
    }
    columns.push({ r: r / sampleHeight, g: g / sampleHeight, b: b / sampleHeight });
  }
  return columns;
}

function averageColors(colors) {
  const total = colors.reduce((acc, color) => {
    acc.r += color.r;
    acc.g += color.g;
    acc.b += color.b;
    return acc;
  }, { r: 0, g: 0, b: 0 });
  return { r: total.r / colors.length, g: total.g / colors.length, b: total.b / colors.length };
}

function colorDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function isExpGreen(r, g, b) {
  const hsv = rgbToHsv(r, g, b);
  return hsv.h >= 72 && hsv.h <= 160 && hsv.s >= 0.24 && hsv.v >= 0.22 && g > r * 1.08 && g > b * 1.04;
}

function isExpTrack(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lum = getLuminance(r, g, b);
  return lum >= 38 && lum <= 178 && max - min <= 42;
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function getLuminance(r, g, b) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function getRuns(indices) {
  if (!indices.length) return [];
  const runs = [];
  let start = indices[0];
  let end = indices[0];
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === end + 1) {
      end = indices[i];
    } else {
      runs.push({ start, end });
      start = indices[i];
      end = indices[i];
    }
  }
  runs.push({ start, end });
  return runs;
}

function sumRange(values, start, end) {
  let total = 0;
  for (let i = start; i <= end; i++) total += values[i] || 0;
  return total;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
