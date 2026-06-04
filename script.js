'use strict';

const GW = 380, GH_BASE = 520;
const LANE_X = [22, 63, 104, 145, 186, 227, 275, 322, 350];
const NPC_IMGS = ['./images/traffic.png','./images/traffic2.png','./images/traffic3.png','./images/traffic4.png'];
const CAR_W = 48, CAR_H = 70, NPC_W = 46, NPC_H = 68;
const SAFE_GAP = 160, HITPAD = 10;
const BASE_SPD = 7;           // reduced base speed
const SPAWN_MS = 550;         // slower spawn rate
const CAR_BASE_Y_OFFSET = 18;
const CAR_BOOST_Y_LIFT = 18;
const BRAKE_Y_LIFT = -10;

// Barrier positions (left and right road edges)
const BARRIER_L = 0;
const BARRIER_R = GW - CAR_W;

const STOREGIT_BASE = 'https://storegit.pages.dev';
let STOREGIT_KEY = '';
let _keyReady = null;
function getKey(){
  if (STOREGIT_KEY) return Promise.resolve(STOREGIT_KEY);
  if (_keyReady) return _keyReady;
  _keyReady = fetch('/api/config')
    .then(r => r.json())
    .then(d => { if (d.key) STOREGIT_KEY = d.key; return STOREGIT_KEY; })
    .catch(() => '');
  return _keyReady;
}
const LB_FILE = 'highway-rush-leaderboard.json';
// Single file — highway-rush-top-scores.json was merged into this in v9
const LB_CACHE_KEY = 'hr_lb_cache';
const LB_PLAYER_KEY = 'hr_lb_player';
const LB_IP_KEY = 'hr_lb_ip';          // stores ip→name binding
const MAX_LB_ENTRIES = 100;

const DEFAULTS = {
  soundOn: true, vibrateOn: true, gyroOn: false,
  swipeOn: true, boostOn: true, sensitivity: 5, nightMode: false
};
let S = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('hr_settings') || '{}'));
function saveSett(){ localStorage.setItem('hr_settings', JSON.stringify(S)); }

const $ = id => document.getElementById(id);
const gc = $('gc');
const ctx = gc.getContext('2d', { alpha: false });
const speedoCanvas = $('speedo-canvas');
const speedoCtx = speedoCanvas.getContext('2d');
const scoreEl = $('score-val'), levelEl = $('level-val');
const screenHome = $('screen-home'), screenPause = $('screen-pause');
const screenGO = $('screen-gameover'), screenSettings = $('screen-settings');
const screenLB = $('screen-leaderboard');
const screenStats = $('screen-stats'), screenAch = $('screen-achievements');
const goScoreEl = $('go-score'), goBestEl = $('go-best'), goLevelEl = $('go-level');
const bestEl = $('best-score'), newBestBadge = $('new-best-badge'), levelToast = $('level-up-toast');
const boostToast = $('boost-toast'), gyroHint = $('gyro-hint');

const HUD_H = 58, CTRL_H = 90;
function sizeCanvas(){
  const availH = window.innerHeight - HUD_H - CTRL_H;
  const scale = Math.min(window.innerWidth / GW, availH / GH_BASE);
  gc.width = GW; gc.height = GH_BASE;
  gc.style.width  = Math.round(GW * scale) + 'px';
  gc.style.height = Math.round(GH_BASE * scale) + 'px';
  gc.style.top = HUD_H + Math.max(0, (availH - Math.round(GH_BASE * scale)) / 2) + 'px';
}
sizeCanvas();
window.addEventListener('resize', sizeCanvas);

const roadImg = new Image(); roadImg.src = './images/road.png';
const carImg  = new Image(); carImg.src  = './images/car.png';
const npcImgs = NPC_IMGS.map(s => { const i = new Image(); i.src = s; return i; });

let STATE = 'home';
let score = 0, level = 1, best = +localStorage.getItem('hr_best') || 0;
let roadSpeed = 0, roadY = 0;
let carX = (GW - CAR_W) / 2;
let carVelX = 0, carTilt = 0, carTiltTarget = 0;
let steerInput = 0, gyroSteer = 0;
let boostActive = false, boostTimer = 0, brakeActive = false;
let carYOffset = 0, carYOffsetTarget = 0;
let traffic = [], particles = [], pops = [];
let raf = null, lastTime = 0, spawnTimer = 0, deathTimer = 0, nearMissTimer = 0;
let distancePx = 0;   // road pixels scrolled this game (1 px ≈ 0.05 m at chosen scale)

// Horn avoidance state
let hornActive = false, hornTimer = 0;

/* ── BOOST COOLDOWN ───────────────────────────────────── */
const BOOST_DURATION  = 3500;   // ms boost lasts
const BOOST_COOLDOWN  = 8000;   // ms before boost is ready again
let boostCooldown = 0;          // ms remaining on cooldown
let boostCoolEl = null;         // cached arc element

/* ── ROAD PERKS ───────────────────────────────────────── */
// perk types: shield, magnet, slow, doubler
const PERK_DEFS = {
  shield:  { icon: '🛡️',  color: '#39ff8a', label: 'SHIELD',   dur: 5000 },
  magnet:  { icon: '🧲',  color: '#ff8cff', label: 'MAGNET',   dur: 6000 },
  slow:    { icon: '🌀',  color: '#00cfff', label: 'TIME SLOW', dur: 5000 },
  doubler: { icon: '×2',  color: '#ffd700', label: '×2 SCORE', dur: 7000 },
};
let roadPerks = [];      // active perk tokens on road: {type, x, y, pulse}
let activePerk = null;   // { type, expiresAt }
let perkSpawnTimer = 0;
const PERK_SPAWN_INTERVAL = 900; // frames between perk spawns

/* ── NPC TYPES ────────────────────────────────────────── */
// type: 'car' (default), 'truck', 'ambulance', 'police', 'motorbike'
const NPC_TYPES = {
  car:       { w:46, h:68, spdMult:1.0,  scoreBonus:0, hitMult:1.0, color:null },
  truck:     { w:52, h:90, spdMult:0.55, scoreBonus:2, hitMult:1.0, color:'#8b4513' },
  ambulance: { w:46, h:72, spdMult:0.80, scoreBonus:3, hitMult:1.0, color:'#fff' },
  police:    { w:46, h:68, spdMult:1.35, scoreBonus:1, hitMult:1.0, color:'#1a1aff' },
  motorbike: { w:24, h:52, spdMult:1.60, scoreBonus:0, hitMult:1.0, color:'#555' },
};

/* ── STREAK / COMBO ───────────────────────────────────── */
let streak = 0, streakTimer = 0;
const STREAK_TIMEOUT = 280;
// After 1st near-miss you're at ×2, 3rd=×3, 6th=×4, 9th=×5
const STREAK_THRESHOLDS = [1, 3, 6, 9];

/* ── SPEED LINES (boost FX) ──────────────────────────── */
let speedLines = [];    // {x,y,len,alpha,speed} — drawn during boost

/* ── PLAYER STATS (persist in localStorage) ──────────── */
const STATS_KEY = 'hr_stats';
let stats = { games: 0, distance: 0, bestStreak: 0, hornUsed: 0, dailyCount: 0 };
try { Object.assign(stats, JSON.parse(localStorage.getItem(STATS_KEY) || '{}')); } catch {}
function saveStats(){ localStorage.setItem(STATS_KEY, JSON.stringify(stats)); }

/* ── ACHIEVEMENTS ────────────────────────────────────── */
const ACHIEVEMENT_KEY = 'hr_achievements';
let achievements = {};   // { id: true }
try { achievements = JSON.parse(localStorage.getItem(ACHIEVEMENT_KEY) || '{}'); } catch {}
function saveAchievements(){ localStorage.setItem(ACHIEVEMENT_KEY, JSON.stringify(achievements)); }

const ACHIEVEMENT_DEFS = [
  { id: 'first_blood',  label: '🩸 First Blood',      desc: 'Survive your first game',             check: () => stats.games >= 1                       },
  { id: 'speeder',      label: '⚡ Speeder',            desc: 'Reach level 5',                       check: () => level >= 5                             },
  { id: 'zen',          label: '🧘 Zen Driver',         desc: 'Finish a game (score≥10) without horn',check: () => !_hornThisGame && score >= 10          },
  { id: 'ghost',        label: '👻 Ghost',              desc: '10 near-misses in one game',           check: () => _gameMisses >= 10                      },
  { id: 'combo_master', label: '🔥 Combo Master',       desc: 'Hit a ×4 streak multiplier',           check: () => streak >= 6                            },
  { id: 'century',      label: '💯 Century',            desc: 'Score 100 in one game',                check: () => score >= 100                           },
  { id: 'survivor',     label: '🛡️ Survivor',           desc: 'Play 10 games',                        check: () => stats.games >= 10                      },
  { id: 'veteran',      label: '🎖️ Veteran',            desc: 'Play 50 games',                        check: () => stats.games >= 50                      },
  { id: 'road_warrior', label: '🏎️ Road Warrior',       desc: 'Travel 10 km total',                   check: () => stats.distance >= 10000                },
  { id: 'marathon',     label: '🏃 Marathon',           desc: 'Travel 42 km total',                   check: () => stats.distance >= 42000                },
  { id: 'level10',      label: '🚀 Top Gear',           desc: 'Reach level 10',                       check: () => level >= 10                            },
  { id: 'near50',       label: '😤 Daredevil',          desc: '50 near-misses in one game',           check: () => _gameMisses >= 50                      },
  { id: 'maxcombo',     label: '💥 Unstoppable',        desc: 'Hit ×5 streak multiplier',             check: () => streak >= 9                            },
  { id: 'score500',     label: '🌟 High Roller',        desc: 'Score 500 in one game',                check: () => score >= 500                           },
  { id: 'daily_done',   label: '📅 Daily Driver',       desc: 'Complete a daily challenge',           check: () => dailyState.done                        },
  { id: 'daily_streak', label: '🗓️ Committed',          desc: 'Complete 7 different daily challenges',check: () => (stats.dailyCount || 0) >= 7           },
];
let _gameMisses = 0;   // near-misses this game (for Ghost achievement)
let _hornThisGame = false;

