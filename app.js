window.__DS_BOOTED = true;

// Erros visíveis (debug)
function __dsShowError(msg){
  try{
    let el=document.getElementById("__ds_err");
    if(!el){
      el=document.createElement("div");
      el.id="__ds_err";
      el.style.position="fixed";
      el.style.left="12px"; el.style.right="12px"; el.style.top="76px";
      el.style.padding="12px";
      el.style.borderRadius="14px";
      el.style.background="#fff";
      el.style.border="1px solid #E2E8F0";
      el.style.boxShadow="0 10px 30px rgba(15,23,42,.12)";
      el.style.zIndex="9999";
      el.style.fontWeight="900";
      el.style.color="#B91C1C";
      document.body.appendChild(el);
    }
    el.textContent = msg;
  }catch(e){}
}
window.addEventListener('error', (e)=> __dsShowError("Erro no app: " + (e.message || "desconhecido")));
window.addEventListener('unhandledrejection', (e)=> __dsShowError("Erro no app: " + (e.reason?.message || String(e.reason || "desconhecido"))));

// Dash Saúde - PWA local (sem backend)
// Regras: comida boa +1 por ocorrência; atividade +1; junk -2 por ocorrência; água bônus +2 ao bater meta 1x/dia; meta pontos padrão 6 editável; undo última ação.

const LS_KEY = "dash_saude_v1";

function pad2(n){ return String(n).padStart(2,'0'); }
function toISODate(d){
  const yyyy=d.getFullYear();
  const mm=pad2(d.getMonth()+1);
  const dd=pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}
