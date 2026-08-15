/* ======================================================================
   SMARTAGRO — SMART CROP ADVISORY SYSTEM
   Split build: index.html + style.css + script.js
   Cloud persistence: Google Sheets via a Google Apps Script Web App
   (Apps Script runs JavaScript on Google's servers — GitHub Pages itself
   only serves static files, so this is the backend that stands in for
   a real server / database.)
   Weather uses the live Open-Meteo public API (no key required).
   ====================================================================== */

/* ---------------- CONFIG ----------------
   1. Deploy the included Code.gs as a Google Apps Script Web App
      (see README.md for step-by-step instructions).
   2. Paste the deployment URL below (it ends in /exec).
------------------------------------------------------------------- */
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbw2wXsSejA0j8FwIC1buS0GMgAV6cBmEB9kkg2zIjtdS3hpdQkFN-ucOyFrlLi6-zmS/exec'
};

/* ---------------- Cloud helpers ---------------- */
function apiConfigured(){
  return CONFIG.API_URL && CONFIG.API_URL.startsWith('http');
}
async function cloudGet(action, params){
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);
  Object.entries(params||{}).forEach(([k,v])=>url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if(!res.ok) throw new Error('Network error (' + res.status + ')');
  return res.json();
}
async function cloudPost(action, payload){
  // text/plain avoids a CORS preflight request, which Apps Script Web Apps don't handle
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action: action }, payload || {}))
  });
  if(!res.ok) throw new Error('Network error (' + res.status + ')');
  return res.json();
}

/* ---------------- Local in-memory cache ----------------
   USERS_CACHE is loaded once at startup. LAND_CACHE / HIST_CACHE are
   loaded for the current user right after login/register, so the rest
   of the app can stay synchronous, same as the original build.
   Session (who's currently logged in on this device) still lives in
   localStorage — only farmer records live in the Sheet.
------------------------------------------------------------------- */
let USERS_CACHE = [];
let LAND_CACHE = null;
let HIST_CACHE = [];

const DB = {
  users: () => USERS_CACHE,
  land: () => LAND_CACHE,
  saveLand: async (uidVal, data) => {
    LAND_CACHE = data;
    try{ await cloudPost('saveLand', { uid: uidVal, land: data }); }
    catch(e){ toast('Saved locally, but could not sync to Google Sheets: ' + e.message, true); }
  },
  history: () => HIST_CACHE,
  addHistoryRecord: async (uidVal, record) => {
    HIST_CACHE.unshift(record);
    try{ await cloudPost('addHistory', { uid: uidVal, record: record }); }
    catch(e){ toast('Saved locally, but could not sync to Google Sheets: ' + e.message, true); }
  },
  session: () => localStorage.getItem('as_session'),
  setSession: (uidVal) => localStorage.setItem('as_session', uidVal),
  clearSession: () => localStorage.removeItem('as_session'),
};
const uid = () => 'F' + Math.random().toString(36).slice(2, 9).toUpperCase();
const todayStr = () => new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

let CUR = null;       // current farmer object
let LANG = 'en';
let ADMIN_MODE = false;
let currentView = 'dashboard';

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg, isError){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}

/* ---------------- i18n ---------------- */
const NAV_ITEMS = [
  {key:'dashboard', icon:'🏠', en:'Dashboard', ta:'முகப்பு'},
  {key:'land', icon:'🌱', en:'Land & Soil Details', ta:'நில விவரம்'},
  {key:'crop', icon:'🌾', en:'Crop Recommendation', ta:'பயிர் பரிந்துரை'},
  {key:'fertilizer', icon:'🧪', en:'Fertilizer Guide', ta:'உரப் பரிந்துரை'},
  {key:'weather', icon:'⛅', en:'Weather', ta:'வானிலை'},
  {key:'pest', icon:'🐛', en:'Pest & Disease Advisory', ta:'பூச்சி எச்சரிக்கை'},
  {key:'yield', icon:'📈', en:'Yield Prediction', ta:'விளைச்சல் மதிப்பீடு'},
  {key:'market', icon:'💰', en:'Market Prices', ta:'சந்தை விலை'},
  {key:'reports', icon:'📄', en:'Reports & History', ta:'அறிக்கைகள்'},
];
const T = {
  en:{welcome:'Welcome back', subDash:'Here is how your farm advisory looks today.'},
  ta:{welcome:'மீண்டும் வரவேற்கிறோம்', subDash:'இன்றைய உங்கள் பண்ணை ஆலோசனை.'}
};

/* ---------------- Soil / Crop Knowledge Base ---------------- */
const SOILS = ['Alluvial','Black (Regur)','Red','Laterite','Sandy','Clay','Loamy'];
const SEASONS = ['Kharif (Jun–Oct)','Rabi (Oct–Mar)','Zaid (Mar–Jun)'];
const WATERLEVELS = ['Low','Medium','High'];