/* ── DAILY CHALLENGE ─────────────────────────────────── */
const DAILY_KEY = 'hr_daily';
function getTodaySeed(){
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth()+1) * 100 + d.getDate();
}
let dailyState = { seed: 0, done: false, score: 0 };
try { dailyState = Object.assign(dailyState, JSON.parse(localStorage.getItem(DAILY_KEY) || '{}')); } catch {}
// Simple seeded PRNG (mulberry32) — deterministic traffic for daily mode
function makePRNG(seed){
  let s = seed >>> 0;
  return function(){
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let dailyMode = false;
let dailyRng  = null;
const DAILY_TARGET_SCORE = 50;   // target score for daily challenge badge

bestEl.textContent = best;

function steerAccel(){ return 0.55 + (S.sensitivity / 10) * 0.65; }
const STEER_FRICTION = 0.80, STEER_RELEASE_FRICTION = 0.85, MAX_STEER_SPD = 9;
const MAX_TILT = 0.28, TILT_SPEED = 0.22, TILT_RETURN = 0.12;

/* ── SPEEDOMETER ─────────────────────────────────────── */
let speedoNeedle = 0;
function drawSpeedometer(speedKmh){
  const target = Math.min(speedKmh, 200);
  speedoNeedle += (target - speedoNeedle) * 0.12;
  const W = speedoCanvas.width, H = speedoCanvas.height;
  const cx = W / 2, cy = H / 2 + 2, R = W / 2 - 3;
  speedoCtx.clearRect(0, 0, W, H);

  const startAng = Math.PI * 0.75;
  const endAng   = Math.PI * 2.25;
  const totalAng = endAng - startAng;

  speedoCtx.beginPath();
  speedoCtx.arc(cx, cy, R, startAng, endAng);
  speedoCtx.lineWidth = 3;
  speedoCtx.strokeStyle = 'rgba(255,255,255,0.08)';
  speedoCtx.stroke();

  const fraction = Math.min(speedoNeedle / 200, 1);
  const color = fraction < 0.55 ? '#39ff8a' : fraction < 0.78 ? '#ff8c00' : '#ff3c3c';
  speedoCtx.beginPath();
  speedoCtx.arc(cx, cy, R, startAng, startAng + totalAng * fraction);
  speedoCtx.lineWidth = 3;
  speedoCtx.strokeStyle = color;
  speedoCtx.stroke();

  const tickCount = 8;
  for (let i = 0; i <= tickCount; i++){
    const a = startAng + (i / tickCount) * totalAng;
    const inner = R - 5, outer = R + 1;
    speedoCtx.beginPath();
    speedoCtx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    speedoCtx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    speedoCtx.lineWidth = 1;
    speedoCtx.strokeStyle = 'rgba(255,255,255,0.3)';
    speedoCtx.stroke();
  }

  const needleAng = startAng + totalAng * fraction;
  speedoCtx.save();
  speedoCtx.translate(cx, cy);
  speedoCtx.rotate(needleAng);
  speedoCtx.beginPath();
  speedoCtx.moveTo(-4, 0);
  speedoCtx.lineTo(R - 6, 0);
  speedoCtx.lineWidth = 2;
  speedoCtx.strokeStyle = '#fff';
  speedoCtx.shadowColor = color;
  speedoCtx.shadowBlur = 6;
  speedoCtx.stroke();
  speedoCtx.restore();

  speedoCtx.beginPath();
  speedoCtx.arc(cx, cy, 3, 0, Math.PI * 2);
  speedoCtx.fillStyle = '#fff';
  speedoCtx.fill();

  speedoCtx.font = "bold 8px 'Orbitron',monospace";
  speedoCtx.fillStyle = color;
  speedoCtx.textAlign = 'center';
  speedoCtx.fillText(Math.round(speedoNeedle), cx, cy + 13);
  speedoCtx.textAlign = 'left';
}

/* ── SCREEN MGMT ─────────────────────────────────────── */
function showScreen(name){
  const all = [screenHome, screenPause, screenGO, screenSettings, screenLB, screenStats, screenAch].filter(Boolean);
  all.forEach(s => s.classList.remove('active'));
  if (name === 'home')           screenHome.classList.add('active');
  else if (name === 'pause')     screenPause.classList.add('active');
  else if (name === 'gameover')  screenGO.classList.add('active');
  else if (name === 'settings')  screenSettings.classList.add('active');
  else if (name === 'leaderboard') screenLB.classList.add('active');
  else if (name === 'stats')     { if(screenStats){ screenStats.classList.add('active'); renderStatsScreen(); } }
  else if (name === 'achievements') { if(screenAch){ screenAch.classList.add('active'); renderAchievementsTab(); } }
}
function setHudVisible(v){
  const o = v ? '1' : '0';
  $('hud').style.opacity = o;
  $('controls').style.opacity = o;
}

/* ── SETTINGS ────────────────────────────────────────── */
function applySettingsUI(){
  const map = {
    'set-sound':   [S.soundOn,   v => { S.soundOn   = v; if(!v){ stopEngine(); } else if(STATE==='playing') startEngine(); }],
    'set-vibrate': [S.vibrateOn, v => { S.vibrateOn = v; }],
    'set-gyro':    [S.gyroOn,    v => { S.gyroOn    = v; gyroHint.hidden = !v; if(v) requestGyroPermission(); }],
    'set-swipe':   [S.swipeOn,   v => { S.swipeOn   = v; }],
    'set-boost':   [S.boostOn,   v => { S.boostOn   = v; $('btn-boost').style.display = v ? '' : 'none'; }],
    'set-night':   [S.nightMode, v => { S.nightMode = v; document.body.classList.toggle('night-mode', v); }],
  };
  for (const [id, [val]] of Object.entries(map)){
    const btn = $(id); if (!btn) continue;
    btn.textContent = val ? 'ON' : 'OFF';
    btn.className = 'toggle-btn ' + (val ? 'on' : 'off');
    btn.onclick = () => {
      const next = !map[id][0]; map[id][0] = next;
      const sKey = {sound:'soundOn', vibrate:'vibrateOn', gyro:'gyroOn', swipe:'swipeOn', boost:'boostOn', night:'nightMode'}[id.replace('set-', '')];
      if (sKey) S[sKey] = next;
      map[id][1](next); saveSett(); applySettingsUI();
    };
  }
  $('set-sensitivity').value = S.sensitivity;
  $('sens-val').textContent = S.sensitivity;
  $('btn-boost').style.display = S.boostOn ? '' : 'none';
  document.body.classList.toggle('night-mode', S.nightMode);
  gyroHint.hidden = !S.gyroOn;
}
$('set-sensitivity').addEventListener('input', e => {
  S.sensitivity = +e.target.value; $('sens-val').textContent = S.sensitivity; saveSett();
});

/* ── IP DETECTION ────────────────────────────────────── */
let clientIP = localStorage.getItem(LB_IP_KEY) || '';
async function fetchClientIP(){
  if (clientIP) return clientIP;
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const d = await r.json();
    clientIP = d.ip || '';
    if (clientIP) localStorage.setItem(LB_IP_KEY, clientIP);
  } catch { clientIP = ''; }
  return clientIP;
}
fetchClientIP();

/* ── LEADERBOARD (StoreGit + optimistic cache) ───────── */
let lbData = [];
let playerName = localStorage.getItem(LB_PLAYER_KEY) || '';

// ip→name map stored locally
let ipNameMap = {};
try { ipNameMap = JSON.parse(localStorage.getItem('hr_ip_name') || '{}'); } catch { ipNameMap = {}; }
function saveIpNameMap(){ localStorage.setItem('hr_ip_name', JSON.stringify(ipNameMap)); }

// Check if the current IP already has a registered name
async function getNameForIP(){
  const ip = await fetchClientIP();
  if (!ip) return null;
  return ipNameMap[ip] || null;
}
async function bindNameToIP(name){
  const ip = await fetchClientIP();
  if (!ip) return;
  ipNameMap[ip] = name;
  saveIpNameMap();
}

async function lbRequest(method, path, body){
  const k = await getKey();
  return fetch(`${STOREGIT_BASE}/api/${path}`, {
    method,
    headers: Object.assign({'X-API-Key': k}, body ? {'Content-Type': 'application/json'} : {}),
    body: body ? JSON.stringify(body) : undefined
  }).then(async r => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  });
}

function lbLoadCache(){
  try { return JSON.parse(localStorage.getItem(LB_CACHE_KEY) || '[]'); } catch { return []; }
}
function lbSaveCache(data){ localStorage.setItem(LB_CACHE_KEY, JSON.stringify(data)); }

// ── One-time migration flag ───────────────────────────
const MIGRATION_KEY = 'hr_migrated_v9';

async function lbFetch(){
  try {
    const k = await getKey();

    // ── Migration: absorb top-scores file and delete it (runs once) ──
    if (!localStorage.getItem(MIGRATION_KEY)){
      try {
        const OLD_FILE = 'highway-rush-top-scores.json';
        const oldText = await fetch(
          `${STOREGIT_BASE}/api/download?name=${encodeURIComponent(OLD_FILE)}`,
          { headers: {'X-API-Key': k} }
        ).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
        const oldEntries = JSON.parse(oldText);
        if (Array.isArray(oldEntries) && oldEntries.length){
          // Merge into current leaderboard (higher score always wins)
          const currentText = await fetch(
            `${STOREGIT_BASE}/api/download?name=${encodeURIComponent(LB_FILE)}`,
            { headers: {'X-API-Key': k} }
          ).then(r => r.ok ? r.text() : '[]').catch(() => '[]');
          const current = JSON.parse(currentText);
          const base = Array.isArray(current) ? current : [];
          // Build merged map: name -> best entry
          const map = new Map();
          [...base, ...oldEntries].forEach(e => {
            const key = e.name.trim().toLowerCase();
            const ex = map.get(key);
            if (!ex || e.score > ex.score) map.set(key, e);
          });
          const merged = Array.from(map.values()).sort((a,b) => b.score - a.score).slice(0, MAX_LB_ENTRIES);
          // Upload merged leaderboard
          await uploadFile(LB_FILE, merged);
          // Delete old file
          try {
            const files = await lbRequest('GET', 'files').catch(() => []);
            const oldFile = Array.isArray(files) ? files.find(f => f.name === OLD_FILE || f.originalName === OLD_FILE) : null;
            if (oldFile) await lbRequest('DELETE', `files/${oldFile.sha || oldFile.id || oldFile.name}`).catch(() => {});
          } catch {}
        }
      } catch {} // old file doesn't exist — no migration needed
      localStorage.setItem(MIGRATION_KEY, '1');
    }

    const text = await fetch(
      `${STOREGIT_BASE}/api/download?name=${encodeURIComponent(LB_FILE)}`,
      { headers: {'X-API-Key': k} }
    ).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
    const parsed = JSON.parse(text);
    lbData = Array.isArray(parsed) ? parsed : [];
    // ── Protect local player's best against stale remote data ──
    // If we know the player's name and their local best is higher than what
    // the remote returned (e.g. upload is in-flight or hasn't propagated yet),
    // merge the local best into lbData so their entry is never erased.
    lbData = mergeLocalBestIntoData(lbData);
    lbSaveCache(lbData);
  } catch {
    lbData = lbLoadCache();
  }

  // ── Sync hr_best from remote for this IP's player ──
  // After fetch, find this device's player in the leaderboard and
  // reconcile the local best — remote always wins if higher (score recovery).
  syncBestFromRemote();

  return lbData;
}

// Merge the local player's known best into a leaderboard dataset.
// Ensures that if the remote hasn't received the latest upload yet (or is
// stale), the player's own entry is never silently removed or downgraded.
// Uses IP as the primary key so two players with the same name stay separate.
function mergeLocalBestIntoData(data){
  if (!playerName) return data;
  const nameKey = playerName.trim().toLowerCase();
  const localBest = best || +localStorage.getItem('hr_best') || 0;
  if (!localBest) return data;
  // Find this device's entry by IP first, then fall back to name
  const existing = clientIP
    ? (data.find(e => e.ip === clientIP) || data.find(e => !e.ip && e.name.trim().toLowerCase() === nameKey))
    : data.find(e => e.name.trim().toLowerCase() === nameKey);
  if (existing && existing.score >= localBest) return data; // remote already has best or better
  // Remote is missing or outdated — upsert with the local best
  const filtered = clientIP
    ? data.filter(e => e.ip ? e.ip !== clientIP : e.name.trim().toLowerCase() !== nameKey)
    : data.filter(e => e.name.trim().toLowerCase() !== nameKey);
  const upserted = { name: playerName.trim().slice(0, 16), score: localBest, ts: existing ? existing.ts : Date.now(), ip: clientIP || undefined };
  return [...filtered, upserted].sort((a, b) => b.score - a.score).slice(0, MAX_LB_ENTRIES);
}

