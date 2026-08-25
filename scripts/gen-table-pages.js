/**
 * 테이블 디스플레이 페이지 일괄 생성
 */
const fs = require("fs");
const path = require("path");

const TABLES_DIR = path.join(__dirname, "..", "pages", "tables");

const PAGES = [
  { file: "hanpo.html", title: "환포표", csv: "hanpo-table.csv" },
  { file: "trait.html", title: "특성", csv: "trait.csv" },
  { file: "sp-skill.html", title: "SP 스킬", csv: "sp-skill.csv" },
  { file: "artifact-info.html", title: "유물", csv: "artifact-info.csv" },
  { file: "monster-stat.html", title: "몬스터체경비", csv: "monster-stat.csv" },
  { file: "tombstone.html", title: "비석지키기", csv: "tombstone.csv" },
  { file: "rpskill-data.html", title: "RP 스킬 데이터", csv: "rpskill-raw.csv" },
  { file: "rpskill-perf.html", title: "RP 스킬 성능", csv: "rpskill-perf.csv" },
  { file: "isekai-skill.html", title: "이세계스킬", csv: "isekai-skill.csv" },
  { file: "isekai-perf.html", title: "이세계스킬 성능", csv: "isekai-perf.csv" },
  { file: "transcend.html", title: "초월정보", csv: "transcend.csv" },
  { file: "crit-formula.html", title: "크뎀계산식", csv: "crit-formula.csv" },
  { file: "tips.html", title: "잡팁", csv: "tips.csv" },
  { file: "rpskill-order.html", title: "RP스킬 투자순서", csv: "rpskill-order.csv" },
];

function template(title, csvPath) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - 이류월드</title>
  <link rel="stylesheet" href="../../css/style.css">
  <script src="../../js/common.js"></script>
  <link rel="icon" href="../../assets/mainImg.png">
</head>
<body>
<div class="wrapper">
  <div class="container">

    <aside class="sidebar"></aside>

    <main class="content">
      <div class="top-banner">
        <h1>${title}</h1>
        <p>${title} 데이터 테이블</p>
      </div>

      <div class="card">
        <div id="tableContainer">데이터 로딩 중...</div>
      </div>
    </main>

  </div>
</div>

<script type="module">
  import { renderTable } from "../../js/table-viewer.js";
  renderTable("../../datas/${csvPath}", "tableContainer");
</script>
</body>
</html>
`;
}

fs.mkdirSync(TABLES_DIR, { recursive: true });

for (const page of PAGES) {
  const filePath = path.join(TABLES_DIR, page.file);
  fs.writeFileSync(filePath, template(page.title, page.csv), "utf-8");
  console.log(`생성: ${page.file}`);
}

console.log(`\n${PAGES.length}개 테이블 페이지 생성 완료!`);