const CROPS = [
 {name:'Rice (Paddy)', ta:'நெல்', soils:['Alluvial','Clay','Loamy'], seasons:['Kharif (Jun–Oct)'], rain:[100,300], temp:[20,35], water:['High'],
  baseYield:2.4, fert:{N:120,P:60,K:40,organic:5}, split:'Apply N in 3 splits (basal, tillering, panicle initiation); P & K as basal dose.',
  pests:[{n:'Stem Borer',s:'Dead heart in young plants, white ear-heads later',c:'Use pheromone traps; apply neem-based biopesticide at early infestation; avoid excess nitrogen.'},
         {n:'Blast Disease',s:'Spindle-shaped grey lesions on leaves',c:'Use resistant varieties; avoid dense sowing; apply tricyclazole if severe.'}]},
 {name:'Wheat', ta:'கோதுமை', soils:['Alluvial','Loamy','Black (Regur)'], seasons:['Rabi (Oct–Mar)'], rain:[40,100], temp:[10,25], water:['Medium'],
  baseYield:2.0, fert:{N:100,P:50,K:30,organic:4}, split:'Half N + full P & K as basal; remaining N at first irrigation (21 days).',
  pests:[{n:'Aphids',s:'Curling leaves, sticky honeydew, sooty mould',c:'Encourage ladybird beetles; spray neem oil; avoid late sowing.'},
         {n:'Rust (Yellow/Brown)',s:'Powdery orange-yellow pustules on leaves',c:'Grow resistant varieties; timely sowing; fungicide spray if detected early.'}]},
 {name:'Maize', ta:'மக்காச்சோளம்', soils:['Loamy','Red','Alluvial'], seasons:['Kharif (Jun–Oct)','Rabi (Oct–Mar)'], rain:[50,100], temp:[18,32], water:['Medium'],
  baseYield:2.8, fert:{N:120,P:60,K:40,organic:5}, split:'N in 3 splits: basal, knee-high stage, tasseling.',
  pests:[{n:'Fall Armyworm',s:'Ragged holes in whorl, sawdust-like frass',c:'Scout early, handpick egg masses, use Bt-based spray, avoid monocropping.'},
         {n:'Stalk Rot',s:'Wilting, soft rotten stalk base',c:'Avoid waterlogging; balanced potash application; crop rotation.'}]},
 {name:'Sugarcane', ta:'கரும்பு', soils:['Alluvial','Loamy','Clay'], seasons:['Kharif (Jun–Oct)'], rain:[100,200], temp:[21,32], water:['High'],
  baseYield:35, fert:{N:250,P:80,K:100,organic:10}, split:'N in 3–4 splits over the season; full P as basal; K in two splits.',
  pests:[{n:'Early Shoot Borer',s:'Dead heart, central shoot dries up',c:'Remove and destroy affected shoots; release Trichogramma; avoid drought stress.'},
         {n:'Red Rot',s:'Reddening of internal stem tissue, alcoholic smell',c:'Use disease-free setts; resistant varieties; avoid waterlogging.'}]},
 {name:'Cotton', ta:'பருத்தி', soils:['Black (Regur)','Alluvial'], seasons:['Kharif (Jun–Oct)'], rain:[50,100], temp:[21,35], water:['Medium'],
  baseYield:0.5, fert:{N:100,P:50,K:50,organic:5}, split:'N in 3 splits at sowing, squaring, flowering; P & K as basal.',
  pests:[{n:'Pink Bollworm',s:'Rosette flowers, holes in bolls',c:'Use pheromone traps; timely destruction of crop residue; avoid late sowing.'},
         {n:'Whitefly',s:'Yellowing leaves, sooty mould, viral transmission',c:'Yellow sticky traps; neem oil spray; avoid excess nitrogen.'}]},
 {name:'Groundnut', ta:'நிலக்கடலை', soils:['Sandy','Red','Loamy'], seasons:['Kharif (Jun–Oct)','Zaid (Mar–Jun)'], rain:[50,100], temp:[20,30], water:['Low'],
  baseYield:1.2, fert:{N:20,P:40,K:40,organic:4}, split:'Low nitrogen (legume); full dose as basal, gypsum at flowering.',
  pests:[{n:'Leaf Miner',s:'Serpentine mines/blotches on leaves',c:'Remove and destroy affected leaves; neem-based spray; balanced fertilization.'},
         {n:'Tikka Leaf Spot',s:'Dark circular spots with yellow halo',c:'Use resistant varieties; avoid overcrowding; fungicide spray if severe.'}]},
 {name:'Finger Millet (Ragi)', ta:'கேழ்வரகு', soils:['Red','Laterite','Sandy'], seasons:['Kharif (Jun–Oct)'], rain:[40,90], temp:[20,30], water:['Low'],
  baseYield:1.5, fert:{N:45,P:30,K:30,organic:3}, split:'Half N + full P & K basal; remaining N at 3 weeks.',
  pests:[{n:'Blast Disease',s:'Grey spindle lesions on leaves and neck',c:'Resistant varieties; avoid excess nitrogen; balanced spacing.'}]},
 {name:'Pearl Millet (Bajra)', ta:'கம்பு', soils:['Sandy','Red','Laterite'], seasons:['Kharif (Jun–Oct)'], rain:[30,75], temp:[25,35], water:['Low'],
  baseYield:1.3, fert:{N:40,P:20,K:20,organic:3}, split:'Half N basal, remaining at 25–30 days.',
  pests:[{n:'Downy Mildew (Green Ear)',s:'Green leafy structures instead of grain',c:'Use resistant hybrids; remove infected plants early; seed treatment.'}]},
 {name:'Chickpea (Gram)', ta:'கொண்டைக்கடலை', soils:['Black (Regur)','Loamy','Alluvial'], seasons:['Rabi (Oct–Mar)'], rain:[40,80], temp:[15,28], water:['Low'],
  baseYield:1.0, fert:{N:20,P:40,K:20,organic:3}, split:'Entire dose as basal at sowing (legume, low N need).',
  pests:[{n:'Pod Borer',s:'Circular holes in pods, feeding on seeds',c:'Pheromone traps; neem spray at flowering; timely handpicking.'}]},
 {name:'Green Gram (Moong)', ta:'பாசிப்பயறு', soils:['Loamy','Black (Regur)','Sandy'], seasons:['Zaid (Mar–Jun)','Kharif (Jun–Oct)'], rain:[40,90], temp:[25,35], water:['Low'],
  baseYield:0.7, fert:{N:20,P:40,K:20,organic:2}, split:'Entire dose as basal (legume crop).',
  pests:[{n:'Yellow Mosaic Virus',s:'Yellow-green mosaic pattern on leaves',c:'Control whitefly vector; remove infected plants; resistant varieties.'}]},
 {name:'Tomato', ta:'தக்காளி', soils:['Loamy','Red','Alluvial'], seasons:['Zaid (Mar–Jun)','Rabi (Oct–Mar)'], rain:[40,90], temp:[18,29], water:['Medium'],
  baseYield:20, fert:{N:120,P:80,K:60,organic:8}, split:'N in 3 splits (basal, flowering, fruiting); P & K basal + one topdress.',
  pests:[{n:'Fruit Borer',s:'Round holes in fruit, larvae feeding inside',c:'Pheromone traps; neem oil spray; remove damaged fruit.'},
         {n:'Early Blight',s:'Concentric dark rings (target spot) on leaves',c:'Crop rotation; avoid overhead irrigation; copper-based fungicide.'}]},
 {name:'Onion', ta:'வெங்காயம்', soils:['Loamy','Red','Alluvial'], seasons:['Rabi (Oct–Mar)'], rain:[40,80], temp:[13,28], water:['Medium'],
  baseYield:15, fert:{N:100,P:50,K:50,organic:6}, split:'Half N + full P & K basal; remaining N in 2 splits.',
  pests:[{n:'Thrips',s:'Silvery streaks on leaves, curling and twisting',c:'Blue sticky traps; neem oil spray; avoid water stress.'}]},
];

