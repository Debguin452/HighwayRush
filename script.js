'use strict';

const GW=380,GH_BASE=520;
const LANE_X=[22,63,104,145,186,227,275,322,350];
const NPC_IMGS=['./images/traffic.png','./images/traffic2.png','./images/traffic3.png','./images/traffic4.png'];
const CAR_W=48,CAR_H=70,NPC_W=46,NPC_H=68;
const SAFE_GAP=160,HITPAD=10;
const BASE_SPD=7,SPAWN_MS=550;
const CAR_BASE_Y_OFFSET=18,CAR_BOOST_Y_LIFT=18,BRAKE_Y_LIFT=-10;
const BARRIER_L=0,BARRIER_R=GW-CAR_W;
const BOOST_DURATION=3500,BOOST_COOLDOWN=8000;
const STREAK_TIMEOUT=300;
const STREAK_THRESHOLDS=[2,4,7,10];
const PERK_SPAWN_INTERVAL=300;

const STOREGIT_BASE='https://storegit.pages.dev';
let STOREGIT_KEY='';
let _keyReady=null;
function getKey(){
  if(STOREGIT_KEY) return Promise.resolve(STOREGIT_KEY);
  if(_keyReady) return _keyReady;
  _keyReady=fetch('/api/config').then(r=>r.json()).then(d=>{if(d.key)STOREGIT_KEY=d.key;return STOREGIT_KEY;}).catch(()=>'');
  return _keyReady;
}
const LB_FILE='highway-rush-leaderboard.json';
const LB_CACHE_KEY='hr_lb_cache',LB_PLAYER_KEY='hr_lb_player',LB_IP_KEY='hr_lb_ip';
const MAX_LB_ENTRIES=100;

const DEFAULTS={soundOn:true,vibrateOn:true,gyroOn:false,swipeOn:true,boostOn:true,sensitivity:5,nightMode:false};
let S=Object.assign({},DEFAULTS,JSON.parse(localStorage.getItem('hr_settings')||'{}'));
function saveSett(){localStorage.setItem('hr_settings',JSON.stringify(S));}

const $=id=>document.getElementById(id);
const gc=$('gc');
const ctx=gc.getContext('2d',{alpha:false});
const speedoCanvas=$('speedo-canvas');
const speedoCtx=speedoCanvas.getContext('2d');
const scoreEl=$('score-val'),levelEl=$('level-val');
const screenHome=$('screen-home'),screenPause=$('screen-pause');
const screenGO=$('screen-gameover'),screenSettings=$('screen-settings');
const screenLB=$('screen-leaderboard');
const screenStats=$('screen-stats'),screenAch=$('screen-achievements');
const goScoreEl=$('go-score'),goBestEl=$('go-best'),goLevelEl=$('go-level');
const bestEl=$('best-score'),newBestBadge=$('new-best-badge');
const levelToast=$('level-up-toast'),boostToast=$('boost-toast'),gyroHint=$('gyro-hint');

const HUD_H=62,CTRL_H=90;
function sizeCanvas(){
  const availH=window.innerHeight-HUD_H-CTRL_H;
  const scale=Math.min(window.innerWidth/GW,availH/GH_BASE);
  gc.width=GW;gc.height=GH_BASE;
  gc.style.width=Math.round(GW*scale)+'px';
  gc.style.height=Math.round(GH_BASE*scale)+'px';
  gc.style.top=HUD_H+Math.max(0,(availH-Math.round(GH_BASE*scale))/2)+'px';
}
sizeCanvas();
window.addEventListener('resize',sizeCanvas);

const roadImg=new Image();roadImg.src='./images/road.png';
const carImg=new Image();carImg.src='./images/car.png';
const npcImgs=NPC_IMGS.map(s=>{const i=new Image();i.src=s;return i;});

let STATE='home';
let score=0,level=1,best=+localStorage.getItem('hr_best')||0;
let roadSpeed=0,roadY=0;
let carX=(GW-CAR_W)/2;
let carVelX=0,carTilt=0,carTiltTarget=0;
let steerInput=0,gyroSteer=0;
let boostActive=false,boostTimer=0,brakeActive=false;
let carYOffset=0,carYOffsetTarget=0;
let traffic=[],particles=[],pops=[],speedLines=[];
let raf=null,lastTime=0,spawnTimer=0,deathTimer=0,nearMissTimer=0;
let distancePx=0;
let hornActive=false,hornTimer=0;
let boostCooldown=0;
let streak=0,streakTimer=0;

const PERK_DEFS={
  shield:{color:'#39ff8a',label:'SHIELD',dur:5000},
  doubler:{color:'#ffd700',label:'×2 SCORE',dur:8000},
};
let roadPerks=[],activePerk=null,perkSpawnTimer=0;

const STATS_KEY='hr_stats';
let stats={games:0,distance:0,bestStreak:0,hornUsed:0,dailyCount:0};
try{Object.assign(stats,JSON.parse(localStorage.getItem(STATS_KEY)||'{}'));}catch{}
function saveStats(){localStorage.setItem(STATS_KEY,JSON.stringify(stats));}

const ACHIEVEMENT_KEY='hr_achievements';
let achievements={};
try{achievements=JSON.parse(localStorage.getItem(ACHIEVEMENT_KEY)||'{}');}catch{}
function saveAchievements(){localStorage.setItem(ACHIEVEMENT_KEY,JSON.stringify(achievements));}
let _gameMisses=0,_hornThisGame=false,_wasDaily=false;

const ACH_SVGS={
  easy:   '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="#39ff8a" stroke-width="1.6"><circle cx="10" cy="10" r="8"/><polyline points="6,10 9,13 14,7"/></svg>',
  medium: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="#ff8c00" stroke-width="1.6"><polygon points="10,2 12.9,7.6 19,8.5 14.5,12.9 15.6,19 10,16 4.4,19 5.5,12.9 1,8.5 7.1,7.6"/></svg>',
  hard:   '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="#ff3c3c" stroke-width="1.6"><path d="M10 2l2.4 5.2 5.6.8-4 4 .9 5.6L10 15l-4.9 2.6.9-5.6-4-4 5.6-.8z"/><line x1="10" y1="6" x2="10" y2="10"/><circle cx="10" cy="13" r="0.8" fill="#ff3c3c"/></svg>',
  impossible:'<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="#cc44ff" stroke-width="1.6"><polygon points="10,1 12.5,7 19,7.6 14.2,12 15.9,18.5 10,15.4 4.1,18.5 5.8,12 1,7.6 7.5,7"/></svg>',
};

const ACHIEVEMENT_DEFS=[
  {id:'first_blood', tier:'easy',       name:'First Drive',   desc:'Complete your first game',                  check:()=>stats.games>=1},
  {id:'speeder',     tier:'easy',       name:'Speeder',       desc:'Reach level 5',                             check:()=>level>=5},
  {id:'century',     tier:'easy',       name:'Century',       desc:'Score 100 in one game',                     check:()=>score>=100},
  {id:'survivor',    tier:'easy',       name:'Survivor',      desc:'Play 10 games',                             check:()=>stats.games>=10},
  {id:'daily_done',  tier:'easy',       name:'Daily Driver',  desc:'Complete a daily challenge',                check:()=>dailyState.done},
  {id:'ghost',       tier:'medium',     name:'Ghost',         desc:'Get 10 near-misses in one game',            check:()=>_gameMisses>=10},
  {id:'zen',         tier:'medium',     name:'Zen Driver',    desc:'Finish a game without using horn',          check:()=>!_hornThisGame&&score>=10},
  {id:'combo_master',tier:'medium',     name:'Combo Master',  desc:'Hit a ×4 streak multiplier',               check:()=>streak>=7},
  {id:'veteran',     tier:'medium',     name:'Veteran',       desc:'Play 50 games',                            check:()=>stats.games>=50},
  {id:'road_warrior',tier:'medium',     name:'Road Warrior',  desc:'Travel 10 km total',                       check:()=>stats.distance>=10000},
  {id:'level10',     tier:'medium',     name:'Top Gear',      desc:'Reach level 10',                           check:()=>level>=10},
  {id:'committed',   tier:'medium',     name:'Committed',     desc:'Complete 7 daily challenges',              check:()=>(stats.dailyCount||0)>=7},
  {id:'high_roller', tier:'hard',       name:'High Roller',   desc:'Score 500 in one game',                    check:()=>score>=500},
  {id:'daredevil',   tier:'hard',       name:'Daredevil',     desc:'Get 50 near-misses in one game',           check:()=>_gameMisses>=50},
  {id:'marathon',    tier:'hard',       name:'Marathon',      desc:'Travel 42 km total',                       check:()=>stats.distance>=42000},
  {id:'unstoppable', tier:'hard',       name:'Unstoppable',   desc:'Hit ×5 streak multiplier',                 check:()=>streak>=10},
  {id:'score1000',   tier:'impossible', name:'Legend',        desc:'Score 1000 in one game',                   check:()=>score>=1000},
  {id:'miss100',     tier:'impossible', name:'Phantom',       desc:'Get 100 near-misses in one game',          check:()=>_gameMisses>=100},
  {id:'century_club',tier:'impossible', name:'Century Club',  desc:'Play 100 games',                           check:()=>stats.games>=100},
  {id:'trans_hwy',   tier:'impossible', name:'Trans-Highway', desc:'Travel 200 km total',                      check:()=>stats.distance>=200000},
];

const DAILY_KEY='hr_daily';
function getTodaySeed(){const d=new Date();return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate();}
let dailyState={seed:0,done:false,score:0};
try{dailyState=Object.assign(dailyState,JSON.parse(localStorage.getItem(DAILY_KEY)||'{}'));}catch{}

function makePRNG(seed){
  let s=seed>>>0;
  return function(){
    s|=0;s=s+0x6D2B79F5|0;
    let t=Math.imul(s^s>>>15,1|s);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return((t^t>>>14)>>>0)/4294967296;
  };
}
let dailyMode=false,dailyRng=null;
let dailyGoalType='score',dailyGoalValue=50;
let dailyProgress=0,dailyComplete=false;

const DAILY_GOAL_DEFS=[
  {type:'score',    label:'Score',      unit:'pts',   value:40},
  {type:'nearmiss', label:'Near-misses',unit:'misses',value:8},
  {type:'distance', label:'Distance',   unit:'m',     value:300},
  {type:'level',    label:'Reach level',unit:'',      value:5},
  {type:'score',    label:'Score',      unit:'pts',   value:60},
  {type:'nearmiss', label:'Near-misses',unit:'misses',value:12},
  {type:'distance', label:'Distance',   unit:'m',     value:500},
  {type:'score',    label:'Score',      unit:'pts',   value:80},
  {type:'nearmiss', label:'Near-misses',unit:'misses',value:15},
  {type:'level',    label:'Reach level',unit:'',      value:6},
  {type:'distance', label:'Distance',   unit:'m',     value:700},
  {type:'score',    label:'Score',      unit:'pts',   value:100},
  {type:'nearmiss', label:'Near-misses',unit:'misses',value:10},
  {type:'distance', label:'Distance',   unit:'m',     value:400},
];
function getDailyGoal(seed){
  const rng=makePRNG(seed);
  const idx=Math.floor(rng()*DAILY_GOAL_DEFS.length);
  const def=DAILY_GOAL_DEFS[idx];
  const variation=Math.round((rng()-0.5)*def.value*0.1);
  return{...def,value:Math.max(1,def.value+variation)};
}