function fromISODate(s){
  const [y,m,d]=s.split('-').map(Number);
  return new Date(y, m-1, d);
}
function fmtDateBR(iso){
  const d=fromISODate(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
}
function nowISO(){
  return new Date().toISOString();
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

function defaultState(){
  return {
    config: { meta_pontos: 6, meta_agua_ml: 2000 },
    days: {},        // { [date]: { meta_pontos, meta_agua_ml, agua_ml, bonus_agua_aplicado, peso_kg } }
    actions: []      // [{id, date, ts, tipo, pontos, agua_delta_ml, desfeito }]
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return defaultState();
    const s = JSON.parse(raw);
    // basic migration safety
    if(!s.config) s.config={meta_pontos:6, meta_agua_ml:2000};
    if(!s.days) s.days={};
    if(!s.actions) s.actions=[];
    return s;
  }catch(e){
    return defaultState();
  }
}

function saveState(){
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

let state = loadState();

function ensureDay(date){
  if(!state.days[date]){
    state.days[date] = {
      meta_pontos: state.config.meta_pontos,
      meta_agua_ml: state.config.meta_agua_ml,
      agua_ml: 0,
      bonus_agua_aplicado: false,
      peso_kg: null
    };
  }
  // keep day meta aligned if user changed config and day has default-like values
  if(typeof state.days[date].meta_pontos !== "number") state.days[date].meta_pontos = state.config.meta_pontos;
  if(typeof state.days[date].meta_agua_ml !== "number") state.days[date].meta_agua_ml = state.config.meta_agua_ml;
  if(typeof state.days[date].agua_ml !== "number") state.days[date].agua_ml = 0;
  if(typeof state.days[date].bonus_agua_aplicado !== "boolean") state.days[date].bonus_agua_aplicado = false;
  return state.days[date];
}

function getDayActions(date){
  return state.actions
    .filter(a => a.date === date && !a.desfeito)
    .sort((a,b)=> (a.ts < b.ts ? -1 : 1));
}

function computeScore(date){
  return getDayActions(date).reduce((sum,a)=> sum + (Number(a.pontos)||0), 0);
}

function statusColor(score, goal){
  if(score >= goal) return "Verde";
  if(score === goal-1) return "Amarelo";
  return "Vermelho";
}

function addAction({date, tipo, pontos, agua_delta_ml=0}){
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  state.actions.push({
    id,
    date,
    ts: nowISO(),
    tipo,
    pontos,
    agua_delta_ml,
    desfeito: false
  });
}

function undoLastAction(date){
  const idx = [...state.actions].reverse().findIndex(a => a.date===date && !a.desfeito);
  if(idx === -1) return false;
  // find actual index in original
  const revIndex = state.actions.length - 1 - idx;
  const last = state.actions[revIndex];
  last.desfeito = true;

  // if undoing bonus_agua, revert day flag
  if(last.tipo === "bonus_agua"){
    state.days[date].bonus_agua_aplicado = false;
  }
  // if undoing água, revert água_ml
  if(last.tipo === "agua" && last.agua_delta_ml){
    state.days[date].agua_ml = Math.max(0, (state.days[date].agua_ml||0) - Number(last.agua_delta_ml));
    // if we went below goal, allow bonus again only if bonus action undone too (handled above)
    if(state.days[date].agua_ml < state.days[date].meta_agua_ml){
      // do nothing; bonus flag controlled by bonus action
    }
  }
  return true;
}

function clearToday(date){
  // mark today's actions as undone (soft delete)
  state.actions.forEach(a => {
    if(a.date===date) a.desfeito = true;
  });
  state.days[date].agua_ml = 0;
  state.days[date].bonus_agua_aplicado = false;
}

function maybeAwardWaterBonus(date){
  const day = state.days[date];
  if(!day) return;
  if(day.agua_ml >= day.meta_agua_ml && day.bonus_agua_aplicado === false){
    // award +2 once
    addAction({date, tipo:"bonus_agua", pontos:2});
    day.bonus_agua_aplicado = true;
  }
}

function addWater(date, ml){
  const day = ensureDay(date);
  day.agua_ml = (day.agua_ml || 0) + ml;
  addAction({date, tipo:"agua", pontos:0, agua_delta_ml:ml});
  maybeAwardWaterBonus(date);
}

function setWeight(date, weightStr){
  const v = String(weightStr||"").replace(",", ".").trim();
  if(!v) { state.days[date].peso_kg = null; return; }
  const n = Number(v);
  if(Number.isFinite(n)) state.days[date].peso_kg = n;
}

function seed14Days(){
  const today = new Date();
  for(let i=13;i>=0;i--){
    const d = new Date(today);
    d.setDate(d.getDate()-i);
    const iso = toISODate(d);
    const day = ensureDay(iso);
    // random-ish pattern
    day.meta_pontos = state.config.meta_pontos;
    day.meta_agua_ml = state.config.meta_agua_ml;
    day.agua_ml = 0;
    day.bonus_agua_aplicado = false;
    day.peso_kg = (i%2===0) ? (98 + (Math.random()*2-1)) : null;

    // actions
    const junkTimes = (Math.random()<0.35) ? 2 : (Math.random()<0.55 ? 1 : 0);
    const goodTimes = 2 + Math.floor(Math.random()*3);
    const actTimes = (Math.random()<0.7) ? 1 : 0;

    for(let g=0; g<goodTimes; g++) addAction({date:iso, tipo:"comida_boa", pontos:1});
    for(let a=0; a<actTimes; a++) addAction({date:iso, tipo:"atividade", pontos:1});
    for(let j=0; j<junkTimes; j++) addAction({date:iso, tipo:"junk", pontos:-2});
    // water
    const waterMl = (Math.random()<0.6) ? day.meta_agua_ml : Math.floor(day.meta_agua_ml*0.6);
    // simulate adding water in chunks
    const chunks = [500,500,500,500];
    day.agua_ml = 0;
    state.actions = state.actions.filter(x=> x.date!==iso); // reset seed day actions for water timing
    for(let g=0; g<goodTimes; g++) addAction({date:iso, tipo:"comida_boa", pontos:1});
    for(let a=0; a<actTimes; a++) addAction({date:iso, tipo:"atividade", pontos:1});
    for(let j=0; j<junkTimes; j++) addAction({date:iso, tipo:"junk", pontos:-2});
    let remaining = waterMl;
    while(remaining>0){
      const step = Math.min(remaining, chunks[Math.floor(Math.random()*chunks.length)]);
      addWater(iso, step);
      remaining -= step;
    }
  }
  saveState();
  renderAll();
}

// UI

function mustEl(id){
  const el = document.getElementById(id);
  if(!el){
    __dsShowError("Elemento não encontrado: #" + id + " (index.html desatualizado?)");
    throw new Error("Elemento não encontrado: " + id);
  }
  return el;
}

const screens = {
  Hoje: document.getElementById("screenHoje"),
  Progresso: document.getElementById("screenProgresso"),
  Historico: document.getElementById("screenHistorico"),
  Config: document.getElementById("screenConfig"),
};

const subtitleDate = document.getElementById("subtitleDate");

const scoreText = document.getElementById("scoreText");
const scoreBar = document.getElementById("scoreBar");
const statusPill = document.getElementById("statusPill");

const waterText = document.getElementById("waterText");
const waterBonusHint = document.getElementById("waterBonusHint");

const weightInput = document.getElementById("weightInput");
const btnSaveWeight = mustEl("btnSaveWeight");

const todayActionsEl = mustEl("todayActions");
const todayEmpty = mustEl("todayEmpty");

const btnGood = mustEl("btnGood");
const btnAct = mustEl("btnAct");
const btnJunk = mustEl("btnJunk");
const btnUndo = mustEl("btnUndo");
const btnClearToday = mustEl("btnClearToday");

const goalScoreInput = document.getElementById("goalScoreInput");
const goalWaterInput = document.getElementById("goalWaterInput");
const btnSaveConfig = document.getElementById("btnSaveConfig");

const btnExport = document.getElementById("btnExport");
const importFile = document.getElementById("importFile");
const btnReset = document.getElementById("btnReset");

const historyList = document.getElementById("historyList");
const btnSeed = document.getElementById("btnSeed");

const chartScore = document.getElementById("chartScore");
const chartWeight = document.getElementById("chartWeight");

const kpiGreen = document.getElementById("kpiGreen");
const kpiAvg = document.getElementById("kpiAvg");
const kpiJunk = document.getElementById("kpiJunk");
const summaryChips = document.getElementById("summaryChips");

const btnBackup = document.getElementById("btnBackup");

// Modal day
const dayModal = document.getElementById("dayModal");
const btnCloseModal = document.getElementById("btnCloseModal");
const modalTitle = document.getElementById("modalTitle");
const modalSub = document.getElementById("modalSub");
const modalScore = document.getElementById("modalScore");
const modalWater = document.getElementById("modalWater");
const modalActions = document.getElementById("modalActions");
const modalWeightInput = document.getElementById("modalWeightInput");
const btnSaveModalWeight = document.getElementById("btnSaveModalWeight");
const btnAddActionModal = document.getElementById("btnAddActionModal");

// Modal add action
const actionModal = document.getElementById("actionModal");
const btnCloseActionModal = document.getElementById("btnCloseActionModal");

let selectedRangeDays = 7;
let modalDate = null;

function setScreen(name){
  Object.entries(screens).forEach(([k,el])=>{
    el.classList.toggle("hidden", k!==name);
  });
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.screen===name);
  });
  if(name==="Progresso") renderProgress();
  if(name==="Historico") renderHistory();
  if(name==="Hoje") renderToday();
  if(name==="Config") renderConfig();
}