/* ---------------- Static reference market prices (₹ / quintal, indicative) ---------------- */
const MARKET = [
 {crop:'Rice (Paddy)',min:1980,max:2300,mkt:'Salem / Erode'},
 {crop:'Wheat',min:2100,max:2450,mkt:'National avg.'},
 {crop:'Maize',min:1850,max:2150,mkt:'Namakkal'},
 {crop:'Sugarcane',min:315,max:360,mkt:'per tonne, TN mills'},
 {crop:'Cotton',min:6200,max:7100,mkt:'Perundurai'},
 {crop:'Groundnut',min:5800,max:6600,mkt:'Salem'},
 {crop:'Finger Millet (Ragi)',min:3200,max:3700,mkt:'Dharmapuri'},
 {crop:'Pearl Millet (Bajra)',min:2200,max:2500,mkt:'National avg.'},
 {crop:'Chickpea (Gram)',min:5200,max:5800,mkt:'National avg.'},
 {crop:'Green Gram (Moong)',min:7800,max:8600,mkt:'National avg.'},
 {crop:'Tomato',min:800,max:2200,mkt:'Salem (volatile)'},
 {crop:'Onion',min:900,max:2000,mkt:'Salem (volatile)'},
];

/* ======================================================================
   AUTH
   ====================================================================== */
function switchAuthTab(tab){
  document.getElementById('tabLogin').classList.toggle('active', tab==='login');
  document.getElementById('tabRegister').classList.toggle('active', tab==='register');
  document.getElementById('loginPane').classList.toggle('hidden', tab!=='login');
  document.getElementById('registerPane').classList.toggle('hidden', tab!=='register');
  document.getElementById('adminPane').classList.add('hidden');
}
function openAdminLogin(){
  document.getElementById('loginPane').classList.add('hidden');
  document.getElementById('registerPane').classList.add('hidden');
  document.getElementById('adminPane').classList.remove('hidden');
  document.getElementById('tabLogin').classList.remove('active');
  document.getElementById('tabRegister').classList.remove('active');
}
async function doRegister(){
  const name=val('regName'), email=val('regEmail'), phone=val('regPhone'), loc=val('regLoc'), pw=val('regPw'), lang=document.getElementById('regLang').value;
  const err=document.getElementById('regErr'); err.textContent='';
  if(!name||!(email||phone)||!pw){ err.textContent='Please fill name, email/phone, and password.'; return; }
  if(pw.length<4){ err.textContent='Password must be at least 4 characters.'; return; }
  if(!apiConfigured()){ err.textContent='Cloud storage is not configured yet (see README.md).'; return; }
  const users=DB.users();
  if(users.some(u=>(email && u.email===email)||(phone && u.phone===phone))){ err.textContent='An account with this email/phone already exists.'; return; }
  const user={id:uid(), name, email, phone, loc:loc||'Tamil Nadu, India', pw, lang, created:new Date().toISOString()};
  const btn=document.getElementById('regBtn'); btn.disabled=true; btn.textContent='Creating account…';
  try{
    const resp = await cloudPost('register', { user });
    if(!resp.ok){ err.textContent = resp.error || 'Could not create account.'; return; }
    USERS_CACHE.push(user);
    DB.setSession(user.id);
    await afterAuthSuccess(user);
  }catch(e){
    err.textContent = 'Could not reach Google Sheets: ' + e.message;
  }finally{
    btn.disabled=false; btn.textContent='Create account';
  }
}
async function doLogin(){
  const id=val('loginId'), pw=val('loginPw');
  const err=document.getElementById('loginErr'); err.textContent='';
  if(!apiConfigured()){ err.textContent='Cloud storage is not configured yet (see README.md).'; return; }
  const users=DB.users();
  const user=users.find(u=>(u.email===id||u.phone===id) && u.pw===pw);
  if(!user){ err.textContent='No matching account, or incorrect password.'; return; }
  const btn=document.getElementById('loginBtn'); btn.disabled=true; btn.textContent='Logging in…';
  try{
    DB.setSession(user.id);
    await afterAuthSuccess(user);
  }finally{
    btn.disabled=false; btn.textContent='Log in';
  }
}
async function afterAuthSuccess(user){
  CUR = user;
  try{
    const [landResp, histResp] = await Promise.all([
      cloudGet('getLand', { uid: user.id }),
      cloudGet('getHistory', { uid: user.id })
    ]);
    LAND_CACHE = landResp.land || null;
    HIST_CACHE = histResp.history || [];
  }catch(e){
    LAND_CACHE = null; HIST_CACHE = [];
    toast('Signed in, but could not load your saved data from Google Sheets: ' + e.message, true);
  }
  boot();
}
function doAdminLogin(){
  const u=val('adminUser'), p=val('adminPw');
  const err=document.getElementById('adminErr'); err.textContent='';
  if(u==='admin' && p==='admin123'){ ADMIN_MODE=true; sessionStorage.setItem('as_admin','1'); boot(); }
  else err.textContent='Incorrect admin credentials.';
}
function logout(){
  DB.clearSession(); ADMIN_MODE=false; sessionStorage.removeItem('as_admin');
  CUR=null; LAND_CACHE=null; HIST_CACHE=[];
  document.getElementById('appShell').classList.remove('show');
  document.getElementById('authScreen').style.display='flex';
  switchAuthTab('login');
}
function val(id){ return document.getElementById(id).value.trim(); }

