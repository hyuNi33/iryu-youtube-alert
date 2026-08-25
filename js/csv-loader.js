/**
 * csv-loader.js
 * CSV 파일을 fetch하여 객체 배열로 반환
 */

export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");

  const lines = text
    .split(/\r?\n/)
    .filter(line => line.trim() !== "");

  if (lines.length < 2) return [];

  const headers = parseLine(lines[0]).map(h => h.trim().replace(/^\uFEFF/, ""));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);

    if (values.every(v => String(v).trim() === "")) continue;

    const obj = {};

    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = values[j] !== undefined ? String(values[j]).trim() : "";
    }

    rows.push(obj);
  }

  return rows;
}

function parseLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }

  result.push(current);
  return result;
}

export async function loadCSV(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`CSV 로딩 실패: ${url} (${res.status})`);
  }

  const text = await res.text();
  return parseCSV(text);
}
