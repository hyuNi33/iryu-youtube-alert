/** 시작·종료 퍼센트 사진 인식 및 경험치바 색 경계 측정. */
import {initExpData,getExpNeedForLevel,getMaxExpLevel,getHourglassMultiplierParts} from './exp.js';
import {loadInputs,saveInputs} from '../storage.js';
import {startCapture,stopCapture} from './screen-exp.js';
const $=id=>document.getElementById(id);
const video=$('video'),preview=$('preview'),frame=document.createElement('canvas');
let stream=null,roi=null,drag=null,raf=0,manualAt=null,manualSettings=null,autoAt=null,autoSettings=null,autoFirst=null,autoLast=null,pending=[],manualResult=null,autoResult=null;
let recentReadings=[],decreaseCandidates=[],readFailures=0;
let manualStartPercent=null,snapshotBusy=false,ocrWorkerPromise=null;
function recordText(value){return value.toFixed(2)+'% · '+new Date().toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});}
function clearRecords(){manualStartPercent=null;for(const id of ['startPercentPhoto','endPercentPhoto'])$(id).hidden=true;$('manualStartRecord').textContent=$('manualEndRecord').textContent='—';}
const configIds=['currentLevel','hourglass','baseExp'];
function status(id,text){$(id).textContent=text;}
export function parseAmount(text){const s=String(text).replace(/[\s,]/g,'');if(/^\d+$/.test(s))return BigInt(s);const units={경:10n**16n,조:10n**12n,억:10n**8n,만:10000n};let sum=0n,last=10n**30n,end=0;const re=/(\d+)(경|조|억|만)/g;let m;while((m=re.exec(s))){if(m.index!==end||units[m[2]]>=last)return null;sum+=BigInt(m[1])*units[m[2]];last=units[m[2]];end=re.lastIndex;}if(!end)return null;const tail=s.slice(end);if(tail){if(!/^\d+$/.test(tail)||BigInt(tail)>=last)return null;sum+=BigInt(tail);}return sum;}
function settings(){const level=Number($('currentLevel').value),hg=Number($('hourglass').value);if(!Number.isInteger(level)||level<1||!$('hourglass').value.trim()||!Number.isInteger(hg)||hg<0||hg>50)throw Error('현재 레벨은 1 이상, 모래시계는 0~50 정수로 입력하세요.');const text=$('baseExp').value.trim(),data=getExpNeedForLevel(level);const base=text?parseAmount(text):data.expNeedBigInt;if(base==null||base<=0n)throw Error('해당 레벨의 기본 필요 경험치를 직접 입력하세요.');return {level,hg,numerator:base*getHourglassMultiplierParts(hg).numerator};}
function format(n,d=1n){const whole=n/d;const units={경:10n**16n,조:10n**12n,억:10n**8n,만:10000n};if(whole>=10000n){let rest=whole,parts=[];for(const [u,v]of Object.entries(units)){if(rest>=v){parts.push((rest/v).toLocaleString('ko-KR')+u);rest%=v;}}if(rest)parts.push(rest.toLocaleString('ko-KR'));return parts.slice(0,3).join(' ');}const fraction=(n%d*100n/d).toString().padStart(2,'0').replace(/0+$/,'');return whole.toLocaleString('ko-KR')+(fraction?'.'+fraction:'');}
export function calculateMeasurement(start,end,seconds,numerator){if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>100||end<start||start>100||end<0)throw Error('퍼센트는 0~100이며 종료값은 시작값 이상이어야 합니다. 레벨업 구간은 새로 측정하세요.');if(!Number.isFinite(seconds)||seconds<=0)throw Error('측정 시간을 양수로 입력하세요.');const delta=BigInt(Math.round(end*10000)-Math.round(start*10000));const gain=BigInt(numerator)*delta,den=10000000n,ms=BigInt(Math.max(1,Math.round(seconds*1000)));return {gain,den,rateNumerator:gain*60000n,rateDenominator:den*ms,seconds,start,end};}
function renderResult(prefix,result){$(prefix+'Gain').textContent=format(result.gain,result.den);$(prefix+'Rate').textContent=format(result.rateNumerator,result.rateDenominator)+' / 분';
 const full=(n,d)=>((n+d/2n)/d).toLocaleString('ko-KR');
 const panel=$(prefix+'RateDetails');panel.replaceChildren();
 for(const line of [
  '1분당 경험치: '+full(result.rateNumerator,result.rateDenominator)+' / 분',
  '시작 '+result.start.toFixed(4)+'% → 종료 '+result.end.toFixed(4)+'%',
  '상승량: '+(result.end-result.start).toFixed(4)+'%p',
  '측정 시간: '+result.seconds.toFixed(3)+'초',
  '획득 경험치: '+full(result.gain,result.den),
  '계산식: 획득 경험치 ÷ 측정 시간 × 60',
  '전체 숫자는 1 단위로 반올림한 추정값입니다. 게임 표시 자릿수와 측정 오차는 포함될 수 있습니다.'
 ]){const p=document.createElement('p');p.textContent=line;panel.appendChild(p);}
 compare();}
