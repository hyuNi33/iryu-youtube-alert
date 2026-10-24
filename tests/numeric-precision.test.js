const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = process.env.NUMERIC_TEST_ROOT || path.join(__dirname, '..');
function moduleContext(file) {
  const context = vm.createContext({
    fetch: async url => ({ ok: true, text: async () => fs.readFileSync(url, 'utf8') })
  });
  const source = ['js/csv-loader.js', file].map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '')).join('\n');
  vm.runInContext(source, context);
  return { run: code => vm.runInContext(code, context), context };
}
test('RP totals and final level cost stay exact above 10^21', async () => {
  const m = moduleContext('js/calc/rpskill.js');
  await m.run(`initRPSkillData(${JSON.stringify(ROOT.replace(/\\/g, '/'))})`);
  assert.equal(m.run(`calcSkillRP('table37',0,30,30)`), 1996540000000000000000n);
  assert.equal(m.run(`calcSkillRP('table37',29,30,30)`), 275000000000000000000n);
  assert.equal(m.run(`calcSkillRP('table37',30,0,30)`), 0n);
  assert.equal(m.run(`calcSkillCurrentRP('missing',5,30)`), 0n);
});
test('artifact distribution conserves stones, respects caps and accepts large exact input', async () => {
  const m = moduleContext('js/calc/artifact.js');
  await m.run(`initArtifactData(${JSON.stringify(ROOT.replace(/\\/g, '/'))})`);
  for (const amount of ['0','1','57','10000','9007199254740993','10000000000000000000001']) {
    m.context.amount = amount;
    const result = m.run(`distributeArtifactStones(amount, getArtifactKeys())`);
    assert.equal(result.usedStone + result.remainingStone, BigInt(amount));
    assert.ok(result.remainingStone >= 0n);
    for (const row of result.rows) {
      assert.equal(row.usedStone + row.remainStone, row.allocatedStone);
      assert.ok(row.reachedLevel >= 0);
    }
  }
  assert.throws(() => m.run(`distributeArtifactStones('1.5',getArtifactKeys())`));
  const result = m.run(`recommendArtifactUpgrades('9007199254740993',Object.fromEntries(getArtifactKeys().map(id=>[id,1])))`);
  assert.equal(result.steps.reduce((sum, step) => sum + step.cost, 0n) + result.remainingStone, 9007199254740993n);
  // Exercise otherwise unused donor rebalancing with BigInt arithmetic.
  assert.equal(m.run(`(()=>{const rows=[{allocated:5n},{allocated:8n}];return pullEvenlyFromDonors(rows,7n)&&rows[0].allocated+rows[1].allocated===6n})()`), true);
});
test('table comparison distinguishes adjacent large values, decimals, signs and Korean units', () => {
  const m = moduleContext('js/table-number.js');
  for (const [a,b,expected] of [
    ['9007199254740992','9007199254740993',-1],
    ['-9007199254740993','-9007199254740992',-1],
    ['9007199254740993.01','9007199254740993.02',-1],
    ['1.99654e21','1996540000000000000000',0],
    ['19해 9654경','1996540000000000000000',0],
    ['1.1','1.09',1],['name','1',null]
  ]) {
    m.context.a=a;m.context.b=b;
    assert.equal(m.run('compareNumericValues(a,b)'),expected);
  }
  assert.equal(m.run(`compactNumber(integerDigits('1.99654e21'))`),'19해 9654경');
});
test('fractional cycle durations keep integer experience arithmetic', async () => {
  const m = moduleContext('js/calc/exp.js');
  await m.run(`initExpData(${JSON.stringify(ROOT.replace(/\\/g, '/'))})`);
  const result=m.run(`calculateCycleLevel('9007199254740993',0,'1',1,1.5)`);
  assert.equal(result.totalHuntingExp,9007199254740993n*90n);
});
test('monster ordering preserves transcend levels and adjacent huge HP values', () => {
  const m=moduleContext('js/table-number.js');
  const html=fs.readFileSync(path.join(ROOT,'pages/tables/monster.html'),'utf8');
  vm.runInContext(`function compact(value){return String(value).replace(/\\s/g,'')}\nfunction normalize(value){return String(value)}\n`+
    html.slice(html.indexOf('  function parseUnitValue'),html.indexOf('  function getHeaderTitle')),m.context);
  assert.equal(m.run(`compareUnitValues('1초월','2초월')`),-1);
  assert.equal(m.run(`compareUnitValues('9007199254740992','9007199254740993')`),-1);
  assert.equal(m.run(`formatKoreanUnit('1996540000000000000000')`),'19해 9654경');
});
test('shared measurement formatting preserves BigInt and integer strings', () => {
  const m=moduleContext('js/calc/screen-exp-core.js');
  assert.equal(m.run(`formatNumber(9007199254740993n)`),'9,007,199,254,740,993');
  assert.equal(m.run(`formatNumber('9007199254740993')`),'9,007,199,254,740,993');
});
test('CSV extraction expands scientific notation without floating point', () => {
  const {integerText}=require(path.join(ROOT,'scripts/csv-utils.js'));
  assert.equal(integerText('1.99654e21'),'1996540000000000000000');
  assert.equal(integerText('9,007,199,254,740,993'),'9007199254740993');
  assert.equal(integerText('1.1'),null);
  assert.equal(integerText('100e-2'),'1');
});