document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=> setScreen(btn.dataset.screen));
});

document.querySelectorAll("[data-water]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const ml = Number(btn.dataset.water);
    const date = toISODate(new Date());
    ensureDay(date);
    addWater(date, ml);
    saveState();
    renderToday();
  });
});

btnGood.addEventListener("click", ()=>{
  const date = toISODate(new Date());
  ensureDay(date);
  addAction({date, tipo:"comida_boa", pontos:1});
  saveState();
  renderToday();
});
btnAct.addEventListener("click", ()=>{
  const date = toISODate(new Date());
  ensureDay(date);
  addAction({date, tipo:"atividade", pontos:1});
  saveState();
  renderToday();
});
btnJunk.addEventListener("click", ()=>{
  const date = toISODate(new Date());
  ensureDay(date);
  addAction({date, tipo:"junk", pontos:-2});
  saveState();
  renderToday();
});
btnUndo.addEventListener("click", ()=>{
  const date = toISODate(new Date());
  ensureDay(date);
  const ok = undoLastAction(date);
  if(ok){
    saveState();
    renderToday();
  }
});

btnClearToday.addEventListener("click", ()=>{
  const date = toISODate(new Date());
  ensureDay(date);
  if(confirm("Tem certeza? Vai zerar água e desfazer todas as ações de hoje.")){
    clearToday(date);
    saveState();
    renderToday();
  }
});