function compare(){if(!manualResult||!autoResult)return;const a=Number(manualResult.rateNumerator)/Number(manualResult.rateDenominator),b=Number(autoResult.rateNumerator)/Number(autoResult.rateDenominator);$('comparison').textContent=a>0?`직접 입력 대비 자동 측정의 1분당 획득량 차이: ${((b-a)/a*100).toFixed(2)}%. 같은 조건과 시간대였는지 확인하세요.`:'직접 입력 획득량이 0이라 상대 차이를 계산하지 않습니다.';}
function controls(){const locked=manualAt!==null||autoAt!==null;for(const id of configIds)$(id).disabled=locked;$('manualStart').disabled=manualAt!==null||snapshotBusy||!stream||!roi;$('manualReset').disabled=snapshotBusy;$('manualStop').disabled=manualAt===null||snapshotBusy;$('startPercent').disabled=snapshotBusy;$('seconds').disabled=manualAt!==null;$('calculate').disabled=manualAt!==null||snapshotBusy;$('capture').disabled=locked||snapshotBusy;$('autoStart').disabled=!stream||!roi||autoAt!==null;$('autoStop').disabled=autoAt===null;$('disconnect').disabled=!stream||snapshotBusy;$('barZoom').disabled=autoAt!==null;}
function refreshSettings(){try{$('required').textContent=`모래시계 ${settings().hg}레벨 · 보정 필요 경험치 ${format(settings().numerator,10n)}`;}catch(e){$('required').textContent=e.message;}}
for(const id of configIds)$(id).onchange=()=>{manualSettings=null;clearRecords();manualResult=autoResult=null;$('manualGain').textContent=$('manualRate').textContent=$('autoGain').textContent=$('autoRate').textContent='—';clearRateDetails();$('comparison').textContent='조건이 변경되었습니다. 결과를 새로 측정하세요.';refreshSettings();saveInputs('expBarMeasure',Object.fromEntries(configIds.map(k=>[k,$(k).value])));};
function percent(id){if(!$(id).value.trim())throw Error('시작·종료 퍼센트를 입력하세요.');const n=Number($(id).value);if(!Number.isFinite(n)||n<0||n>100)throw Error('퍼센트는 0~100으로 입력하세요.');return n;}
// 버튼을 누른 시점의 원본 사진과 시간을 고정합니다.
function takeSnapshot(id){if(!stream||video.readyState<2)throw Error('게임 화면을 연결하세요.');render();if(!roi||roi.w<10||roi.h<3)throw Error('퍼센트 숫자 전체와 % 영역을 지정하세요.');const c=$(id+'Photo');c.width=roi.w;c.height=roi.h;c.getContext('2d').drawImage(frame,roi.x,roi.y,roi.w,roi.h,0,0,roi.w,roi.h);c.hidden=false;return {canvas:c,at:performance.now()};}
async function readSnapshot(canvas){if(!ocrWorkerPromise)ocrWorkerPromise=window.Tesseract.createWorker('eng',1,{workerPath:new URL('../vendor/tesseract/worker.min.js',import.meta.url).href,corePath:new URL('../vendor/tesseract/core/',import.meta.url).href,langPath:new URL('../vendor/tesseract/lang/',import.meta.url).href}).then(async worker=>{await worker.setParameters({tessedit_char_whitelist:'0123456789.%',tessedit_pageseg_mode:'7',user_defined_dpi:'300'});return worker;}).catch(e=>{ocrWorkerPromise=null;throw e;});const worker=await ocrWorkerPromise;
 for(const white of [false,true]){const enlarged=document.createElement('canvas');enlarged.width=canvas.width*6+48;enlarged.height=canvas.height*6+48;const ctx=enlarged.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,enlarged.width,enlarged.height);ctx.imageSmoothingEnabled=false;ctx.drawImage(canvas,24,24,canvas.width*6,canvas.height*6);if(white){const image=ctx.getImageData(24,24,canvas.width*6,canvas.height*6);for(let i=0;i<image.data.length;i+=4){const r=image.data[i],g=image.data[i+1],b=image.data[i+2],v=Math.min(r,g,b)>155&&Math.max(r,g,b)-Math.min(r,g,b)<65?0:255;image.data[i]=image.data[i+1]=image.data[i+2]=v;}ctx.putImageData(image,24,24);}const {data}=await worker.recognize(enlarged);const text=data.text.replace(/\s/g,'');const match=text.match(/^(\d{1,3}\.\d{1,2})%$/);if(match&&Number(match[1])<=100&&data.confidence>=40)return Number(match[1]);}throw Error('퍼센트를 확실하게 읽지 못했습니다. 사진을 보고 퍼센트를 입력하세요.');}