// Restore hr_best from the remote leaderboard for this device's player.
// Runs silently after every lbFetch so same-IP devices always show
// the correct high score even if localStorage was cleared.
function syncBestFromRemote(){
  if (!playerName || !lbData.length) return;
  const key = playerName.trim().toLowerCase();
  // Find this device's entry by IP first, then fall back to name
  const entry = clientIP
    ? (lbData.find(e => e.ip === clientIP) || lbData.find(e => !e.ip && e.name.trim().toLowerCase() === key))
    : lbData.find(e => e.name.trim().toLowerCase() === key);
  if (!entry) return;
  if (entry.score > best){
    best = entry.score;
    localStorage.setItem('hr_best', best);
    bestEl.textContent = best;
  }
}

// Restore hr_best by player NAME alone — used after the player re-enters their
// name (e.g. after clearing site data). Falls back to name match so they always
// recover their score even if their IP has changed (new network, VPN, mobile).
function syncBestFromRemoteByName(name){
  if (!name || !lbData.length) return;
  const key = name.trim().toLowerCase();
  // Prefer IP match; fall back to name match only
  const entry = (clientIP && lbData.find(e => e.ip === clientIP))
    || lbData.find(e => e.name.trim().toLowerCase() === key);
  if (!entry) return;
  if (entry.score > best){
    best = entry.score;
    localStorage.setItem('hr_best', best);
    bestEl.textContent = best;
  }
}

// Upload a file to StoreGit
async function uploadFile(fileName, data){
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  const files = await lbRequest('GET', 'files').catch(() => []);
  const existing = Array.isArray(files) ? files.find(f => f.name === fileName || f.originalName === fileName) : null;
  if (existing){
    await lbRequest('POST', 'upload', { name: fileName, content, sha: existing.sha });
  } else {
    await lbRequest('POST', 'upload', { name: fileName, content });
  }
}

async function lbPush(name, scoreVal){
  const ip = await fetchClientIP();
  const nameKey = name.trim().slice(0, 16).toLowerCase();

  // Always use live lbData (just fetched) so we compare against real remote scores
  const base = lbData.length ? lbData : lbLoadCache();
  // Match by IP first (same player, possibly renamed), then fall back to name-only
  // when IP is unavailable. Two players with the same name but different IPs keep
  // separate leaderboard entries.
  const prev = ip
    ? (base.find(e => e.ip === ip) || base.find(e => !e.ip && e.name.trim().toLowerCase() === nameKey))
    : base.find(e => e.name.trim().toLowerCase() === nameKey);

  // Final score = highest of: what we're submitting, local hr_best, and remote best
  // This prevents any downgrade and resolves conflicts by always taking the max.
  const finalScore = Math.max(scoreVal, prev ? prev.score : 0, best);
  const entry = { name: name.trim().slice(0, 16), score: finalScore, ts: Date.now(), ip };

  // Remove the previous entry for this IP (or name if no IP), then add updated one
  const filtered = ip
    ? base.filter(e => e.ip ? e.ip !== ip : e.name.trim().toLowerCase() !== nameKey)
    : base.filter(e => e.name.trim().toLowerCase() !== nameKey);
  const merged = [...filtered, entry]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LB_ENTRIES);
  lbSaveCache(merged);
  lbData = merged;

  // Keep local hr_best in sync too
  if (finalScore > best){
    best = finalScore;
    localStorage.setItem('hr_best', best);
    bestEl.textContent = best;
  }

  try {
    await uploadFile(LB_FILE, merged);
  } catch (e) {
    console.warn('LB push failed:', e.message);
  }
}

// renderLB: draws the list and returns {rank, score} for the current player (or null)
function renderLB(data, myName){
  const el = $('lb-list');
  if (!data || !data.length){
    el.innerHTML = '<div class="lb-empty">No entries yet — be the first!</div>';
    return null;
  }
  const me = myName ? myName.trim().toLowerCase() : '';
  const header = '<div class="lb-col-header"><span class="lbh-rank">#</span><span class="lbh-name">DRIVER</span><span class="lbh-score">SCORE</span></div>';
  let myRank = null, myScore = null;
  const rows = data.slice(0, 100).map((e, i) => {
    const rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
    const rankNum = rankEmoji || (i + 1);
    const rankCls = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    // Identify "YOU" by IP when available; fall back to name match so that two
    // players sharing the same name each only see their own row highlighted.
    const isMe = clientIP
      ? (e.ip === clientIP)
      : (me && e.name.trim().toLowerCase() === me);
    if (isMe){ myRank = i + 1; myScore = e.score; }
    const isMeClass = isMe ? ' lb-row--me' : '';
    const topClass = i < 3 ? ' lb-row--top lb-row--rank' + i : '';
    return '<div class="lb-row' + topClass + isMeClass + (e._optimistic ? ' lb-row--optimistic' : '') + '" data-me="' + (isMe ? '1' : '0') + '">' +
      '<span class="lb-rank ' + rankCls + '">' + rankNum + '</span>' +
      '<span class="lb-name">' + escHtml(e.name) + (isMe ? '<span class="lb-you"> YOU</span>' : '') + '</span>' +
      '<span class="lb-score">' + e.score.toLocaleString() + '</span>' +
      '</div>';
  }).join('');
  el.innerHTML = header + rows;
  // Auto-scroll so the player's own row is visible
  if (me){
    setTimeout(() => {
      const meRow = el.querySelector('.lb-row--me');
      if (meRow) meRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 80);
  }
  return myRank !== null ? { rank: myRank, score: myScore } : null;
}

function escHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function openLeaderboard(){
  showScreen('leaderboard');
  $('lb-list').innerHTML = '<div class="lb-loading"><span class="lb-spinner"></span>Loading\u2026</div>';
  const cached = lbLoadCache();
  if (cached.length) renderLB(cached, playerName);
  try {
    const fresh = await lbFetch();
    renderLB(fresh, playerName);
  } catch {
    // keep cached render
  }
}

/* ── GAME LIFECYCLE ──────────────────────────────────── */
function startGame(){
  traffic = []; particles = []; pops = []; speedLines = [];
  score = 0; level = 1; roadSpeed = 0;
  carX = (GW - CAR_W) / 2; carVelX = 0; steerInput = 0; gyroSteer = 0;
  carYOffset = 0; carYOffsetTarget = 0; carTilt = 0; carTiltTarget = 0;
  roadY = 0; lastTime = 0; spawnTimer = 0; deathTimer = 0;
  boostActive = false; boostTimer = 0; brakeActive = false; nearMissTimer = 0;
  hornActive = false; hornTimer = 0; distancePx = 0;
  roadPerks = []; activePerk = null; perkSpawnTimer = 0;
  boostCooldown = 0; updateBoostArc(1);
  streak = 0; streakTimer = 0; _gameMisses = 0; _hornThisGame = false;
  speedoNeedle = 60;
  scoreEl.textContent = '0'; levelEl.textContent = '1';
  updateStreakHUD();
  STATE = 'playing';
  showScreen(null);
  setHudVisible(true);
  if (S.soundOn){ startEngine(); }
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}
function pauseGame(){
  if (STATE !== 'playing') return;
  STATE = 'paused'; showScreen('pause'); stopEngine();
  if (raf){ cancelAnimationFrame(raf); raf = null; }
}
function resumeGame(){
  if (STATE !== 'paused') return;
  STATE = 'playing'; showScreen(null); lastTime = 0;
  if (S.soundOn) startEngine();
  raf = requestAnimationFrame(loop);
}
async function doGameOver(){
  STATE = 'gameover';

  // ── Update persistent stats ──
  stats.games++;
  // 1 screen height (520px) ≈ 60 metres at a reasonable highway scale
  const metresThisGame = Math.round((distancePx / GH_BASE) * 60);
  stats.distance += metresThisGame;
  if (streak > stats.bestStreak) stats.bestStreak = streak;
  if (_hornThisGame) stats.hornUsed = (stats.hornUsed || 0) + 1;
  saveStats();

  // ── Check achievements before showing screen ──
  checkAchievements();

  // ── Daily challenge wrap-up ──
  finishDailyChallenge();

  // ── Reset streak display ──
  resetStreak(); updateStreakHUD();

  const isNew = score > best;
  if (isNew){ best = score; localStorage.setItem('hr_best', best); }
  bestEl.textContent = best;
  goScoreEl.textContent = score;
  goBestEl.textContent  = best;
  goLevelEl.textContent = level;
  newBestBadge.hidden   = !isNew;

  const goDistEl = $('go-distance');
  if (goDistEl) goDistEl.textContent = metresThisGame >= 1000
    ? (metresThisGame / 1000).toFixed(2) + ' km'
    : metresThisGame + ' m';
  setHudVisible(false);
  showScreen('gameover');
  if (S.vibrateOn && navigator.vibrate) navigator.vibrate([80, 40, 80]);

  const entryWrap = $('lb-entry-wrap');
  const statusEl = $('lb-submit-status');

  // Check IP binding — if this IP has a known name, adopt it silently
  const ipName = await getNameForIP();
  if (ipName && !playerName) {
    playerName = ipName;
    localStorage.setItem(LB_PLAYER_KEY, playerName);
  }

  if (playerName){
    // Player is known — hide name entry, fetch live LB, push score in background
    entryWrap.style.display = 'none';

    // Show cached leaderboard immediately with optimistic entry
    const nameKey = playerName.toLowerCase();
    const cached = lbLoadCache();
    // Use IP to find this player's entry in the cache; fall back to name
    const cachedEntry = clientIP
      ? (cached.find(e => e.ip === clientIP) || cached.find(e => !e.ip && e.name.toLowerCase() === nameKey))
      : cached.find(e => e.name.toLowerCase() === nameKey);
    const shouldUpdate = !cachedEntry || score > cachedEntry.score;

    if (shouldUpdate){
      // Insert optimistic entry right away so player sees their position immediately
      const optimistic = { name: playerName, score, ts: Date.now(), _optimistic: true, ip: clientIP || undefined };
      const optimisticList = [...cached.filter(e => clientIP ? (e.ip ? e.ip !== clientIP : e.name.toLowerCase() !== nameKey) : e.name.toLowerCase() !== nameKey), optimistic]
        .sort((a, b) => b.score - a.score).slice(0, MAX_LB_ENTRIES);
      lbSaveCache(optimisticList);
      lbData = optimisticList;
    } else {
      lbData = cached;
    }

    const rankInfo = renderLB(lbData, playerName);
    if (rankInfo){
      statusEl.textContent = 'Rank #' + rankInfo.rank + ' \u2014 ' + rankInfo.score.toLocaleString() + ' pts';
    }

    // Fetch live data and push in background — update display when done
    lbFetch().then(() => {
      // syncBestFromRemote ran inside lbFetch — refresh displayed best
      goBestEl.textContent = best;
      bestEl.textContent   = best;
      // Use IP to find this player's live entry; fall back to name
      const liveEntry = clientIP
        ? (lbData.find(e => e.ip === clientIP) || lbData.find(e => !e.ip && e.name.toLowerCase() === nameKey))
        : lbData.find(e => e.name.toLowerCase() === nameKey);
      const reallyUpdate = !liveEntry || score > liveEntry.score;
      if (reallyUpdate){
        // Re-insert with live data as base (lbData is now fresh from lbFetch)
        const optimistic2 = { name: playerName, score, ts: Date.now(), _optimistic: true, ip: clientIP || undefined };
        lbData = [...lbData.filter(e => clientIP ? (e.ip ? e.ip !== clientIP : e.name.toLowerCase() !== nameKey) : e.name.toLowerCase() !== nameKey), optimistic2]
          .sort((a, b) => b.score - a.score).slice(0, MAX_LB_ENTRIES);
        lbSaveCache(lbData);
        lbPush(playerName, score).then(() => {
          // Remove _optimistic flag after confirmed push
          lbData = lbData.map(e => e._optimistic ? { name: e.name, score: e.score, ts: e.ts, ip: e.ip } : e);
          lbSaveCache(lbData);
          const ri = renderLB(lbData, playerName);
          if (ri) statusEl.textContent = 'Rank #' + ri.rank + ' \u2014 ' + ri.score.toLocaleString() + ' pts \u2713';
        }).catch(() => {});
      } else {
        // Remote is up-to-date and has equal or better score; mergeLocalBestIntoData
        // (already called inside lbFetch) ensures our entry wasn't erased.
        const ri = renderLB(lbData, playerName);
        if (ri) statusEl.textContent = 'Rank #' + ri.rank + ' \u2014 ' + ri.score.toLocaleString() + ' pts';
      }
    }).catch(() => {});

  } else {
    // New player — show name entry form
    entryWrap.style.display = '';
    $('lb-name-input').value = '';
    statusEl.textContent = '';
    $('lb-submit-btn').disabled = false;
    // Pre-load leaderboard in background so it's ready
    lbFetch().catch(() => {});
  }
}
function goHome(){
  STATE = 'home'; stopEngine();
  if (raf){ cancelAnimationFrame(raf); raf = null; }
  traffic = []; particles = []; pops = [];
  setHudVisible(false); showScreen('home');
}

/* ── EFFECTS ─────────────────────────────────────────── */
function spawnExplosion(x, y){
  for (let i = 0; i < 26; i++){
    const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 5;
    particles.push({x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s - 2.5, life: 1, r: 2 + Math.random()*5, c: Math.random() < 0.5 ? '#ff3c3c' : '#ff8c00'});
  }
}
function showToast(el, dur = 1000){
  el.hidden = false; el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 250); }, dur);
}
function levelUp(){
  level++; roadSpeed += 0.25; levelEl.textContent = level; showToast(levelToast, 300);
}