bestEl.textContent=best;

function steerAccel(){return 0.55+(S.sensitivity/10)*0.65;}
const STEER_FRICTION=0.80,STEER_RELEASE_FRICTION=0.85,MAX_STEER_SPD=9;
const MAX_TILT=0.28,TILT_SPEED=0.22,TILT_RETURN=0.12;

let speedoNeedle=0;
function drawSpeedometer(speedKmh){
  const target=Math.min(speedKmh,220);
  speedoNeedle+=(target-speedoNeedle)*0.10;
  const W=speedoCanvas.width,H=speedoCanvas.height;
  const cx=W/2,cy=H/2+2,R=W/2-3;
  speedoCtx.clearRect(0,0,W,H);
  const startAng=Math.PI*0.75,endAng=Math.PI*2.25;
  const totalAng=endAng-startAng;
  speedoCtx.beginPath();speedoCtx.arc(cx,cy,R,startAng,endAng);
  speedoCtx.lineWidth=3;speedoCtx.strokeStyle='rgba(255,255,255,0.07)';speedoCtx.stroke();
  const fraction=Math.min(speedoNeedle/220,1);
  const color=fraction<0.5?'#39ff8a':fraction<0.78?'#ff8c00':'#ff3c3c';
  speedoCtx.beginPath();speedoCtx.arc(cx,cy,R,startAng,startAng+totalAng*fraction);
  speedoCtx.lineWidth=3;speedoCtx.strokeStyle=color;speedoCtx.stroke();
  for(let i=0;i<=8;i++){
    const a=startAng+(i/8)*totalAng;
    speedoCtx.beginPath();
    speedoCtx.moveTo(cx+Math.cos(a)*(R-5),cy+Math.sin(a)*(R-5));
    speedoCtx.lineTo(cx+Math.cos(a)*(R+1),cy+Math.sin(a)*(R+1));
    speedoCtx.lineWidth=1;speedoCtx.strokeStyle='rgba(255,255,255,0.22)';speedoCtx.stroke();
  }
  const needleAng=startAng+totalAng*fraction;
  speedoCtx.save();speedoCtx.translate(cx,cy);speedoCtx.rotate(needleAng);
  speedoCtx.beginPath();speedoCtx.moveTo(-4,0);speedoCtx.lineTo(R-6,0);
  speedoCtx.lineWidth=2;speedoCtx.strokeStyle='#fff';
  speedoCtx.shadowColor=color;speedoCtx.shadowBlur=6;speedoCtx.stroke();speedoCtx.restore();
  speedoCtx.beginPath();speedoCtx.arc(cx,cy,3,0,Math.PI*2);
  speedoCtx.fillStyle='#fff';speedoCtx.fill();
  speedoCtx.font="bold 8px 'Orbitron',monospace";
  speedoCtx.fillStyle=color;speedoCtx.textAlign='center';
  speedoCtx.fillText(Math.round(speedoNeedle)+'',cx,cy+13);speedoCtx.textAlign='left';
}

function showScreen(name){
  const all=[screenHome,screenPause,screenGO,screenSettings,screenLB,screenStats,screenAch].filter(Boolean);
  all.forEach(s=>s.classList.remove('active'));
  if(name==='home')screenHome.classList.add('active');
  else if(name==='pause')screenPause.classList.add('active');
  else if(name==='gameover')screenGO.classList.add('active');
  else if(name==='settings')screenSettings.classList.add('active');
  else if(name==='leaderboard')screenLB.classList.add('active');
  else if(name==='stats'){if(screenStats){screenStats.classList.add('active');renderStatsScreen();}}
  else if(name==='achievements'){if(screenAch){screenAch.classList.add('active');renderAchievementsTab();}}
}
function setHudVisible(v){
  const o=v?'1':'0';
  $('hud').style.opacity=o;$('controls').style.opacity=o;
}

function applySettingsUI(){
  const map={
    'set-sound':  [S.soundOn,  v=>{S.soundOn=v;  if(!v)stopEngine();else if(STATE==='playing')startEngine();}],
    'set-vibrate':[S.vibrateOn,v=>{S.vibrateOn=v;}],
    'set-gyro':   [S.gyroOn,   v=>{S.gyroOn=v;   gyroHint.hidden=!v;if(v)requestGyroPermission();}],
    'set-swipe':  [S.swipeOn,  v=>{S.swipeOn=v;}],
    'set-boost':  [S.boostOn,  v=>{S.boostOn=v;  $('btn-boost').style.display=v?'':'none';}],
    'set-night':  [S.nightMode,v=>{S.nightMode=v;document.body.classList.toggle('night-mode',v);}],
  };
  for(const[id,[val]]of Object.entries(map)){
    const btn=$(id);if(!btn)continue;
    btn.textContent=val?'ON':'OFF';
    btn.className='toggle-btn '+(val?'on':'off');
    btn.onclick=()=>{
      const next=!map[id][0];map[id][0]=next;
      const sKey={sound:'soundOn',vibrate:'vibrateOn',gyro:'gyroOn',swipe:'swipeOn',boost:'boostOn',night:'nightMode'}[id.replace('set-','')];
      if(sKey)S[sKey]=next;
      map[id][1](next);saveSett();applySettingsUI();
    };
  }
  $('set-sensitivity').value=S.sensitivity;
  $('sens-val').textContent=S.sensitivity;
  $('btn-boost').style.display=S.boostOn?'':'none';
  document.body.classList.toggle('night-mode',S.nightMode);
  gyroHint.hidden=!S.gyroOn;
}
$('set-sensitivity').addEventListener('input',e=>{S.sensitivity=+e.target.value;$('sens-val').textContent=S.sensitivity;saveSett();});

let clientIP=localStorage.getItem(LB_IP_KEY)||'';
async function fetchClientIP(){
  if(clientIP)return clientIP;
  try{const r=await fetch('https://api.ipify.org?format=json');const d=await r.json();clientIP=d.ip||'';if(clientIP)localStorage.setItem(LB_IP_KEY,clientIP);}catch{clientIP='';}
  return clientIP;
}
fetchClientIP();
let ipNameMap={};
try{ipNameMap=JSON.parse(localStorage.getItem('hr_ip_name')||'{}');}catch{}
function saveIpNameMap(){localStorage.setItem('hr_ip_name',JSON.stringify(ipNameMap));}
async function getNameForIP(){const ip=await fetchClientIP();return ip?(ipNameMap[ip]||null):null;}
async function bindNameToIP(name){const ip=await fetchClientIP();if(ip){ipNameMap[ip]=name;saveIpNameMap();}}

let lbData=[],playerName=localStorage.getItem(LB_PLAYER_KEY)||'';
async function lbRequest(method,path,body){
  const k=await getKey();
  return fetch(`${STOREGIT_BASE}/api/${path}`,{
    method,headers:Object.assign({'X-API-Key':k},body?{'Content-Type':'application/json'}:{}),
    body:body?JSON.stringify(body):undefined
  }).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d;});
}
function lbLoadCache(){try{return JSON.parse(localStorage.getItem(LB_CACHE_KEY)||'[]');}catch{return[];}}
function lbSaveCache(data){localStorage.setItem(LB_CACHE_KEY,JSON.stringify(data));}
const MIGRATION_KEY='hr_migrated_v9';

async function lbFetch(){
  try{
    const k=await getKey();
    if(!localStorage.getItem(MIGRATION_KEY)){
      try{
        const OLD='highway-rush-top-scores.json';
        const oldText=await fetch(`${STOREGIT_BASE}/api/download?name=${encodeURIComponent(OLD)}`,{headers:{'X-API-Key':k}}).then(r=>{if(!r.ok)throw new Error(r.status);return r.text();});
        const oldEntries=JSON.parse(oldText);
        if(Array.isArray(oldEntries)&&oldEntries.length){
          const curText=await fetch(`${STOREGIT_BASE}/api/download?name=${encodeURIComponent(LB_FILE)}`,{headers:{'X-API-Key':k}}).then(r=>r.ok?r.text():'[]').catch(()=>'[]');
          const cur=JSON.parse(curText);const base=Array.isArray(cur)?cur:[];
          const map=new Map();
          [...base,...oldEntries].forEach(e=>{const key=e.name.trim().toLowerCase();const ex=map.get(key);if(!ex||e.score>ex.score)map.set(key,e);});
          const merged=Array.from(map.values()).sort((a,b)=>b.score-a.score).slice(0,MAX_LB_ENTRIES);
          await uploadFile(LB_FILE,merged);
          try{const files=await lbRequest('GET','files').catch(()=>[]);const old=Array.isArray(files)?files.find(f=>f.name===OLD||f.originalName===OLD):null;if(old)await lbRequest('DELETE',`files/${old.sha||old.id||old.name}`).catch(()=>{});}catch{}
        }
      }catch{}
      localStorage.setItem(MIGRATION_KEY,'1');
    }
    const text=await fetch(`${STOREGIT_BASE}/api/download?name=${encodeURIComponent(LB_FILE)}`,{headers:{'X-API-Key':k}}).then(r=>{if(!r.ok)throw new Error(r.status);return r.text();});
    lbData=Array.isArray(JSON.parse(text))?JSON.parse(text):[];
    lbData=mergeLocalBestIntoData(lbData);
    lbSaveCache(lbData);
  }catch{lbData=lbLoadCache();}
  syncBestFromRemote();
  return lbData;
}