btnSaveWeight.addEventListener("click", ()=>{
  const date = toISODate(new Date());
  ensureDay(date);
  setWeight(date, weightInput.value);
  saveState();
  renderToday();
});

btnSaveConfig.addEventListener("click", ()=>{
  const g = Number(String(goalScoreInput.value||"").replace(",", "."));
  const w = Number(String(goalWaterInput.value||"").replace(",", "."));
  if(Number.isFinite(g) && g>0) state.config.meta_pontos = Math.round(g);
  if(Number.isFinite(w) && w>0) state.config.meta_agua_ml = Math.round(w);
  saveState();
  renderConfig();
  renderToday();
  alert("Configurações salvas.");
});

btnExport.addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `dash_saude_backup_${toISODate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

importFile.addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  try{
    const txt = await file.text();
    const parsed = JSON.parse(txt);
    if(!parsed || !parsed.config || !parsed.days || !parsed.actions) throw new Error("Formato inválido");
    state = parsed;
    saveState();
    renderAll();
    alert("Importado com sucesso.");
  }catch(err){
    alert("Não consegui importar. Verifique o arquivo.");
  }finally{
    importFile.value = "";
  }
});

btnReset.addEventListener("click", ()=>{
  if(confirm("Zerar tudo? Isso apaga seu histórico local.")){
    state = defaultState();
    saveState();
    renderAll();
  }
});

btnSeed.addEventListener("click", ()=>{
  if(confirm("Gerar 14 dias de dados de teste? Isso adiciona dados (pode misturar com os seus).")){
    seed14Days();
  }
});

btnBackup.addEventListener("click", ()=> setScreen("Config"));

// Progress range toggle
document.querySelectorAll(".segBtn").forEach(b=>{
  b.addEventListener("click", ()=>{
    selectedRangeDays = Number(b.dataset.range);
    document.querySelectorAll(".segBtn").forEach(x=> x.classList.toggle("active", x===b));
    renderProgress();
  });
});

// Modal handlers
function openDayModal(date){
  modalDate = date;
  dayModal.classList.remove("hidden");
  renderModalDay();
}
function closeDayModal(){
  dayModal.classList.add("hidden");
  modalDate = null;
}
btnCloseModal.addEventListener("click", closeDayModal);
dayModal.addEventListener("click", (e)=>{
  if(e.target === dayModal) closeDayModal();
});

btnSaveModalWeight.addEventListener("click", ()=>{
  const date = modalDate || toISODate(new Date());
    ensureDay(date);
    //
  ensureDay(modalDate);
  setWeight(modalDate, modalWeightInput.value);
  saveState();
  renderModalDay();
  renderProgress();
});

btnAddActionModal.addEventListener("click", ()=>{
  actionModal.classList.remove("hidden");
});
btnCloseActionModal.addEventListener("click", ()=> actionModal.classList.add("hidden"));
actionModal.addEventListener("click", (e)=>{
  if(e.target === actionModal) actionModal.classList.add("hidden");
});
actionModal.querySelectorAll("[data-add]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    if(!modalDate) return;
    ensureDay(modalDate);
    const t = btn.dataset.add;
    if(t==="comida_boa") addAction({date, tipo:"comida_boa", pontos:1});
    if(t==="atividade") addAction({date, tipo:"atividade", pontos:1});
    if(t==="junk") addAction({date, tipo:"junk", pontos:-2});
    if(t==="agua_250") addWater(date, 250);
    saveState();
    actionModal.classList.add("hidden");
    renderModalDay();
    renderHistory();
    renderToday();
  });
});

function renderToday(){
  const date = toISODate(new Date());
  subtitleDate.textContent = "Hoje • " + fmtDateBR(date);
  const day = ensureDay(date);

  const score = computeScore(date);
  const goal = day.meta_pontos ?? state.config.meta_pontos;
  scoreText.textContent = `${score} / ${goal}`;
  const pct = clamp(goal>0 ? (score/goal)*100 : 0, 0, 100);
  scoreBar.style.width = `${pct}%`;
  const st = statusColor(score, goal);
  statusPill.textContent = st;
  statusPill.style.background = st==="Verde" ? "rgba(44,182,125,.10)" : st==="Amarelo" ? "rgba(245,158,11,.14)" : "rgba(209,67,67,.10)";
  statusPill.style.borderColor = st==="Verde" ? "rgba(44,182,125,.35)" : st==="Amarelo" ? "rgba(245,158,11,.35)" : "rgba(209,67,67,.35)";
  statusPill.style.color = st==="Verde" ? "rgba(16,185,129,1)" : st==="Amarelo" ? "rgba(180,83,9,1)" : "rgba(185,28,28,1)";

  waterText.textContent = `${day.agua_ml || 0} / ${day.meta_agua_ml || state.config.meta_agua_ml} ml`;
  waterBonusHint.textContent = day.bonus_agua_aplicado ? "Bônus de água já aplicado hoje (+2)." : "Bônus: +2 ao bater a meta 1x/dia";

  weightInput.value = (day.peso_kg==null) ? "" : String(day.peso_kg).replace(".", ",");

  const actions = getDayActions(date).slice().reverse();
  todayActionsEl.innerHTML = "";
  if(actions.length===0){
    todayEmpty.style.display = "block";
  }else{
    todayEmpty.style.display = "none";
    actions.forEach(a=>{
      todayActionsEl.appendChild(renderActionItem(a, {showDate:false}));
    });
  }
}

function renderActionItem(a, {showDate}){
  const el = document.createElement("div");
  el.className = "item";
  const left = document.createElement("div");
  left.className = "left";
  const title = document.createElement("div");
  title.style.fontWeight = "900";
  title.textContent = labelForAction(a);
  const sub = document.createElement("div");
  sub.className = "small";
  const when = new Date(a.ts);
  const hh = pad2(when.getHours());
  const mm = pad2(when.getMinutes());
  sub.textContent = (showDate ? fmtDateBR(a.date) + " • " : "") + `${hh}:${mm}`;
  left.appendChild(title);
  left.appendChild(sub);

  const right = document.createElement("div");
  right.className = "right";

  const pts = document.createElement("div");
  pts.className = "points";
  pts.textContent = (a.pontos>0? `+${a.pontos}` : String(a.pontos));
  pts.style.color = a.pontos>0 ? "rgba(16,185,129,1)" : (a.pontos<0 ? "rgba(185,28,28,1)" : "rgba(100,116,139,1)");

  const del = document.createElement("button");
  del.className = "del";
  del.textContent = "Desfazer";
  del.addEventListener("click", ()=>{
    a.desfeito = true;
    // revert day flags/agua if needed
    if(a.tipo==="bonus_agua"){
      state.days[a.date].bonus_agua_aplicado = false;
    }
    if(a.tipo==="agua" && a.agua_delta_ml){
      state.days[a.date].agua_ml = Math.max(0, (state.days[a.date].agua_ml||0) - Number(a.agua_delta_ml));
    }
    saveState();
    renderAll();
    if(dayModal && !dayModal.classList.contains("hidden")) renderModalDay();
  });

  right.appendChild(pts);
  right.appendChild(del);

  el.appendChild(left);
  el.appendChild(right);
  return el;
}

function labelForAction(a){
  if(a.tipo==="comida_boa") return "Comida boa (+1)";
  if(a.tipo==="atividade") return "Atividade (+1)";
  if(a.tipo==="junk") return "Junk (-2)";
  if(a.tipo==="agua") return `Água (+${a.agua_delta_ml || 0} ml)`;
  if(a.tipo==="bonus_agua") return "Bônus água (+2)";
  return a.tipo;
}

function renderHistory(){
  // list last 60 days that exist or have actions
  const dates = new Set(Object.keys(state.days));
  state.actions.forEach(a=> dates.add(a.date));
  const arr = [...dates].sort().reverse();
  historyList.innerHTML = "";
  arr.slice(0, 90).forEach(date=>{
    ensureDay(date);
    const day = state.days[date];
    const score = computeScore(date);
    const goal = day.meta_pontos;
    const st = statusColor(score, goal);
    const item = document.createElement("div");
    item.className = "item";
    item.style.cursor = "pointer";

    const left = document.createElement("div");
    left.className = "left";
    const t = document.createElement("div");
    t.style.fontWeight="900";
    t.textContent = fmtDateBR(date);
    const s = document.createElement("div");
    s.className = "small";
    s.textContent = `Pontos: ${score}/${goal} • Água: ${day.agua_ml}/${day.meta_agua_ml} ml`;
    left.appendChild(t);
    left.appendChild(s);

    const right = document.createElement("div");
    right.className = "right";
    const pill = document.createElement("div");
    pill.className = "pill";
    pill.textContent = st;
    pill.style.background = st==="Verde" ? "rgba(44,182,125,.10)" : st==="Amarelo" ? "rgba(245,158,11,.14)" : "rgba(209,67,67,.10)";
    pill.style.borderColor = st==="Verde" ? "rgba(44,182,125,.35)" : st==="Amarelo" ? "rgba(245,158,11,.35)" : "rgba(209,67,67,.35)";
    pill.style.color = st==="Verde" ? "rgba(16,185,129,1)" : st==="Amarelo" ? "rgba(180,83,9,1)" : "rgba(185,28,28,1)";

    right.appendChild(pill);
    item.appendChild(left);
    item.appendChild(right);

    item.addEventListener("click", ()=> openDayModal(date));
    historyList.appendChild(item);
  });
}

function renderModalDay(){
  if(!modalDate) return;
  ensureDay(modalDate);
  const day = state.days[modalDate];
  const score = computeScore(modalDate);
  modalTitle.textContent = "Detalhe do dia";
  modalSub.textContent = fmtDateBR(modalDate);
  modalScore.textContent = `${score} / ${day.meta_pontos}`;
  modalWater.textContent = `${day.agua_ml} / ${day.meta_agua_ml} ml`;
  modalWeightInput.value = (day.peso_kg==null) ? "" : String(day.peso_kg).replace(".", ",");
  modalActions.innerHTML = "";
  const actions = getDayActions(modalDate).slice().reverse();
  actions.forEach(a=>{
    modalActions.appendChild(renderActionItem(a, {showDate:false}));
  });
}

function renderConfig(){
  goalScoreInput.value = String(state.config.meta_pontos);
  goalWaterInput.value = String(state.config.meta_agua_ml);
}

function drawLineChart(canvas, data, {minY=null,maxY=null, goalLine=null}={}){
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = canvas.getAttribute("height") * devicePixelRatio;
  ctx.clearRect(0,0,w,h);

  const pad = 16 * devicePixelRatio;
  const innerW = w - pad*2;
  const innerH = h - pad*2;

  const ys = data.map(d=> d.y).filter(v=> v!=null && Number.isFinite(v));
  const yMin = (minY!=null) ? minY : (ys.length ? Math.min(...ys) : 0);
  const yMax = (maxY!=null) ? maxY : (ys.length ? Math.max(...ys) : 1);
  const span = (yMax - yMin) || 1;

  function xAt(i){ return pad + (innerW*(data.length<=1?0:i/(data.length-1))); }
  function yAt(v){ return pad + innerH - ((v - yMin)/span)*innerH; }

  // grid
  ctx.strokeStyle = "rgba(100,116,139,.25)";
  ctx.lineWidth = 1 * devicePixelRatio;
  ctx.beginPath();
  for(let i=0;i<=4;i++){
    const yy = pad + (innerH*i/4);
    ctx.moveTo(pad, yy);
    ctx.lineTo(pad+innerW, yy);
  }
  ctx.stroke();

  // goal line
  if(goalLine!=null){
    const yy = yAt(goalLine);
    ctx.strokeStyle = "rgba(100,116,139,.85)";
    ctx.setLineDash([6*devicePixelRatio, 6*devicePixelRatio]);
    ctx.beginPath();
    ctx.moveTo(pad, yy);
    ctx.lineTo(pad+innerW, yy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // line
  ctx.strokeStyle = "rgba(47,128,237,1)";
  ctx.lineWidth = 3 * devicePixelRatio;
  ctx.beginPath();
  let started=false;
  data.forEach((d,i)=>{
    if(d.y==null || !Number.isFinite(d.y)) return;
    const x=xAt(i), y=yAt(d.y);
    if(!started){ ctx.moveTo(x,y); started=true; }
    else ctx.lineTo(x,y);
  });
  ctx.stroke();

  // points
  ctx.fillStyle = "rgba(44,182,125,1)";
  data.forEach((d,i)=>{
    if(d.y==null || !Number.isFinite(d.y)) return;
    const x=xAt(i), y=yAt(d.y);
    ctx.beginPath();
    ctx.arc(x,y,4*devicePixelRatio,0,Math.PI*2);
    ctx.fill();
  });
}

function renderProgress(){
  const today = new Date();
  const dates = [];
  for(let i=selectedRangeDays-1;i>=0;i--){
    const d = new Date(today);
    d.setDate(d.getDate()-i);
    dates.push(toISODate(d));
  }

  dates.forEach(ensureDay);
  const scores = dates.map(date=>{
    const day = state.days[date];
    return { x:date, y: computeScore(date), goal: day.meta_pontos };
  });

  const weights = dates.map(date=>{
    const day = state.days[date];
    return { x:date, y: day.peso_kg };
  });

  // KPIs
  const greens = scores.filter(s=> s.y >= s.goal).length;
  const avg = scores.reduce((sum,s)=> sum+s.y, 0) / scores.length;
  const junkCount = state.actions.filter(a=> dates.includes(a.date) && !a.desfeito && a.tipo==="junk").length;
  kpiGreen.textContent = String(greens);
  kpiAvg.textContent = String(Math.round(avg*10)/10).replace(".", ",");
  kpiJunk.textContent = String(junkCount);

  // chips colors summary
  summaryChips.innerHTML = "";
  dates.slice().reverse().forEach(date=>{
    const day = state.days[date];
    const score = computeScore(date);
    const st = statusColor(score, day.meta_pontos);
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = fmtDateBR(date).slice(0,5) + " • " + score;
    chip.style.borderColor = st==="Verde" ? "rgba(44,182,125,.35)" : st==="Amarelo" ? "rgba(245,158,11,.35)" : "rgba(209,67,67,.35)";
    chip.style.background = st==="Verde" ? "rgba(44,182,125,.08)" : st==="Amarelo" ? "rgba(245,158,11,.10)" : "rgba(209,67,67,.06)";
    summaryChips.appendChild(chip);
  });

  // charts
  drawLineChart(chartScore, scores.map(s=>({x:s.x, y:s.y})), {goalLine: state.config.meta_pontos});
  drawLineChart(chartWeight, weights, {});
}

function renderAll(){
  renderConfig();
  renderToday();
  renderHistory();
  renderProgress();
}

// service worker
if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").then(reg=>{reg.update();}).catch(()=>{});
}

console.log("Dash Saúde: app.js carregado");

// init
(function init(){
  const today = toISODate(new Date());
  ensureDay(today);
  saveState();
  renderAll();
  setScreen("Hoje");
})();
