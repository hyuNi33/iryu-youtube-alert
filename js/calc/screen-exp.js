/**
 * 화면 캡처 기반 경험치 바 측정 유틸 (beta)
 */

export async function startCapture(videoEl) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    throw new Error("이 브라우저는 화면 캡처를 지원하지 않습니다.");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 5 },
    audio: false
  });

  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

export function stopCapture(stream) {
  if (!stream) return;
  stream.getTracks().forEach(track => track.stop());
}

export function drawFrameToCanvas(videoEl, canvasEl) {
  const width = videoEl.videoWidth;
  const height = videoEl.videoHeight;

  if (!width || !height) {
    throw new Error("캡처 화면이 아직 준비되지 않았습니다.");
  }

  canvasEl.width = width;
  canvasEl.height = height;

  const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(videoEl, 0, 0, width, height);
  return ctx;
}

export function detectExpRatio(canvasEl, roi) {
  const normalized = normalizeRoi(roi, canvasEl.width, canvasEl.height);
  if (!normalized) {
    return { error: "경험치 바 영역을 먼저 지정하세요." };
  }

  const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(normalized.x, normalized.y, normalized.width, normalized.height);
  const columns = getColumnAverages(image.data, normalized.width, normalized.height);
  const sampleSize = Math.max(3, Math.floor(columns.length * 0.08));
  const filledSample = averageColors(columns.slice(0, sampleSize));
  const emptySample = averageColors(columns.slice(-sampleSize));

  let filledUntil = -1;
  let gap = 0;
  const maxGap = Math.max(6, Math.floor(columns.length * 0.05));

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

  if (filledUntil < 0) {
    return { error: "경험치 바 진행률을 감지하지 못했습니다." };
  }

  const ratio = clamp((filledUntil + 1) / columns.length, 0, 1);
  return { ratio, roi: normalized };
}

export function captureExpRatio(videoEl, roi, canvasEl) {
  const normalized = normalizeRoi(roi, videoEl.videoWidth, videoEl.videoHeight);
  if (!normalized) {
    return { error: "경험치 바 영역을 먼저 지정하세요." };
  }

  const maxWidth = 360;
  const scale = Math.min(1, maxWidth / normalized.width);
  const width = Math.max(10, Math.round(normalized.width * scale));
  const height = Math.max(4, Math.round(normalized.height * scale));

  canvasEl.width = width;
  canvasEl.height = height;

  const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(
    videoEl,
    normalized.x,
    normalized.y,
    normalized.width,
    normalized.height,
    0,
    0,
    width,
    height
  );

  const detected = detectExpRatio(canvasEl, { x: 0, y: 0, width, height });
  if (detected.error) return detected;

  return { ...detected, roi: normalized };
}

export function calculateExpPerMinute(expNeed, startRatio, endRatio, elapsedSeconds) {
  expNeed = Number(expNeed);
  startRatio = Number(startRatio);
  endRatio = Number(endRatio);
  elapsedSeconds = Number(elapsedSeconds);

  if (!Number.isFinite(expNeed) || expNeed <= 0) {
    return { error: "레벨 경험치 데이터가 올바르지 않습니다." };
  }
  if (!Number.isFinite(startRatio) || !Number.isFinite(endRatio)) {
    return { error: "경험치 바 진행률을 계산하지 못했습니다." };
  }
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return { error: "측정 시간이 올바르지 않습니다." };
  }

  const deltaRatio = endRatio - startRatio;
  if (deltaRatio <= 0) {
    return { error: "경험치 바가 증가하지 않았습니다. 레벨업, 영역 오류, 색상 감지 실패 가능성이 있습니다." };
  }

  const gainedExp = expNeed * deltaRatio;
  return {
    deltaRatio,
    gainedExp,
    expPerMinute: gainedExp / elapsedSeconds * 60
  };
}

function normalizeRoi(roi, maxWidth, maxHeight) {
  if (!roi) return null;

  const x = Math.max(0, Math.min(roi.x, maxWidth));
  const y = Math.max(0, Math.min(roi.y, maxHeight));
  const width = Math.max(0, Math.min(roi.width, maxWidth - x));
  const height = Math.max(0, Math.min(roi.height, maxHeight - y));

  if (width < 10 || height < 4) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
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

  return {
    r: total.r / colors.length,
    g: total.g / colors.length,
    b: total.b / colors.length
  };
}

function colorDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
