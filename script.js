'use strict';

const GW = 380, GH_BASE = 520;
const LANE_X = [22, 63, 104, 145, 186, 227, 275, 322, 350];
const NPC_IMGS = ['./images/traffic.png','./images/traffic2.png','./images/traffic3.png','./images/traffic4.png'];
const CAR_W = 48, CAR_H = 70, NPC_W = 46, NPC_H = 68;
const SAFE_GAP = 160, HITPAD = 10;
const BASE_SPD = 5.5;           // reduced base speed
const SPAWN_MS = 600;         // slower spawn rate
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
const goScoreEl = $('go-score'), goBestEl = $('go-best'), goLevelEl = $('go-level');
const bestEl = $('best-score'), newBestBadge = $('new-best-badge'), levelToast = $('level-up-toast');
const boostToast = $('boost-toast'), gyroHint = $('gyro-hint');
const sndCrash = $('snd-crash'), sndDrive = $('snd-drive');

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
let roadSpeed = BASE_SPD, roadY = 0;
let carX = (GW - CAR_W) / 2;
let carVelX = 0, carTilt = 0, carTiltTarget = 0;
let steerInput = 0, gyroSteer = 0;
let boostActive = false, boostTimer = 0, brakeActive = false;
let carYOffset = 0, carYOffsetTarget = 0;
let traffic = [], particles = [], pops = [];
let raf = null, lastTime = 0, spawnTimer = 0, deathTimer = 0, nearMissTimer = 0;

// Horn avoidance state
let hornActive = false, hornTimer = 0;

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
  [screenHome, screenPause, screenGO, screenSettings, screenLB].forEach(s => s.classList.remove('active'));
  if (name === 'home')        screenHome.classList.add('active');
  else if (name === 'pause')  screenPause.classList.add('active');
  else if (name === 'gameover') screenGO.classList.add('active');
  else if (name === 'settings') screenSettings.classList.add('active');
  else if (name === 'leaderboard') screenLB.classList.add('active');
}
function setHudVisible(v){
  const o = v ? '1' : '0';
  $('hud').style.opacity = o;
  $('controls').style.opacity = o;
}

