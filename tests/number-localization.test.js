const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.NUMERIC_TEST_ROOT||path.join(__dirname,'..');
function setup(language='ko') {
 const element={nodeType:1,tagName:'SPAN',closest(){return null},getAttribute(){return null},hasAttribute(){return true}};
 const text={nodeType:3,nodeValue:'19해 9654경',parentElement:element};
 const detail={nodeType:3,nodeValue:'1,996,540,000,000,000,000,000',parentElement:element};
 const document={readyState:'loading',documentElement:element,addEventListener(){},dispatchEvent(){},querySelectorAll(){return []},getElementById(){return null},
   createTreeWalker(){let i=0;return {nextNode(){return [text,detail][i++]||null}}}};
 const window={addEventListener(){},alert(){},confirm(){},prompt(){}};
 const ctx=vm.createContext({window,document,localStorage:{getItem(){return language},setItem(){}},Node:{TEXT_NODE:3,ELEMENT_NODE:1,DOCUMENT_NODE:9},NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4},CustomEvent:function(){},location:{origin:'https://example.test'}});
 vm.runInContext(fs.readFileSync(path.join(root,'js/i18n.js'),'utf8'),ctx);
 return {api:window.iryuI18n,text,detail};
}
test('English compact notation uses exact integer scaling and handles large suffixes',()=>{
 const {api}=setup('en');
 for(const [source,expected] of [
  ['1만','10K'],['100만','1M'],['1억','100M'],['10억','1B'],['1조','1T'],
  ['19해 9654경','1.997Sx'],['1조 2345억','1.235T'],['9999억 9999만','1T'],
  ['1항하사','10Sxd'],['1무량대수','1e+68'],['1억 5000만 / 분','150M / minute']
 ]) assert.equal(api.translate(source),expected,source);
 assert.equal(api.translate('1,996,540,000,000,000,000,000'),'1,996,540,000,000,000,000,000');
});
test('Traditional Chinese preserves groups of 10,000 and translates all large units',()=>{
 const {api}=setup('zh-TW');
 assert.equal(api.translate('1억'),'1億');
 assert.equal(api.translate('19해 9654경'),'19垓 9654京');
 assert.equal(api.translate('1무량대수'),'1無量大數');
});
test('language switching restores source values and leaves full-number details intact',()=>{
 const {api,text,detail}=setup();
 for(const [language,expected] of [['en','1.997Sx'],['zh-TW','19垓 9654京'],['ko','19해 9654경'],['en','1.997Sx']]) {
  api.setLanguage(language);
  assert.equal(text.nodeValue,expected);
  assert.equal(detail.nodeValue,'1,996,540,000,000,000,000,000');
 }
 text.nodeValue='2억';
 api.setLanguage('en');
 assert.equal(text.nodeValue,'200M');
 api.setLanguage('ko');
 assert.equal(text.nodeValue,'2억');
});