$('manualStart').onclick=async()=>{if(snapshotBusy)return;try{const config=settings(),shot=takeSnapshot('startPercent');manualSettings=config;manualAt=shot.at;manualStartPercent=null;$('startPercent').value='';$('endPercent').value='';$('endPercentPhoto').hidden=true;$('seconds').value='';$('manualEndRecord').textContent='—';$('manualStartRecord').textContent='시작 사진 저장 · '+new Date().toLocaleTimeString('ko-KR');manualResult=null;clearRateDetails('manual');$('manualGain').textContent=$('manualRate').textContent='—';snapshotBusy=true;controls();status('manualStatus','시작 사진 저장 완료. 퍼센트를 읽고 있습니다.');try{manualStartPercent=await readSnapshot(shot.canvas);$('startPercent').value=manualStartPercent.toFixed(2);$('manualStartRecord').textContent=recordText(manualStartPercent);status('manualStatus','시작 퍼센트 자동 입력 완료. 사진과 값을 확인한 뒤 측정 종료를 누르세요.');}catch(e){status('manualStatus',e.message+' 타이머는 시작 사진 시점부터 진행 중입니다.');}}catch(e){status('manualStatus',e.message);}finally{snapshotBusy=false;controls();}};
$('manualStop').onclick=async()=>{if(manualAt===null||snapshotBusy)return;try{const shot=takeSnapshot('endPercent'),seconds=(shot.at-manualAt)/1000;manualAt=null;$('seconds').value=seconds.toFixed(3);$('endPercent').value='';$('manualEndRecord').textContent='종료 사진 저장 · '+new Date().toLocaleTimeString('ko-KR');snapshotBusy=true;controls();status('manualStatus','종료 사진 저장 완료. 퍼센트를 읽고 있습니다.');const end=await readSnapshot(shot.canvas);$('endPercent').value=end.toFixed(2);$('manualEndRecord').textContent=recordText(end);manualResult=calculateMeasurement(percent('startPercent'),end,seconds,manualSettings.numerator);renderResult('manual',manualResult);status('manualStatus','시작·종료 사진에서 자동 입력 및 계산을 완료했습니다. 사진과 퍼센트가 일치하는지 확인하세요.');}catch(e){status('manualStatus',e.message+' 저장된 사진을 확인하고 입력값으로 재계산하세요.');}finally{snapshotBusy=false;controls();}};
$('manualReset').onclick=()=>{manualAt=null;manualSettings=null;manualResult=null;clearRecords();for(const id of ['startPercent','endPercent','seconds'])$(id).value='';$('timer').textContent='00:00';$('manualGain').textContent=$('manualRate').textContent='—';clearRateDetails('manual');$('comparison').textContent='직접 입력 결과를 새로 계산하세요.';status('manualStatus','게임 화면에서 퍼센트 영역을 지정하고 측정 시작을 누르세요.');controls();};
$('calculate').onclick=()=>{try{manualResult=calculateMeasurement(percent('startPercent'),percent('endPercent'),Number($('seconds').value), (manualSettings||settings()).numerator);renderResult('manual',manualResult);status('manualStatus',manualResult.seconds<180?'계산 완료. 짧은 구간에서는 표시 자릿수 오차가 커질 수 있습니다.':'계산 완료. 게임 표시 자릿수를 기준으로 한 추정값입니다.');}catch(e){status('manualStatus',e.message);}};
setInterval(()=>{if(manualAt!==null){const sec=Math.floor((performance.now()-manualAt)/1000);$('timer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}},200);
function render(){if(!stream||!video.videoWidth)return;const w=video.videoWidth,y=Math.floor(video.videoHeight*.85),h=video.videoHeight-y;if(frame.width!==w||frame.height!==h){if(autoAt!==null)stopAuto('화면 크기가 변경되었습니다. 다시 지정하세요.');roi=null;frame.width=preview.width=w;frame.height=preview.height=h;controls();}frame.getContext('2d').drawImage(video,0,y,w,h,0,0,w,h);const ctx=preview.getContext('2d');ctx.drawImage(frame,0,0);if(roi){ctx.strokeStyle='#ff775d';ctx.lineWidth=1;ctx.strokeRect(roi.x,roi.y,roi.w,roi.h);}}
function animate(){render();raf=requestAnimationFrame(animate);}
function point(e){const r=preview.getBoundingClientRect();return{x:Math.max(0,Math.min(preview.width,(e.clientX-r.left)*preview.width/r.width)),y:Math.max(0,Math.min(preview.height,(e.clientY-r.top)*preview.height/r.height))};}
preview.onpointerdown=e=>{if(!stream||autoAt!==null||manualAt!==null||snapshotBusy)return;drag=point(e);preview.setPointerCapture(e.pointerId);};preview.onpointermove=e=>{magnify(point(e));if(!drag)return;const p=point(e);roi={x:Math.floor(Math.min(p.x,drag.x)),y:Math.floor(Math.min(p.y,drag.y)),w:Math.floor(Math.abs(p.x-drag.x)),h:Math.floor(Math.abs(p.y-drag.y))};render();};preview.onpointerup=e=>{if(!drag)return;preview.onpointermove(e);drag=null;controls();status('autoStatus','色 띠를 지정했습니다.'.replace('色','색')+` 폭 ${roi.w}px · 높이 ${roi.h}px. 숫자 겹침은 허용합니다. 테두리를 제외하고 전체 폭을 선택하세요.`);};preview.onpointercancel=()=>{drag=null;};
export function detectBar(image) {
 const {width:w,height:h,data}=image;
 if(w<100||h<1||h>30)throw Error('전체 폭 100px 이상, 바 내부 높이 1~30px를 선택하세요.');
 const n=Math.max(3,Math.floor(w*.03));
 function reference(from,to){const channels=[[],[],[]];for(let y=0;y<h;y++)for(let x=from;x<to;x++)for(let c=0;c<3;c++)channels[c].push(data[(y*w+x)*4+c]);return channels.map(a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)]);}
 const left=reference(0,n),right=reference(w-n,w);
 const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
 if(distance(left,right)<35||left[1]<left[2]+25)throw Error('초록색과 빈 영역을 구별하지 못했습니다. 바 내부만 선택하고 0%/100% 부근은 직접 입력하세요.');
 const states=[];
 for(let x=0;x<w;x++){
  let filled=0,empty=0;
  for(let y=0;y<h;y++){
   const i=(y*w+x)*4,c=[data[i],data[i+1],data[i+2]],a=distance(c,left),b=distance(c,right);
   // 바 색과 다른 흰 글자·어두운 그림자·흰 테두리는 투표에서 제외합니다.
   if(Math.min(a,b)>55||Math.abs(a-b)<12)continue;
   if(a<b)filled++;else empty++;
  }
  const count=filled+empty;
  states.push(!count||Math.abs(filled-empty)/count<.3?null:filled>empty);
 }
 const available=states.filter(v=>v!==null).length;
 if(available<w*.5)throw Error('글자나 테두리가 영역의 절반 이상을 가립니다. 바 내부 높이를 조금 넓혀 선택하세요.');
 let best=Infinity,first=0,last=0,emptyBefore=0,filledAfter=states.filter(v=>v===true).length;
 for(let x=0;x<=w;x++){
  const cost=emptyBefore+filledAfter;
  if(cost<best){best=cost;first=last=x;}else if(cost===best)last=x;
  if(x<w){if(states[x]===true)filledAfter--;else if(states[x]===false)emptyBefore++;}
 }
 const boundary=(first+last)/2,uncertainty=(last-first)/w*100;
 if(best/available>.1||boundary<=0||boundary>=w||uncertainty>1)throw Error('색 경계가 가려져 확정할 수 없습니다. 바 내부 높이를 넓히거나 직접 입력을 사용하세요.');
 return {pct:boundary/w*100,pixelStep:100/w,uncertainty};
}

function readBar(){render();if(!roi)throw Error('색 띠를 먼저 지정하세요.');return detectBar(frame.getContext('2d',{willReadFrequently:true}).getImageData(roi.x,roi.y,roi.w,roi.h));}
function stopAuto(message){autoAt=null;pending=[];controls();status('autoStatus',message||'자동 측정을 종료했습니다. 마지막 정상값까지의 결과입니다.');}
export function assessBarReadings(values, previous, pixelStep) {
 const tolerance=Math.max(.3,pixelStep*3);
 const sorted=[...values].sort((a,b)=>a-b);
 const median=sorted[Math.floor(sorted.length/2)];
 return {median,tolerance,stable:values.length>=3&&sorted.at(-1)-sorted[0]<=tolerance,decreased:previous!==null&&median<previous-tolerance};
}
function sample(){
 if(autoAt===null)return;
 try{
  const now=performance.now(),reading=readBar();if(autoAt===null)return;
  readFailures=0;
  $('autoPercent').textContent=reading.pct.toFixed(2)+'%';
  const tolerance=Math.max(.3,reading.pixelStep*3);
  if(autoLast&&reading.pct<autoLast.pct-tolerance){
   decreaseCandidates.push(reading.pct);if(decreaseCandidates.length>5)decreaseCandidates.shift();
   recentReadings=[];
   const stable=Math.max(...decreaseCandidates)-Math.min(...decreaseCandidates)<=tolerance;
   if(decreaseCandidates.length>=5&&stable)return stopAuto('5회 연속 안정적인 감소가 확인되어 종료했습니다. 레벨업·손실·영역 변경을 확인하세요.');
   status('autoStatus', '감소 후보 검증 중 '+decreaseCandidates.length+'/5. 마지막 확정값을 유지합니다.');return;
  }
  decreaseCandidates=[];
  recentReadings.push({...reading,at:now});if(recentReadings.length>3)recentReadings.shift();
  const filtered=assessBarReadings(recentReadings.map(v=>v.pct),autoLast?.pct??null,reading.pixelStep);
  if(!filtered.stable){status('autoStatus','색 경계 안정화 중 '+recentReadings.length+'/3. 흔들리는 값은 결과에 반영하지 않습니다.');return;}
  const confirmed={...reading,pct:filtered.median,at:now};
  if(!autoFirst){autoFirst=autoLast=confirmed;status('autoStatus','시작값을 확정했습니다. 자동 측정 중입니다.');return;}
  if(confirmed.pct-autoLast.pct>2){status('autoStatus','큰 증가 후보를 보류했습니다. 영역과 화면을 확인하세요.');return;}
  confirmed.pct=Math.max(autoLast.pct,confirmed.pct);autoLast=confirmed;
  const sec=(now-autoFirst.at)/1000;
  if(sec>0){autoResult=calculateMeasurement(autoFirst.pct,autoLast.pct,sec,autoSettings.numerator);$('autoTime').textContent=sec.toFixed(1)+'초';renderResult('auto',autoResult);}
  status('autoStatus','자동 측정 중 · 확정 '+autoLast.pct.toFixed(2)+'% · 순간적인 흔들림은 무시합니다.');
 }catch(e){recentReadings=[];decreaseCandidates=[];readFailures++;if(readFailures>=3)stopAuto('3회 연속 색 경계를 읽지 못했습니다. '+e.message);else status('autoStatus','색 경계 재확인 중 '+readFailures+'/3. '+e.message);}
}

$('autoStart').onclick=()=>{try{autoSettings=settings();readBar();autoFirst=autoLast=autoResult=null;clearRateDetails('auto');pending=[];recentReadings=[];decreaseCandidates=[];readFailures=0;autoAt=performance.now();$('autoGain').textContent=$('autoRate').textContent=$('autoTime').textContent='—';controls();sample();}catch(e){status('autoStatus',e.message);}};setInterval(sample,1000);$('autoStop').onclick=()=>{sample();stopAuto();};
function disconnect(){if(manualAt!==null){$('seconds').value=((performance.now()-manualAt)/1000).toFixed(3);manualAt=null;status('manualStatus','화면 연결이 종료되었습니다. 종료 사진이 없으므로 저장된 시작 사진과 입력값을 확인하세요.');}stopAuto('화면 연결을 해제했습니다.');if(stream)stopCapture(stream);stream=null;roi=null;cancelAnimationFrame(raf);video.srcObject=null;controls();}
$('disconnect').onclick=disconnect;$('capture').onclick=async()=>{try{if(stream)disconnect();stream=await startCapture(video);stream.getVideoTracks()[0].onended=disconnect;render();animate();controls();status('autoStatus','하단에서 측정 영역을 드래그하세요.');status('manualStatus','미리보기에서 퍼센트 숫자와 % 전체를 드래그한 뒤 측정 시작을 누르세요.');}catch(e){status('autoStatus','화면 연결 실패: '+e.message);}};
window.addEventListener('beforeunload',()=>{if(stream)stopCapture(stream);});
const saved=loadInputs('expBarMeasure');if(saved)for(const id of configIds)if(saved[id]!=null)$(id).value=saved[id];try{await initExpData('../..');$('currentLevel').max=String(getMaxExpLevel());}catch(e){status('required','경험치 데이터를 불러오지 못했습니다. 기본 필요 경험치를 직접 입력하세요.');}refreshSettings();controls();
function postHeight(){if(parent!==window)requestAnimationFrame(()=>parent.postMessage({type:'iryuMeasureFrameHeight',height:document.documentElement.scrollHeight},location.origin));}window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent)return;if(e.data?.type==='iryuMeasureRequestHeight')postHeight();if(e.data?.type==='iryuMeasureTheme'&&['light','dark'].includes(e.data.theme))document.documentElement.dataset.theme=e.data.theme;});new ResizeObserver(postHeight).observe(document.querySelector('.ocr-tool'));postHeight();