/* ======================================================================
   BOOT / NAV
   ====================================================================== */
async function initApp(){
  const statusEl = document.getElementById('cloudStatus');
  if(!apiConfigured()){
    statusEl.textContent = '⚠️ Cloud storage not connected — set API_URL at the top of script.js (see README.md).';
    disableAuthButtons(true);
    return;
  }
  try{
    const resp = await cloudGet('getUsers');
    USERS_CACHE = resp.users || [];
    statusEl.textContent = '';
    disableAuthButtons(false);
    boot();
  }catch(e){
    statusEl.textContent = '⚠️ Could not reach Google Sheets: ' + e.message + ' — check the deployment URL and try again.';
    disableAuthButtons(true);
  }
}
function disableAuthButtons(state){
  ['loginBtn','regBtn'].forEach(id=>{
    const b=document.getElementById(id); if(b) b.disabled = state;
  });
}
function boot(){
  if(sessionStorage.getItem('as_admin')==='1'){ ADMIN_MODE=true; }
  if(ADMIN_MODE){
    document.getElementById('authScreen').style.display='none';
    document.getElementById('appShell').classList.add('show');
    document.getElementById('sideUserName').textContent='Administrator';
    buildNav(true);
    navigate('admin');
    return;
  }
  const sid = DB.session();
  if(!sid){ return; }
  if(!CUR || CUR.id!==sid){
    CUR = USERS_CACHE.find(u=>u.id===sid);
    if(!CUR){ DB.clearSession(); return; }
  }
  LANG = CUR.lang || 'en';
  document.getElementById('authScreen').style.display='none';
  document.getElementById('appShell').classList.add('show');
  document.getElementById('sideUserName').textContent=CUR.name;
  setLang(LANG, true);
  buildNav(false);
  navigate('dashboard');
}
function buildNav(isAdmin){
  const nav=document.getElementById('navList'); nav.innerHTML='';
  const items = isAdmin ? [{key:'admin',icon:'🛠️',en:'Admin Panel',ta:'நிர்வாகம்'}] : NAV_ITEMS;
  items.forEach(it=>{
    const li=document.createElement('li');
    li.innerHTML = `<button id="nav_${it.key}" onclick="navigate('${it.key}')"><span class="navicon">${it.icon}</span> <span data-navlabel="${it.key}">${LANG==='ta'?it.ta:it.en}</span></button>`;
    nav.appendChild(li);
  });
}
function navigate(key){
  currentView = key;
  document.querySelectorAll('.navlist button').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('nav_'+key); if(btn) btn.classList.add('active');
  const titles = {
    dashboard:['Dashboard','Overview of your farm advisory'],
    land:['Land & Soil Details','Tell us about your field'],
    crop:['Crop Recommendation','Ranked by suitability to your land'],
    fertilizer:['Fertilizer Guide','Dosage & schedule for your chosen crop'],
    weather:['Weather','Live conditions for your location'],
    pest:['Pest & Disease Advisory','Watch-outs for your chosen crop'],
    yield:['Yield Prediction','Estimated output for your field'],
    market:['Market Prices','Indicative mandi price ranges'],
    reports:['Reports & History','Past recommendations for this account'],
    admin:['Admin Panel','All registered farmers & records'],
  };
  document.getElementById('viewTitle').textContent = titles[key][0];
  document.getElementById('viewSub').textContent = titles[key][1];
  const root=document.getElementById('viewRoot');
  root.innerHTML='';
  const renderers = {dashboard:renderDashboard, land:renderLand, crop:renderCrop, fertilizer:renderFertilizer,
    weather:renderWeather, pest:renderPest, yield:renderYield, market:renderMarket, reports:renderReports, admin:renderAdmin};
  renderers[key](root);
  refreshNotifications();
}
function setLang(l, silent){
  LANG=l;
  document.getElementById('langEnBtn').classList.toggle('active', l==='en');
  document.getElementById('langTaBtn').classList.toggle('active', l==='ta');
  document.querySelectorAll('.navlist button span[data-navlabel]').forEach(s=>{
    const it = NAV_ITEMS.find(i=>i.key===s.dataset.navlabel) || {key:'admin',en:'Admin Panel',ta:'நிர்வாகம்'};
    s.textContent = l==='ta'? it.ta : it.en;
  });
  if(!silent) navigate(currentView);
}