function mergeLocalBestIntoData(data){
  if(!playerName)return data;
  const nameKey=playerName.trim().toLowerCase();
  const localBest=best||+localStorage.getItem('hr_best')||0;
  if(!localBest)return data;
  const existing=clientIP?(data.find(e=>e.ip===clientIP)||data.find(e=>!e.ip&&e.name.trim().toLowerCase()===nameKey)):data.find(e=>e.name.trim().toLowerCase()===nameKey);
  if(existing&&existing.score>=localBest)return data;
  const filtered=clientIP?data.filter(e=>e.ip?e.ip!==clientIP:e.name.trim().toLowerCase()!==nameKey):data.filter(e=>e.name.trim().toLowerCase()!==nameKey);
  return[...filtered,{name:playerName.trim().slice(0,16),score:localBest,ts:existing?existing.ts:Date.now(),ip:clientIP||undefined}].sort((a,b)=>b.score-a.score).slice(0,MAX_LB_ENTRIES);
}
function syncBestFromRemote(){
  if(!playerName||!lbData.length)return;
  const key=playerName.trim().toLowerCase();
  const entry=clientIP?(lbData.find(e=>e.ip===clientIP)||lbData.find(e=>!e.ip&&e.name.trim().toLowerCase()===key)):lbData.find(e=>e.name.trim().toLowerCase()===key);
  if(!entry)return;
  if(entry.score>best){best=entry.score;localStorage.setItem('hr_best',best);bestEl.textContent=best;}
}
function syncBestFromRemoteByName(name){
  if(!name||!lbData.length)return;
  const key=name.trim().toLowerCase();
  const entry=(clientIP&&lbData.find(e=>e.ip===clientIP))||lbData.find(e=>e.name.trim().toLowerCase()===key);
  if(!entry)return;
  if(entry.score>best){best=entry.score;localStorage.setItem('hr_best',best);bestEl.textContent=best;}
}
async function uploadFile(fileName,data){
  const content=btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  const files=await lbRequest('GET','files').catch(()=>[]);
  const existing=Array.isArray(files)?files.find(f=>f.name===fileName||f.originalName===fileName):null;
  if(existing)await lbRequest('POST','upload',{name:fileName,content,sha:existing.sha});
  else await lbRequest('POST','upload',{name:fileName,content});
}
async function lbPush(name,scoreVal){
  const ip=await fetchClientIP();
  const nameKey=name.trim().slice(0,16).toLowerCase();
  const base=lbData.length?lbData:lbLoadCache();
  const prev=ip?(base.find(e=>e.ip===ip)||base.find(e=>!e.ip&&e.name.trim().toLowerCase()===nameKey)):base.find(e=>e.name.trim().toLowerCase()===nameKey);
  const finalScore=Math.max(scoreVal,prev?prev.score:0,best);
  const entry={name:name.trim().slice(0,16),score:finalScore,ts:Date.now(),ip};
  const filtered=ip?base.filter(e=>e.ip?e.ip!==ip:e.name.trim().toLowerCase()!==nameKey):base.filter(e=>e.name.trim().toLowerCase()!==nameKey);
  const merged=[...filtered,entry].sort((a,b)=>b.score-a.score).slice(0,MAX_LB_ENTRIES);
  lbSaveCache(merged);lbData=merged;
  if(finalScore>best){best=finalScore;localStorage.setItem('hr_best',best);bestEl.textContent=best;}
  try{await uploadFile(LB_FILE,merged);}catch(e){console.warn('LB push failed:',e.message);}
}

function renderLB(data,myName){
  const el=$('lb-list');
  if(!data||!data.length){el.innerHTML='<div class="lb-empty">No entries yet — be the first!</div>';return null;}
  const me=myName?myName.trim().toLowerCase():'';
  const header='<div class="lb-col-header"><span class="lbh-rank">#</span><span class="lbh-name">DRIVER</span><span class="lbh-score">SCORE</span></div>';
  let myRank=null,myScore=null;
  const MEDALS=['🥇','🥈','🥉'];
  const rows=data.slice(0,100).map((e,i)=>{
    const rankDisp=i<3?MEDALS[i]:(i+1);
    const rankCls=i===0?'gold':i===1?'silver':i===2?'bronze':'';
    const isMe=clientIP?(e.ip===clientIP):(me&&e.name.trim().toLowerCase()===me);
    if(isMe){myRank=i+1;myScore=e.score;}
    return '<div class="lb-row'+(i<3?' lb-row--top lb-row--rank'+i:'')+(isMe?' lb-row--me':'')+(e._optimistic?' lb-row--optimistic':'')+'">'+
      '<span class="lb-rank '+rankCls+'">'+rankDisp+'</span>'+
      '<span class="lb-name">'+escHtml(e.name)+(isMe?'<span class="lb-you"> YOU</span>':'')+'</span>'+
      '<span class="lb-score">'+e.score.toLocaleString()+'</span></div>';
  }).join('');
  el.innerHTML=header+rows;
  if(me)setTimeout(()=>{const r=el.querySelector('.lb-row--me');if(r)r.scrollIntoView({block:'nearest',behavior:'smooth'});},80);
  return myRank!==null?{rank:myRank,score:myScore}:null;
}
function escHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function openLeaderboard(){
  showScreen('leaderboard');
  $('lb-list').innerHTML='<div class="lb-loading"><span class="lb-spinner"></span>Loading\u2026</div>';
  const cached=lbLoadCache();
  if(cached.length)renderLB(cached,playerName);
  try{const fresh=await lbFetch();renderLB(fresh,playerName);}catch{}
}

let resumeCountdown=0,resumeCountdownActive=false;
function startGame(){
  traffic=[];particles=[];pops=[];speedLines=[];
  score=0;level=1;roadSpeed=0;
  carX=(GW-CAR_W)/2;carVelX=0;steerInput=0;gyroSteer=0;
  carYOffset=0;carYOffsetTarget=0;carTilt=0;carTiltTarget=0;
  roadY=0;lastTime=0;spawnTimer=0;deathTimer=0;
  boostActive=false;boostTimer=0;brakeActive=false;nearMissTimer=0;
  hornActive=false;hornTimer=0;distancePx=0;
  roadPerks=[];activePerk=null;perkSpawnTimer=0;
  boostCooldown=0;updateBoostArc(1);
  streak=0;streakTimer=0;_gameMisses=0;_hornThisGame=false;
  dailyComplete=false;dailyProgress=0;
  _wasDaily=dailyMode;
  speedoNeedle=0;
  scoreEl.textContent='0';levelEl.textContent='1';
  updateStreakHUD();updateDistHUD(0);updatePerkTimerBar();
  if(dailyMode){
    const seed=getTodaySeed();
    const goal=getDailyGoal(seed);
    dailyGoalType=goal.type;dailyGoalValue=goal.value;
  }
  STATE='playing';showScreen(null);setHudVisible(true);
  if(S.soundOn)startEngine();
  if(raf)cancelAnimationFrame(raf);
  raf=requestAnimationFrame(loop);
}

function pauseGame(){
  if(STATE!=='playing')return;
  STATE='paused';stopEngine();
  steerInput=0;brakeActive=false;boostActive=false;
  showScreen('pause');
  if(raf){cancelAnimationFrame(raf);raf=null;}
}

function resumeGame(){
  if(STATE!=='paused')return;
  showScreen(null);
  resumeCountdown=3;resumeCountdownActive=true;
  lastTime=0;
  STATE='resuming';
  if(raf)cancelAnimationFrame(raf);
  raf=requestAnimationFrame(loop);
}

async function doGameOver(){
  STATE='gameover';
  stats.games++;
  const metresThisGame=Math.round((distancePx/GH_BASE)*60);
  stats.distance+=metresThisGame;
  if(streak>stats.bestStreak)stats.bestStreak=streak;
  if(_hornThisGame)stats.hornUsed=(stats.hornUsed||0)+1;
  saveStats();
  checkAchievements();
  finishDailyChallenge();
  resetStreak();updateStreakHUD();
  const isNew=score>best;
  if(isNew){best=score;localStorage.setItem('hr_best',best);}
  bestEl.textContent=best;
  goScoreEl.textContent=score;
  goBestEl.textContent=best;
  goLevelEl.textContent=level;
  newBestBadge.hidden=!isNew;
  const goDistEl=$('go-distance');
  if(goDistEl)goDistEl.textContent=metresThisGame>=1000?(metresThisGame/1000).toFixed(2)+' km':metresThisGame+' m';
  setHudVisible(false);showScreen('gameover');
  if(S.vibrateOn&&navigator.vibrate)navigator.vibrate([80,40,80]);
  const entryWrap=$('lb-entry-wrap'),statusEl=$('lb-submit-status');
  const ipName=await getNameForIP();
  if(ipName&&!playerName){playerName=ipName;localStorage.setItem(LB_PLAYER_KEY,playerName);}
  if(playerName){
    entryWrap.style.display='none';
    const nameKey=playerName.toLowerCase();
    const cached=lbLoadCache();
    const cachedEntry=clientIP?(cached.find(e=>e.ip===clientIP)||cached.find(e=>!e.ip&&e.name.toLowerCase()===nameKey)):cached.find(e=>e.name.toLowerCase()===nameKey);
    const shouldUpdate=!cachedEntry||score>cachedEntry.score;
    if(shouldUpdate){
      const optimistic={name:playerName,score,ts:Date.now(),_optimistic:true,ip:clientIP||undefined};
      const opt=[...cached.filter(e=>clientIP?(e.ip?e.ip!==clientIP:e.name.toLowerCase()!==nameKey):e.name.toLowerCase()!==nameKey),optimistic].sort((a,b)=>b.score-a.score).slice(0,MAX_LB_ENTRIES);
      lbSaveCache(opt);lbData=opt;
    }else{lbData=cached;}
    const rankInfo=renderLB(lbData,playerName);
    if(rankInfo)statusEl.textContent='Rank #'+rankInfo.rank+' \u2014 '+rankInfo.score.toLocaleString()+' pts';
    lbFetch().then(()=>{
      goBestEl.textContent=best;bestEl.textContent=best;
      const liveEntry=clientIP?(lbData.find(e=>e.ip===clientIP)||lbData.find(e=>!e.ip&&e.name.toLowerCase()===nameKey)):lbData.find(e=>e.name.toLowerCase()===nameKey);
      if(!liveEntry||score>liveEntry.score){
        const opt2={name:playerName,score,ts:Date.now(),_optimistic:true,ip:clientIP||undefined};
        lbData=[...lbData.filter(e=>clientIP?(e.ip?e.ip!==clientIP:e.name.toLowerCase()!==nameKey):e.name.toLowerCase()!==nameKey),opt2].sort((a,b)=>b.score-a.score).slice(0,MAX_LB_ENTRIES);
        lbSaveCache(lbData);
        lbPush(playerName,score).then(()=>{
          lbData=lbData.map(e=>e._optimistic?{name:e.name,score:e.score,ts:e.ts,ip:e.ip}:e);
          lbSaveCache(lbData);
          const ri=renderLB(lbData,playerName);
          if(ri)statusEl.textContent='Rank #'+ri.rank+' \u2014 '+ri.score.toLocaleString()+' pts \u2713';
        }).catch(()=>{});
      }else{
        const ri=renderLB(lbData,playerName);
        if(ri)statusEl.textContent='Rank #'+ri.rank+' \u2014 '+ri.score.toLocaleString()+' pts';
      }
    }).catch(()=>{});
  }else{
    entryWrap.style.display='';
    $('lb-name-input').value='';statusEl.textContent='';
    $('lb-submit-btn').disabled=false;
    lbFetch().catch(()=>{});
  }
}

function goHome(){
  STATE='home';stopEngine();
  if(raf){cancelAnimationFrame(raf);raf=null;}
  traffic=[];particles=[];pops=[];
  dailyMode=false;_wasDaily=false;
  resumeCountdownActive=false;
  const dco=$('daily-complete-overlay');if(dco)dco.hidden=true;
  setHudVisible(false);showScreen('home');
}

function spawnExplosion(x,y){
  for(let i=0;i<26;i++){
    const a=Math.random()*Math.PI*2,s=1.5+Math.random()*5;
    particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-2.5,life:1,r:2+Math.random()*5,c:Math.random()<0.5?'#ff3c3c':'#ff8c00'});
  }
}
function showToast(el,dur=1000){
  el.hidden=false;el.classList.add('show');
  setTimeout(()=>{el.classList.remove('show');setTimeout(()=>{el.hidden=true;},250);},dur);
}

