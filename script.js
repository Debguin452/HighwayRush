'use strict';

const GW = 380, GH_BASE = 520;
const LANE_X = [22, 63, 104, 145, 186, 227, 275, 322, 350];
const NPC_IMGS = ['./images/traffic.png','./images/traffic2.png','./images/traffic3.png','./images/traffic4.png'];
const CAR_W = 48, CAR_H = 70, NPC_W = 46, NPC_H = 68;
const SAFE_GAP = 160, HITPAD = 10;
const BASE_SPD = 5.5;
const SPAWN_MS = 500;
const CAR_BASE_Y_OFFSET = 18;
const CAR_BOOST_Y_LIFT = 18;
const BRAKE_Y_LIFT = 10;

const DEFAULTS = {
  soundOn: true,
  vibrateOn: true,
  gyroOn: false,
  swipeOn: true,
  boostOn: true,
  hornOn: true,
  sensitivity: 5,
  nightMode: false
};
let S = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('hr_settings') || '{}'));
function saveSett(){ localStorage.setItem('hr_settings', JSON.stringify(S)); }

const $ = id => document.getElementById(id);
const gc = $('gc');
const ctx = gc.getContext('2d', { alpha: false });
const scoreEl = $('score-val'), levelEl = $('level-val');
const speedBar = $('speed-bar'), speedLabel = $('speed-label');
const screenHome = $('screen-home'), screenPause = $('screen-pause');
const screenGO = $('screen-gameover'), screenSettings = $('screen-settings');
const goScoreEl = $('go-score'), goBestEl = $('go-best'), goLevelEl = $('go-level');
const bestEl = $('best-score'), newBestBadge = $('new-best-badge'), levelToast = $('level-up-toast');
const hornToast = $('horn-toast'), boostToast = $('boost-toast'), gyroHint = $('gyro-hint');
const sndCrash = $('snd-crash'), sndDrive = $('snd-drive');