/* ── BOOST ARC ────────────────────────────────────────── */
function updateBoostArc(fraction){
  if (!boostCoolEl) boostCoolEl = document.getElementById('boost-arc-fill');
  if (!boostCoolEl) return;
  const circ = 2 * Math.PI * 18;   // r=18 → circumference ≈ 113
  const dash = circ * fraction;
  boostCoolEl.style.strokeDashoffset = circ - dash;
  boostCoolEl.classList.toggle('active', fraction >= 1);
  const btn = document.getElementById('btn-boost');
  if (btn){
    btn.classList.toggle('boost-ready', fraction >= 1);
    btn.classList.toggle('boost-cooling', fraction < 1);
  }
}

/* ── PERK HELPERS ─────────────────────────────────────── */
function spawnPerk(){
  if (roadPerks.length >= 2) return;
  const types = Object.keys(PERK_DEFS);
  const type = types[Math.floor(Math.random() * types.length)];
  const x = 20 + Math.random() * (GW - 50);
  roadPerks.push({ type, x, y: -30, pulse: 0 });
}

function collectPerk(type){
  const def = PERK_DEFS[type];
  activePerk = { type, expiresAt: Date.now() + def.dur };
  const perkHud = document.getElementById('perk-hud');
  if (perkHud){ perkHud.textContent = def.icon; perkHud.classList.add('active'); }
  pops.push({ x: GW/2, y: GH_BASE * 0.4, a: 1.3, t: def.label + '!', c: def.color });
  if (S.vibrateOn && navigator.vibrate) navigator.vibrate([20, 10, 30]);
}

function clearPerk(){
  activePerk = null;
  const perkHud = document.getElementById('perk-hud');
  if (perkHud) perkHud.classList.remove('active');
}

function isPerkActive(type){ return activePerk && activePerk.type === type && Date.now() < activePerk.expiresAt; }