// 확대는 표시 크기만 바꿉니다. 측정은 원본 캡처 좌표로 계산합니다.
function updateZoom(){preview.style.width=$('barZoom').value+'%';$('barZoomLabel').textContent=$('barZoom').value+'%';}
$('barZoom').oninput=updateZoom;updateZoom();
function magnify(p){if(!stream)return;const canvas=$('barMagnifier'),ctx=canvas.getContext('2d');ctx.fillStyle='#111';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;const zoom=5,x=p.x-canvas.width/zoom/2,y=p.y-canvas.height/zoom/2;ctx.drawImage(frame,x,y,canvas.width/zoom,canvas.height/zoom,0,0,canvas.width,canvas.height);ctx.strokeStyle='#ff775d';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(canvas.width/2,0);ctx.lineTo(canvas.width/2,canvas.height);ctx.moveTo(0,canvas.height/2);ctx.lineTo(canvas.width,canvas.height/2);ctx.stroke();}

function clearRateDetails(prefix){for(const key of prefix?[prefix]:['manual','auto']){const panel=$(key+'RateDetails');panel.textContent='측정 결과를 계산하면 상세를 볼 수 있습니다.';panel.closest('details').open=false;}}
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.rate-details').forEach(d=>d.open=false);});
document.addEventListener('click',e=>document.querySelectorAll('.rate-details[open]').forEach(d=>{if(!d.contains(e.target))d.open=false;}));