const HUD_H = 50, CTRL_H = 90;
function sizeCanvas(){
  const availH = window.innerHeight - HUD_H - CTRL_H;
  const scale = Math.min(window.innerWidth / GW, availH / GH_BASE);
  const cw = Math.round(GW * scale);
  const ch = Math.round(GH_BASE * scale);
  gc.width = GW; gc.height = GH_BASE;
  gc.style.width  = cw + 'px';
  gc.style.height = ch + 'px';
  gc.style.top = HUD_H + Math.max(0, (availH - ch) / 2) + 'px';
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
let carVelX = 0;
let steerInput = 0;
let gyroSteer = 0;
let boostActive = false, boostTimer = 0;
let brakeActive = false;
let carYOffset = 0, carYOffsetTarget = 0;
let traffic = [], particles = [], pops = [];
let raf = null;
let lastTime = 0, spawnTimer = 0, deathTimer = 0;
let nearMissTimer = 0;

bestEl.textContent = best;

function steerAccel(){ return 0.55 + (S.sensitivity / 10) * 0.7; }
const STEER_FRICTION = 0.78;
const MAX_STEER_SPD  = 9;

function showScreen(name){
  [screenHome, screenPause, screenGO, screenSettings].forEach(s => s.classList.remove('active'));
  if (name === 'home')     screenHome.classList.add('active');
  else if (name === 'pause')    screenPause.classList.add('active');
  else if (name === 'gameover') screenGO.classList.add('active');
  else if (name === 'settings') screenSettings.classList.add('active');
}
function setHudVisible(v){
  const o = v ? '1' : '0';
  $('hud').style.opacity = o;
  $('controls').style.opacity = o;
  $('speed-bar-wrap').style.opacity = o;
}

function applySettingsUI(){
  const map = {
    'set-sound':   [S.soundOn,   v => { S.soundOn   = v; if(!v) sndDrive.pause(); else if(STATE==='playing') sndDrive.play().catch(()=>{}); }],
    'set-vibrate': [S.vibrateOn, v => { S.vibrateOn = v; }],
    'set-gyro':    [S.gyroOn,    v => { S.gyroOn    = v; gyroHint.hidden = !v; if(v) requestGyroPermission(); }],
    'set-swipe':   [S.swipeOn,   v => { S.swipeOn   = v; }],
    'set-boost':   [S.boostOn,   v => { S.boostOn   = v; $('btn-boost').style.display = v ? '' : 'none'; }],
    'set-horn':    [S.hornOn,    v => { S.hornOn    = v; $('btn-horn').style.display  = v ? '' : 'none'; }],
    'set-night':   [S.nightMode, v => { S.nightMode = v; document.body.classList.toggle('night-mode', v); }],
  };
  for (const [id, [val]] of Object.entries(map)){
    const btn = $(id);
    if (!btn) continue;
    btn.textContent = val ? 'ON' : 'OFF';
    btn.className = 'toggle-btn ' + (val ? 'on' : 'off');
    btn.onclick = () => {
      const cur = map[id][0];
      const next = !cur;
      map[id][0] = next;
      const key = id.replace('set-', '');
      const sKey = {sound:'soundOn', vibrate:'vibrateOn', gyro:'gyroOn', swipe:'swipeOn', boost:'boostOn', horn:'hornOn', night:'nightMode'}[key];
      if (sKey) S[sKey] = next;
      map[id][1](next);
      saveSett();
      applySettingsUI();
    };
  }
  $('set-sensitivity').value = S.sensitivity;
  $('sens-val').textContent = S.sensitivity;
  $('btn-boost').style.display = S.boostOn ? '' : 'none';
  $('btn-horn').style.display  = S.hornOn  ? '' : 'none';
  document.body.classList.toggle('night-mode', S.nightMode);
  gyroHint.hidden = !S.gyroOn;
}
$('set-sensitivity').addEventListener('input', e => {
  S.sensitivity = +e.target.value;
  $('sens-val').textContent = S.sensitivity;
  saveSett();
});

function startGame(){
  traffic = []; particles = []; pops = [];
  score = 0; level = 1; roadSpeed = BASE_SPD;
  carX = (GW - CAR_W) / 2; carVelX = 0; steerInput = 0; gyroSteer = 0;
  carYOffset = 0; carYOffsetTarget = 0;
  roadY = 0; lastTime = 0; spawnTimer = 0; deathTimer = 0;
  boostActive = false; boostTimer = 0; brakeActive = false; nearMissTimer = 0;
  scoreEl.textContent = '0'; levelEl.textContent = '1';
  speedBar.style.setProperty('--spd', '0%');
  speedLabel.textContent = '60';
  STATE = 'playing';
  showScreen(null);
  setHudVisible(true);
  if (S.soundOn){ sndDrive.currentTime = 0; sndDrive.play().catch(() => {}); }
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

function pauseGame(){
  if (STATE !== 'playing') return;
  STATE = 'paused';
  showScreen('pause');
  sndDrive.pause();
  if (raf){ cancelAnimationFrame(raf); raf = null; }
}
function resumeGame(){
  if (STATE !== 'paused') return;
  STATE = 'playing';
  showScreen(null);
  lastTime = 0;
  if (S.soundOn) sndDrive.play().catch(() => {});
  raf = requestAnimationFrame(loop);
}
function doGameOver(){
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
}
function goHome(){
  STATE = 'home';
  sndDrive.pause();
  if (raf){ cancelAnimationFrame(raf); raf = null; }
  traffic = []; particles = []; pops = [];
  setHudVisible(false);
  showScreen('home');
}

function spawnExplosion(x, y){
  for (let i = 0; i < 26; i++){
    const a = Math.random() * Math.PI * 2;
    const s = 1.5 + Math.random() * 5;
    particles.push({x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s - 2.5, life: 1, r: 2 + Math.random()*5, c: Math.random() < 0.5 ? '#ff3c3c' : '#ff8c00'});
  }
}
function showToast(el, dur = 1000){
  el.hidden = false;
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 250);
  }, dur);
}

function levelUp(){
  level++;
  roadSpeed += 0.55;
  levelEl.textContent = level;
  showToast(levelToast, 1000);
}