/* ======================================================================
   DASHBOARD
   ====================================================================== */
function renderDashboard(root){
  const land = DB.land();
  const hist = DB.history();
  root.innerHTML = `
    <div class="grid grid-3">
      <div class="card stat-card"><span>Farmer</span><b style="font-size:18px">${CUR.name}</b><span>${CUR.loc}</span></div>
      <div class="card stat-card"><span>Land on file</span><b>${land? land.area+' acre' : '—'}</b><span>${land? land.soil : 'Add land details to begin'}</span></div>
      <div class="card stat-card"><span>Saved recommendations</span><b>${hist.length}</b><span>view under Reports & History</span></div>
    </div>
    <div class="section-title"><h3 style="margin:0;">Quick actions</h3><div class="line"></div></div>
    <div class="grid grid-3">
      <div class="card"><h3>1 · Land &amp; Soil</h3><p style="font-size:13px;color:var(--ink-soft)">Enter soil type, season, rainfall & water availability.</p><button class="btn-sm" onclick="navigate('land')">Open</button></div>
      <div class="card"><h3>2 · Crop Recommendation</h3><p style="font-size:13px;color:var(--ink-soft)">Get a ranked shortlist of suitable crops.</p><button class="btn-sm" onclick="navigate('crop')">Open</button></div>
      <div class="card"><h3>3 · Yield &amp; Reports</h3><p style="font-size:13px;color:var(--ink-soft)">Estimate output and export a PDF report.</p><button class="btn-sm" onclick="navigate('yield')">Open</button></div>
    </div>
    ${!land? `<div class="card" style="margin-top:18px;border-color:var(--wheat);"><b>Get started:</b> add your land & soil details first — every other module (crop choice, fertilizer, yield) uses this information.</div>`:''}
  `;
}

/* ======================================================================
   LAND & SOIL
   ====================================================================== */
