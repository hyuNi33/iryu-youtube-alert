(() => {
 'use strict';
 const E=window.IryuRP,$=id=>document.getElementById(id),KEY='iryu-rp-calculator-v2';
 const defaults={daily:'2,364,606,387,153,462,989,610',dailyUnit:'RP',initial:'1,686,164,325,465,481,286,674',initialUnit:'RP',period:30,ascensionStage:"2",includeResonance:false,resonanceLevel:0,spendAllOnLastDay:false,incomeChanges:[],start:E.todayInZone(E.timeZoneFor(window.iryuI18n?.getLanguage()||localStorageLanguage())),asc:''};
 let state={config:{...defaults},day:1,changed:true,done:{}};
 try{const s=JSON.parse(localStorage.getItem(KEY));if(s&&typeof s==='object'){state.config={...defaults,...s.config};state.day=Number.isInteger(s.day)?s.day:1;state.changed=s.changed!==false;state.done=s.done&&typeof s.done==='object'?s.done:{};}}catch{}
 const DRAFT_KEY='iryu_rp_calculator_draft_v1';
 let formDraft=null,draftStorageError=false;
 try{const saved=JSON.parse(localStorage.getItem(DRAFT_KEY));if(saved&&typeof saved==='object'&&!Array.isArray(saved)){formDraft={};for(const field of ['daily','dailyUnit','initial','initialUnit','period','start','asc','ascensionStage','resonanceLevel'])if(typeof saved[field]==='string')formDraft[field]=saved[field];if(typeof saved.includeResonance==='boolean')formDraft.includeResonance=saved.includeResonance;if(typeof saved.spendAllOnLastDay==='boolean')formDraft.spendAllOnLastDay=saved.spendAllOnLastDay;if(Array.isArray(saved.incomeChanges))formDraft.incomeChanges=saved.incomeChanges.slice(0,100).map(x=>({date:typeof x?.date==='string'?x.date:'',amount:typeof x?.amount==='string'?x.amount:'',unit:['RP','경','해'].includes(x?.unit)?x.unit:'RP'}));}}catch{}
 let incomeDraft=Array.isArray(formDraft?.incomeChanges)?formDraft.incomeChanges.map(x=>({...x})):Array.isArray(state.config.incomeChanges)?state.config.incomeChanges.map(x=>({...x})):[];
 let resonanceTable=[],resonanceStatus='loading';
 let selectedLanguage=null,noticeKey='',calculationError=null;
 const locale=()=>selectedLanguage||window.iryuI18n?.getLanguage()||localStorageLanguage();
 const timeZone=()=>E.timeZoneFor(locale());
 const today=()=>E.todayInZone(timeZone());
 function localStorageLanguage(){try{const s=localStorage.getItem('iryu_language');return ['ko','en','zh-TW'].includes(s)?s:'ko';}catch{return 'ko';}}
 function t(key,vars={}){const lang=locale(),template=lang==='ko'?key:(window.IryuRPLocales[lang]?.[key]||key);return template.replace(/\{(\w+)\}/g,(m,k)=>Object.prototype.hasOwnProperty.call(vars,k)?String(vars[k]):m);}
 function money(n){
  if(locale()==='en')return Number(n).toExponential(5)+' RP';
  const h=n/10n**20n,k=n% (10n**20n)/10n**16n;
  if(h)return h.toLocaleString()+(locale()==='zh-TW'?'垓 ':'해 ')+k.toLocaleString()+(locale()==='zh-TW'?'京':'경');
  if(k)return (n/10n**16n).toLocaleString()+(locale()==='zh-TW'?'京':'경');
  return n.toLocaleString()+' RP';
 }
 const records=new WeakMap(),attributeRecords=new WeakMap();
 function translateStatic(){
  const walker=document.createTreeWalker(document.querySelector('.rp'),NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){
   if(node.parentElement.closest('script,style,textarea,option[value="RP"]'))continue;
   const old=records.get(node),source=old&&node.nodeValue===old.last?old.source:node.nodeValue;
   const trim=source.trim();if(!trim)continue;
   const next=source.replace(trim,t(trim));records.set(node,{source,last:next});if(node.nodeValue!==next)node.nodeValue=next;
  }
  document.querySelectorAll('.rp [aria-label],.rp [title]').forEach(el=>{
   for(const key of ['aria-label','title']){const value=el.getAttribute(key);if(value===null)continue;let map=attributeRecords.get(el);if(!map){map={};attributeRecords.set(el,map);}const old=map[key],source=old&&value===old.last?old.source:value,next=t(source);map[key]={source,last:next};if(value!==next)el.setAttribute(key,next);}
  });
  document.title=t('승천2 이후 RP 투자 계산기')+' · Iryu World';
 }
 function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{$('status').textContent=t('이 브라우저에서는 완료 상태를 저장할 수 없습니다.');}}
 function errorText(error){const messages={'duplicate-income-date':'같은 날짜의 획득량 변경이 중복되어 있습니다. 날짜마다 하나만 남겨주세요.','invalid-income-history':'획득량 변경일과 금액을 모두 올바르게 입력하세요. 최대 100개까지 추가할 수 있습니다.','completed-over-budget':'완료한 강화 비용이 변경된 획득량 예산보다 큽니다. 획득량 이력과 남은 RP를 확인하세요.','invalid-completed':'저장된 완료 기록을 확인해주세요.','resonance-data':'공명 CSV 데이터를 불러올 수 없습니다. 새로고침하거나 공명 강화 옵션을 해제하세요.','invalid-resonance-level':'현재 공명 레벨은 0~30의 정수로 입력하세요.','invalid-ascension':'승천 단계를 선택하세요.','invalid-rp':'금액은 0 이상의 숫자로 입력하세요. 쉼표 또는 소수점은 선택한 단위에 맞게 사용할 수 있습니다.','invalid-unit':'금액은 0 이상의 숫자로 입력하세요. 쉼표 또는 소수점은 선택한 단위에 맞게 사용할 수 있습니다.',precision:'RP 단위는 정수만, 경은 소수 16자리까지, 해는 소수 20자리까지 입력할 수 있습니다.','too-large':'금액이 너무 큽니다. RP 기준 60자리 이하로 입력하세요.','invalid-period':'1~3,650일을 입력하세요.','invalid-date':'유효한 날짜를 입력하세요.','future-date':'승천일은 오늘보다 미래일 수 없습니다.'};return t(messages[error.message]||'유효한 날짜를 입력하세요.');}
 function readConfig(){
  const config={daily:$('daily-input').value.trim(),dailyUnit:$('daily-unit').value,initial:$('initial-input').value.trim(),initialUnit:$('initial-unit').value,period:Number($('period-input').value),start:$('start-date').value,asc:$('asc-date').value,ascensionStage:$('ascension-stage').value,includeResonance:$('ascension-stage').value==='2'&&$('include-resonance').checked,resonanceLevel:$('resonance-level').value===''?NaN:Number($('resonance-level').value),spendAllOnLastDay:$('spend-all-last-day').checked,incomeChanges:incomeDraft.map(x=>({...x}))};
  E.dateNumber(config.start);return config;
 }
 function captureDraft(){return {daily:$('daily-input').value,dailyUnit:$('daily-unit').value,initial:$('initial-input').value,initialUnit:$('initial-unit').value,period:$('period-input').value,start:$('start-date').value,asc:$('asc-date').value,ascensionStage:$('ascension-stage').value,includeResonance:$('ascension-stage').value==='2'&&$('include-resonance').checked,resonanceLevel:$('resonance-level').value,spendAllOnLastDay:$('spend-all-last-day').checked,incomeChanges:incomeDraft.map(x=>({...x}))};}
 function draftDiffers(){if(!formDraft)return false;const raw={...state.config,...formDraft};return ['daily','dailyUnit','initial','initialUnit','period','start','asc','ascensionStage','resonanceLevel'].some(k=>String(raw[k]??'').trim()!==String(state.config[k]??'').trim())||Boolean(raw.includeResonance)!==Boolean(state.config.includeResonance)||Boolean(raw.spendAllOnLastDay)!==Boolean(state.config.spendAllOnLastDay)||JSON.stringify(raw.incomeChanges||[])!==JSON.stringify(state.config.incomeChanges||[]);}
 function renderDraftNote(){$('draft-note').textContent=draftStorageError?t('이 브라우저에서는 입력값을 저장할 수 없습니다.'):draftDiffers()?t('입력값은 자동 저장되었습니다. 변경 내용을 목표에 적용하려면 목표 계산하기를 눌러주세요.'):t('입력값이 자동 저장됩니다. 다른 페이지를 다녀와도 이 브라우저에서 복원됩니다.');}
 function saveDraft(){formDraft=captureDraft();try{localStorage.setItem(DRAFT_KEY,JSON.stringify(formDraft));draftStorageError=false;}catch{draftStorageError=true;}renderDraftNote();}
 function schedule(config){return (config.incomeChanges||[]).map(x=>({day:E.dateNumber(x.date)-E.dateNumber(config.start)+1,daily:E.parseRP(x.amount,x.unit)}));}
 function completionLocks(){return Object.entries(state.done).filter(([,level])=>Number.isInteger(level)&&level>0).map(([key,level])=>{const [day,skill]=key.split(':').map(Number);return {day,skill,level};});}
 function calculate(config,completed=[]){return E.buildPlan({initial:E.parseRP(config.initial,config.initialUnit),daily:E.parseRP(config.daily,config.dailyUnit),period:config.period,incomeChanges:schedule(config),completed:completed.filter(x=>x.skill<E.SKILLS.length||(config.ascensionStage==='2'&&config.includeResonance===true&&x.level>=Number(config.resonanceLevel))),ascensionStage:config.ascensionStage||'2',includeResonance:config.includeResonance===true,resonanceLevel:Number(config.resonanceLevel),resonanceTable,spendAllOnLastDay:config.spendAllOnLastDay===true});}
 let plan;try{plan=calculate(state.config,completionLocks());E.dateNumber(state.config.start);}catch(error){if(error.message==='resonance-data'){plan=calculate({...state.config,includeResonance:false},completionLocks());calculationError=error;}else if(error.message==='completed-over-budget'){plan=calculate(state.config);calculationError=error;}else{state={config:{...defaults},day:1,changed:true,done:{}};plan=calculate(state.config);}}
 for(const [id,value]of Object.entries(state.done)){if(value===true){const [day,i]=id.split(':').map(Number);if(plan.levels[i]?.[day])state.done[id]=plan.levels[i][day];else delete state.done[id];}else if(!Number.isInteger(value)||value<=0)delete state.done[id];}
 state.day=Math.max(1,Math.min(plan.period,state.day));
 function populate(){const c={...state.config,...formDraft};incomeDraft=(c.incomeChanges||[]).map(x=>({...x}));renderIncomeHistory();$('daily-input').value=c.daily;$('daily-unit').value=c.dailyUnit;$('initial-input').value=c.initial;$('initial-unit').value=c.initialUnit;$('period-input').value=c.period;$('start-date').value=c.start;$('asc-date').value=c.asc;$('asc-date').max=today();$('spend-all-last-day').checked=c.spendAllOnLastDay===true;$('ascension-stage').value=c.ascensionStage||'2';$('include-resonance').checked=c.includeResonance===true;$('resonance-level').value=c.resonanceLevel??0;syncResonanceInputs();}
 const key=(d,i)=>d+':'+i;
 const isComplete=(day,i)=>Number(state.done[key(day,i)]||0)>=plan.levels[i][day];
 function changes(day){return plan.skills.map((s,i)=>({s,i,level:plan.levels[i][day],previous:plan.levels[i][day-1]})).filter(x=>x.level>x.previous);}
 function dateFor(day){return new Date(E.addDate(state.config.start,day-1)+'T12:00:00Z').toLocaleDateString(locale(),{timeZone:'UTC',month:'long',day:'numeric',weekday:'short'});}
 function updateAsc(){
  const zone=timeZone(),now=new Date(),zoneLabel=t(locale()==='zh-TW'?'대만 시간':locale()==='en'?'기기 현지 시간':'한국 시간');
  $('asc-date').max=today();
  $('asc-today').textContent=t('오늘: {date} {time} ({zone})',{date:E.todayInZone(zone,now),time:new Intl.DateTimeFormat(locale(),{timeZone:zone,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now),zone:zoneLabel+' · '+zone});$('asc-error').textContent='';
  const asc=$('asc-date').value;
  if(!asc){$('asc-elapsed').textContent=t('승천 날짜를 선택하면 오늘까지의 경과 일수를 보여줍니다.');$('asc-income').textContent='';return;}
  try{const elapsed=E.elapsed(asc,today());$('asc-elapsed').textContent=t('{days}일 경과 · 승천 {ordinal}일차',elapsed);let daily=plan.daily;try{daily=E.parseRP($('daily-input').value,$('daily-unit').value);}catch{}$('asc-income').textContent=t('경과 기간 추정 획득량: {rp}',{rp:money(E.incomeBetween(daily,(state.config.incomeChanges||[]).map(x=>({day:E.dateNumber(x.date),daily:E.parseRP(x.amount,x.unit)})),E.dateNumber(asc),E.dateNumber(today())))});}
  catch(error){$('asc-elapsed').textContent='';$('asc-income').textContent='';$('asc-error').textContent=errorText(error);}
 }
 function hint(){for(const name of ['daily','initial']){try{const n=E.parseRP($(name+'-input').value,$(name+'-unit').value);$(name+'-hint').textContent=money(n);$(name+'-hint').title=n.toLocaleString()+' RP';}catch{$(name+'-hint').textContent='';}}updateAsc();}
 function overview(from,to){
  $('overview-title').textContent=t('{period}일 전체 목표',{period:plan.period});
  const count=to-from+1,table=$('overview');table.style.setProperty('--rp-table-width','calc(var(--rp-first-col) + '+((count+1)*64)+'px)');
  table.innerHTML='<caption style="text-align:left;padding:12px">'+t(plan.ascensionStage==='3+'?'일별 목표 레벨 · 공명 30레벨 유지':plan.includeResonance?'일별 목표 레벨 · 공명 포함 배분':'일별 목표 레벨 · 공명 추가 강화 제외')+' · '+t('{from}~{to}일 / 총 {period}일',{from,to,period:plan.period})+'</caption><thead><tr><th scope="col">'+t('스킬')+'</th><th scope="col">'+t('시작')+'</th>'+Array.from({length:count},(_,i)=>'<th scope="col">'+t('{day}일',{day:from+i})+'</th>').join('')+'</tr></thead><tbody>'+plan.skills.map((s,i)=>'<tr><th scope="row">'+t(s.name)+'</th><td>'+s.start+'</td>'+Array.from({length:count},(_,j)=>{const day=from+j,l=plan.levels[i][day];return '<td class="'+(l>plan.levels[i][day-1]?'changed':'')+'">'+l+'</td>';}).join('')+'</tr>').join('')+'</tbody>';
 }
 function render(){
  const day=state.day,changed=changes(day),done=changed.filter(x=>isComplete(day,x.i)).length;
  $('income').textContent=money(plan.dailyIncome[day]);$('income').title=plan.dailyIncome[day].toLocaleString()+' RP';$('budget').textContent=money(plan.totalBudget);$('budget').title=plan.totalBudget.toLocaleString()+' RP';$('reserve').textContent=money(plan.balances[plan.period]);$('reserve').title=plan.balances[plan.period].toLocaleString()+' RP';
  $('budget-label').textContent=t('{days}일 총 예산',{days:plan.period});$('reserve-label').textContent=t('{days}일 후 예상 잔액',{days:plan.period});
  const from=Math.floor((day-1)/30)*30+1,to=Math.min(plan.period,from+29);
  $('day-range').textContent=t('{from}~{to}일 / 총 {period}일',{from,to,period:plan.period});$('page-prev').disabled=from===1;$('page-next').disabled=to===plan.period;
  $('days').innerHTML=Array.from({length:to-from+1},(_,i)=>{const d=from+i,c=changes(d),complete=c.length&&c.every(x=>isComplete(d,x.i));return '<button data-day="'+d+'" aria-pressed="'+(d===day)+'" class="'+(complete?'complete':'')+'" aria-label="'+t(complete?'{day}일차 완료':'{day}일차',{day:d})+'">'+t('{day}일',{day:d})+'</button>';}).join('');
  $('jump-day').value=day;$('jump-day').max=plan.period;$('changed-only').checked=state.changed;
  $('day-label').textContent='DAY '+day+' / '+plan.period+' · '+dateFor(day);
  $('day-title').textContent=changed.length?t('오늘은 {count}개 스킬을 올려요',{count:changed.length}):t('오늘은 RP를 모으는 날');
  $('day-meta').textContent=t('오늘 계획 비용 {cost} · 목표 달성 후 잔액 {balance}',{cost:money(plan.totals[day]-plan.totals[day-1]),balance:money(plan.balances[day])});
  $('progress-label').textContent=changed.length?t('오늘 강화 {done} / {count}개 완료',{done,count:changed.length}):t('강화 없음 · 기존 레벨 유지');$('progress').style.width=(changed.length?done/changed.length*100:0)+'%';
  $('prev').disabled=day===1;$('next').disabled=day===plan.period;$('check-all').disabled=!changed.length;$('check-all').textContent=t(done===changed.length&&changed.length?'오늘 완료 체크 해제':'오늘 강화 모두 완료');
  const entries=state.changed?changed:plan.skills.map((s,i)=>({s,i,level:plan.levels[i][day],previous:plan.levels[i][day-1]}));
  $('cards').innerHTML=entries.length?entries.map(x=>{const active=x.level>x.previous,checked=active&&isComplete(day,x.i);return '<label class="skill '+(checked?'done':'')+'"><input type="checkbox" data-skill="'+x.i+'" '+(checked?'checked ':'')+(!active?'disabled ':'')+'aria-label="'+t('{skill} {level}레벨 강화 완료',{skill:t(x.s.name),level:x.level})+'"><div class="skill-main"><div class="skill-name">'+t(x.s.name)+'</div><small>'+(active?t('이전 {prev} → {level} · +{gain}레벨',{prev:x.previous,level:x.level,gain:x.level-x.previous}):t('유지 · 추가 강화 없음'))+'</small></div><div class="level">'+x.level+'<span> Lv</span></div></label>';}).join(''):'<div class="empty" style="grid-column:1/-1"><strong>'+t('차곡차곡, 다음 강화를 준비해요.')+'</strong><span class="muted">'+t('오늘은 변경할 스킬이 없습니다.')+'<br>'+t('전체 스킬을 보고 싶으면 위 필터를 해제하세요.')+'</span></div>';
  $('basis-list').innerHTML=plan.skills.map((s,i)=>'<div class="basis-row"><strong>'+t(s.name)+'</strong><br>'+t('시작 레벨')+': '+s.start+' · '+t('기간 추천 목표')+': '+plan.levels[i][plan.period]+'<br>'+t('다음 강화 RP')+': '+(s.maxLevel!==undefined&&s.start===s.maxLevel?t('최대 레벨'):money(s.base))+'</div>').join('');
  overview(from,to);hint();syncResonanceInputs();renderResonanceSummary();translateStatic();renderDraftNote();
  if(noticeKey)$('status').textContent=t(noticeKey);
  $('calc-error').textContent=calculationError?errorText(calculationError):'';
 }
 function go(day){if(!Number.isInteger(day)||day<1||day>plan.period)return;state.day=day;save();render();}
 function syncResonanceInputs(){
  const second=$('ascension-stage').value==='2';$('resonance-options').hidden=!second;
  if(!second)$('include-resonance').checked=false;
  $('resonance-level-group').hidden=!second||!$('include-resonance').checked;
  $('resonance-level').disabled=!second||!$('include-resonance').checked;
  $('resonance-data-status').textContent=resonanceStatus==='ready'?'':t(resonanceStatus==='loading'?'공명 CSV 데이터를 불러오는 중입니다.':'공명 CSV 데이터를 불러올 수 없습니다. 새로고침하거나 공명 강화 옵션을 해제하세요.');
 }
 function renderResonanceSummary(){
  if(plan.ascensionStage==='3+'){$('resonance-summary').textContent=t('승천3 이상은 공명 30레벨 완료 기준으로 계산하며 추가 투자하지 않습니다.');return;}
  if(!plan.includeResonance){$('resonance-summary').textContent=t('현재 계산 결과에는 공명 추가 강화가 포함되지 않습니다.');return;}
  const i=plan.skills.findIndex(s=>s.kind==='resonance'),level=plan.levels[i][state.day],last=plan.levels[i][plan.period],record=plan.resonanceTable[level-1];
  $('resonance-summary').textContent=t('선택일 공명 {level}레벨 · 최종데미지 {damage}% · 별빛 일일 획득 상한 {starlight}% · 기간 최종 목표 {last}레벨',{level,damage:record?.damage||0,starlight:record?.starlight||0,last});
 }
 $('ascension-stage').addEventListener('change',syncResonanceInputs);
 $('include-resonance').addEventListener('change',syncResonanceInputs);
 function escapeInput(value){return String(value??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
 function renderIncomeHistory(){
  $('income-rows').innerHTML=incomeDraft.length?incomeDraft.map((row,i)=>'<div class="income-change-row"><label>'+t('획득량 변경 적용일')+'<input type="date" data-history-index="'+i+'" data-history-field="date" value="'+escapeInput(row.date)+'"></label><label>'+t('변경 후 하루 RP 획득량')+'<div class="amount-field"><input type="text" inputmode="decimal" data-history-index="'+i+'" data-history-field="amount" value="'+escapeInput(row.amount)+'"><select data-history-index="'+i+'" data-history-field="unit" aria-label="'+t('단위')+'">'+['RP','경','해'].map(unit=>'<option value="'+unit+'" '+(row.unit===unit?'selected':'')+'>'+t(unit==='RP'?'RP':unit==='경'?'경 (10¹⁶ RP)':'해 (10²⁰ RP)')+'</option>').join('')+'</select></div></label><button type="button" data-remove-income="'+i+'">'+t('삭제')+'</button></div>').join(''):'<p class="muted income-empty">'+t('변경 이력이 없으면 기본 하루 획득량을 전체 기간에 적용합니다.')+'</p>';
  $('add-income').disabled=incomeDraft.length>=100;
 }
 $('add-income').onclick=()=>{if(incomeDraft.length>=100)return;incomeDraft.push({date:today(),amount:$('daily-input').value,unit:$('daily-unit').value});renderIncomeHistory();saveDraft();};
 $('income-rows').addEventListener('input',event=>{const i=Number(event.target.dataset.historyIndex),field=event.target.dataset.historyField;if(incomeDraft[i]&&['date','amount','unit'].includes(field))incomeDraft[i][field]=event.target.value;});
 $('income-rows').addEventListener('change',event=>{const i=Number(event.target.dataset.historyIndex),field=event.target.dataset.historyField;if(incomeDraft[i]&&['date','amount','unit'].includes(field))incomeDraft[i][field]=event.target.value;});
 $('income-rows').addEventListener('click',event=>{const remove=event.target.closest('[data-remove-income]');if(remove){incomeDraft.splice(Number(remove.dataset.removeIncome),1);renderIncomeHistory();saveDraft();return;}if(event.target.matches('input[type="date"]')&&typeof event.target.showPicker==='function'){try{event.target.showPicker();event.preventDefault();}catch{}}});
 $('rp-form').addEventListener('submit',event=>{
  event.preventDefault();saveDraft();calculationError=null;$('calc-error').textContent='';
  try{const config=readConfig(),sameOrigin=state.config.start===config.start&&E.parseRP(state.config.initial,state.config.initialUnit)===E.parseRP(config.initial,config.initialUnit),next=calculate(config,sameOrigin?completionLocks():[]);state.config=config;plan=next;if(!sameOrigin)state.done={};state.day=Math.min(state.day,plan.period);save();saveDraft();render();noticeKey='획득량 이력을 반영해 계산했습니다. 같은 시작일과 남은 RP를 유지하면 완료한 강화도 보존됩니다.';$('status').textContent=t(noticeKey);}
  catch(error){calculationError=error;$('calc-error').textContent=errorText(error);}
 });
 document.querySelectorAll('[data-period]').forEach(button=>button.addEventListener('click',()=>{$('period-input').value=button.dataset.period;$('rp-form').requestSubmit();}));
 for(const name of ['daily','initial'])for(const suffix of ['input','unit'])$(name+'-'+suffix).addEventListener('input',hint);
 $('asc-date').addEventListener('change',()=>{state.config.asc=$('asc-date').value;save();updateAsc();});
 $('use-asc').onclick=()=>{try{if(!$('asc-date').value){$('asc-error').textContent=t('먼저 승천 날짜를 선택하세요.');return;}E.elapsed($('asc-date').value,today());$('start-date').value=E.addDate($('asc-date').value,1);$('rp-form').requestSubmit();}catch(error){$('asc-error').textContent=errorText(error);}};
 $('days').addEventListener('click',event=>{const b=event.target.closest('[data-day]');if(b)go(Number(b.dataset.day));});
 $('prev').onclick=()=>go(state.day-1);$('next').onclick=()=>go(state.day+1);$('page-prev').onclick=()=>go(Math.max(1,Math.floor((state.day-1)/30)*30-29));$('page-next').onclick=()=>go(Math.min(plan.period,Math.floor((state.day-1)/30)*30+31));$('jump').onclick=()=>go(Number($('jump-day').value));
 $('changed-only').onchange=event=>{state.changed=event.target.checked;save();render();};
 $('go-today').onclick=()=>go(Math.max(1,Math.min(plan.period,E.dateNumber(today())-E.dateNumber(state.config.start)+1)));
 $('cards').addEventListener('change',event=>{if(event.target.matches('[data-skill]')){const i=Number(event.target.dataset.skill);if(event.target.checked)state.done[key(state.day,i)]=plan.levels[i][state.day];else delete state.done[key(state.day,i)];save();render();}});
 $('check-all').onclick=()=>{const c=changes(state.day),all=c.every(x=>isComplete(state.day,x.i));c.forEach(x=>{if(all)delete state.done[key(state.day,x.i)];else state.done[key(state.day,x.i)]=x.level;});save();render();};
 $('copy').onclick=async()=>{const c=changes(state.day),text=t('[{day}일차 RP 강화 목표]',{day:state.day})+' '+dateFor(state.day)+'\n'+(c.length?c.map(x=>t('{skill}: {prev} → {level}레벨',{skill:t(x.s.name),prev:x.previous,level:x.level})).join('\n'):t('강화 없이 RP 모으기 · 기존 레벨 유지'))+'\n'+t(plan.ascensionStage==='3+'?'※ 숫자는 달성 목표 레벨 / 공명 30 유지':plan.includeResonance?'※ 숫자는 달성 목표 레벨 / 공명 포함':'※ 숫자는 달성 목표 레벨 / 공명 강화 제외');try{await navigator.clipboard.writeText(text);noticeKey='복사했어요. 디스코드에 붙여넣으세요.';$('status').textContent=t(noticeKey);}catch{const area=document.createElement('textarea');area.value=text;area.setAttribute('aria-label',t('복사할 강화 목표'));area.style.width='100%';area.style.minHeight='220px';$('status').replaceChildren(area);area.focus();area.select();}};
 $('table-toggle').onclick=()=>{const open=$('table-wrap').hidden;$('table-wrap').hidden=!open;$('table-scroll-controls').hidden=!open;$('table-toggle').textContent=t(open?'전체 표 접기':'전체 표 펼치기');$('table-toggle').setAttribute('aria-expanded',String(open));};
 $('table-left').onclick=()=>$('table-wrap').scrollBy({left:-Math.max(256,$('table-wrap').clientWidth*.65),behavior:'smooth'});$('table-right').onclick=()=>$('table-wrap').scrollBy({left:Math.max(256,$('table-wrap').clientWidth*.65),behavior:'smooth'});
 function refreshLanguage(language){
  if(!['ko','en','zh-TW'].includes(language))return;
  selectedLanguage=language;document.documentElement.lang=language;renderIncomeHistory();
  render();$('table-toggle').textContent=t($('table-wrap').hidden?'전체 표 펼치기':'전체 표 접기');
 }
 document.addEventListener('iryu:languagechange',event=>refreshLanguage(event.detail?.language||window.iryuI18n?.getLanguage()||localStorageLanguage()));
 // Also work before the shared translation module finishes loading.
 document.addEventListener('change',event=>{
  if(event.target.id==='languageSelect'){
   const language=event.target.value;
   if(['ko','en','zh-TW'].includes(language)){try{localStorage.setItem('iryu_language',language);}catch{}refreshLanguage(language);}
  }
 });
 window.addEventListener('storage',event=>{if(event.key==='iryu_language')refreshLanguage(event.newValue||'ko');});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateAsc();});

 // Open native date pickers from anywhere in the input, preserving native fallback.
 document.querySelectorAll('.rp input[type="date"]').forEach(input=>{
  function openPicker(event){
   if(input.disabled||input.readOnly||typeof input.showPicker!=='function')return;
   try{input.showPicker();event.preventDefault();}catch{/* Keep the native date input behavior. */}
  }
  input.addEventListener('click',openPicker);
  input.addEventListener('keydown',event=>{
   if(event.key==='Enter'||event.key===' '||(event.altKey&&event.key==='ArrowDown'))openPicker(event);
  });
 });

 // Save raw edits independently of the last successfully calculated plan.
 // Invalid or unfinished input is restored too, without clearing completion records.
 $('rp-form').addEventListener('input',saveDraft);
 $('rp-form').addEventListener('change',saveDraft);
 $('asc-date').addEventListener('input',saveDraft);
 // The existing ascension-date change handler saves applied metadata as before.
 document.addEventListener('change',event=>{if(event.target.id==='asc-date')saveDraft();});
 populate();render();
 if(typeof fetch==='function')fetch('../../datas/rpskill-perf/ascension-resonance.csv',{cache:'no-cache'})
  .then(response=>{if(!response.ok)throw Error('resonance-data');return response.text();})
  .then(text=>{resonanceTable=E.parseResonanceCSV(text);resonanceStatus='ready';try{plan=calculate(state.config,completionLocks());if(calculationError?.message==='resonance-data')calculationError=null;}catch(error){calculationError=error;}render();})
  .catch(()=>{resonanceStatus='error';syncResonanceInputs();});
 window.setInterval(()=>{if(!document.hidden)updateAsc();},1000);
})();