function levelUp(){
  level++;roadSpeed+=0.25;levelEl.textContent=level;showToast(levelToast,300);
}

function updateBoostArc(fraction){
  const el=document.getElementById('boost-arc-fill');
  if(!el)return;
  const circ=2*Math.PI*18;
  el.style.strokeDashoffset=(circ*(1-fraction)).toFixed(2);
  el.classList.toggle('ready',fraction>=1);
  const btn=$('btn-boost');
  if(btn){
    btn.classList.toggle('boost-ready',fraction>=1);
    btn.classList.toggle('boost-cooling',fraction>0&&fraction<1);
  }
  const lbl=$('boost-cd-label');
  if(lbl)lbl.textContent=fraction>=1?'':fraction<=0?'CD':Math.ceil(boostCooldown/1000)+'s';
}

function updatePerkTimerBar(){
  const bar=$('perk-timer-bar');
  const wrap=$('perk-timer-track');
  if(!bar)return;
  if(!activePerk){bar.style.width='0%';if(wrap)wrap.style.opacity='0';return;}
  const def=PERK_DEFS[activePerk.type];
  const frac=Math.max(0,(activePerk.expiresAt-Date.now())/def.dur);
  bar.style.width=(frac*100)+'%';
  bar.style.background=def.color;
  if(wrap)wrap.style.opacity='1';
}

function spawnPerk(){
  if(roadPerks.length>=2)return;
  const types=Object.keys(PERK_DEFS);
  const type=types[Math.floor(Math.random()*types.length)];
  const x=36+Math.random()*(GW-80);
  roadPerks.push({type,x,y:-32,pulse:0});
}
function collectPerk(type){
  const def=PERK_DEFS[type];
  activePerk={type,expiresAt:Date.now()+def.dur};
  const ph=$('perk-hud');
  if(ph){
    ph.innerHTML=type==='shield'
      ?'<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="#39ff8a" stroke-width="1.8"><path d="M10 2l7 3v5c0 4-3.5 7.5-7 8-3.5-.5-7-4-7-8V5z"/></svg>'
      :'<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="#ffd700" stroke-width="1.8"><text x="10" y="15" text-anchor="middle" font-size="11" font-weight="bold" fill="#ffd700" stroke="none">×2</text></svg>';
    ph.classList.add('active');
  }
  pops.push({x:GW/2,y:GH_BASE*0.38,a:1.5,t:def.label+'!',c:def.color});
  if(S.vibrateOn&&navigator.vibrate)navigator.vibrate([20,10,30]);
}
function clearPerk(){
  activePerk=null;
  const ph=$('perk-hud');if(ph){ph.innerHTML='';ph.classList.remove('active');}
  updatePerkTimerBar();
}
function isPerkActive(type){return activePerk&&activePerk.type===type&&Date.now()<activePerk.expiresAt;}

function drawPerks(){
  roadPerks.forEach(p=>{
    const def=PERK_DEFS[p.type];
    p.pulse=(p.pulse||0)+0.07;
    const glow=0.72+0.28*Math.sin(p.pulse);
    const px=p.x+16,py=p.y+16,r=16;
    ctx.save();
    ctx.globalAlpha=0.3*glow;
    ctx.strokeStyle=def.color;ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(px,py,r+3+Math.sin(p.pulse)*2,0,Math.PI*2);ctx.stroke();
    const grad=ctx.createRadialGradient(px,py,2,px,py,r);
    grad.addColorStop(0,def.color+'55');grad.addColorStop(1,def.color+'0a');
    ctx.globalAlpha=1;ctx.fillStyle=grad;
    ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=0.6*glow;ctx.strokeStyle=def.color;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2);ctx.stroke();
    ctx.globalAlpha=glow;
    if(p.type==='doubler'){
      ctx.font="bold 11px 'Orbitron',monospace";ctx.fillStyle=def.color;
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('\u00d72',px,py);
    }else{
      ctx.strokeStyle='#39ff8a';ctx.lineWidth=1.5;
      const s=7;
      ctx.beginPath();
      ctx.moveTo(px,py-s);ctx.lineTo(px+s*0.6,py-s*0.2);ctx.lineTo(px+s*0.4,py+s*0.6);
      ctx.lineTo(px,py+s*0.3);ctx.lineTo(px-s*0.4,py+s*0.6);ctx.lineTo(px-s*0.6,py-s*0.2);
      ctx.closePath();ctx.stroke();
    }
    ctx.restore();
  });
  ctx.textAlign='left';ctx.textBaseline='alphabetic';
}

function getStreakMult(){
  for(let i=STREAK_THRESHOLDS.length-1;i>=0;i--)
    if(streak>=STREAK_THRESHOLDS[i])return i+2;
  return 1;
}
function resetStreak(){
  if(streak>0){
    if(streak>stats.bestStreak){stats.bestStreak=streak;saveStats();}
    streak=0;streakTimer=0;updateStreakHUD();
  }
}
function updateStreakHUD(){
  const el=$('streak-display');if(!el)return;
  const mult=getStreakMult();
  if(streak<2||mult<=1){el.style.opacity='0';el.style.transform='translateY(-50%) scale(0.7)';}
  else{
    el.textContent='\u00d7'+mult;
    el.style.opacity='1';el.style.transform='translateY(-50%) scale(1)';
    el.style.color=mult>=5?'#ff3c3c':mult>=4?'#ff8c00':mult>=3?'#ffcc00':'#39ff8a';
  }
}
function updateDistHUD(metres){
  const el=$('hud-dist');if(!el)return;
  el.textContent=metres>=1000?(metres/1000).toFixed(2)+' km':metres+' m';
}

function checkAchievements(){
  ACHIEVEMENT_DEFS.forEach(def=>{
    if(achievements[def.id])return;
    if(!def.check())return;
    achievements[def.id]=true;saveAchievements();
    flashAchievementToast(def.name,def.tier);
    renderAchievementsTab();
  });
}
function flashAchievementToast(name,tier){
  const el=$('achievement-toast');if(!el)return;
  const tierLabel={easy:'Easy',medium:'Medium',hard:'Hard',impossible:'Impossible'}[tier]||'';
  el.innerHTML=ACH_SVGS[tier||'easy']+' <span>'+escHtml(name)+'</span><span class="ach-toast-tier"> '+tierLabel+'</span>';
  el.hidden=false;el.classList.add('show');
  setTimeout(()=>{el.classList.remove('show');setTimeout(()=>{el.hidden=true;},350);},2600);
}

const TIER_ORDER=['easy','medium','hard','impossible'];
const TIER_LABELS={easy:'EASY',medium:'MEDIUM',hard:'HARD',impossible:'IMPOSSIBLE'};
const TIER_COLORS={easy:'#39ff8a',medium:'#ff8c00',hard:'#ff3c3c',impossible:'#cc44ff'};

function renderAchievementsTab(){
  const el=$('achievements-list');if(!el)return;
  let html='';
  TIER_ORDER.forEach(tier=>{
    const defs=ACHIEVEMENT_DEFS.filter(d=>d.tier===tier);
    const doneCount=defs.filter(d=>achievements[d.id]).length;
    html+=`<div class="ach-tier-header" style="border-color:${TIER_COLORS[tier]};color:${TIER_COLORS[tier]}">
      ${ACH_SVGS[tier]}
      <span>${TIER_LABELS[tier]}</span>
      <span class="ach-tier-count">${doneCount}/${defs.length}</span>
    </div>`;
    defs.forEach(def=>{
      const done=!!achievements[def.id];
      html+=`<div class="ach-row${done?' ach-done':''}">
        <span class="ach-icon-wrap">${done?ACH_SVGS[def.tier]:'<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"><rect x="5" y="8" width="10" height="9" rx="1.5"/><path d="M7 8V6a3 3 0 0 1 6 0v2"/></svg>'}</span>
        <span class="ach-text"><span class="ach-label">${def.name}</span><span class="ach-desc">${def.desc}</span></span>
        ${done?'<svg class="ach-check" viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7" fill="#39ff8a22" stroke="#39ff8a" stroke-width="1.2"/><polyline points="5,8 7,10.5 11,6" fill="none" stroke="#39ff8a" stroke-width="1.5" stroke-linecap="round"/></svg>':''}
      </div>`;
    });
  });
  el.innerHTML=html;
}

function renderStatsScreen(){
  const el=$('stats-body');if(!el)return;
  const dist=stats.distance||0;
  const distStr=dist>=1000?(dist/1000).toFixed(1)+' km':dist+' m';
  const todaySeed=getTodaySeed();
  const dailyBest=(dailyState.seed===todaySeed&&dailyState.done)?dailyState.score:'\u2014';
  el.innerHTML=`
    <div class="stat-row"><span class="stat-lbl">Games Played</span><span class="stat-val">${stats.games}</span></div>
    <div class="stat-row"><span class="stat-lbl">Total Distance</span><span class="stat-val">${distStr}</span></div>
    <div class="stat-row"><span class="stat-lbl">All-Time Best</span><span class="stat-val">${best}</span></div>
    <div class="stat-row"><span class="stat-lbl">Today's Best</span><span class="stat-val">${dailyBest}</span></div>
    <div class="stat-row"><span class="stat-lbl">Best Streak</span><span class="stat-val">${stats.bestStreak}</span></div>
    <div class="stat-row"><span class="stat-lbl">Daily Challenges</span><span class="stat-val">${stats.dailyCount||0}</span></div>
    <div class="stat-row"><span class="stat-lbl">Medals</span><span class="stat-val">${Object.keys(achievements).length} / ${ACHIEVEMENT_DEFS.length}</span></div>
  `;
}

function openDailyChallenge(){
  const seed=getTodaySeed();
  dailyMode=true;dailyRng=makePRNG(seed);
  startGame();
}

function getDailyProgressValue(){
  if(dailyGoalType==='score')    return score;
  if(dailyGoalType==='nearmiss') return _gameMisses;
  if(dailyGoalType==='distance') return Math.round((distancePx/GH_BASE)*60);
  if(dailyGoalType==='level')    return level;
  return 0;
}

function checkDailyGoal(){
  if(!dailyMode||dailyComplete)return;
  dailyProgress=getDailyProgressValue();
  if(dailyProgress>=dailyGoalValue){
    dailyComplete=true;
    triggerDailyComplete();
  }
}

