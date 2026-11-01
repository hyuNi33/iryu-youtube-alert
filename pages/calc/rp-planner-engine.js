(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.IryuRP=factory();})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 const UNIT=10n**16n;
 const SKILLS=[['샤프아이즈',70,2100,92],['영웅의 메아리',70,360,95],['버서크',70,1020,96],['쉐도우 파트너',70,330,101],['메이플 용사',55,3870,74],['샤프니스',30,2640,51],['어드밴스드 콤보',70,1770,91],['데몬스 퓨리',40,1590,62],['그리드',30,2310,52],['크리티컬 리인포스',55,2460,76],['바이탈 체인',40,2730,66],['어드밴스드 파이널 어택',35,180,63],['관록',30,1380,49]].map(([name,start,base,reference])=>({name,start,base:BigInt(base)*UNIT,reference,step:name==='샤프아이즈'?2:1}));
 const round=(a,b)=>(a+b/2n)/b;
 function parseRP(value,unit='RP'){
  const scale=unit==='해'?20:unit==='경'?16:unit==='RP'?0:-1;
  if(scale<0)throw Error('invalid-unit');
  const raw=String(value).trim();
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw))throw Error('invalid-rp');
  const [whole,fraction='']=raw.replace(/,/g,'').split('.');
  if(fraction.length>scale)throw Error('precision');
  const result=BigInt(whole)*10n**BigInt(scale)+BigInt(fraction.padEnd(scale,'0')||'0');
  if(result.toString().length>60)throw Error('too-large');
  return result;
 }
 function dateNumber(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('invalid-date');
  const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
  if(y<1900||date.toISOString().slice(0,10)!==value)throw Error('invalid-date');
  return Math.floor(+date/86400000);
 }
 function timeZoneFor(language,deviceZone=Intl.DateTimeFormat().resolvedOptions().timeZone){return language==='zh-TW'?'Asia/Taipei':language==='en'?(deviceZone||'UTC'):'Asia/Seoul';}
 function todayInZone(timeZone='Asia/Seoul',now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=t=>parts.find(p=>p.type===t).value;return get('year')+'-'+get('month')+'-'+get('day');
 }
 function koreaToday(now=new Date()){return todayInZone('Asia/Seoul',now);}
 function elapsed(asc,today=koreaToday()){
  const days=dateNumber(today)-dateNumber(asc);if(days<0)throw Error('future-date');
  return {days,ordinal:days+1};
 }
 function addDate(value,days){return new Date((dateNumber(value)+days)*86400000).toISOString().slice(0,10);}
 function buildPlan({initial,daily,period}){
  if(typeof initial!=='bigint'||typeof daily!=='bigint'||initial<0n||daily<0n)throw Error('invalid-rp');
  if(!Number.isInteger(period)||period<1||period>3650)throw Error('invalid-period');
  if((initial+daily*BigInt(period)).toString().length>64)throw Error('too-large');
  const series=SKILLS.map(s=>{const sums=[0n];let a=s.base,b=1n;return {s,sums,extend(){sums.push(sums.at(-1)+round(a,b));a*=6n;b*=5n;}};});
  const weights=series.map(q=>{while(q.sums.length<=q.s.reference-q.s.start)q.extend();return q.sums[q.s.reference-q.s.start];});
  const denominator=weights.reduce((a,b)=>a+b,0n);
  const levels=SKILLS.map(s=>[s.start]),totals=[0n],balances=[initial];
  const counts=SKILLS.map(()=>0);
  for(let day=1;day<=period;day++){
   const budget=initial+daily*BigInt(day);let total=0n;
   for(let i=0;i<SKILLS.length;i++){
    const q=series[i],quota=budget*weights[i]/denominator;
    while(true){const next=counts[i]+q.s.step;while(q.sums.length<=next)q.extend();if(q.sums[next]>quota)break;counts[i]=next;}
    levels[i].push(q.s.start+counts[i]);total+=q.sums[counts[i]];
   }
   totals.push(total);balances.push(budget-total);
  }
  return {period,initial,daily,levels,totals,balances,weights,denominator,totalBudget:initial+daily*BigInt(period)};
 }
 return {SKILLS,parseRP,dateNumber,koreaToday,timeZoneFor,todayInZone,elapsed,addDate,buildPlan};
});