function renderLand(root){
  const land = DB.land() || {soil:SOILS[0], season:SEASONS[0], rainfall:75, temp:27, water:'Medium', area:1};
  root.innerHTML = `
    <div class="card" style="max-width:640px;">
      <h3>Field details</h3>
      <div class="form-row">
        <div class="field"><label>Soil type</label>
          <select id="lSoil">${SOILS.map(s=>`<option ${s===land.soil?'selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Cropping season</label>
          <select id="lSeason">${SEASONS.map(s=>`<option ${s===land.season?'selected':''}>${s}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="field"><label>Average annual rainfall (cm)</label><input type="number" id="lRain" value="${land.rainfall}"></div>
        <div class="field"><label>Average temperature (°C)</label><input type="number" id="lTemp" value="${land.temp}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Water availability</label>
          <select id="lWater">${WATERLEVELS.map(w=>`<option ${w===land.water?'selected':''}>${w}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Land area (acres)</label><input type="number" step="0.1" id="lArea" value="${land.area}"></div>
      </div>
      <button class="btn-primary" onclick="saveLandForm()">Save land & soil details</button>
      <div class="small-note" id="lSaved"></div>
    </div>
  `;
}
async function saveLandForm(){
  const data = {
    soil: document.getElementById('lSoil').value,
    season: document.getElementById('lSeason').value,
    rainfall: parseFloat(document.getElementById('lRain').value)||0,
    temp: parseFloat(document.getElementById('lTemp').value)||0,
    water: document.getElementById('lWater').value,
    area: parseFloat(document.getElementById('lArea').value)||1,
  };
  document.getElementById('lSaved').textContent = 'Saving…';
  await DB.saveLand(CUR.id, data);
  document.getElementById('lSaved').textContent = 'Saved ✓ — head to Crop Recommendation next.';
}

/* ======================================================================
   CROP RECOMMENDATION ENGINE
   ====================================================================== */
function scoreCrop(crop, land){
  let score=0, reasons=[];
  if(crop.soils.includes(land.soil)){ score+=30; reasons.push(`Well suited to ${land.soil} soil`); }
  else { score+=8; reasons.push(`Not ideal for ${land.soil} soil`); }
  if(crop.seasons.includes(land.season)){ score+=25; reasons.push(`Matches ${land.season.split(' ')[0]} season`); }
  else { reasons.push(`Off-season for this crop`); }
  const [rlo,rhi]=crop.rain;
  if(land.rainfall>=rlo && land.rainfall<=rhi){ score+=20; reasons.push(`Rainfall (${land.rainfall}cm) within ideal range`); }
  else { const d=Math.min(Math.abs(land.rainfall-rlo),Math.abs(land.rainfall-rhi)); score += Math.max(0,20-d/2); reasons.push(`Rainfall slightly outside ideal ${rlo}-${rhi}cm range`); }
  const [tlo,thi]=crop.temp;
  if(land.temp>=tlo && land.temp<=thi){ score+=15; reasons.push(`Temperature (${land.temp}°C) suits this crop`); }
  else { const d=Math.min(Math.abs(land.temp-tlo),Math.abs(land.temp-thi)); score += Math.max(0,15-d); }
  if(crop.water.includes(land.water)){ score+=10; reasons.push(`${land.water} water availability is adequate`); }
  else reasons.push(`Water availability (${land.water}) is a mismatch`);
  return {crop, score:Math.max(0,Math.min(100,Math.round(score))), reasons};
}
function renderCrop(root){
  const land = DB.land();
  if(!land){ root.innerHTML = emptyState('🌱','Add land & soil details first', 'land'); return; }
  const results = CROPS.map(c=>scoreCrop(c,land)).sort((a,b)=>b.score-a.score).slice(0,6);
  root.innerHTML = `
    <div class="card small-note" style="margin-bottom:16px;">Scoring uses a transparent weighted rule engine (soil 30%, season 25%, rainfall 20%, temperature 15%, water 10%) — not a black-box model, so you can see exactly why each crop is ranked.</div>
    ${results.map((r,i)=>`
      <div class="crop-card">
        <span class="rank">#${i+1}</span>
        <h4>${r.crop.name} <span style="font-size:12px;color:var(--ink-soft);font-weight:400;">(${r.crop.ta})</span></h4>
        <div class="score-bar"><div class="score-fill" style="width:${r.score}%"></div></div>
        <div class="mono" style="font-size:11.5px;color:var(--ink-soft);">Suitability score: ${r.score}/100</div>
        <ul class="reasons">${r.reasons.slice(0,3).map(x=>`<li>${x}</li>`).join('')}</ul>
        <button class="btn-sm outline" onclick="selectCrop('${r.crop.name.replace(/'/g,"\\'")}')">Use this crop →</button>
      </div>
    `).join('')}
  `;
}
async function selectCrop(name){
  localStorage.setItem('as_selected_'+CUR.id, name);
  const land = DB.land();
  const rec = {date:new Date().toISOString(), crop:name, soil:land.soil, season:land.season, note:'Selected from Crop Recommendation'};
  await DB.addHistoryRecord(CUR.id, rec);
  navigate('fertilizer');
}
function getSelectedCrop(){
  const name = localStorage.getItem('as_selected_'+CUR.id);
  return CROPS.find(c=>c.name===name) || null;
}

/* ======================================================================
   FERTILIZER
   ====================================================================== */
function renderFertilizer(root){
  const crop = getSelectedCrop();
  const land = DB.land();
  if(!crop){ root.innerHTML = emptyState('🧪','Pick a crop from Crop Recommendation first', 'crop'); return; }
  const soilNote = land && (land.soil==='Sandy') ? 'Sandy soil: split doses into smaller, more frequent applications to reduce nutrient leaching.'
    : land && (land.soil==='Clay') ? 'Clay soil: fewer, well-timed applications are sufficient; avoid waterlogging after top-dressing.'
    : 'Standard split schedule applies for this soil type.';
  root.innerHTML = `
    <div class="card" style="max-width:680px;">
      <h3>${crop.name} — recommended dose per acre</h3>
      <div class="grid grid-3" style="margin:14px 0;">
        <div class="card stat-card"><span>Nitrogen (N)</span><b>${crop.fert.N} kg</b></div>
        <div class="card stat-card"><span>Phosphorus (P)</span><b>${crop.fert.P} kg</b></div>
        <div class="card stat-card"><span>Potassium (K)</span><b>${crop.fert.K} kg</b></div>
      </div>
      <p><b>Farmyard manure / compost:</b> ${crop.fert.organic} tonnes/acre, worked into soil before sowing.</p>
      <p><b>Application schedule:</b> ${crop.split}</p>
      <div class="tag ok">${soilNote}</div>
    </div>
  `;
}

/* ======================================================================
   WEATHER (live via Open-Meteo — free, no API key)
   ====================================================================== */
function renderWeather(root){
  const loc = CUR.loc || 'Salem, Tamil Nadu';
  root.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="field" style="max-width:340px;margin-bottom:0;"><label>Location</label>
        <div style="display:flex;gap:8px;"><input id="wLoc" value="${loc}"><button class="btn-sm" onclick="fetchWeather()">Get forecast</button></div>
      </div>
    </div>
    <div id="weatherResult"><div class="empty"><div class="big">⛅</div>Enter a location and fetch live weather.</div></div>
  `;
  fetchWeather();
}
async function fetchWeather(){
  const loc = document.getElementById('wLoc').value.trim() || 'Salem';
  const box = document.getElementById('weatherResult');
  box.innerHTML = `<div class="empty">Fetching live conditions for ${loc}…</div>`;
  try{
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc.split(',')[0])}&count=1`);
    const geo = await geoRes.json();
    if(!geo.results || !geo.results.length){ box.innerHTML = `<div class="empty">Could not find that location. Try a nearby town name.</div>`; return; }
    const {latitude, longitude, name, admin1} = geo.results[0];
    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`);
    const w = await wRes.json();
    const cur = w.current;
    const rainNext = w.daily.precipitation_sum.slice(1,4).reduce((a,b)=>a+b,0);
    let advisory = 'No significant rain expected — irrigate and apply fertilizer as scheduled.';
    if(rainNext > 15) advisory = `Rain expected in the next 3 days (~${rainNext.toFixed(0)}mm total) — delay urea top-dressing and postpone irrigation to avoid nutrient wash-off.`;
    else if(cur.relative_humidity_2m > 80) advisory = 'High humidity — monitor for fungal disease (leaf spot, blight); ensure good field drainage.';
    box.innerHTML = `
      <div class="weather-hero">
        <div><div class="loc">${name}${admin1?', '+admin1:''} · live</div><div class="temp">${Math.round(cur.temperature_2m)}°C</div></div>
        <div style="text-align:right;"><div class="loc">Humidity</div><b style="font-size:22px;">${cur.relative_humidity_2m}%</b></div>
      </div>
      <div class="wgrid">
        <div><b>${cur.precipitation} mm</b><span>Current rainfall</span></div>
        <div><b>${cur.wind_speed_10m} km/h</b><span>Wind speed</span></div>
        <div><b>${Math.round(w.daily.temperature_2m_max[0])}°/${Math.round(w.daily.temperature_2m_min[0])}°</b><span>Today high/low</span></div>
        <div><b>${rainNext.toFixed(0)} mm</b><span>Rain, next 3 days</span></div>
      </div>
      <div class="card" style="margin-top:14px;"><b>Farming advisory:</b> ${advisory}</div>
    `;
  }catch(e){
    box.innerHTML = `<div class="empty">Live weather needs an internet connection. (${e.message})</div>`;
  }
}