function triggerDailyComplete(){
  STATE='dailyComplete';
  stopEngine();
  const seed=getTodaySeed();
  const prev=(dailyState.seed===seed)?dailyState.score:0;
  const newScore=Math.max(score,prev);
  dailyState={seed,done:true,score:newScore};
  localStorage.setItem(DAILY_KEY,JSON.stringify(dailyState));
  const alreadyCounted=(stats._dailySeedCounted===seed);
  if(!alreadyCounted){
    stats.dailyCount=(stats.dailyCount||0)+1;
    stats._dailySeedCounted=seed;
    saveStats();
  }
  checkAchievements();
  const overlay=$('daily-complete-overlay');if(!overlay)return;
  const goal=getDailyGoal(seed);
  const titleEl=$('daily-complete-title');
  const goalEl=$('daily-complete-goal');
  const scoreEl2=$('daily-complete-score');
  const cdEl=$('daily-complete-countdown');
  if(titleEl)titleEl.textContent='DAILY COMPLETE!';
  if(goalEl)goalEl.textContent=goal.label+': '+dailyGoalValue+(goal.unit?' '+goal.unit:'');
  if(scoreEl2)scoreEl2.textContent='Score: '+score;
  overlay.hidden=false;
  let secs=5;
  if(cdEl)cdEl.textContent='Continuing in '+secs+'s\u2026';
  const tick=setInterval(()=>{
    secs--;
    if(secs<=0){
      clearInterval(tick);
      overlay.hidden=true;
      dailyMode=false;
      STATE='playing';
      lastTime=0;
      if(S.soundOn)startEngine();
      raf=requestAnimationFrame(loop);
    }else{
      if(cdEl)cdEl.textContent='Continuing in '+secs+'s\u2026';
    }
  },1000);
}

function finishDailyChallenge(){
  if(!_wasDaily)return;
  const seed=getTodaySeed();
  const reached=dailyProgress>=dailyGoalValue;
  if(reached){
    const prev=(dailyState.seed===seed)?dailyState.score:0;
    dailyState={seed,done:true,score:Math.max(score,prev)};
    localStorage.setItem(DAILY_KEY,JSON.stringify(dailyState));
  }
  const badge=$('go-daily-badge');
  if(badge){
    badge.hidden=false;
    const goal=getDailyGoal(seed);
    badge.textContent=(reached?'\u2713 DAILY COMPLETE  ':'')+'Goal: '+goal.label+' '+dailyGoalValue+(goal.unit?' '+goal.unit:'')+'  Progress: '+dailyProgress+(reached&&dailyState.done?' \u00b7 Best: '+dailyState.score:'');
  }
}

function drawDailyHUD(){
  if(!dailyMode||dailyComplete)return;
  dailyProgress=getDailyProgressValue();
  const frac=Math.min(1,dailyProgress/dailyGoalValue);
  const bx=8,by=10,bw=GW-16,bh=6;
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.5)';
  ctx.beginPath();ctx.roundRect(bx-1,by-1,bw+2,bh+2,4);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.06)';
  ctx.beginPath();ctx.roundRect(bx,by,bw,bh,3);ctx.fill();
  if(frac>0){
    const grad=ctx.createLinearGradient(bx,0,bx+bw*frac,0);
    grad.addColorStop(0,'#1a44bb');grad.addColorStop(1,'#55aaff');
    ctx.fillStyle=grad;
    ctx.beginPath();ctx.roundRect(bx,by,bw*frac,bh,3);ctx.fill();
  }
  const goal=getDailyGoal(getTodaySeed());
  ctx.font="bold 9px 'Orbitron',monospace";
  ctx.fillStyle='rgba(255,255,255,0.5)';ctx.textAlign='center';
  ctx.fillText('DAILY  '+dailyProgress+' / '+dailyGoalValue+(goal.unit?' '+goal.unit:''),GW/2,by+bh+11);
  ctx.textAlign='left';ctx.restore();
}

function drawFinishLine(){
  if(!dailyMode||dailyGoalType!=='distance')return;
  const currentMetres=Math.round((distancePx/GH_BASE)*60);
  const remaining=dailyGoalValue-currentMetres;
  if(remaining<=0||remaining>140)return;
  const pixelsPerMetre=GH_BASE/60;
  const finishY=GH_BASE-remaining*pixelsPerMetre;
  if(finishY<0||finishY>GH_BASE)return;
  ctx.save();
  const sq=12,cols=Math.ceil(GW/sq);
  for(let c=0;c<cols;c++){
    ctx.fillStyle=(c%2===0)?'rgba(255,255,255,0.9)':'rgba(0,0,0,0.85)';
    ctx.fillRect(c*sq,finishY,sq,sq*0.5);
  }
  ctx.shadowColor='#39ff8a';ctx.shadowBlur=16;
  ctx.strokeStyle='#39ff8a';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(0,finishY);ctx.lineTo(GW,finishY);ctx.stroke();
  ctx.shadowBlur=0;
  ctx.font="bold 10px 'Orbitron',monospace";
  ctx.fillStyle='#39ff8a';ctx.textAlign='center';
  ctx.fillText('FINISH  '+remaining+'m',GW/2,finishY-7);
  ctx.restore();ctx.textAlign='left';
}

let _resumeFlash=0;
function drawResumeCountdown(){
  if(!resumeCountdownActive)return;
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.55)';
  ctx.fillRect(0,0,GW,GH_BASE);
  _resumeFlash+=0.18;
  const pulse=0.8+0.2*Math.sin(_resumeFlash*6);
  ctx.globalAlpha=pulse;
  ctx.font="bold 88px 'Orbitron',monospace";
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle=resumeCountdown<=1?'#ff3c3c':resumeCountdown===2?'#ff8c00':'#ffffff';
  ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=24;
  ctx.fillText(resumeCountdown>0?resumeCountdown:'GO!',GW/2,GH_BASE/2);
  ctx.restore();
  ctx.textAlign='left';ctx.textBaseline='alphabetic';
}

function spawnSpeedLines(){
  if(speedLines.length>22)return;
  for(let i=0;i<3;i++)speedLines.push({x:Math.random()*GW,y:Math.random()*GH_BASE*0.6,len:18+Math.random()*55,alpha:0.55+Math.random()*0.4,speed:14+Math.random()*18});
}
function updateDrawSpeedLines(dt){
  if(!boostActive){speedLines=[];return;}
  spawnSpeedLines();
  ctx.save();
  for(let i=speedLines.length-1;i>=0;i--){
    const sl=speedLines[i];
    sl.y+=sl.speed*dt;sl.alpha-=0.045*dt;
    if(sl.alpha<=0||sl.y>GH_BASE+sl.len){speedLines.splice(i,1);continue;}
    ctx.globalAlpha=sl.alpha*0.65;ctx.strokeStyle='#fff';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(sl.x,sl.y);ctx.lineTo(sl.x,sl.y+sl.len);ctx.stroke();
  }
  ctx.restore();
}

function getHornDodgeFactor(npcX,npcY,carDrawY){
  const dx=Math.abs((npcX+NPC_W/2)-(carX+CAR_W/2));
  const dy=carDrawY-(npcY+NPC_H/2);
  const dist=Math.sqrt(dx*dx+dy*dy);
  const maxDist=150;
  if(dist>maxDist||dy<-40)return 0;
  return Math.max(0,1-dist/maxDist);
}

function spawnNPC(){
  const rng=dailyRng||Math.random.bind(Math);
  const lane=Math.floor(rng()*LANE_X.length);
  if(traffic.some(t=>t.lane===lane&&t.y<SAFE_GAP))return;
  const absFloor=BASE_SPD*0.25;
  const relBonus=0.6+rng()*1.0;
  const effectiveRoad=Math.max(BASE_SPD,roadSpeed);
  const spdRel=Math.max(absFloor,relBonus*(effectiveRoad/BASE_SPD));
  traffic.push({lane,x:LANE_X[lane]-NPC_W/2,y:-NPC_H,spdRel,imgIdx:Math.floor(rng()*npcImgs.length),dodgeVelX:0,dodgeOffsetX:0});
  if(level>=2&&rng()<0.20){
    const lane2=(lane+1+Math.floor(rng()*2))%LANE_X.length;
    const spdRel2=Math.max(absFloor,(0.6+rng()*1.0)*(effectiveRoad/BASE_SPD));
    if(!traffic.some(t=>t.lane===lane2&&t.y<SAFE_GAP))
      traffic.push({lane:lane2,x:LANE_X[lane2]-NPC_W/2,y:-NPC_H-30,spdRel:spdRel2,imgIdx:Math.floor(rng()*npcImgs.length),dodgeVelX:0,dodgeOffsetX:0});
  }
}

function hbox(x,y,w,h){return{l:x+HITPAD,r:x+w-HITPAD,t:y+HITPAD,b:y+h-HITPAD};}
function overlaps(a,b){return!(a.b<b.t||a.t>b.b||a.r<b.l||a.l>b.r);}
function lerp(a,b,t){return a+(b-a)*t;}
function checkBarrierCollision(){
  if(carX<BARRIER_L){carX=BARRIER_L;carVelX=-carVelX*0.4;spawnExplosion(carX+CAR_W/2,GH_BASE-CAR_H-CAR_BASE_Y_OFFSET);return true;}
  if(carX>BARRIER_R){carX=BARRIER_R;carVelX=-carVelX*0.4;spawnExplosion(carX+CAR_W/2,GH_BASE-CAR_H-CAR_BASE_Y_OFFSET);return true;}
  return false;
}