// 같은 iframe을 유지해 탭 전환 중 측정 상태와 입력값을 보존합니다.
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='iryuMeasureMode')return;
 const mode=event.data.mode;if(!['manual','auto'].includes(mode))return;
 if(manualAt!==null||autoAt!==null||snapshotBusy){status('manualStatus','측정 중에는 기존 선택 영역을 유지합니다. 종료 후 영역을 다시 지정하세요.');}else if(document.body.dataset.measureMode!==mode){roi=null;controls();}document.body.dataset.measureMode=mode;$('selectionGuide').textContent=mode==='manual'?'퍼센트 숫자 전체와 %를 드래그하세요. 위치가 움직일 여유를 포함하고 괄호 뒤 경험치 숫자는 제외하세요.':'초록색과 회색을 포함한 경험치바 내부 전체 폭을 드래그하세요. 흰 테두리와 바 밖 배경은 제외하세요.';
 const intro=document.querySelector('.ocr-intro');
 intro.querySelector('strong').textContent=mode==='manual'?'직접 입력 · 권장':'색 경계 자동 측정 · 비교용';
 intro.querySelector('p').textContent=mode==='manual'?'게임 화면에서 퍼센트 영역을 지정한 뒤 측정 시작·종료를 누르세요. 각 사진에서 읽은 퍼센트를 자동 입력합니다. 사진과 값을 확인하고 필요하면 수정하세요.':'숫자가 겹친 바 내부 색 영역을 선택하세요. 흰 테두리와 바 밖 배경은 제외하세요. 직접 입력 측정과 비교하는 것을 권장합니다.';
 postHeight();
});