/* ── SETTINGS ────────────────────────────────────────── */
function applySettingsUI(){
  const map = {
    'set-sound':   [S.soundOn,   v => { S.soundOn   = v; if(!v) sndDrive.pause(); else if(STATE==='playing') sndDrive.play().catch(()=>{}); }],
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

// Restore hr_best from the remote leaderboard for this device's player.
// Runs silently after every lbFetch so same-IP devices always show
// the correct high score even if localStorage was cleared.
function syncBestFromRemote(){
  if (!playerName || !lbData.length) return;
  const key = playerName.trim().toLowerCase();
  const entry = lbData.find(e => e.name.trim().toLowerCase() === key);
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
  const prev = base.find(e => e.name.trim().toLowerCase() === nameKey);

  // Final score = highest of: what we're submitting, local hr_best, and remote best
  // This prevents any downgrade and resolves conflicts by always taking the max.
  const finalScore = Math.max(scoreVal, prev ? prev.score : 0, best);
  const entry = { name: name.trim().slice(0, 16), score: finalScore, ts: Date.now(), ip };

  const filtered = base.filter(e => e.name.trim().toLowerCase() !== nameKey);
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
    const isMe = me && e.name.trim().toLowerCase() === me;
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
  traffic = []; particles = []; pops = [];
  score = 0; level = 1; roadSpeed = BASE_SPD;
  carX = (GW - CAR_W) / 2; carVelX = 0; steerInput = 0; gyroSteer = 0;
  carYOffset = 0; carYOffsetTarget = 0; carTilt = 0; carTiltTarget = 0;
  roadY = 0; lastTime = 0; spawnTimer = 0; deathTimer = 0;
  boostActive = false; boostTimer = 0; brakeActive = false; nearMissTimer = 0;
  hornActive = false; hornTimer = 0;
  speedoNeedle = 60;
  scoreEl.textContent = '0'; levelEl.textContent = '1';
  STATE = 'playing';
  showScreen(null);
  setHudVisible(true);
  if (S.soundOn){ sndDrive.currentTime = 0; sndDrive.play().catch(() => {}); }
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}
function pauseGame(){
  if (STATE !== 'playing') return;
  STATE = 'paused'; showScreen('pause'); sndDrive.pause();
  if (raf){ cancelAnimationFrame(raf); raf = null; }
}
function resumeGame(){
  if (STATE !== 'paused') return;
  STATE = 'playing'; showScreen(null); lastTime = 0;
  if (S.soundOn) sndDrive.play().catch(() => {});
  raf = requestAnimationFrame(loop);
}
async function doGameOver(){
  STATE = 'gameover';
  const isNew = score > best;
  if (isNew){ best = score; localStorage.setItem('hr_best', best); }
  bestEl.textContent = best;
  goScoreEl.textContent = score;
  goBestEl.textContent  = best;
  goLevelEl.textContent = level;
  newBestBadge.hidden   = !isNew;
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
    const cachedEntry = cached.find(e => e.name.toLowerCase() === nameKey);
    const shouldUpdate = !cachedEntry || score > cachedEntry.score;

    if (shouldUpdate){
      // Insert optimistic entry right away so player sees their position immediately
      const optimistic = { name: playerName, score, ts: Date.now(), _optimistic: true };
      const optimisticList = [...cached.filter(e => e.name.toLowerCase() !== nameKey), optimistic]
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
      const liveEntry = lbData.find(e => e.name.toLowerCase() === nameKey);
      const reallyUpdate = !liveEntry || score > liveEntry.score;
      if (reallyUpdate){
        // Re-insert with live data as base (lbData is now fresh from lbFetch)
        const optimistic2 = { name: playerName, score, ts: Date.now(), _optimistic: true };
        lbData = [...lbData.filter(e => e.name.toLowerCase() !== nameKey), optimistic2]
          .sort((a, b) => b.score - a.score).slice(0, MAX_LB_ENTRIES);
        lbSaveCache(lbData);
        lbPush(playerName, score).then(() => {
          // Remove _optimistic flag after confirmed push
          lbData = lbData.map(e => e._optimistic ? { name: e.name, score: e.score, ts: e.ts } : e);
          lbSaveCache(lbData);
          const ri = renderLB(lbData, playerName);
          if (ri) statusEl.textContent = 'Rank #' + ri.rank + ' \u2014 ' + ri.score.toLocaleString() + ' pts \u2713';
        }).catch(() => {});
      } else {
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
  STATE = 'home'; sndDrive.pause();
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
  level++; roadSpeed += 0.3; levelEl.textContent = level; showToast(levelToast, 400);
}

/* ── NPC AVOIDANCE ON HORN ───────────────────────────── */
// Returns how much an NPC should dodge (0-1) based on distance to player car.
// Closer = stronger avoidance
function getHornDodgeFactor(npcX, npcY, carDrawY){
  const dx = Math.abs((npcX + NPC_W/2) - (carX + CAR_W/2));
  const dy = carDrawY - (npcY + NPC_H/2);        // positive = NPC is above (ahead)
  const dist = Math.sqrt(dx*dx + dy*dy);
  const maxDist = 200;                            // avoidance radius
  if (dist > maxDist || dy < -40) return 0;       // far away or behind = no effect
  return Math.max(0, 1 - dist / maxDist);
}

/* ── SPAWN ───────────────────────────────────────────── */
function spawnNPC(){
  const lane = Math.floor(Math.random() * LANE_X.length);
  if (traffic.some(t => t.lane === lane && t.y < SAFE_GAP)) return;
  // NPC speed now scales with roadSpeed so they stay relevant at all levels
  const baseRel = 0.8 + Math.random() * 1.2;     // reduced relative speed
  const spdRel = baseRel * (roadSpeed / BASE_SPD);
  traffic.push({
    lane, x: LANE_X[lane] - NPC_W/2, y: -NPC_H,
    spdRel, imgIdx: Math.floor(Math.random() * npcImgs.length),
    dodgeVelX: 0, dodgeOffsetX: 0                // for horn avoidance
  });
  if (level >= 2 && Math.random() < 0.20){
    const lane2 = (lane + 1 + Math.floor(Math.random() * 2)) % LANE_X.length;
    const spdRel2 = (0.8 + Math.random() * 1.2) * (roadSpeed / BASE_SPD);
    if (!traffic.some(t => t.lane === lane2 && t.y < SAFE_GAP))
      traffic.push({
        lane: lane2, x: LANE_X[lane2] - NPC_W/2, y: -NPC_H - 30,
        spdRel: spdRel2, imgIdx: Math.floor(Math.random() * npcImgs.length),
        dodgeVelX: 0, dodgeOffsetX: 0
      });
  }
}

/* ── COLLISION HELPERS ───────────────────────────────── */
function hbox(x, y, w, h){ return {l: x+HITPAD, r: x+w-HITPAD, t: y+HITPAD, b: y+h-HITPAD}; }
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

  traffic.forEach(t => {
    const drawX = t.x + (t.dodgeOffsetX || 0);
    const npcTilt = t.dodgeTilt || 0;
    if (Math.abs(npcTilt) > 0.005){
      ctx.save();
      ctx.translate(drawX + NPC_W/2, t.y + NPC_H * 0.5);
      ctx.rotate(npcTilt);
      ctx.drawImage(npcImgs[t.imgIdx], 0, 0, 120, 120, -NPC_W/2, -NPC_H*0.5, NPC_W, NPC_H);
      ctx.restore();
    } else {
      ctx.drawImage(npcImgs[t.imgIdx], 0, 0, 120, 120, drawX, t.y, NPC_W, NPC_H);
    }
  });

  const carDrawY = GH_BASE - CAR_H - CAR_BASE_Y_OFFSET - carYOffset;

  if (boostActive){
    ctx.save();
    for (let i = 1; i <= 3; i++){
      ctx.globalAlpha = 0.15 / i;
      ctx.drawImage(carImg, 0, 0, 120, 120, carX, carDrawY + i * 5, CAR_W, CAR_H);
    }
    ctx.restore();
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
}

/* ── HUD UPDATE ──────────────────────────────────────── */
function updateHUD(){
  const pct = Math.min(100, (roadSpeed - BASE_SPD) / (BASE_SPD * 1.8) * 100);
  const kmh = Math.round(80 + pct * 1.8);
  drawSpeedometer(kmh);
  if (S.soundOn) sndDrive.playbackRate = 0.85 + pct / 100 * 0.65;
}

/* ── MAIN LOOP ───────────────────────────────────────── */
function loop(ts){
  if (STATE !== 'playing' && STATE !== 'dying') return;
  const dt = Math.min(lastTime ? (ts - lastTime) / 16.667 : 1, 2.5);
  lastTime = ts;

  if (STATE === 'playing'){
    roadY += roadSpeed * dt;
    const eff = steerInput !== 0 ? steerInput : (S.gyroOn ? gyroSteer : 0);

    if (boostActive){ boostTimer -= dt * 16.667; if (boostTimer <= 0) boostActive = false; }
    if (hornActive)  { hornTimer  -= dt * 16.667; if (hornTimer  <= 0) hornActive  = false; }

    // Speed scaling: all dependent on roadSpeed
    const targetSpeed = boostActive ? BASE_SPD * 2 :
                        brakeActive ? BASE_SPD * 0.35 :
                        BASE_SPD + (level - 1) * 0.35;   // gentler level ramp
    const speedLerp = boostActive ? 0.05 * dt :
                      brakeActive ? 0.08 * dt :
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
        sndDrive.pause();
        if (S.soundOn){ sndCrash.currentTime = 0; sndCrash.play().catch(() => {}); }
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

    // ── NPC update ──
    for (let i = traffic.length - 1; i >= 0; i--){
      const t = traffic[i];
      // NPC speed scaled proportionally to roadSpeed
      t.y += (roadSpeed + t.spdRel) * dt;

      // Horn avoidance — nearer NPCs dodge with gentle acceleration and visible tilt
      if (hornActive){
        const dodge = getHornDodgeFactor(t.x + (t.dodgeOffsetX||0), t.y, carDrawY);
        if (dodge > 0){
          const carCenterX = carX + CAR_W/2;
          const npcCenterX = t.x + (t.dodgeOffsetX||0) + NPC_W/2;
          const dir = npcCenterX > carCenterX ? 1 : -1;
          // Gentle acceleration (was 0.06, now 0.022) — less snappy, more natural
          t.dodgeVelX = lerp(t.dodgeVelX || 0, dir * dodge * 2.8 * (roadSpeed / BASE_SPD), 0.022 * dt);
        }
      } else {
        // Slower return-to-lane (was 0.025, now 0.010) — car eases back gradually
        t.dodgeVelX = lerp(t.dodgeVelX || 0, 0, 0.010 * dt);
      }
      t.dodgeOffsetX = (t.dodgeOffsetX || 0) + (t.dodgeVelX || 0) * dt;
      // NPC tilt proportional to dodge velocity — looks like the car is actually swerving
      const MAX_NPC_TILT = 0.18;
      t.dodgeTilt = lerp(t.dodgeTilt || 0, (t.dodgeVelX || 0) / (2.8 * 1.5) * MAX_NPC_TILT, 0.08 * dt);
      // Clamp dodge so NPC stays on road
      const rawX = t.x + t.dodgeOffsetX;
      if (rawX < 0) t.dodgeOffsetX = -t.x;
      if (rawX + NPC_W > GW) t.dodgeOffsetX = GW - NPC_W - t.x;

      if (t.y > GH_BASE + NPC_H){
        traffic.splice(i, 1); score++;
        scoreEl.textContent = score;
        pops.push({x: t.x + NPC_W/2, y: GH_BASE - 50, a: 1, t: '+1', c: '#fff'});
        if (score % 12 === 0) levelUp();
        continue;
      }

      // Car–NPC collision
      const npcDrawX = t.x + (t.dodgeOffsetX || 0);
      if (overlaps(chb, hbox(npcDrawX, t.y, NPC_W, NPC_H))){
        spawnExplosion(carX + CAR_W/2, carDrawY + CAR_H/2);
        STATE = 'dying'; deathTimer = 520;
        sndDrive.pause();
        if (S.soundOn){ sndCrash.currentTime = 0; sndCrash.play().catch(() => {}); }
        gc.classList.add('shake');
        setTimeout(() => gc.classList.remove('shake'), 400);
        break;
      }

      // Car–Car near miss
      const nb = hbox(npcDrawX, t.y, NPC_W, NPC_H);
      const exp = {l: nb.l-14, r: nb.r+14, t: nb.t, b: nb.b};
      if (overlaps(chb, exp) && !overlaps(chb, nb) && nearMissTimer <= 0){
        nearMissTimer = 60; score += 2; scoreEl.textContent = score;
        pops.push({x: npcDrawX + NPC_W/2, y: t.y, a: 1, t: 'CLOSE!', c: '#ffcc00'});
        if (S.vibrateOn && navigator.vibrate) navigator.vibrate(30);
      }
    }
    if (nearMissTimer > 0) nearMissTimer -= dt;

    // ── NPC–NPC collision (push apart) ──
    for (let i = 0; i < traffic.length; i++){
      for (let j = i + 1; j < traffic.length; j++){
        const a = traffic[i], b = traffic[j];
        const ax = a.x + (a.dodgeOffsetX || 0), bx = b.x + (b.dodgeOffsetX || 0);
        const aBox = hbox(ax, a.y, NPC_W, NPC_H);
        const bBox = hbox(bx, b.y, NPC_W, NPC_H);
        if (overlaps(aBox, bBox)){
          const push = 1.5;
          a.dodgeOffsetX = (a.dodgeOffsetX||0) + (ax < bx ? -push : push);
          b.dodgeOffsetX = (b.dodgeOffsetX||0) + (bx < ax ? -push : push);
          // Slow down the faster one slightly
          if (a.spdRel > b.spdRel) a.spdRel *= 0.98;
          else b.spdRel *= 0.98;
        }
      }
    }

    spawnTimer += dt * 16.667;
    // Spawn interval also scales with speed — faster = more frequent
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

/* ── REALISTIC HORN (Web Audio API) ─────────────────── */
let hornAudioCtx = null;
function getAudioCtx(){
  if (!hornAudioCtx || hornAudioCtx.state === 'closed')
    hornAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (hornAudioCtx.state === 'suspended') hornAudioCtx.resume();
  return hornAudioCtx;
}

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

    const bpf = ac.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.setValueAtTime(900, now);
    bpf.Q.value = 0.8;
    masterGain.connect(bpf);

  } catch (e2) {}
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

  // Bind this name to the current IP
  await bindNameToIP(name);

  // Build optimistic list immediately so player sees their rank right away
  const nameKey = name.toLowerCase();
  const base = lbData.length ? lbData : lbLoadCache();
  const optimisticEntry = { name, score, ts: Date.now(), _optimistic: true };
  const withNew = [...base.filter(e => e.name.toLowerCase() !== nameKey), optimisticEntry]
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

  // Push to server in background; update status when confirmed
  lbPush(name, score).then(() => {
    lbData = lbData.map(e => e._optimistic ? { name: e.name, score: e.score, ts: e.ts } : e);
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
  boostActive = true; boostTimer = 1400;
  showToast(boostToast, 400);
  if (S.vibrateOn && navigator.vibrate) navigator.vibrate(40);
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
  // No toast on horn — just play sound and trigger avoidance
  playHorn();
  hornActive = true;
  hornTimer = 1200;    // avoidance lasts ~1.2 seconds
  if (S.vibrateOn && navigator.vibrate) navigator.vibrate([15, 10, 20]);
});

/* ── KEYBOARD ────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft')       steerInput = -1;
  else if (e.key === 'ArrowRight') steerInput = 1;
  else if (e.key === 'ArrowDown')  brakeActive = true;
  else if (e.key === 'ArrowUp'){ boostActive = true; boostTimer = 1400; }
  else if (e.key === ' ') STATE === 'playing' ? pauseGame() : STATE === 'paused' ? resumeGame() : null;
  else if (e.key === 'b' || e.key === 'B'){ boostActive = true; boostTimer = 1400; }
  else if (e.key === 'h' || e.key === 'H'){
    playHorn(); hornActive = true; hornTimer = 1200;
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