function draw(){
  const rh=roadImg.naturalHeight||600;
  if(rh>1){
    const off=((roadY%rh)+rh)%rh;
    for(let y=off-rh;y<GH_BASE;y+=rh)ctx.drawImage(roadImg,0,y,GW,rh);
  }else{
    ctx.fillStyle='#1a1a1f';ctx.fillRect(0,0,GW,GH_BASE);
  }

  traffic.forEach(t=>{
    const drawX=t.x+(t.dodgeOffsetX||0);
    const npcTilt=t.dodgeTilt||0;
    if(Math.abs(npcTilt)>0.005){
      ctx.save();
      ctx.translate(drawX+NPC_W/2,t.y+NPC_H*0.5);
      ctx.rotate(npcTilt);
      ctx.drawImage(npcImgs[t.imgIdx],0,0,120,120,-NPC_W/2,-NPC_H*0.5,NPC_W,NPC_H);
      ctx.restore();
    }else{
      ctx.drawImage(npcImgs[t.imgIdx],0,0,120,120,drawX,t.y,NPC_W,NPC_H);
    }
  });

  drawPerks();

  const carDrawY=GH_BASE-CAR_H-CAR_BASE_Y_OFFSET-carYOffset;

  if(boostActive){
    ctx.save();
    for(let i=1;i<=4;i++){ctx.globalAlpha=0.13/i;ctx.drawImage(carImg,0,0,120,120,carX,carDrawY+i*6,CAR_W,CAR_H);}
    ctx.restore();
    updateDrawSpeedLines(1);
  }

  if(isPerkActive('shield')){
    const pulse=0.7+0.3*Math.sin(Date.now()/180);
    ctx.save();
    ctx.globalAlpha=0.35*pulse;
    ctx.strokeStyle='#39ff8a';ctx.lineWidth=3;
    ctx.shadowColor='#39ff8a';ctx.shadowBlur=12;
    ctx.beginPath();ctx.ellipse(carX+CAR_W/2,carDrawY+CAR_H/2,CAR_W/2+5,CAR_H/2+5,0,0,Math.PI*2);ctx.stroke();
    ctx.restore();
  }

  if(Math.abs(carTilt)>0.005){
    ctx.save();
    ctx.translate(carX+CAR_W/2,carDrawY+CAR_H*0.55);
    ctx.rotate(carTilt);
    ctx.drawImage(carImg,0,0,120,120,-CAR_W/2,-CAR_H*0.55,CAR_W,CAR_H);
    ctx.restore();
  }else{
    ctx.drawImage(carImg,0,0,120,120,carX,carDrawY,CAR_W,CAR_H);
  }

  if(particles.length){
    particles.forEach(p=>{ctx.globalAlpha=p.life;ctx.fillStyle=p.c;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(0.1,p.r*p.life),0,Math.PI*2);ctx.fill();});
    ctx.globalAlpha=1;
  }

  if(pops.length){
    ctx.font="bold 13px 'Orbitron',monospace";ctx.textAlign='center';
    pops.forEach(p=>{ctx.globalAlpha=Math.min(1,p.a);ctx.fillStyle=p.c||'#fff';ctx.fillText(p.t||'+1',p.x,p.y);});
    ctx.globalAlpha=1;ctx.textAlign='left';
  }

  const mult=getStreakMult();
  if(streak>=2&&mult>1){
    const pulse=0.85+0.15*Math.sin(Date.now()/120);
    ctx.save();
    ctx.globalAlpha=Math.min(1,streakTimer/40)*pulse;
    ctx.font=`bold ${12+mult*2}px 'Orbitron',monospace`;
    ctx.textAlign='center';
    ctx.fillStyle=mult>=5?'#ff3c3c':mult>=4?'#ff8c00':mult>=3?'#ffcc00':'#39ff8a';
    ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=10;
    ctx.fillText('\u00d7'+mult,carX+CAR_W/2,carDrawY-10);
    ctx.restore();
  }

  if(dailyMode&&!dailyComplete)drawDailyHUD();
  if(dailyMode&&!dailyComplete)drawFinishLine();
  if(resumeCountdownActive)drawResumeCountdown();
}

let _resumeLastFlip=0;
function updateHUD(){
  const pct=Math.min(100,(roadSpeed/(BASE_SPD*2.8))*100);
  const kmh=Math.round(pct*2.2);
  drawSpeedometer(kmh);
  if(S.soundOn)updateEngineAudio(pct,boostActive,brakeActive);
  const metres=Math.round((distancePx/GH_BASE)*60);
  updateDistHUD(metres);
  updatePerkTimerBar();
}

function loop(ts){
  if(STATE==='resuming'){
    const dt2=Math.min(lastTime?(ts-lastTime)/16.667:1,2.5);
    lastTime=ts;
    const now=performance.now();
    if(now-_resumeLastFlip>1000){
      _resumeLastFlip=now;
      resumeCountdown--;
      if(resumeCountdown<=0){
        resumeCountdownActive=false;
        STATE='playing';
        if(S.soundOn)startEngine();
        raf=requestAnimationFrame(loop);
        return;
      }
    }
    for(let i=particles.length-1;i>=0;i--){
      const p=particles[i];
      p.x+=p.vx*dt2;p.y+=p.vy*dt2;p.vy+=0.15*dt2;p.life-=0.035*dt2;
      if(p.life<=0)particles.splice(i,1);
    }
    draw();
    raf=requestAnimationFrame(loop);
    return;
  }

  if(STATE!=='playing'&&STATE!=='dying')return;
  const dt=Math.min(lastTime?(ts-lastTime)/16.667:1,2.5);
  lastTime=ts;

  if(STATE==='playing'){
    roadY+=roadSpeed*dt;
    distancePx+=roadSpeed*dt;

    const eff=steerInput!==0?steerInput:(S.gyroOn?gyroSteer:0);

    if(boostActive){boostTimer-=dt*16.667;if(boostTimer<=0)boostActive=false;}
    if(hornActive){hornTimer-=dt*16.667;if(hornTimer<=0)hornActive=false;}

    if(!boostActive&&boostCooldown>0){
      boostCooldown-=dt*16.667;
      if(boostCooldown<0)boostCooldown=0;
      updateBoostArc(1-boostCooldown/BOOST_COOLDOWN);
    }

    const cruiseSpeed=BASE_SPD+(level-1)*0.45;
    const boostTarget=cruiseSpeed*2.1;
    let targetSpeed,accelT;
    if(boostActive){
      const elapsed=BOOST_DURATION-boostTimer;
      const t2=Math.min(1,elapsed/2000);
      const eased=t2*t2*(3-2*t2);
      targetSpeed=cruiseSpeed+(boostTarget-cruiseSpeed)*eased;
      accelT=0.04*dt;
    }else if(brakeActive){
      targetSpeed=cruiseSpeed*0.30;
      accelT=0.14*dt;
    }else{
      targetSpeed=cruiseSpeed;
      accelT=roadSpeed>cruiseSpeed?0.03*dt:0.018*dt;
    }
    roadSpeed=lerp(roadSpeed,targetSpeed,accelT);

    carYOffsetTarget=boostActive?CAR_BOOST_Y_LIFT:brakeActive?BRAKE_Y_LIFT:0;
    carYOffset=lerp(carYOffset,carYOffsetTarget,0.12*dt);

    const isHolding=steerInput!==0||(S.gyroOn&&Math.abs(gyroSteer)>0.05);
    const fric=isHolding?Math.pow(STEER_FRICTION,dt):Math.pow(STEER_RELEASE_FRICTION,dt);
    carVelX+=eff*steerAccel()*(boostActive?1.9:1)*(brakeActive?0:1)*dt;
    carVelX*=fric;
    carVelX=Math.max(-MAX_STEER_SPD,Math.min(MAX_STEER_SPD,carVelX));
    carX=Math.max(0,Math.min(GW-CAR_W,carX+carVelX*dt));

    if(checkBarrierCollision()){
      if(Math.abs(carVelX)>3){
        spawnExplosion(carX+CAR_W/2,GH_BASE-CAR_H-CAR_BASE_Y_OFFSET);
        STATE='dying';deathTimer=520;stopEngine();playCrash();
        gc.classList.add('shake');setTimeout(()=>gc.classList.remove('shake'),400);
        raf=requestAnimationFrame(loop);return;
      }
    }

    carTiltTarget=(carVelX/MAX_STEER_SPD)*MAX_TILT;
    carTilt=lerp(carTilt,carTiltTarget,(isHolding?TILT_SPEED:TILT_RETURN)*dt);

    const carDrawY=GH_BASE-CAR_H-CAR_BASE_Y_OFFSET-carYOffset;
    const chb=hbox(carX,carDrawY,CAR_W,CAR_H);

    if(activePerk&&Date.now()>=activePerk.expiresAt)clearPerk();

    for(let i=roadPerks.length-1;i>=0;i--){
      const p=roadPerks[i];
      p.y+=Math.max(BASE_SPD*0.5,roadSpeed)*dt;
      if(p.y>GH_BASE+32){roadPerks.splice(i,1);continue;}
      const px=p.x+16,py=p.y+16;
      const carCX=carX+CAR_W/2,carCY=carDrawY+CAR_H/2;
      if(Math.hypot(px-carCX,py-carCY)<36){collectPerk(p.type);roadPerks.splice(i,1);}
    }
    perkSpawnTimer+=dt;
    if(perkSpawnTimer>=PERK_SPAWN_INTERVAL){spawnPerk();perkSpawnTimer=0;}

    for(let i=traffic.length-1;i>=0;i--){
      const t=traffic[i];
      const npcMove=(Math.max(BASE_SPD*0.5,roadSpeed)+t.spdRel);
      t.y+=npcMove*dt;

      if(hornActive){
        const dodge=getHornDodgeFactor(t.x+(t.dodgeOffsetX||0),t.y,carDrawY);
        if(dodge>0){
          const carCX=carX+CAR_W/2,npcCX=t.x+(t.dodgeOffsetX||0)+NPC_W/2;
          const dir=npcCX>carCX?1:-1;
          t.dodgeVelX=lerp(t.dodgeVelX||0,dir*dodge*2.8*(roadSpeed/BASE_SPD),0.045*dt);
        }
      }else{
        t.dodgeVelX=lerp(t.dodgeVelX||0,0,0.01*dt);
      }
      t.dodgeOffsetX=(t.dodgeOffsetX||0)+(t.dodgeVelX||0)*dt;
      t.dodgeTilt=lerp(t.dodgeTilt||0,(t.dodgeVelX||0)/(2.8*1.5)*(-0.18),0.08*dt);
      const rawX=t.x+t.dodgeOffsetX;
      if(rawX<0)t.dodgeOffsetX=-t.x;
      if(rawX+NPC_W>GW)t.dodgeOffsetX=GW-NPC_W-t.x;

      if(t.y>GH_BASE+NPC_H){
        traffic.splice(i,1);
        const mult=getStreakMult();
        const doublerOn=isPerkActive('doubler');
        const pts=1*mult*(doublerOn?2:1);
        score+=pts;scoreEl.textContent=score;
        const label=pts>1?'+'+pts+(mult>1?'\u00d7'+mult:'')+(doublerOn?'\u00d72':''):'+1';
        pops.push({x:t.x+NPC_W/2,y:GH_BASE-50,a:1,t:label,c:doublerOn?'#ffd700':mult>1?'#39ff8a':'#fff'});
        if(score%12===0)levelUp();
        checkDailyGoal();
        continue;
      }

      const nb=hbox(t.x+(t.dodgeOffsetX||0),t.y,NPC_W,NPC_H);

      if(overlaps(chb,nb)){
        if(isPerkActive('shield')){
          t.dodgeVelX=(t.x<carX?-5:5);t.y-=14;
          clearPerk();
          pops.push({x:carX+CAR_W/2,y:carDrawY-20,a:1.5,t:'SHIELD!',c:'#39ff8a'});
          if(S.vibrateOn&&navigator.vibrate)navigator.vibrate([10,5,10]);
        }else{
          spawnExplosion(carX+CAR_W/2,carDrawY+CAR_H/2);
          STATE='dying';deathTimer=520;stopEngine();playCrash();
          gc.classList.add('shake');setTimeout(()=>gc.classList.remove('shake'),400);
          break;
        }
      }

      const exp={l:nb.l-14,r:nb.r+14,t:nb.t,b:nb.b};
      if(overlaps(chb,exp)&&!overlaps(chb,nb)&&nearMissTimer<=0){
        nearMissTimer=60;
        streak++;streakTimer=STREAK_TIMEOUT;_gameMisses++;
        checkDailyGoal();
        const mult=getStreakMult();
        const doublerOn=isPerkActive('doubler');
        const pts=3*mult*(doublerOn?2:1);
        score+=pts;scoreEl.textContent=score;
        const multLabel=mult>1?' \u00d7'+mult+'!':'';
        const doublerLabel=doublerOn?' \u00d72':'';
        pops.push({x:nb.l+(nb.r-nb.l)/2,y:t.y,a:1,
          t:'CLOSE! +'+pts+multLabel+doublerLabel,
          c:mult>=4?'#ff3c3c':mult>=3?'#ff8c00':'#ffcc00'});
        if(S.vibrateOn&&navigator.vibrate)navigator.vibrate(30);
        playWhoosh();updateStreakHUD();checkAchievements();
      }
    }
    if(nearMissTimer>0)nearMissTimer-=dt;

    if(streakTimer>0){streakTimer-=dt;if(streakTimer<=0)resetStreak();}
    if(hornActive||brakeActive)resetStreak();

    for(let i=0;i<traffic.length;i++){
      for(let j=i+1;j<traffic.length;j++){
        const a=traffic[i],b=traffic[j];
        const ax=a.x+(a.dodgeOffsetX||0),bx=b.x+(b.dodgeOffsetX||0);
        if(overlaps(hbox(ax,a.y,NPC_W,NPC_H),hbox(bx,b.y,NPC_W,NPC_H))){
          const push=1.5;
          a.dodgeOffsetX=(a.dodgeOffsetX||0)+(ax<bx?-push:push);
          b.dodgeOffsetX=(b.dodgeOffsetX||0)+(bx<ax?-push:push);
          if(a.spdRel>b.spdRel)a.spdRel*=0.98;else b.spdRel*=0.98;
        }
      }
    }

    spawnTimer+=dt*16.667;
    const spawnInterval=Math.max(300,SPAWN_MS-(level-1)*40-(roadSpeed-BASE_SPD)*15);
    if(spawnTimer>=spawnInterval){spawnNPC();spawnTimer=0;}
    updateHUD();

  }else{
    deathTimer-=dt*16.667;
    if(deathTimer<=0){doGameOver();return;}
  }

  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=0.15*dt;p.life-=0.035*dt;
    if(p.life<=0)particles.splice(i,1);
  }
  for(let i=pops.length-1;i>=0;i--){
    pops[i].y-=1.5*dt;pops[i].a-=0.045*dt;
    if(pops[i].a<=0)pops.splice(i,1);
  }

  draw();
  raf=requestAnimationFrame(loop);
}