function spawnNPC(){
  const lane = Math.floor(Math.random() * LANE_X.length);
  if (traffic.some(t => t.lane === lane && t.y < SAFE_GAP)) return;
  const spd = roadSpeed - 0.6 + Math.random() * 1.95;
  traffic.push({ lane, x: LANE_X[lane] - NPC_W/2, y: -NPC_H, spd, imgIdx: Math.floor(Math.random() * npcImgs.length) });
  if (level >= 2 && Math.random() < 0.20){
    const lane2 = (lane + 1 + Math.floor(Math.random() * 2)) % LANE_X.length;
    if (!traffic.some(t => t.lane === lane2 && t.y < SAFE_GAP)){
      traffic.push({ lane: lane2, x: LANE_X[lane2] - NPC_W/2, y: -NPC_H - 30, spd: spd + Math.random() * 0.5, imgIdx: Math.floor(Math.random() * npcImgs.length) });
    }
  }
}

function hbox(x, y, w, h){ return {l: x+HITPAD, r: x+w-HITPAD, t: y+HITPAD, b: y+h-HITPAD}; }
function overlaps(a, b){ return !(a.b < b.t || a.t > b.b || a.r < b.l || a.l > b.r); }

function lerp(a, b, t){ return a + (b - a) * t; }

function draw(){
  const rh = roadImg.naturalHeight || 600;
  if (rh > 1){
    const off = ((roadY % rh) + rh) % rh;
    for (let y = off - rh; y < GH_BASE; y += rh){
      ctx.drawImage(roadImg, 0, y, GW, rh);
    }
  } else {
    ctx.fillStyle = '#1a1a1f';
    ctx.fillRect(0, 0, GW, GH_BASE);
  }

  traffic.forEach(t => ctx.drawImage(npcImgs[t.imgIdx], 0, 0, 120, 120, t.x, t.y, NPC_W, NPC_H));

  const carDrawY = GH_BASE - CAR_H - CAR_BASE_Y_OFFSET - carYOffset;

  if (boostActive){
    ctx.globalAlpha = 0.28 + Math.random() * 0.12;
    ctx.fillStyle = '#ff8c00';
    ctx.beginPath();
    ctx.ellipse(carX + CAR_W/2, carDrawY + CAR_H + 4, CAR_W/2 + 4, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    const trailLen = 3;
    for (let i = 1; i <= trailLen; i++){
      ctx.globalAlpha = (0.18 / i);
      ctx.drawImage(carImg, 0, 0, 120, 120, carX, carDrawY + i * 6, CAR_W, CAR_H);
    }
    ctx.globalAlpha = 1;
  }

  ctx.drawImage(carImg, 0, 0, 120, 120, carX, carDrawY, CAR_W, CAR_H);

  if (particles.length){
    particles.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.1, p.r * p.life), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  if (pops.length){
    ctx.font = "bold 13px 'Orbitron',monospace";
    ctx.textAlign = 'center';
    pops.forEach(p => {
      ctx.globalAlpha = p.a;
      ctx.fillStyle = p.c || '#ffffff';
      ctx.fillText(p.t || '+1', p.x, p.y);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}

function updateHUD(){
  const pct = Math.min(100, (roadSpeed - BASE_SPD) / (BASE_SPD * 1.5) * 100);
  speedBar.style.setProperty('--spd', pct + '%');
  speedLabel.textContent = Math.round(60 + pct * 1.4);
  if (S.soundOn) sndDrive.playbackRate = 0.9 + pct / 100 * 0.55;
}

function loop(ts){
  if (STATE !== 'playing' && STATE !== 'dying') return;
  const rawDt = lastTime ? (ts - lastTime) / 16.667 : 1;
  const dt = Math.min(rawDt, 2.5);
  lastTime = ts;

  if (STATE === 'playing'){
    roadY += roadSpeed * dt;

    let eff = steerInput !== 0 ? steerInput : (S.gyroOn ? gyroSteer : 0);

    if (boostActive){
      boostTimer -= dt * 16.667;
      if (boostTimer <= 0){ boostActive = false; }
    }

    const boostMult = boostActive ? 1.9 : 1;
    const brakeMult = brakeActive ? 0.0 : 1;

    if (boostActive){
      roadSpeed = Math.min(BASE_SPD * 2.6, roadSpeed + 0.18 * dt);
    } else if (brakeActive){
      roadSpeed = Math.max(BASE_SPD * 0.35, roadSpeed - 0.22 * dt);
    } else {
      roadSpeed = lerp(roadSpeed, BASE_SPD + (level - 1) * 0.55, 0.012 * dt);
    }

    if (boostActive){
      carYOffsetTarget = CAR_BOOST_Y_LIFT;
    } else if (brakeActive){
      carYOffsetTarget = BRAKE_Y_LIFT;
    } else {
      carYOffsetTarget = 0;
    }
    carYOffset = lerp(carYOffset, carYOffsetTarget, 0.12 * dt);

    carVelX += eff * steerAccel() * boostMult * brakeMult * dt;
    carVelX *= Math.pow(STEER_FRICTION, dt);
    carVelX = Math.max(-MAX_STEER_SPD, Math.min(MAX_STEER_SPD, carVelX));
    carX = Math.max(0, Math.min(GW - CAR_W, carX + carVelX * dt));

    const carDrawY = GH_BASE - CAR_H - CAR_BASE_Y_OFFSET - carYOffset;
    const chb = hbox(carX, carDrawY, CAR_W, CAR_H);

    for (let i = traffic.length - 1; i >= 0; i--){
      const t = traffic[i];
      t.y += (t.spd + 2) * dt;
      if (t.y > GH_BASE + NPC_H){
        traffic.splice(i, 1);
        score++;
        scoreEl.textContent = score;
        pops.push({x: t.x + NPC_W/2, y: GH_BASE - 50, a: 1, t: '+1', c: '#fff'});
        if (score % 12 === 0) levelUp();
        continue;
      }
      if (overlaps(chb, hbox(t.x, t.y, NPC_W, NPC_H))){
        spawnExplosion(carX + CAR_W/2, carDrawY + CAR_H/2);
        STATE = 'dying'; deathTimer = 520;
        sndDrive.pause();
        if (S.soundOn){ sndCrash.currentTime = 0; sndCrash.play().catch(() => {}); }
        gc.classList.add('shake');
        setTimeout(() => gc.classList.remove('shake'), 400);
        break;
      }
      const nb = hbox(t.x, t.y, NPC_W, NPC_H);
      const exp = {l: nb.l-14, r: nb.r+14, t: nb.t, b: nb.b};
      if (overlaps(chb, exp) && !overlaps(chb, nb) && nearMissTimer <= 0){
        nearMissTimer = 60;
        score++;
        scoreEl.textContent = score;
        pops.push({x: t.x + NPC_W/2, y: t.y, a: 1, t: 'CLOSE!', c: '#ffcc00'});
        if (S.vibrateOn && navigator.vibrate) navigator.vibrate(30);
      }
    }
    if (nearMissTimer > 0) nearMissTimer -= dt;

    spawnTimer += dt * 16.667;
    const spawnInterval = Math.max(500, SPAWN_MS - (level - 1) * 60);
    if (spawnTimer >= spawnInterval){ spawnNPC(); spawnTimer = 0; }
    updateHUD();

  } else {
    deathTimer -= dt * 16.667;
    if (deathTimer <= 0){ doGameOver(); return; }
  }

  for (let i = particles.length - 1; i >= 0; i--){
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 0.15 * dt; p.life -= 0.035 * dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = pops.length - 1; i >= 0; i--){
    pops[i].y -= 1.5 * dt; pops[i].a -= 0.045 * dt;
    if (pops[i].a <= 0) pops.splice(i, 1);
  }

  draw();
  raf = requestAnimationFrame(loop);
}

$('play-btn').addEventListener('click', startGame);
$('pause-btn').addEventListener('click', pauseGame);
$('resume-btn').addEventListener('click', resumeGame);
$('retry-btn').addEventListener('click', startGame);
$('home-from-pause').addEventListener('click', goHome);
$('home-from-go').addEventListener('click', goHome);

function openSettings(prev){
  applySettingsUI();
  screenSettings.dataset.prev = prev || 'home';
  showScreen('settings');
}
$('settings-open-btn').addEventListener('click', () => openSettings('home'));
$('settings-pause-btn').addEventListener('click', () => { pauseGame(); openSettings('pause'); });
$('settings-close-btn').addEventListener('click', () => {
  const prev = screenSettings.dataset.prev || 'home';
  if (prev === 'pause') showScreen('pause');
  else goHome();
});

$('btn-left').addEventListener('pointerdown',  e => { e.preventDefault(); steerInput = -1; });
$('btn-right').addEventListener('pointerdown', e => { e.preventDefault(); steerInput =  1; });
$('btn-left').addEventListener('pointerup',    e => { e.preventDefault(); steerInput = 0; carVelX *= 0.3; });
$('btn-right').addEventListener('pointerup',   e => { e.preventDefault(); steerInput = 0; carVelX *= 0.3; });
$('btn-left').addEventListener('pointerleave', e => { if (e.buttons > 0){ steerInput = 0; carVelX *= 0.3; }});
$('btn-right').addEventListener('pointerleave',e => { if (e.buttons > 0){ steerInput = 0; carVelX *= 0.3; }});
document.addEventListener('pointerup',     () => { steerInput = 0; brakeActive = false; });
document.addEventListener('pointercancel', () => { steerInput = 0; carVelX = 0; brakeActive = false; });

$('btn-boost').addEventListener('pointerdown', e => {
  e.preventDefault();
  if (STATE !== 'playing') return;
  boostActive = true; boostTimer = 1400;
  showToast(boostToast, 400);
  if (S.vibrateOn && navigator.vibrate) navigator.vibrate(40);
});
$('btn-boost').addEventListener('pointerup', e => { e.preventDefault(); });

const brakeBtn = $('btn-brake');
if (brakeBtn){
  brakeBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (STATE !== 'playing') return;
    brakeActive = true;
  });
  brakeBtn.addEventListener('pointerup',    e => { e.preventDefault(); brakeActive = false; });
  brakeBtn.addEventListener('pointerleave', e => { if (e.buttons > 0) brakeActive = false; });
}

$('btn-horn').addEventListener('pointerdown', e => {
  e.preventDefault();
  if (STATE !== 'playing') return;
  showToast(hornToast, 400);
  if (S.soundOn){
    try {
      const ctx2 = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx2.createOscillator();
      const gain = ctx2.createGain();
      osc.connect(gain); gain.connect(ctx2.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, ctx2.currentTime);
      osc.frequency.linearRampToValueAtTime(280, ctx2.currentTime + 0.15);
      gain.gain.setValueAtTime(0.22, ctx2.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx2.currentTime + 0.25);
      osc.start(ctx2.currentTime);
      osc.stop(ctx2.currentTime + 0.28);
    } catch(e2){}
  }
  if (S.vibrateOn && navigator.vibrate) navigator.vibrate(20);
});

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft')  steerInput = -1;
  else if (e.key === 'ArrowRight') steerInput = 1;
  else if (e.key === 'ArrowDown') brakeActive = true;
  else if (e.key === 'ArrowUp'){ boostActive = true; boostTimer = 1400; }
  else if (e.key === ' ') STATE === 'playing' ? pauseGame() : STATE === 'paused' ? resumeGame() : null;
  else if (e.key === 'b' || e.key === 'B'){ boostActive = true; boostTimer = 1400; }
});
document.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight'){ steerInput = 0; carVelX *= 0.3; }
  if (e.key === 'ArrowDown') brakeActive = false;
});