/* ======================================================================
   PEST & DISEASE
   ====================================================================== */
function renderPest(root){
  const crop = getSelectedCrop();
  if(!crop){ root.innerHTML = emptyState('🐛','Pick a crop from Crop Recommendation first', 'crop'); return; }
  root.innerHTML = `<h3 style="margin-bottom:12px;">${crop.name} — common pests & diseases</h3>` + crop.pests.map(p=>`
    <div class="card" style="margin-bottom:12px;">
      <div class="tag danger">${p.n}</div>
      <p style="margin:8px 0 4px 0;"><b>Symptoms:</b> ${p.s}</p>
      <p style="margin:0;"><b>Prevention / control:</b> ${p.c}</p>
    </div>
  `).join('');
}

/* ======================================================================
   YIELD PREDICTION
   ====================================================================== */
function renderYield(root){
  const crop = getSelectedCrop();
  const land = DB.land();
  if(!crop || !land){ root.innerHTML = emptyState('📈','Complete Land & Soil details and pick a crop first', 'land'); return; }
  const r = scoreCrop(crop, land);
  const waterFactor = {Low:0.8, Medium:1.0, High:1.1}[land.water];
  const est = crop.baseYield * (r.score/100) * waterFactor * land.area;
  root.innerHTML = `
    <div class="card" style="max-width:640px;">
      <h3>${crop.name} — estimated yield</h3>
      <div class="grid grid-3" style="margin:14px 0;">
        <div class="card stat-card"><span>Suitability score</span><b>${r.score}/100</b></div>
        <div class="card stat-card"><span>Field area</span><b>${land.area} acre</b></div>
        <div class="card stat-card"><span>Estimated total yield</span><b>${est.toFixed(2)} t</b></div>
      </div>
      <p class="small-note">Formula: base yield/acre (${crop.baseYield} t) × suitability factor × water-availability factor (${waterFactor}) × field area. Actual yield varies with management, seed quality and weather.</p>
      <button class="btn-sm" onclick="saveYieldRecord(${est.toFixed(2)})">Save this estimate to Reports</button>
      <span id="ySaved" class="small-note"></span>
    </div>
  `;
}
async function saveYieldRecord(est){
  const crop=getSelectedCrop(), land=DB.land();
  const rec = {date:new Date().toISOString(), crop:crop.name, soil:land.soil, season:land.season, yieldEst:est, note:'Yield estimate saved'};
  document.getElementById('ySaved').textContent=' Saving…';
  await DB.addHistoryRecord(CUR.id, rec);
  document.getElementById('ySaved').textContent=' Saved ✓';
}

/* ======================================================================
   MARKET PRICES
   ====================================================================== */
function renderMarket(root){
  root.innerHTML = `
    <div class="card small-note" style="margin-bottom:14px;">Indicative price ranges (₹/quintal) based on recent Tamil Nadu mandi trends. For live prices, connect the Agmarknet/e-NAM API with a valid key.</div>
    <div class="card"><table><thead><tr><th>Crop</th><th>Min ₹</th><th>Max ₹</th><th>Reference market</th></tr></thead><tbody>
    ${MARKET.map(m=>`<tr><td>${m.crop}</td><td>₹${m.min}</td><td>₹${m.max}</td><td>${m.mkt}</td></tr>`).join('')}
    </tbody></table></div>
  `;
}

/* ======================================================================
   REPORTS & HISTORY
   ====================================================================== */
function renderReports(root){
  const hist = DB.history();
  const land = DB.land();
  const crop = getSelectedCrop();
  root.innerHTML = `
    <div class="no-print" style="margin-bottom:16px;display:flex;gap:10px;">
      <button class="btn-sm" onclick="window.print()">🖨️ Print / Save as PDF</button>
      <button class="btn-sm outline" onclick="emailReport()">✉️ Email this report</button>
    </div>
    <div class="card" id="reportCard">
      <h3>Advisory Report — ${CUR.name}</h3>
      <p class="small-note">Generated ${todayStr()} · ${CUR.loc}</p>
      ${land? `<p><b>Land:</b> ${land.area} acre · ${land.soil} soil · ${land.season} · rainfall ${land.rainfall}cm · water ${land.water}</p>`:''}
      ${crop? `<p><b>Current crop selection:</b> ${crop.name} (${crop.ta})</p>`:''}
      <footer class="report-only">SMARTAGRO Smart Crop Advisory System — auto-generated report, for guidance only. Consult your local Agriculture Extension Officer before major input decisions.</footer>
    </div>
    <div class="section-title"><h3 style="margin:0;">Saved history</h3><div class="line"></div></div>
    ${hist.length? hist.map(h=>`
      <div class="history-item">
        <div class="meta">${new Date(h.date).toLocaleString('en-IN')}</div>
        <b>${h.crop}</b> — ${h.note}${h.yieldEst? ` · est. ${h.yieldEst} t`:''}
      </div>
    `).join('') : `<div class="empty"><div class="big">📄</div>No saved records yet — selections from Crop Recommendation and Yield Prediction appear here.</div>`}
  `;
}
function emailReport(){
  const land = DB.land(); const crop=getSelectedCrop();
  const body = `SMARTAGRO Advisory Report for ${CUR.name}%0D%0A`+
    `Location: ${CUR.loc}%0D%0A`+
    (land? `Land: ${land.area} acre, ${land.soil} soil, ${land.season}, rainfall ${land.rainfall}cm, water ${land.water}%0D%0A`:'')+
    (crop? `Recommended crop: ${crop.name}%0D%0A`+`Fertilizer (per acre): N ${crop.fert.N}kg, P ${crop.fert.P}kg, K ${crop.fert.K}kg%0D%0A`:'');
  window.location.href = `mailto:${CUR.email||''}?subject=${encodeURIComponent('My SMARTAGRO Farm Advisory Report')}&body=${body}`;
}