let audioCtx=null;
function getAudioCtx(){
  if(!audioCtx||audioCtx.state==='closed')audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==='suspended')audioCtx.resume();
  return audioCtx;
}
const RPM_IDLE=600,RPM_CRUISE=3000,RPM_MAX=6500;
function speedToRPM(spd,isBoost,isBrake){
  if(isBrake)return Math.max(RPM_IDLE+100,_currentRPM*0.55);
  const frac=Math.min(1,spd/(BASE_SPD*2.5));
  const base=RPM_IDLE+frac*(RPM_CRUISE-RPM_IDLE);
  return isBoost?Math.min(RPM_MAX,base*1.3):Math.min(RPM_MAX,base);
}
function rpmToRate(rpm){return Math.max(0.25,rpm/2200);}
function rpmToHz(rpm){return(rpm/60)*2;}

let engineBuffer=null,_engineLoading=false,eng=null,_currentRPM=RPM_IDLE,_rpmTick=0;
function makeDistortionCurve(amount){
  const n=512,c=new Float32Array(n);
  for(let i=0;i<n;i++){const x=(i*2)/n-1;c[i]=((Math.PI+amount)*x)/(Math.PI+amount*Math.abs(x));}
  return c;
}
async function loadEngineBuffer(){
  if(engineBuffer||_engineLoading)return;
  _engineLoading=true;
  try{const ac=getAudioCtx();const resp=await fetch('sounds/engine.wav');const ab=await resp.arrayBuffer();engineBuffer=await ac.decodeAudioData(ab);}catch(e){console.warn('engine audio failed',e);}
  _engineLoading=false;
}
loadEngineBuffer();

function startEngine(){
  if(!S.soundOn)return;
  stopEngine();
  const ac=getAudioCtx();const now=ac.currentTime;
  _currentRPM=RPM_IDLE;
  const masterGain=ac.createGain();masterGain.gain.setValueAtTime(0.001,now);masterGain.gain.linearRampToValueAtTime(0.58,now+2.2);
  const boostGain=ac.createGain();boostGain.gain.value=1;
  const comp=ac.createDynamicsCompressor();comp.threshold.value=-18;comp.knee.value=12;comp.ratio.value=4;comp.attack.value=0.006;comp.release.value=0.25;
  const lp=ac.createBiquadFilter();lp.type='lowpass';lp.frequency.value=2400;lp.Q.value=0.6;
  const hp=ac.createBiquadFilter();hp.type='highpass';hp.frequency.value=55;hp.Q.value=0.5;
  const waveshaper=ac.createWaveShaper();waveshaper.curve=makeDistortionCurve(30);waveshaper.oversample='2x';
  hp.connect(waveshaper);waveshaper.connect(lp);lp.connect(comp);comp.connect(boostGain);boostGain.connect(masterGain);masterGain.connect(ac.destination);
  let src=null;
  if(engineBuffer){
    const srcGain=ac.createGain();srcGain.gain.value=0.80;
    src=ac.createBufferSource();src.buffer=engineBuffer;src.loop=true;src.playbackRate.value=rpmToRate(RPM_IDLE);
    src.connect(srcGain);srcGain.connect(hp);src.start(now);
  }
  const harmonicDefs=[{mult:1,amp:0.22,type:'sawtooth'},{mult:2,amp:0.12,type:'sawtooth'},{mult:3,amp:0.05,type:'square'},{mult:0.5,amp:0.10,type:'sine'}];
  const baseHz=rpmToHz(RPM_IDLE);
  const synthNodes=harmonicDefs.map(def=>{const osc=ac.createOscillator();const g=ac.createGain();osc.type=def.type;osc.frequency.value=baseHz*def.mult;g.gain.value=def.amp*0.15;osc.connect(g);g.connect(hp);osc.start(now);return{osc,g,mult:def.mult,baseAmp:def.amp};});
  eng={src,synthNodes,lp,hp,comp,boostGain,masterGain};
}
function stopEngine(){
  if(!eng)return;
  try{if(eng.src)eng.src.stop();eng.synthNodes.forEach(n=>{try{n.osc.stop();}catch{}});try{eng.masterGain.gain.cancelScheduledValues(0);eng.masterGain.disconnect();}catch{}try{eng.boostGain.gain.cancelScheduledValues(0);eng.boostGain.disconnect();}catch{}try{eng.comp.disconnect();}catch{}try{eng.lp.frequency.cancelScheduledValues(0);eng.lp.disconnect();}catch{}try{if(eng.hp)eng.hp.disconnect();}catch{}}catch{}
  eng=null;
}
function updateEngineAudio(pct,isBoost,isBrake){
  if(!eng)return;
  const ac=getAudioCtx();const now=ac.currentTime;
  const targetRPM=speedToRPM(roadSpeed,isBoost,isBrake);
  const rpmLerp=isBoost?0.10:isBrake?0.06:0.028;
  _currentRPM=_currentRPM+(targetRPM-_currentRPM)*rpmLerp;
  _rpmTick++;
  const rpmDisplay=(_rpmTick%4===0)?_currentRPM*(0.985+Math.random()*0.03):_currentRPM;
  const rate=rpmToRate(rpmDisplay),freqHz=rpmToHz(rpmDisplay);
  if(eng.src)eng.src.playbackRate.linearRampToValueAtTime(rate,now+0.055);
  eng.synthNodes.forEach(n=>{
    n.osc.frequency.linearRampToValueAtTime(freqHz*n.mult,now+0.055);
    const rpmFactor=Math.max(0,Math.min(1,(_currentRPM-(RPM_IDLE+400))/(RPM_CRUISE-RPM_IDLE)));
    n.g.gain.linearRampToValueAtTime(n.baseAmp*(0.08+rpmFactor*0.85),now+0.08);
  });
  const lpFreq=850+(_currentRPM/RPM_MAX)*3400;
  eng.lp.frequency.linearRampToValueAtTime(lpFreq,now+0.10);
  const vol=0.32+(pct/100)*0.22;
  eng.masterGain.gain.linearRampToValueAtTime(isBoost?vol+0.08:vol,now+0.10);
}
function playBoostSurge(){
  if(!S.soundOn||!eng)return;
  const ac=getAudioCtx();const now=ac.currentTime;
  eng.boostGain.gain.cancelScheduledValues(now);eng.boostGain.gain.setValueAtTime(eng.boostGain.gain.value,now);
  eng.boostGain.gain.linearRampToValueAtTime(1.9,now+0.08);eng.boostGain.gain.linearRampToValueAtTime(1.35,now+0.45);eng.boostGain.gain.linearRampToValueAtTime(1.0,now+1.6);
  _currentRPM=Math.min(RPM_MAX,_currentRPM*1.6);_playTurboHiss();
}
function _playTurboHiss(){
  if(!S.soundOn)return;
  try{const ac=getAudioCtx();const now=ac.currentTime;const len=Math.floor(ac.sampleRate*0.9);const buf=ac.createBuffer(1,len,ac.sampleRate);const d=buf.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;const src=ac.createBufferSource();src.buffer=buf;const hp=ac.createBiquadFilter();hp.type='highpass';hp.frequency.value=2200;const bp=ac.createBiquadFilter();bp.type='bandpass';bp.frequency.value=4000;bp.Q.value=2.2;const g=ac.createGain();g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(0.26,now+0.05);g.gain.setValueAtTime(0.26,now+0.28);g.gain.exponentialRampToValueAtTime(0.001,now+0.88);src.connect(hp);hp.connect(bp);bp.connect(g);g.connect(ac.destination);src.start(now);src.stop(now+0.9);}catch{}
}
function playWhoosh(){
  if(!S.soundOn)return;
  try{
    const ac=getAudioCtx();const now=ac.currentTime;
    const dur=0.52;
    const buf=ac.createBuffer(2,Math.floor(ac.sampleRate*dur),ac.sampleRate);
    for(let ch=0;ch<2;ch++){
      const d=buf.getChannelData(ch);
      for(let i=0;i<d.length;i++){
        const t=i/ac.sampleRate;
        d[i]=(Math.random()*2-1)*0.7+Math.sin(t*420+Math.random()*0.3)*0.12;
      }
    }
    const src=ac.createBufferSource();src.buffer=buf;
    const bp=ac.createBiquadFilter();bp.type='bandpass';
    bp.frequency.setValueAtTime(3200,now);
    bp.frequency.exponentialRampToValueAtTime(160,now+dur);
    bp.Q.value=0.8;
    const hp=ac.createBiquadFilter();hp.type='highpass';hp.frequency.value=100;
    const g=ac.createGain();
    g.gain.setValueAtTime(0,now);
    g.gain.linearRampToValueAtTime(0.52,now+0.022);
    g.gain.exponentialRampToValueAtTime(0.001,now+dur);
    src.connect(bp);bp.connect(hp);hp.connect(g);g.connect(ac.destination);
    src.start(now);src.stop(now+dur);
  }catch{}
}
const sndCrash=$('snd-crash');
function playCrash(){
  if(!S.soundOn)return;
  sndCrash.currentTime=0;sndCrash.play().catch(()=>{});
  try{const ac=getAudioCtx();const now=ac.currentTime;const bufSize=Math.floor(ac.sampleRate*0.6);const buf=ac.createBuffer(1,bufSize,ac.sampleRate);const data=buf.getChannelData(0);for(let i=0;i<bufSize;i++){const t=i/ac.sampleRate;data[i]=(Math.random()*2-1)*Math.exp(-t*8);}const src=ac.createBufferSource();src.buffer=buf;const lp=ac.createBiquadFilter();lp.type='lowpass';lp.frequency.value=380;const g=ac.createGain();g.gain.setValueAtTime(0.9,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.55);src.connect(lp);lp.connect(g);g.connect(ac.destination);src.start(now);src.stop(now+0.65);}catch{}
}
function playHorn(){
  if(!S.soundOn)return;
  try{const ac=getAudioCtx();const now=ac.currentTime;const masterGain=ac.createGain();masterGain.gain.setValueAtTime(0,now);masterGain.gain.linearRampToValueAtTime(0.35,now+0.03);masterGain.gain.setValueAtTime(0.35,now+0.22);masterGain.gain.exponentialRampToValueAtTime(0.001,now+0.42);masterGain.connect(ac.destination);[415,523,622].forEach(freq=>{const osc=ac.createOscillator();const g=ac.createGain();osc.type='sawtooth';osc.frequency.setValueAtTime(freq*0.97,now);osc.frequency.linearRampToValueAtTime(freq,now+0.04);g.gain.setValueAtTime(0.4,now);osc.connect(g);g.connect(masterGain);osc.start(now);osc.stop(now+0.45);});const noise=ac.createOscillator();const ng=ac.createGain();noise.type='square';noise.frequency.setValueAtTime(80,now);ng.gain.setValueAtTime(0.06,now);ng.gain.exponentialRampToValueAtTime(0.001,now+0.1);noise.connect(ng);ng.connect(masterGain);noise.start(now);noise.stop(now+0.12);}catch{}
}