function drawPerks(){
  roadPerks.forEach(p => {
    const def = PERK_DEFS[p.type];
    p.pulse = (p.pulse || 0) + 0.08;
    const glow = 0.7 + 0.3 * Math.sin(p.pulse);
    ctx.save();
    // outer glow ring
    ctx.globalAlpha = 0.35 * glow;
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(p.x + 16, p.y + 16, 19 + Math.sin(p.pulse) * 3, 0, Math.PI*2); ctx.stroke();
    // filled circle
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(p.x + 16, p.y + 16, 16, 0, Math.PI*2); ctx.fill();
    // icon
    ctx.globalAlpha = glow;
    ctx.font = p.type === 'doubler' ? "bold 13px 'Orbitron',monospace" : '18px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (p.type === 'doubler'){ ctx.fillStyle = def.color; ctx.fillText('×2', p.x + 16, p.y + 17); }
    else ctx.fillText(def.icon, p.x + 16, p.y + 17);
    ctx.restore();
  });
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

/* ── NPC TYPE HELPERS ────────────────────────────────── */
function pickNPCType(lvl){
  const r = Math.random();
  if (lvl < 2) return 'car';
  if (lvl < 3){ return r < 0.12 ? 'truck' : r < 0.18 ? 'motorbike' : 'car'; }
  if (lvl < 5){ return r < 0.12 ? 'truck' : r < 0.22 ? 'motorbike' : r < 0.28 ? 'ambulance' : 'car'; }
  return r < 0.10 ? 'truck' : r < 0.22 ? 'motorbike' : r < 0.30 ? 'ambulance' : r < 0.38 ? 'police' : 'car';
}

// Draw a single NPC, handling special visuals for each type
function drawNPC(t){
  const def = NPC_TYPES[t.npcType] || NPC_TYPES.car;
  const drawX = t.x + (t.dodgeOffsetX || 0);
  const npcTilt = t.dodgeTilt || 0;

  ctx.save();
  if (Math.abs(npcTilt) > 0.005){
    ctx.translate(drawX + def.w/2, t.y + def.h * 0.5);
    ctx.rotate(npcTilt);
    ctx.translate(-def.w/2, -def.h*0.5);
  } else {
    ctx.translate(drawX, t.y);
  }

  if (t.npcType === 'truck'){
    // Truck: dark cab + long body
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(0, 0, def.w, def.h);
    ctx.fillStyle = '#8b4513'; ctx.fillRect(3, def.h*0.55, def.w-6, def.h*0.42);
    ctx.fillStyle = 'rgba(255,220,100,0.6)'; ctx.fillRect(4, 2, def.w-8, 8); // headlights
    ctx.fillStyle = '#222'; ctx.fillRect(6, 10, def.w-12, def.h*0.42); // windscreen
    // wheels
    ctx.fillStyle = '#111'; ctx.fillRect(-3, def.h*0.1, 5, 14); ctx.fillRect(def.w-2, def.h*0.1, 5, 14);
    ctx.fillRect(-3, def.h*0.55, 5, 14); ctx.fillRect(def.w-2, def.h*0.55, 5, 14);

  } else if (t.npcType === 'ambulance'){
    // White body with red cross
    ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, def.w, def.h);
    ctx.fillStyle = '#cc0000';
    ctx.fillRect(def.w/2-3, def.h*0.25, 6, 16); ctx.fillRect(def.w/2-8, def.h*0.30, 16, 6);
    ctx.fillStyle = '#222'; ctx.fillRect(4, 4, def.w-8, def.h*0.28);
    // Flashing lights
    const flash = Math.sin(Date.now() / 150) > 0;
    ctx.fillStyle = flash ? '#ff2020' : '#2020ff';
    ctx.beginPath(); ctx.arc(def.w*0.3, 3, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = flash ? '#2020ff' : '#ff2020';
    ctx.beginPath(); ctx.arc(def.w*0.7, 3, 4, 0, Math.PI*2); ctx.fill();

  } else if (t.npcType === 'police'){
    // Black and white police car
    const half = Math.sin(Date.now()/80) > 0;
    ctx.fillStyle = half ? '#fff' : '#111'; ctx.fillRect(0, 0, def.w/2, def.h);
    ctx.fillStyle = half ? '#111' : '#fff'; ctx.fillRect(def.w/2, 0, def.w/2, def.h);
    ctx.fillStyle = '#222'; ctx.fillRect(4, 4, def.w-8, def.h*0.30);
    // Siren lights
    ctx.fillStyle = half ? '#ff0000' : '#0000ff';
    ctx.beginPath(); ctx.arc(def.w*0.35, 4, 5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = half ? '#0000ff' : '#ff0000';
    ctx.beginPath(); ctx.arc(def.w*0.65, 4, 5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,0,0.7)'; ctx.fillRect(8, def.h-10, 6, 6); ctx.fillRect(def.w-14, def.h-10, 6, 6);

  } else if (t.npcType === 'motorbike'){
    // Slim motorbike shape
    ctx.fillStyle = '#444'; ctx.fillRect(def.w*0.2, def.h*0.05, def.w*0.6, def.h*0.55);
    ctx.fillStyle = '#222'; ctx.beginPath();
    ctx.ellipse(def.w/2, def.h*0.18, def.w*0.32, def.h*0.12, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#666'; ctx.fillRect(def.w*0.25, def.h*0.55, def.w*0.5, def.h*0.38);
    // Wheels (circles)
    ctx.strokeStyle = '#888'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(def.w/2, def.h*0.12, def.w*0.28, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(def.w/2, def.h*0.82, def.w*0.28, 0, Math.PI*2); ctx.stroke();
    // Headlight
    ctx.fillStyle = 'rgba(255,220,100,0.9)';
    ctx.beginPath(); ctx.arc(def.w/2, 3, 3, 0, Math.PI*2); ctx.fill();

  } else {
    // Normal car — use image
    ctx.drawImage(npcImgs[t.imgIdx], 0, 0, 120, 120, 0, 0, def.w, def.h);
  }
  ctx.restore();
}

/* ── STREAK HELPERS ──────────────────────────────────── */
function getStreakMult(){
  // Returns 1, 2, 3, 4 or 5 based on streak count
  for (let i = STREAK_THRESHOLDS.length - 1; i >= 0; i--)
    if (streak >= STREAK_THRESHOLDS[i]) return i + 2;
  return 1;
}

function resetStreak(){
  if (streak > 0){
    if (streak > stats.bestStreak){ stats.bestStreak = streak; saveStats(); }
    streak = 0; streakTimer = 0;
    updateStreakHUD();
  }
}

function updateStreakHUD(){
  const el = $('streak-display');
  if (!el) return;
  const mult = getStreakMult();
  if (streak === 0 || mult === 1){
    el.style.opacity = '0';
    el.style.transform = 'scale(0.7)';
  } else {
    el.textContent = '\u00d7' + mult;
    el.style.opacity = '1';
    el.style.transform = 'scale(1)';
    el.style.color = mult >= 5 ? '#ff3c3c' : mult >= 4 ? '#ff8c00' : mult >= 3 ? '#ffcc00' : '#39ff8a';
  }
}

/* ── ACHIEVEMENT HELPERS ─────────────────────────────── */
function checkAchievements(){
  ACHIEVEMENT_DEFS.forEach(def => {
    if (achievements[def.id]) return;          // already unlocked
    if (!def.check()) return;
    achievements[def.id] = true;
    saveAchievements();
    flashAchievementToast(def.label);
    renderAchievementsTab();
  });
}

function flashAchievementToast(label){
  const el = $('achievement-toast');
  if (!el) return;
  el.textContent = label + '  UNLOCKED';
  el.hidden = false; el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 350);
  }, 2200);
}

function renderAchievementsTab(){
  const el = $('achievements-list');
  if (!el) return;
  el.innerHTML = ACHIEVEMENT_DEFS.map(def => {
    const done = !!achievements[def.id];
    return `<div class="ach-row${done ? ' ach-done' : ''}">
      <span class="ach-label">${def.label}</span>
      <span class="ach-desc">${def.desc}</span>
      ${done ? '<span class="ach-check">\u2713</span>' : '<span class="ach-lock">\uD83D\uDD12</span>'}
    </div>`;
  }).join('');
}

/* ── PLAYER STATS SCREEN ─────────────────────────────── */
function renderStatsScreen(){
  const el = $('stats-body');
  if (!el) return;
  const dist = stats.distance || 0;
  const distStr = dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : dist + ' m';
  const todaySeed = getTodaySeed();
  const dailyBest = (dailyState.seed === todaySeed && dailyState.done) ? dailyState.score : '—';
  el.innerHTML = `
    <div class="stat-row"><span class="stat-lbl">Games Played</span><span class="stat-val">${stats.games}</span></div>
    <div class="stat-row"><span class="stat-lbl">Total Distance</span><span class="stat-val">${distStr}</span></div>
    <div class="stat-row"><span class="stat-lbl">All-Time Best</span><span class="stat-val">${best}</span></div>
    <div class="stat-row"><span class="stat-lbl">Today's Best</span><span class="stat-val">${dailyBest}</span></div>
    <div class="stat-row"><span class="stat-lbl">Best Streak</span><span class="stat-val">${stats.bestStreak} misses</span></div>
    <div class="stat-row"><span class="stat-lbl">Daily Challenges</span><span class="stat-val">${stats.dailyCount || 0}</span></div>
    <div class="stat-row"><span class="stat-lbl">Achievements</span><span class="stat-val">${Object.keys(achievements).length} / ${ACHIEVEMENT_DEFS.length}</span></div>
  `;
}

/* ── DAILY CHALLENGE HELPERS ─────────────────────────── */
function openDailyChallenge(){
  const seed = getTodaySeed();
  dailyMode = true;
  dailyRng  = makePRNG(seed);
  const $el = $('daily-badge');
  if ($el) $el.hidden = dailyState.done && dailyState.seed === seed;
  startGame();
}

function finishDailyChallenge(){
  if (!dailyMode) return;
  dailyMode = false;
  const seed = getTodaySeed();
  const prev = (dailyState.seed === seed) ? dailyState.score : 0;
  const isNewDailyBest = score > prev;
  if (isNewDailyBest){
    dailyState = { seed, done: true, score };
    localStorage.setItem(DAILY_KEY, JSON.stringify(dailyState));
  } else if (!dailyState.done || dailyState.seed !== seed) {
    dailyState = { seed, done: true, score: prev };
    localStorage.setItem(DAILY_KEY, JSON.stringify(dailyState));
  }
  // Count unique days completed
  const prevCount = stats.dailyCount || 0;
  stats.dailyCount = prevCount + 1;
  saveStats();

  const badge = $('go-daily-badge');
  if (badge){
    badge.hidden = false;
    const reached = score >= DAILY_TARGET_SCORE;
    badge.textContent = isNewDailyBest
      ? '📅 Daily Best: ' + score + (reached ? ' 🏆' : '')
      : '📅 Daily Score: ' + score + ' (Best: ' + dailyState.score + ')';
  }
}

/* ── SPEED LINES (boost FX) ──────────────────────────── */
function spawnSpeedLines(){
  if (speedLines.length > 22) return;
  for (let i = 0; i < 3; i++){
    speedLines.push({
      x: Math.random() * GW,
      y: Math.random() * GH_BASE * 0.6,
      len: 18 + Math.random() * 55,
      alpha: 0.55 + Math.random() * 0.4,
      speed: 14 + Math.random() * 18,
    });
  }
}

function updateDrawSpeedLines(dt){
  if (!boostActive){ speedLines = []; return; }
  spawnSpeedLines();
  ctx.save();
  for (let i = speedLines.length - 1; i >= 0; i--){
    const sl = speedLines[i];
    sl.y += sl.speed * dt;
    sl.alpha -= 0.045 * dt;
    if (sl.alpha <= 0 || sl.y > GH_BASE + sl.len){ speedLines.splice(i, 1); continue; }
    ctx.globalAlpha = sl.alpha * 0.7;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(sl.x, sl.y);
    ctx.lineTo(sl.x, sl.y + sl.len);
    ctx.stroke();
  }
  ctx.restore();
}

/* ── NPC AVOIDANCE ON HORN ───────────────────────────── */
// Returns how much an NPC should dodge (0-1) based on distance to player car.
// Closer = stronger avoidance
function getHornDodgeFactor(npcX, npcY, carDrawY){
  const dx = Math.abs((npcX + NPC_W/2) - (carX + CAR_W/2));
  const dy = carDrawY - (npcY + NPC_H/2);        // positive = NPC is above (ahead)
  const dist = Math.sqrt(dx*dx + dy*dy);
  const maxDist = 150;                            // avoidance radius
  if (dist > maxDist || dy < -40) return 0;       // far away or behind = no effect
  return Math.max(0, 1 - dist / maxDist);
}

/* ── SPAWN ───────────────────────────────────────────── */
function spawnNPC(){
  const lane = Math.floor(Math.random() * LANE_X.length);
  const npcType = pickNPCType(level);
  const def = NPC_TYPES[npcType];
  if (traffic.some(t => t.lane === lane && t.y < SAFE_GAP + (def.h - 68))) return;
  const absFloor = BASE_SPD * 0.25;
  const relBonus = 0.6 + Math.random() * 1.0;
  const effectiveRoad = Math.max(BASE_SPD, roadSpeed);
  const spdRel = Math.max(absFloor, relBonus * (effectiveRoad / BASE_SPD) * def.spdMult);
  traffic.push({
    lane, x: LANE_X[lane] - def.w/2, y: -def.h,
    npcType, spdRel, imgIdx: Math.floor(Math.random() * npcImgs.length),
    dodgeVelX: 0, dodgeOffsetX: 0, policeChase: npcType === 'police',
    zigzagTimer: npcType === 'motorbike' ? Math.random() * 60 : 0,
  });
  if (level >= 2 && Math.random() < 0.20){
    const lane2 = (lane + 1 + Math.floor(Math.random() * 2)) % LANE_X.length;
    const npcType2 = pickNPCType(level);
    const def2 = NPC_TYPES[npcType2];
    const spdRel2 = Math.max(absFloor, (0.6 + Math.random() * 1.0) * (effectiveRoad / BASE_SPD) * def2.spdMult);
    if (!traffic.some(t => t.lane === lane2 && t.y < SAFE_GAP))
      traffic.push({
        lane: lane2, x: LANE_X[lane2] - def2.w/2, y: -def2.h - 30,
        npcType: npcType2, spdRel: spdRel2, imgIdx: Math.floor(Math.random() * npcImgs.length),
        dodgeVelX: 0, dodgeOffsetX: 0, policeChase: npcType2 === 'police',
        zigzagTimer: npcType2 === 'motorbike' ? Math.random() * 60 : 0,
      });
  }
}

/* ── COLLISION HELPERS ───────────────────────────────── */
function hbox(x, y, w, h){ return {l: x+HITPAD, r: x+w-HITPAD, t: y+HITPAD, b: y+h-HITPAD}; }
function npcBox(t){ const def = NPC_TYPES[t.npcType]||NPC_TYPES.car; return hbox(t.x+(t.dodgeOffsetX||0), t.y, def.w, def.h); }
function overlaps(a, b){ return !(a.b < b.t || a.t > b.b || a.r < b.l || a.l > b.r); }
function lerp(a, b, t){ return a + (b - a) * t; }

/* ── CAR–BARRIER COLLISION ───────────────────────────── */
function checkBarrierCollision(){
  if (carX < BARRIER_L){
    carX = BARRIER_L;
    carVelX = -carVelX * 0.4;        // bounce back slightly
    spawnExplosion(carX + CAR_W/2, GH_BASE - CAR_H - CAR_BASE_Y_OFFSET);
    return true;
  }
  if (carX > BARRIER_R){
    carX = BARRIER_R;
    carVelX = -carVelX * 0.4;
    spawnExplosion(carX + CAR_W/2, GH_BASE - CAR_H - CAR_BASE_Y_OFFSET);
    return true;
  }
  return false;
}

/* ── DRAW ────────────────────────────────────────────── */
function draw(){
  const rh = roadImg.naturalHeight || 600;
  if (rh > 1){
    const off = ((roadY % rh) + rh) % rh;
    for (let y = off - rh; y < GH_BASE; y += rh) ctx.drawImage(roadImg, 0, y, GW, rh);
  } else {
    ctx.fillStyle = '#1a1a1f'; ctx.fillRect(0, 0, GW, GH_BASE);
  }

  traffic.forEach(t => { drawNPC(t); });

  drawPerks();

  const carDrawY = GH_BASE - CAR_H - CAR_BASE_Y_OFFSET - carYOffset;

  if (boostActive){
    ctx.save();
    // Ghost trail frames
    for (let i = 1; i <= 4; i++){
      ctx.globalAlpha = 0.13 / i;
      ctx.drawImage(carImg, 0, 0, 120, 120, carX, carDrawY + i * 6, CAR_W, CAR_H);
    }
    ctx.restore();
    // Speed lines
    updateDrawSpeedLines(1);
  }

  if (Math.abs(carTilt) > 0.005){
    ctx.save();
    ctx.translate(carX + CAR_W/2, carDrawY + CAR_H * 0.55);
    ctx.rotate(carTilt);
    ctx.drawImage(carImg, 0, 0, 120, 120, -CAR_W/2, -CAR_H*0.55, CAR_W, CAR_H);
    ctx.restore();
  } else {
    ctx.drawImage(carImg, 0, 0, 120, 120, carX, carDrawY, CAR_W, CAR_H);
  }

  if (particles.length){
    particles.forEach(p => {
      ctx.globalAlpha = p.life; ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.1, p.r * p.life), 0, Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  if (pops.length){
    ctx.font = "bold 13px 'Orbitron',monospace"; ctx.textAlign = 'center';
    pops.forEach(p => { ctx.globalAlpha = p.a; ctx.fillStyle = p.c||'#fff'; ctx.fillText(p.t||'+1', p.x, p.y); });
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }

  // Floating combo multiplier above car during active streak
  const mult = getStreakMult();
  if (streak > 0 && mult > 1){
    const pulse = 0.85 + 0.15 * Math.sin(Date.now() / 120);
    ctx.save();
    ctx.globalAlpha = Math.min(1, streakTimer / 40) * pulse;
    ctx.font = `bold ${12 + mult * 2}px 'Orbitron',monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = mult >= 5 ? '#ff3c3c' : mult >= 4 ? '#ff8c00' : mult >= 3 ? '#ffcc00' : '#39ff8a';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    ctx.fillText('\u00d7' + mult, carX + CAR_W / 2, carDrawY - 10);
    ctx.restore();
  }
}

/* ── HUD UPDATE ──────────────────────────────────────── */
function updateHUD(){
  // pct: 0 at standstill, 100 at max normal speed
  const pct = Math.min(100, (roadSpeed / (BASE_SPD * 2.8)) * 100);
  const kmh = Math.round(pct * 1.8);
  drawSpeedometer(kmh);
  if (S.soundOn) updateEngineAudio(pct, boostActive, brakeActive);
}

/* ── MAIN LOOP ───────────────────────────────────────── */
function loop(ts){
  if (STATE !== 'playing' && STATE !== 'dying') return;
  const dt = Math.min(lastTime ? (ts - lastTime) / 16.667 : 1, 2.5);
  lastTime = ts;

  if (STATE === 'playing'){
    roadY += roadSpeed * dt;
    distancePx += roadSpeed * dt;
    const eff = steerInput !== 0 ? steerInput : (S.gyroOn ? gyroSteer : 0);

    if (boostActive){ boostTimer -= dt * 16.667; if (boostTimer <= 0) boostActive = false; }
    if (hornActive)  { hornTimer  -= dt * 16.667; if (hornTimer  <= 0) hornActive  = false; }

    // Speed scaling: accelerate from 0 on start, then scale with level/boost/brake
    const cruiseSpeed = BASE_SPD + (level - 1) * 0.45;
    const targetSpeed = boostActive ? cruiseSpeed * 2 :
                        brakeActive ? cruiseSpeed * 0.35 :
                        cruiseSpeed;
    // Slow ramp at very low speeds (launch feel), faster lerp once up to speed
    const speedLerp = boostActive ? 0.01 * dt :
                      brakeActive ? 0.08 * dt :
                      roadSpeed < BASE_SPD * 0.5 ? 0.1 * dt :  // slow launch
                      roadSpeed < BASE_SPD        ? 0.008 * dt :  // mid ramp
                      0.012 * dt;
    roadSpeed = lerp(roadSpeed, targetSpeed, speedLerp);

    carYOffsetTarget = boostActive ? CAR_BOOST_Y_LIFT : brakeActive ? BRAKE_Y_LIFT : 0;
    carYOffset = lerp(carYOffset, carYOffsetTarget, 0.12 * dt);

    const isHolding = steerInput !== 0 || (S.gyroOn && Math.abs(gyroSteer) > 0.05);
    const fric = isHolding ? Math.pow(STEER_FRICTION, dt) : Math.pow(STEER_RELEASE_FRICTION, dt);
    carVelX += eff * steerAccel() * (boostActive ? 1.9 : 1) * (brakeActive ? 0 : 1) * dt;
    carVelX *= fric;
    carVelX = Math.max(-MAX_STEER_SPD, Math.min(MAX_STEER_SPD, carVelX));
    carX = Math.max(0, Math.min(GW - CAR_W, carX + carVelX * dt));

    // Barrier collision — hard walls, causes game over on strong impact
    if (checkBarrierCollision()){
      if (Math.abs(carVelX) > 3){          // only crash on fast impact
        spawnExplosion(carX + CAR_W/2, GH_BASE - CAR_H - CAR_BASE_Y_OFFSET);
        STATE = 'dying'; deathTimer = 520;
        stopEngine();
        playCrash();
        gc.classList.add('shake');
        setTimeout(() => gc.classList.remove('shake'), 400);
        raf = requestAnimationFrame(loop);
        return;
      }
    }

    carTiltTarget = (carVelX / MAX_STEER_SPD) * MAX_TILT;
    carTilt = lerp(carTilt, carTiltTarget, (isHolding ? TILT_SPEED : TILT_RETURN) * dt);

    const carDrawY = GH_BASE - CAR_H - CAR_BASE_Y_OFFSET - carYOffset;
    const chb = hbox(carX, carDrawY, CAR_W, CAR_H);

    // ── Perk pickup & expiry ──
    if (activePerk && Date.now() >= activePerk.expiresAt) clearPerk();

    // ── Boost cooldown tick ──
    if (!boostActive && boostCooldown > 0){
      boostCooldown -= dt * 16.667;
      if (boostCooldown < 0) boostCooldown = 0;
      updateBoostArc(1 - boostCooldown / BOOST_COOLDOWN);
    }

    // ── Road perk movement & player pickup ──
    const perkPickupR = 24;
    for (let i = roadPerks.length - 1; i >= 0; i--){
      const p = roadPerks[i];
      p.y += (Math.max(BASE_SPD*0.5, roadSpeed)) * dt;
      if (p.y > GH_BASE + 32){ roadPerks.splice(i, 1); continue; }
      const px = p.x + 16, py = p.y + 16;
      const carCX = carX + CAR_W/2, carCY = carDrawY + CAR_H/2;
      if (Math.hypot(px - carCX, py - carCY) < perkPickupR + 16){
        collectPerk(p.type); roadPerks.splice(i, 1);
      }
    }

    perkSpawnTimer += dt;
    if (perkSpawnTimer >= PERK_SPAWN_INTERVAL){ spawnPerk(); perkSpawnTimer = 0; }

    // ── NPC update ──
    for (let i = traffic.length - 1; i >= 0; i--){
      const t = traffic[i];
      const def = NPC_TYPES[t.npcType] || NPC_TYPES.car;
      const slowFactor = isPerkActive('slow') ? 0.35 : 1;
      const npcMove = (Math.max(BASE_SPD*0.5, roadSpeed) + t.spdRel) * slowFactor;
      t.y += npcMove * dt;

      // Motorbike zigzag behaviour
      if (t.npcType === 'motorbike'){
        t.zigzagTimer = (t.zigzagTimer || 0) + dt;
        if (t.zigzagTimer > 45 + Math.random() * 30){
          t.dodgeVelX = (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 2);
          t.zigzagTimer = 0;
        }
      }

      // Police chases player X position
      if (t.npcType === 'police' && t.y > 0 && t.y < GH_BASE * 0.7){
        const carCX = carX + CAR_W/2, polCX = t.x + (t.dodgeOffsetX||0) + def.w/2;
        const chaseDir = carCX > polCX ? 1 : -1;
        t.dodgeVelX = lerp(t.dodgeVelX||0, chaseDir * 1.8, 0.04 * dt);
      }

      // Horn avoidance
      if (hornActive){
        const dodge = getHornDodgeFactor(t.x + (t.dodgeOffsetX||0), t.y, carDrawY);
        if (dodge > 0){
          const carCenterX = carX + CAR_W/2;
          const npcCenterX = t.x + (t.dodgeOffsetX||0) + def.w/2;
          const dir = npcCenterX > carCenterX ? 1 : -1;
          t.dodgeVelX = lerp(t.dodgeVelX || 0, dir * dodge * 2.8 * (roadSpeed / BASE_SPD), 0.045 * dt);
        }
      } else if (t.npcType !== 'motorbike' && t.npcType !== 'police'){
        t.dodgeVelX = lerp(t.dodgeVelX || 0, 0, 0.01 * dt);
      }
      t.dodgeOffsetX = (t.dodgeOffsetX || 0) + (t.dodgeVelX || 0) * dt;
      const MAX_NPC_TILT = -0.18;
      t.dodgeTilt = lerp(t.dodgeTilt || 0, (t.dodgeVelX || 0) / (2.8 * 1.5) * MAX_NPC_TILT, 0.08 * dt);
      const rawX = t.x + t.dodgeOffsetX;
      if (rawX < 0) t.dodgeOffsetX = -t.x;
      if (rawX + def.w > GW) t.dodgeOffsetX = GW - def.w - t.x;

      // Magnet perk: pull nearby NPC off road for bonus
      if (isPerkActive('magnet')){
        const npcCX = t.x + (t.dodgeOffsetX||0) + def.w/2;
        const npcCY = t.y + def.h/2;
        if (Math.hypot(npcCX - (carX+CAR_W/2), npcCY - (carDrawY+CAR_H/2)) < 90){
          t.y += 8 * dt; // pull them off screen faster
        }
      }

      if (t.y > GH_BASE + def.h){
        traffic.splice(i, 1);
        const mult = getStreakMult();
        const doublerOn = isPerkActive('doubler');
        const baseScore = t.npcType === 'truck' ? 2 : t.npcType === 'ambulance' ? 3 : 1;
        const pts = baseScore * mult * (doublerOn ? 2 : 1);
        score += pts;
        scoreEl.textContent = score;
        const label = (mult > 1 || doublerOn) ? '+' + pts + (mult > 1 ? ' \u00d7'+mult : '') + (doublerOn ? ' \u00d72' : '') : '+' + baseScore;
        pops.push({x: t.x + def.w/2, y: GH_BASE - 50, a: 1, t: label,
          c: doublerOn ? '#ffd700' : mult > 1 ? '#39ff8a' : '#fff'});
        if (score % 12 === 0) levelUp();
        continue;
      }

      // Car–NPC collision — shield absorbs it
      const nb = npcBox(t);
      if (overlaps(chb, nb)){
        if (isPerkActive('shield')){
          // Shield: bounce NPC off, lose shield
          t.dodgeVelX = (t.x < carX ? -4 : 4);
          t.y -= 12;
          clearPerk();
          pops.push({x: carX+CAR_W/2, y: carDrawY-20, a: 1.5, t: 'SHIELD!', c:'#39ff8a'});
          if (S.vibrateOn && navigator.vibrate) navigator.vibrate([10,5,10]);
        } else {
          spawnExplosion(carX + CAR_W/2, carDrawY + CAR_H/2);
          STATE = 'dying'; deathTimer = 520;
          stopEngine(); playCrash();
          gc.classList.add('shake');
          setTimeout(() => gc.classList.remove('shake'), 400);
          break;
        }
      }

      // Near miss — use expanded box
      const exp = {l: nb.l-14, r: nb.r+14, t: nb.t, b: nb.b};
      if (overlaps(chb, exp) && !overlaps(chb, nb) && nearMissTimer <= 0){
        nearMissTimer = 60;
        streak++; streakTimer = STREAK_TIMEOUT;
        _gameMisses++;
        const mult = getStreakMult();
        const doublerOn = isPerkActive('doubler');
        const pts = 3 * mult * (doublerOn ? 2 : 1);
        score += pts; scoreEl.textContent = score;
        const multLabel = mult > 1 ? ' \u00d7' + mult + '!' : '';
        pops.push({x: nb.l + (nb.r-nb.l)/2, y: t.y, a: 1,
          t: 'CLOSE! +' + pts + multLabel,
          c: mult >= 4 ? '#ff3c3c' : mult >= 3 ? '#ff8c00' : '#ffcc00'});
        if (S.vibrateOn && navigator.vibrate) navigator.vibrate(30);
        playWhoosh();
        updateStreakHUD();
        checkAchievements();
      }
    }
    if (nearMissTimer > 0) nearMissTimer -= dt;

    if (streakTimer > 0){
      streakTimer -= dt;
      if (streakTimer <= 0) resetStreak();
    }
    if (hornActive || brakeActive) resetStreak();

    // ── NPC–NPC push apart ──
    for (let i = 0; i < traffic.length; i++){
      for (let j = i + 1; j < traffic.length; j++){
        const a = traffic[i], b = traffic[j];
        const da = NPC_TYPES[a.npcType]||NPC_TYPES.car, db = NPC_TYPES[b.npcType]||NPC_TYPES.car;
        const ax = a.x + (a.dodgeOffsetX || 0), bx = b.x + (b.dodgeOffsetX || 0);
        const aBox = hbox(ax, a.y, da.w, da.h);
        const bBox = hbox(bx, b.y, db.w, db.h);
        if (overlaps(aBox, bBox)){
          const push = 1.5;
          a.dodgeOffsetX = (a.dodgeOffsetX||0) + (ax < bx ? -push : push);
          b.dodgeOffsetX = (b.dodgeOffsetX||0) + (bx < ax ? -push : push);
          if (a.spdRel > b.spdRel) a.spdRel *= 0.98; else b.spdRel *= 0.98;
        }
      }
    }

    spawnTimer += dt * 16.667;
    const spawnInterval = Math.max(300, SPAWN_MS - (level-1)*40 - (roadSpeed - BASE_SPD)*15);
    if (spawnTimer >= spawnInterval){ spawnNPC(); spawnTimer = 0; }
    updateHUD();

  } else {
    deathTimer -= dt * 16.667;
    if (deathTimer <= 0){ doGameOver(); return; }
  }

  for (let i = particles.length - 1; i >= 0; i--){
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.15 * dt; p.life -= 0.035 * dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = pops.length - 1; i >= 0; i--){
    pops[i].y -= 1.5 * dt; pops[i].a -= 0.045 * dt;
    if (pops[i].a <= 0) pops.splice(i, 1);
  }

  draw();
  raf = requestAnimationFrame(loop);
}

/* ═══════════════════════════════════════════════════════
   AUDIO ENGINE  —  multi-layer realistic car engine
   ═══════════════════════════════════════════════════════
   Architecture:
     [engine.mp3 source] ──┐
     [synth harmonics  ] ──┼─► [waveshaper] ─► [lowpass] ─► [compressor] ─► [boostGain] ─► [masterGain] ─► out
   RPM model: 700 rpm idle → 7000 rpm redline
   ═══════════════════════════════════════════════════════ */

let audioCtx = null;
function getAudioCtx(){
  if (!audioCtx || audioCtx.state === 'closed')
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ── RPM constants ──
const RPM_IDLE   = 600;
const RPM_CRUISE = 3000;
const RPM_MAX    = 6500;
function speedToRPM(spd, isBoost, isBrake){
  if (isBrake){
    // On brake: RPM drops toward a slightly raised idle (engine braking feel)
    return Math.max(RPM_IDLE + 100, _currentRPM * 0.55);
  }
  // Map road speed to RPM range — use a gentle curve so low speeds
  // don't produce an annoying buzz (idle is barely audible)
  const frac = Math.min(1, spd / (BASE_SPD * 2.5));
  const base  = RPM_IDLE + frac * (RPM_CRUISE - RPM_IDLE);
  return isBoost ? Math.min(RPM_MAX, base * 1.3) : Math.min(RPM_MAX, base);
}
function rpmToRate(rpm){ return Math.max(0.25, rpm / 2200); }
function rpmToHz(rpm) { return (rpm / 60) * 2; }  // 4-cyl: 2 firing events/rev

// ── Engine state ──
let engineBuffer   = null;
let _engineLoading = false;
let eng            = null;
let _currentRPM    = RPM_IDLE;
let _rpmTick       = 0;

// Waveshaper — combustion harmonic distortion
function makeDistortionCurve(amount){
  const n = 512, c = new Float32Array(n);
  for (let i = 0; i < n; i++){
    const x = (i * 2) / n - 1;
    c[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return c;
}

async function loadEngineBuffer(){
  if (engineBuffer || _engineLoading) return;
  _engineLoading = true;
  try {
    const ac   = getAudioCtx();
    const resp = await fetch('sounds/engine.mp3');
    const ab   = await resp.arrayBuffer();
    engineBuffer = await ac.decodeAudioData(ab);
  } catch(e){ console.warn('engine.mp3 failed — synth layer active', e); }
  _engineLoading = false;
}
loadEngineBuffer();

function startEngine(){
  if (!S.soundOn) return;
  stopEngine();
  const ac  = getAudioCtx();
  const now = ac.currentTime;
  _currentRPM = RPM_IDLE;

  // ── Output chain ──
  const masterGain = ac.createGain();
  // Start near-silent and ramp up — prevents harsh click on game start
  masterGain.gain.setValueAtTime(0.001, now);
  masterGain.gain.linearRampToValueAtTime(0.58, now + 2.2);  // gentler, slower fade-in

  const boostGain = ac.createGain();
  boostGain.gain.value = 1;

  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value      = 12;
  comp.ratio.value     = 4;
  comp.attack.value    = 0.006;
  comp.release.value   = 0.25;

  // Two-stage filter: gentle low-pass keeps it warm, high-pass cuts sub-rumble
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 0.6;

  const hp = ac.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 55; hp.Q.value = 0.5;

  // Milder waveshaper — less electronic buzz, more mechanical warmth
  const waveshaper = ac.createWaveShaper();
  waveshaper.curve      = makeDistortionCurve(30);  // was 55 — softer saturation
  waveshaper.oversample = '2x';

  hp.connect(waveshaper);
  waveshaper.connect(lp);
  lp.connect(comp);
  comp.connect(boostGain);
  boostGain.connect(masterGain);
  masterGain.connect(ac.destination);

  // ── Layer A: engine.wav pitch-shifted by RPM ──
  let src = null;
  if (engineBuffer){
    const srcGain = ac.createGain();
    srcGain.gain.value = 0.80;
    src = ac.createBufferSource();
    src.buffer = engineBuffer;
    src.loop   = true;
    src.playbackRate.value = rpmToRate(RPM_IDLE);
    src.connect(srcGain);
    srcGain.connect(hp);
    src.start(now);
  }

  // ── Layer B: synthesised harmonic stack ──
  // Quieter amplitudes at idle — the engine.wav carries the low end;
  // synth just adds top-end character and helps when the file isn't loaded.
  const harmonicDefs = [
    { mult: 1,   amp: 0.22, type: 'sawtooth' },  // fundamental
    { mult: 2,   amp: 0.12, type: 'sawtooth' },  // 2nd harmonic
    { mult: 3,   amp: 0.05, type: 'square'   },  // 3rd — gentle growl
    { mult: 0.5, amp: 0.10, type: 'sine'     },  // sub — exhaust thump
  ];
  const baseHz    = rpmToHz(RPM_IDLE);
  const synthNodes = harmonicDefs.map(def => {
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.type            = def.type;
    osc.frequency.value = baseHz * def.mult;
    // Start synth near-silent at idle so it doesn't buzz annoyingly
    g.gain.value = def.amp * 0.15;
    osc.connect(g); g.connect(hp);
    osc.start(now);
    return { osc, g, mult: def.mult, baseAmp: def.amp };
  });

  eng = { src, synthNodes, lp, hp, comp, boostGain, masterGain };
}

function stopEngine(){
  if (!eng) return;
  try {
    if (eng.src) eng.src.stop();
    eng.synthNodes.forEach(n => { try { n.osc.stop(); } catch {} });
    try { eng.masterGain.gain.cancelScheduledValues(0); eng.masterGain.disconnect(); } catch {}
    try { eng.boostGain.gain.cancelScheduledValues(0);  eng.boostGain.disconnect();  } catch {}
    try { eng.comp.disconnect();       } catch {}
    try { eng.lp.frequency.cancelScheduledValues(0); eng.lp.disconnect(); } catch {}
    try { if (eng.hp) eng.hp.disconnect(); } catch {}
  } catch {}
  eng = null;
}

// Called every frame from updateHUD
function updateEngineAudio(pct, isBoost, isBrake){
  if (!eng) return;
  const ac  = getAudioCtx();
  const now = ac.currentTime;

  // Smooth RPM — engine inertia
  const targetRPM = speedToRPM(roadSpeed, isBoost, isBrake);
  const rpmLerp   = isBoost ? 0.10 : isBrake ? 0.06 : 0.028;
  _currentRPM     = _currentRPM + (targetRPM - _currentRPM) * rpmLerp;

  // Micro-flutter every 4 frames — uneven cylinder firing
  _rpmTick++;
  const rpmDisplay = (_rpmTick % 4 === 0)
    ? _currentRPM * (0.985 + Math.random() * 0.03)
    : _currentRPM;

  const rate  = rpmToRate(rpmDisplay);
  const freqHz = rpmToHz(rpmDisplay);

  if (eng.src){
    eng.src.playbackRate.linearRampToValueAtTime(rate, now + 0.055);
  }
  eng.synthNodes.forEach(n => {
    n.osc.frequency.linearRampToValueAtTime(freqHz * n.mult, now + 0.055);
    // Keep synth near-silent at idle — only open up as RPM rises past idle+400
    const rpmFactor = Math.max(0, Math.min(1, (_currentRPM - (RPM_IDLE + 400)) / (RPM_CRUISE - RPM_IDLE)));
    n.g.gain.linearRampToValueAtTime(n.baseAmp * (0.08 + rpmFactor * 0.85), now + 0.08);
  });

  // LP cutoff opens with RPM — more top-end at high revs
  const lpFreq = 850 + (_currentRPM / RPM_MAX) * 3400;
  eng.lp.frequency.linearRampToValueAtTime(lpFreq, now + 0.10);

  // Master volume
  const vol = 0.32 + (pct / 100) * 0.22;
  eng.masterGain.gain.linearRampToValueAtTime(isBoost ? vol + 0.08 : vol, now + 0.10);
}

// Boost surge — pitch/gain spike + turbo hiss
function playBoostSurge(){
  if (!S.soundOn || !eng) return;
  const ac  = getAudioCtx();
  const now = ac.currentTime;
  eng.boostGain.gain.cancelScheduledValues(now);
  eng.boostGain.gain.setValueAtTime(eng.boostGain.gain.value, now);
  eng.boostGain.gain.linearRampToValueAtTime(1.9,  now + 0.08);
  eng.boostGain.gain.linearRampToValueAtTime(1.35, now + 0.45);
  eng.boostGain.gain.linearRampToValueAtTime(1.0,  now + 1.6);
  _currentRPM = Math.min(RPM_MAX, _currentRPM * 1.6);
  _playTurboHiss();
}

function _playTurboHiss(){
  if (!S.soundOn) return;
  try {
    const ac  = getAudioCtx();
    const now = ac.currentTime;
    const len = Math.floor(ac.sampleRate * 0.9);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = buf;
    const hp  = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const bp  = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4000; bp.Q.value = 2.2;
    const g   = ac.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.26, now + 0.05);
    g.gain.setValueAtTime(0.26,         now + 0.28);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.88);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(ac.destination);
    src.start(now); src.stop(now + 0.9);
  } catch {}
}
// ── Near-miss whoosh (synthesised) ──
function playWhoosh(){
  if (!S.soundOn) return;
  try {
    const ac = getAudioCtx();
    const now = ac.currentTime;
    const bufSize = ac.sampleRate * 0.35;
    const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;

    const bpf = ac.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.setValueAtTime(3500, now);
    bpf.frequency.linearRampToValueAtTime(600, now + 0.3);
    bpf.Q.value = 1.2;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    src.connect(bpf); bpf.connect(g); g.connect(ac.destination);
    src.start(now); src.stop(now + 0.35);
  } catch {}
}

// ── Crash: play crash.mp3 + layered metal crunch (synthesised) ──
const sndCrash = $('snd-crash');
function playCrash(){
  if (!S.soundOn) return;
  // File layer
  sndCrash.currentTime = 0;
  sndCrash.play().catch(() => {});
  // Synthesised low crunch layer
  try {
    const ac = getAudioCtx();
    const now = ac.currentTime;
    const bufSize = Math.floor(ac.sampleRate * 0.6);
    const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++){
      const t = i / ac.sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 8);
    }
    const src = ac.createBufferSource();
    src.buffer = buf;

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.9, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

    src.connect(lp); lp.connect(g); g.connect(ac.destination);
    src.start(now); src.stop(now + 0.65);
  } catch {}
}

/* ── REALISTIC HORN (Web Audio API) ─────────────────── */
function playHorn(){
  if (!S.soundOn) return;
  try {
    const ac = getAudioCtx();
    const now = ac.currentTime;

    const masterGain = ac.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.35, now + 0.03);
    masterGain.gain.setValueAtTime(0.35, now + 0.22);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    masterGain.connect(ac.destination);

    const freqs = [415, 523, 622];
    freqs.forEach(freq => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq * 0.97, now);
      osc.frequency.linearRampToValueAtTime(freq, now + 0.04);
      g.gain.setValueAtTime(0.4, now);
      osc.connect(g); g.connect(masterGain);
      osc.start(now); osc.stop(now + 0.45);
    });

    const noise = ac.createOscillator();
    const noiseGain = ac.createGain();
    noise.type = 'square';
    noise.frequency.setValueAtTime(80, now);
    noiseGain.gain.setValueAtTime(0.06, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    noise.connect(noiseGain); noiseGain.connect(masterGain);
    noise.start(now); noise.stop(now + 0.12);
  } catch {}
}

/* ── BUTTON EVENTS ───────────────────────────────────── */
$('play-btn').addEventListener('click', startGame);
$('pause-btn').addEventListener('click', pauseGame);
$('resume-btn').addEventListener('click', resumeGame);
$('retry-btn').addEventListener('click', startGame);
$('home-from-pause').addEventListener('click', goHome);
$('home-from-go').addEventListener('click', goHome);
$('lb-open-btn').addEventListener('click', openLeaderboard);
$('lb-close-btn').addEventListener('click', () => showScreen('home'));

// Stats screen
const statsBtn = $('stats-open-btn');
if (statsBtn) statsBtn.addEventListener('click', () => showScreen('stats'));
const statsClose = $('stats-close-btn');
if (statsClose) statsClose.addEventListener('click', () => showScreen('home'));

// Achievements screen
const achBtn = $('achievements-open-btn');
if (achBtn) achBtn.addEventListener('click', () => showScreen('achievements'));
const achClose = $('achievements-close-btn');
if (achClose) achClose.addEventListener('click', () => showScreen('home'));

// Daily challenge button
const dailyBtn = $('daily-btn');
if (dailyBtn) dailyBtn.addEventListener('click', openDailyChallenge);

function openSettings(prev){
  applySettingsUI(); screenSettings.dataset.prev = prev || 'home'; showScreen('settings');
}
$('settings-open-btn').addEventListener('click', () => openSettings('home'));
$('settings-pause-btn').addEventListener('click', () => { pauseGame(); openSettings('pause'); });
$('settings-close-btn').addEventListener('click', () => {
  const prev = screenSettings.dataset.prev || 'home';
  if (prev === 'pause') showScreen('pause'); else goHome();
});

/* ── LEADERBOARD SUBMIT ──────────────────────────────── */
$('lb-submit-btn').addEventListener('click', async () => {
  const name = $('lb-name-input').value.trim();
  if (!name){ $('lb-submit-status').textContent = 'Enter your name!'; return; }
  playerName = name;
  localStorage.setItem(LB_PLAYER_KEY, name);
  $('lb-submit-btn').disabled = true;
  $('lb-submit-status').textContent = 'Looking up your score\u2026';

  await bindNameToIP(name);

  // Fetch live data FIRST so lbData is populated, then recover score by name
  try { await lbFetch(); } catch {}
  syncBestFromRemoteByName(name);
  bestEl.textContent = best;
  goBestEl.textContent = best;

  const nameKey = name.toLowerCase();
  const base = lbData.length ? lbData : lbLoadCache();
  const submitScore = Math.max(score, best);
  const optimisticEntry = { name, score: submitScore, ts: Date.now(), _optimistic: true, ip: clientIP || undefined };
  const withNew = [...base.filter(e => clientIP ? (e.ip ? e.ip !== clientIP : e.name.toLowerCase() !== nameKey) : e.name.toLowerCase() !== nameKey), optimisticEntry]
    .sort((a, b) => b.score - a.score).slice(0, MAX_LB_ENTRIES);
  lbSaveCache(withNew);
  lbData = withNew;

  const rankInfo = renderLB(lbData, playerName);
  if (rankInfo){
    $('lb-submit-status').textContent = 'Rank #' + rankInfo.rank + ' \u2014 ' + rankInfo.score.toLocaleString() + ' pts';
  } else {
    $('lb-submit-status').textContent = '\u2713 Submitted!';
  }
  $('lb-entry-wrap').style.display = 'none';

  lbPush(name, submitScore).then(() => {
    lbData = lbData.map(e => e._optimistic ? { name: e.name, score: e.score, ts: e.ts, ip: e.ip } : e);
    lbSaveCache(lbData);
    const ri = renderLB(lbData, playerName);
    if (ri) $('lb-submit-status').textContent = 'Rank #' + ri.rank + ' \u2014 ' + ri.score.toLocaleString() + ' pts \u2713';
  }).catch(() => {
    $('lb-submit-status').textContent = (rankInfo ? 'Rank #' + rankInfo.rank + ' ' : '') + '(syncing\u2026)';
  });
});

/* ── STEER BUTTONS ───────────────────────────────────── */
$('btn-left').addEventListener('pointerdown',  e => { e.preventDefault(); steerInput = -1; });
$('btn-right').addEventListener('pointerdown', e => { e.preventDefault(); steerInput =  1; });
$('btn-left').addEventListener('pointerup',    e => { e.preventDefault(); steerInput = 0; carVelX *= 0.7; });
$('btn-right').addEventListener('pointerup',   e => { e.preventDefault(); steerInput = 0; carVelX *= 0.7; });
$('btn-left').addEventListener('pointerleave', e => { if (e.buttons > 0){ steerInput = 0; carVelX *= 0.7; }});
$('btn-right').addEventListener('pointerleave',e => { if (e.buttons > 0){ steerInput = 0; carVelX *= 0.7; }});
document.addEventListener('pointerup', () => { steerInput = 0; brakeActive = false; });
document.addEventListener('pointercancel', () => { steerInput = 0; carVelX = 0; brakeActive = false; });

/* ── BOOST ───────────────────────────────────────────── */
$('btn-boost').addEventListener('pointerdown', e => {
  e.preventDefault();
  if (STATE !== 'playing') return;
  if (boostCooldown > 0) return;   // on cooldown — blocked
  boostActive = true; boostTimer = BOOST_DURATION;
  boostCooldown = BOOST_COOLDOWN;
  updateBoostArc(0);
  playBoostSurge();
  showToast(boostToast, 300);
  if (S.vibrateOn && navigator.vibrate) navigator.vibrate(60);
});
$('btn-boost').addEventListener('pointerup', e => e.preventDefault());

/* ── BRAKE ───────────────────────────────────────────── */
const brakeBtn = $('btn-brake');
if (brakeBtn){
  brakeBtn.addEventListener('pointerdown', e => {
    e.preventDefault(); if (STATE !== 'playing') return; brakeActive = true;
  });
  brakeBtn.addEventListener('pointerup',    e => { e.preventDefault(); brakeActive = false; });
  brakeBtn.addEventListener('pointerleave', e => { if (e.buttons > 0) brakeActive = false; });
}

/* ── HORN BUTTON (outside HUD, in controls area) ────── */
$('btn-horn').addEventListener('pointerdown', e => {
  e.preventDefault();
  if (STATE !== 'playing') return;
  _hornThisGame = true;
  playHorn();
  hornActive = true;
  hornTimer = 1000;    // avoidance lasts ~1.2 seconds
  if (S.vibrateOn && navigator.vibrate) navigator.vibrate([15, 10, 20]);
});

/* ── KEYBOARD ────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft')       steerInput = -1;
  else if (e.key === 'ArrowRight') steerInput = 1;
  else if (e.key === 'ArrowDown')  brakeActive = true;
  else if (e.key === 'ArrowUp' && boostCooldown <= 0){ boostActive = true; boostTimer = BOOST_DURATION; boostCooldown = BOOST_COOLDOWN; updateBoostArc(0); playBoostSurge(); }
  else if ((e.key === 'b' || e.key === 'B') && boostCooldown <= 0){ boostActive = true; boostTimer = BOOST_DURATION; boostCooldown = BOOST_COOLDOWN; updateBoostArc(0); playBoostSurge(); }
  else if (e.key === ' ') STATE === 'playing' ? pauseGame() : STATE === 'paused' ? resumeGame() : null;
  else if (e.key === 'h' || e.key === 'H'){
    _hornThisGame = true; playHorn(); hornActive = true; hornTimer = 1200;
  }
});
document.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight'){ steerInput = 0; carVelX *= 0.7; }
  if (e.key === 'ArrowDown') brakeActive = false;
});

/* ── SWIPE ───────────────────────────────────────────── */
let swipeX = null, swipeStartX = null;
gc.addEventListener('touchstart', e => {
  if (S.swipeOn){ swipeX = e.touches[0].clientX; swipeStartX = swipeX; }
}, {passive: true});
gc.addEventListener('touchmove', e => {
  if (!S.swipeOn || swipeX === null) return;
  const dx = e.touches[0].clientX - swipeX;
  if (Math.abs(e.touches[0].clientX - swipeStartX) > 6){
    steerInput = dx > 0 ? 1 : -1;
    carVelX += (dx > 0 ? 1 : -1) * Math.min(Math.abs(dx)/18, 1) * steerAccel() * 0.6;
  }
  swipeX = e.touches[0].clientX;
}, {passive: true});
gc.addEventListener('touchend', () => { steerInput = 0; swipeX = null; carVelX *= 0.75; }, {passive: true});

/* ── GYRO ────────────────────────────────────────────── */
function requestGyroPermission(){
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function')
    DeviceOrientationEvent.requestPermission().catch(() => {});
}
window.addEventListener('deviceorientation', e => {
  if (!S.gyroOn || STATE !== 'playing' || e.gamma === null) return;
  const dead = 5 - S.sensitivity * 0.3, g = e.gamma;
  gyroSteer = Math.abs(g) < dead ? 0 : Math.max(-1, Math.min(1, (g - Math.sign(g)*dead) / 18));
});

document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());

/* ── INIT ────────────────────────────────────────────── */
applySettingsUI();
showScreen('home');
setHudVisible(false);
drawSpeedometer(60);
updateStreakHUD();
renderAchievementsTab();
lbFetch();

// Pre-load IP, resolve player name, then sync best score from remote
(async () => {
  const ip = await fetchClientIP();
  if (ip && !playerName) {
    const mapped = ipNameMap[ip];
    if (mapped) {
      playerName = mapped;
      localStorage.setItem(LB_PLAYER_KEY, mapped);
    }
  }
  // Now that playerName is definitely set (if it exists), sync best from
  // whatever lbFetch already loaded — covers the case where lbFetch finished
  // before we knew the player's name.
  syncBestFromRemote();
})();

if ('serviceWorker' in navigator)
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