/* ======================================================================
   ADMIN
   ====================================================================== */
function renderAdmin(root){
  const users = USERS_CACHE;
  root.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:20px;">
      <div class="card stat-card"><span>Registered farmers</span><b>${users.length}</b></div>
      <div class="card stat-card"><span>Total saved records</span><b id="adminRecCount">…</b></div>
      <div class="card stat-card"><span>Land profiles submitted</span><b id="adminLandCount">…</b></div>
    </div>
    <div class="card">
      <h3>All farmers</h3>
      <table><thead><tr><th>Name</th><th>Contact</th><th>Location</th><th></th></tr></thead>
      <tbody>${users.map(u=>`<tr><td>${u.name}</td><td>${u.email||u.phone}</td><td>${u.loc}</td>
          <td><button class="btn-sm danger" onclick="adminDelete('${u.id}')">Remove</button></td></tr>`).join('') || `<tr><td colspan="4">No farmers registered yet.</td></tr>`}</tbody></table>
      <p class="small-note">Soil type / record counts per farmer require an extra Sheets lookup per row and are omitted here to keep the admin panel fast — open Reports & History as that farmer to see details, or check the Sheet directly.</p>
    </div>
  `;
}
async function adminDelete(id){
  if(!confirm('Remove this farmer and all their records? This cannot be undone.')) return;
  try{
    await cloudPost('adminDeleteUser', { uid: id });
    USERS_CACHE = USERS_CACHE.filter(u=>u.id!==id);
    renderAdmin(document.getElementById('viewRoot'));
    toast('Farmer removed.');
  }catch(e){
    toast('Could not remove farmer: ' + e.message, true);
  }
}

/* ======================================================================
   NOTIFICATIONS
   ====================================================================== */
function toggleNotif(){ document.getElementById('notifPanel').classList.toggle('hidden'); }
function refreshNotifications(){
  if(ADMIN_MODE || !CUR) return;
  const land=DB.land(); const crop=getSelectedCrop();
  const list=document.getElementById('notifList'); const bell=document.getElementById('bellBtn');
  let notes=[];
  if(!land) notes.push({t:'Add your land & soil details to unlock crop recommendations.', warn:false});
  if(land && !crop) notes.push({t:'Pick a crop to see fertilizer schedule, pest alerts and yield estimate.', warn:false});
  if(crop) notes.push({t:`Watch for ${crop.pests[0].n} on ${crop.name} — check leaves/stems weekly.`, warn:true});
  if(!notes.length) notes.push({t:'You are up to date — no pending actions.', warn:false});
  list.innerHTML = notes.map(n=>`<div class="notif-item ${n.warn?'warn':''}">${n.t}</div>`).join('');
  bell.classList.toggle('has-alert', notes.some(n=>n.warn));
}

/* ---------------- misc ---------------- */
function emptyState(icon,msg,goto){
  return `<div class="empty"><div class="big">${icon}</div>${msg}<div style="margin-top:12px;"><button class="btn-sm" onclick="navigate('${goto}')">Go now →</button></div></div>`;
}

/* ======================================================================
   COPY / SOURCE-VIEW DETERRENTS
   Note: these are UI-level deterrents only — they stop the casual
   right-click "View Page Source" / copy route. They cannot stop anyone
   from reading the code via browser DevTools' Network tab, "view-source:"
   typed directly in the address bar, or by downloading the files from
   the public GitHub repo itself. True code secrecy isn't possible for
   anything that runs in the browser.
   ====================================================================== */
document.addEventListener('contextmenu', (e)=> e.preventDefault());
document.addEventListener('dragstart', (e)=> e.preventDefault());
document.addEventListener('keydown', (e)=>{
  const k = e.key ? e.key.toLowerCase() : '';
  const blockCombo =
    k==='f12' ||
    (e.ctrlKey && e.shiftKey && (k==='i'||k==='j'||k==='c')) ||
    (e.metaKey && e.altKey && (k==='i'||k==='j'||k==='c')) || // Mac Safari/Chrome devtools
    (e.ctrlKey && k==='u') ||
    (e.metaKey && k==='u');
  if(blockCombo) e.preventDefault();
});

/* ---------------- init ---------------- */
window.addEventListener('click', (e)=>{
  const panel=document.getElementById('notifPanel'), bell=document.getElementById('bellBtn');
  if(panel && !panel.classList.contains('hidden') && !panel.contains(e.target) && e.target!==bell){ panel.classList.add('hidden'); }
});
initApp();