$('play-btn').addEventListener('click',startGame);
$('pause-btn').addEventListener('click',pauseGame);
$('resume-btn').addEventListener('click',resumeGame);
$('retry-btn').addEventListener('click',()=>{if(_wasDaily){dailyMode=true;dailyRng=makePRNG(getTodaySeed());}startGame();});
$('home-from-pause').addEventListener('click',goHome);
$('home-from-go').addEventListener('click',goHome);
$('lb-open-btn').addEventListener('click',openLeaderboard);
$('lb-close-btn').addEventListener('click',()=>showScreen('home'));
$('stats-open-btn').addEventListener('click',()=>showScreen('stats'));
$('stats-close-btn').addEventListener('click',()=>showScreen('home'));
$('achievements-open-btn').addEventListener('click',()=>showScreen('achievements'));
$('achievements-close-btn').addEventListener('click',()=>showScreen('home'));
$('daily-btn').addEventListener('click',openDailyChallenge);

function openSettings(prev){applySettingsUI();screenSettings.dataset.prev=prev||'home';showScreen('settings');}
$('settings-open-btn').addEventListener('click',()=>openSettings('home'));
$('settings-pause-btn').addEventListener('click',()=>{pauseGame();openSettings('pause');});
$('settings-close-btn').addEventListener('click',()=>{const prev=screenSettings.dataset.prev||'home';if(prev==='pause')showScreen('pause');else goHome();});

$('lb-submit-btn').addEventListener('click',async()=>{
  const name=$('lb-name-input').value.trim();
  if(!name){$('lb-submit-status').textContent='Enter your name!';return;}
  playerName=name;localStorage.setItem(LB_PLAYER_KEY,name);
  $('lb-submit-btn').disabled=true;$('lb-submit-status').textContent='Submitting\u2026';
  await bindNameToIP(name);
  try{await lbFetch();}catch{}
  syncBestFromRemoteByName(name);bestEl.textContent=best;goBestEl.textContent=best;
  const nameKey=name.toLowerCase();const base=lbData.length?lbData:lbLoadCache();
  const submitScore=Math.max(score,best);
  const opt={name,score:submitScore,ts:Date.now(),_optimistic:true,ip:clientIP||undefined};
  const withNew=[...base.filter(e=>clientIP?(e.ip?e.ip!==clientIP:e.name.toLowerCase()!==nameKey):e.name.toLowerCase()!==nameKey),opt].sort((a,b)=>b.score-a.score).slice(0,MAX_LB_ENTRIES);
  lbSaveCache(withNew);lbData=withNew;
  const ri=renderLB(lbData,playerName);
  if(ri)$('lb-submit-status').textContent='Rank #'+ri.rank+' \u2014 '+ri.score.toLocaleString()+' pts';
  else $('lb-submit-status').textContent='\u2713 Submitted!';
  $('lb-entry-wrap').style.display='none';
  lbPush(name,submitScore).then(()=>{
    lbData=lbData.map(e=>e._optimistic?{name:e.name,score:e.score,ts:e.ts,ip:e.ip}:e);
    lbSaveCache(lbData);
    const ri2=renderLB(lbData,playerName);
    if(ri2)$('lb-submit-status').textContent='Rank #'+ri2.rank+' \u2014 '+ri2.score.toLocaleString()+' pts \u2713';
  }).catch(()=>{});
});

$('btn-left').addEventListener('pointerdown',e=>{e.preventDefault();steerInput=-1;});
$('btn-right').addEventListener('pointerdown',e=>{e.preventDefault();steerInput=1;});
$('btn-left').addEventListener('pointerup',e=>{e.preventDefault();steerInput=0;carVelX*=0.7;});
$('btn-right').addEventListener('pointerup',e=>{e.preventDefault();steerInput=0;carVelX*=0.7;});
$('btn-left').addEventListener('pointerleave',e=>{if(e.buttons>0){steerInput=0;carVelX*=0.7;}});
$('btn-right').addEventListener('pointerleave',e=>{if(e.buttons>0){steerInput=0;carVelX*=0.7;}});
document.addEventListener('pointerup',()=>{steerInput=0;brakeActive=false;});
document.addEventListener('pointercancel',()=>{steerInput=0;carVelX=0;brakeActive=false;});

$('btn-boost').addEventListener('pointerdown',e=>{
  e.preventDefault();
  if(STATE!=='playing')return;
  if(boostCooldown>0)return;
  boostActive=true;boostTimer=BOOST_DURATION;boostCooldown=BOOST_COOLDOWN;
  updateBoostArc(0);playBoostSurge();showToast(boostToast,300);
  if(S.vibrateOn&&navigator.vibrate)navigator.vibrate(60);
});
$('btn-boost').addEventListener('pointerup',e=>e.preventDefault());

const brakeBtn=$('btn-brake');
if(brakeBtn){
  brakeBtn.addEventListener('pointerdown',e=>{e.preventDefault();if(STATE!=='playing')return;brakeActive=true;});
  brakeBtn.addEventListener('pointerup',e=>{e.preventDefault();brakeActive=false;});
  brakeBtn.addEventListener('pointerleave',e=>{if(e.buttons>0)brakeActive=false;});
}

$('btn-horn').addEventListener('pointerdown',e=>{
  e.preventDefault();
  if(STATE!=='playing')return;
  _hornThisGame=true;playHorn();hornActive=true;hornTimer=1000;
  if(S.vibrateOn&&navigator.vibrate)navigator.vibrate([15,10,20]);
});

let swipeX=null,swipeStartX=null;
gc.addEventListener('touchstart',e=>{if(S.swipeOn){swipeX=e.touches[0].clientX;swipeStartX=swipeX;}},{passive:true});
gc.addEventListener('touchmove',e=>{
  if(!S.swipeOn||swipeX===null)return;
  const dx=e.touches[0].clientX-swipeX;
  if(Math.abs(e.touches[0].clientX-swipeStartX)>6){steerInput=dx>0?1:-1;carVelX+=(dx>0?1:-1)*Math.min(Math.abs(dx)/18,1)*steerAccel()*0.6;}
  swipeX=e.touches[0].clientX;
},{passive:true});
gc.addEventListener('touchend',()=>{steerInput=0;swipeX=null;carVelX*=0.75;},{passive:true});

document.addEventListener('keydown',e=>{
  if(e.key==='ArrowLeft')steerInput=-1;
  else if(e.key==='ArrowRight')steerInput=1;
  else if(e.key==='ArrowDown')brakeActive=true;
  else if(e.key==='ArrowUp'&&boostCooldown<=0){boostActive=true;boostTimer=BOOST_DURATION;boostCooldown=BOOST_COOLDOWN;updateBoostArc(0);playBoostSurge();}
  else if((e.key==='b'||e.key==='B')&&boostCooldown<=0){boostActive=true;boostTimer=BOOST_DURATION;boostCooldown=BOOST_COOLDOWN;updateBoostArc(0);playBoostSurge();}
  else if(e.key===' ')STATE==='playing'?pauseGame():STATE==='paused'?resumeGame():null;
  else if(e.key==='h'||e.key==='H'){_hornThisGame=true;playHorn();hornActive=true;hornTimer=1200;}
});
document.addEventListener('keyup',e=>{
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){steerInput=0;carVelX*=0.7;}
  if(e.key==='ArrowDown')brakeActive=false;
});

function requestGyroPermission(){if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function')DeviceOrientationEvent.requestPermission().catch(()=>{});}
window.addEventListener('deviceorientation',e=>{
  if(!S.gyroOn||STATE!=='playing'||e.gamma===null)return;
  const dead=5-S.sensitivity*0.3,g=e.gamma;
  gyroSteer=Math.abs(g)<dead?0:Math.max(-1,Math.min(1,(g-Math.sign(g)*dead)/18));
});

document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('gesturechange',e=>e.preventDefault());

applySettingsUI();
showScreen('home');
setHudVisible(false);
drawSpeedometer(0);
updateStreakHUD();
renderAchievementsTab();
updateBoostArc(1);
lbFetch();

(async()=>{
  const ip=await fetchClientIP();
  if(ip&&!playerName){const mapped=ipNameMap[ip];if(mapped){playerName=mapped;localStorage.setItem(LB_PLAYER_KEY,mapped);}}
  syncBestFromRemote();
})();

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    const hadController=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').then(reg=>{
      reg.addEventListener('updatefound',()=>{
        if(!hadController) return;
        const w=reg.installing;
        w.addEventListener('statechange',()=>{
          if(w.state==='installed') showUpdateBanner();
        });
      });
    }).catch(()=>{});
  });
}
function showUpdateBanner(){
  if(document.getElementById('update-banner')) return;
  const b=document.createElement('div');
  b.id='update-banner';
  b.innerHTML='<span>Update available</span><button id="update-btn">Reload</button>';
  document.body.appendChild(b);
  document.getElementById('update-btn').addEventListener('click',()=>window.location.reload());
  setTimeout(()=>{ const el=document.getElementById('update-banner'); if(el) el.remove(); },8000);
}
