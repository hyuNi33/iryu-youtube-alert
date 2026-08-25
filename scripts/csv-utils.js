const fs = require("fs");

const UTF8_BOM = "\uFEFF";

function stripBom(text) {
  return text.replace(/^\uFEFF/, "");
}

function addBom(text) {
  return text.startsWith(UTF8_BOM) ? text : UTF8_BOM + text;
}

function readCsvText(filePath) {
  return stripBom(fs.readFileSync(filePath, "utf-8"));
}

function writeCsvFile(filePath, text) {
  fs.writeFileSync(filePath, addBom(text), "utf-8");
}

module.exports = {
  addBom,
  readCsvText,
  stripBom,
  writeCsvFile,
};
