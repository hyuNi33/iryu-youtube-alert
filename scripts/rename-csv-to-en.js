/**
 * 한글 CSV 파일명 → 영문으로 일괄 변환
 * meta.csv도 함께 업데이트
 */
const fs = require("fs");
const path = require("path");
const { readCsvText, writeCsvFile } = require("./csv-utils");

const DATAS = path.join(__dirname, "..", "datas");

// 한글 → 영문 매핑
const NAME_MAP = {
  // SP 스킬
  "파워스트라이크": "power-strike",
  "슬래시_블러스트": "slash-blast",
  "드래곤버스터": "dragon-buster",
  "드래곤_로어": "dragon-roar",
  "브랜디쉬": "brandish",
  "무기마스터리": "weapon-mastery",
  "크리티컬샷": "critical-shot",
  "분노": "rage",
  "홀리심볼": "holy-symbol",
  "메소업": "meso-up",
  "피지컬_트레이닝": "physical-training",
  "블레스": "bless",
  "메디테이션": "meditation",
  "드래곤_블러드": "dragon-blood",
  "콤보_어택": "combo-attack",
  "크리티컬_스로우": "critical-throw",
  "엘리멘트_엠플리피케이션": "element-amplification",
  "비홀더스버프": "beholder-buff",

  // 이세계 스킬
  "매직클로": "magic-claw",
  "아이언_애로우": "iron-arrow",
  "썬더볼트": "thunderbolt",
  "피어싱": "piercing",
  "생츄어리": "sanctuary",
  "스크류펀치": "screw-punch",
  "아이스데몬": "ice-demon",
  "제네시스": "genesis",

  // RP 스킬 성능
  "부스트": "boost",
  "경험치_RP_(1~200)": "exp-rp",
  "강화_확률_증가": "enhance-chance",
  "SP_증가량": "sp-increase",
  "장비_제한_레벨_감소": "equip-level-reduce",
  "샤프": "sharp",
  "버서크": "berserk",
  "쉐도우_파트너": "shadow-partner",
  "환포증가": "hanpo-increase",
  "비홀더버프": "beholder-buff",
  "타겟": "target",
  "강횟": "enhance-count",
  "매용": "melee",
  "원거리마스터리": "ranged-mastery",
  "어드밴스드_콤보": "advanced-combo",
  "파이널어택": "final-attack",
  "너클마스터리": "knuckle-mastery",
  "크리티컬_리인포스": "critical-reinforce",
  "오브_마스터리": "orb-mastery",
  "아드레날린": "adrenaline",

  // 유물 정보
  "세가지_보석": "three-gems",
  "전설의_뿔피리": "legend-horn",
  "황금_인장_반지": "golden-seal-ring",
  "화염_부적": "flame-talisman",
  "아누비스의_가면": "anubis-mask",
  "잊혀진_기억_로켓": "memory-rocket",
  "요정의_목걸이": "fairy-necklace",
  "결의의_증표": "token-of-resolve",
  "고룡의_비늘": "dragon-scale",
  "어둠에_물든_구슬": "dark-orb",
  "시간의_모래시계": "hourglass",
};

const DIRS = ["sp-skill", "isekai-perf", "rpskill-perf", "artifact-info"];

for (const dir of DIRS) {
  const dirPath = path.join(DATAS, dir);
  if (!fs.existsSync(dirPath)) continue;

  const files = fs.readdirSync(dirPath).filter(f => f !== "meta.csv" && f.endsWith(".csv"));
  const renames = [];

  for (const file of files) {
    const baseName = file.replace(".csv", "");
    const enName = NAME_MAP[baseName];

    if (!enName) {
      console.log(`  [매핑없음] ${dir}/${file}`);
      continue;
    }

    const oldPath = path.join(dirPath, file);
    const newFile = enName + ".csv";
    const newPath = path.join(dirPath, newFile);

    fs.renameSync(oldPath, newPath);
    renames.push({ oldFile: file, newFile, name: baseName });
  }

  // meta.csv 업데이트
  const metaPath = path.join(dirPath, "meta.csv");
  if (fs.existsSync(metaPath)) {
    let metaContent = readCsvText(metaPath);
    for (const r of renames) {
      metaContent = metaContent.replace(r.oldFile, r.newFile);
    }
    writeCsvFile(metaPath, metaContent);
  }

  console.log(`[${dir}] ${renames.length}개 파일 영문 변환`);
}

console.log("\n완료!");