let swipeX = null, swipeStartX = null;
gc.addEventListener('touchstart', e => {
  if (S.swipeOn){ swipeX = e.touches[0].clientX; swipeStartX = swipeX; }
}, {passive: true});
gc.addEventListener('touchmove', e => {
  if (!S.swipeOn || swipeX === null) return;
  const dx = e.touches[0].clientX - swipeX;
  const totalDx = e.touches[0].clientX - swipeStartX;
  if (Math.abs(totalDx) > 6){
    steerInput = dx > 0 ? 1 : -1;
    const strength = Math.min(Math.abs(dx) / 18, 1);
    carVelX += (dx > 0 ? 1 : -1) * strength * steerAccel() * 0.6;
  }
  swipeX = e.touches[0].clientX;
}, {passive: true});
gc.addEventListener('touchend', () => { steerInput = 0; swipeX = null; carVelX *= 0.5; }, {passive: true});

function requestGyroPermission(){
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'){
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }
}
window.addEventListener('deviceorientation', e => {
  if (!S.gyroOn || STATE !== 'playing' || e.gamma === null) return;
  const dead = 5 - S.sensitivity * 0.3;
  const g = e.gamma;
  gyroSteer = Math.abs(g) < dead ? 0 : Math.max(-1, Math.min(1, (g - Math.sign(g) * dead) / 18));
});

document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());

applySettingsUI();
showScreen('home');
setHudVisible(false);

if ('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
