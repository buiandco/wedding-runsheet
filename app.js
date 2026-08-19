(() => {
  "use strict";

  const cfg = window.WEDDING_CONFIG || {};
  const state = {
    tab: "runsheet",
    data: { tasks: [], people: [], vendors: [], settings: {} },
    selectedPerson: null,
    loading: true,
    error: "",
    success: "",
    lastSync: null,
    pin: sessionStorage.getItem("weddingAdminPin") || "",
    adminUnlocked: sessionStorage.getItem("weddingAdminUnlocked") === "true",
    modal: null,
    notifOn: typeof Notification !== "undefined" && Notification.permission === "granted",
    notified: new Set(),
    saving: false,
    unlocking: false,
    syncing: false,
    celebratingTaskId: null
  };

  const app = document.getElementById("app");
  const CACHE_KEY = "weddingRunsheetCacheV2";

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const cached = JSON.parse(raw);
      if (!cached || !cached.data || !Array.isArray(cached.data.tasks)) return false;
      state.data = cached.data;
      state.lastSync = cached.syncedAt ? new Date(cached.syncedAt) : null;
      state.loading = false;
      return true;
    } catch { return false; }
  }

  function writeCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({data:state.data, syncedAt:state.lastSync ? state.lastSync.toISOString() : new Date().toISOString()})); } catch {}
  }

  const demoData = {
    tasks: [
      {id:"t01",time:"07:00",title:"Hair & makeup begins",peopleIds:["jennifer","moh","bm1","bm2"],notes:"At the house",done:false,sortOrder:10},
      {id:"t02",time:"09:30",title:"Getting-ready photos",peopleIds:["jennifer","moh"],notes:"Photographer arrives",done:false,sortOrder:20},
      {id:"t03",time:"10:00",title:"Suits on",peopleIds:["charlie","gm1"],notes:"",done:false,sortOrder:30},
      {id:"t04",time:"11:00",title:"Flowers delivered & checked",peopleIds:["moh"],notes:"Confirm count with florist",done:false,sortOrder:40},
      {id:"t05",time:"12:30",title:"Cars depart for ceremony",peopleIds:["jennifer","charlie","moh","bm1","bm2","gm1"],notes:"",done:false,sortOrder:50},
      {id:"t06",time:"14:00",title:"Ceremony begins",peopleIds:["jennifer","charlie","moh","bm1","bm2","gm1"],notes:"",done:false,sortOrder:60},
      {id:"t07",time:"15:00",title:"Wedding party photos",peopleIds:["jennifer","charlie","moh","bm1","bm2","gm1"],notes:"",done:false,sortOrder:70},
      {id:"t08",time:"18:00",title:"Reception — guests arrive",peopleIds:[],notes:"",done:false,sortOrder:80},
      {id:"t09",time:"18:30",title:"Bridal party entrance",peopleIds:["jennifer","charlie","moh","bm1","bm2","gm1"],notes:"",done:false,sortOrder:90},
      {id:"t10",time:"21:00",title:"First dance",peopleIds:["jennifer","charlie"],notes:"",done:false,sortOrder:100}
    ],
    people: [
      {id:"jennifer",name:"Jennifer",role:"Bride"},{id:"charlie",name:"Charlie",role:"Groom"},{id:"moh",name:"Maid of Honour",role:"Bridal party"},{id:"bm1",name:"Bridesmaid 1",role:"Bridal party"},{id:"bm2",name:"Bridesmaid 2",role:"Bridal party"},{id:"gm1",name:"Best Man",role:"Bridal party"}
    ],
    vendors: [
      {id:"v1",role:"Florist",name:"Glamorous Occasions",phone:"",email:"",notes:"Add phone / email"},
      {id:"v2",role:"Photographer",name:"Add name",phone:"",email:"",notes:""},
      {id:"v3",role:"Celebrant",name:"Add name",phone:"",email:"",notes:""},
      {id:"v4",role:"Venue coordinator",name:"Add name",phone:"",email:"",notes:""},
      {id:"v5",role:"Catering",name:"Add name",phone:"",email:"",notes:""}
    ],
    settings: { eventTitle: cfg.EVENT_TITLE || "The Wedding Day", eventLabel: cfg.EVENT_LABEL || "26 September 2026" }
  };

  function clientId(prefix) { const r=(globalThis.crypto && crypto.randomUUID)?crypto.randomUUID().replace(/-/g,"").slice(0,12):Date.now().toString(36)+Math.random().toString(36).slice(2,7); return prefix+r; }
  function esc(v="") { return String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
  function fmtTime(hhmm) { const [h,m] = (hhmm || "00:00").split(":").map(Number); const p=h>=12?"PM":"AM"; const h12=h%12===0?12:h%12; return `${h12}:${String(m).padStart(2,"0")} ${p}`; }
  function fmtClock(d) { return d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit", second:"2-digit"}); }
  function timeToday(hhmm, base=new Date()) { const [h,m]=(hhmm||"00:00").split(":").map(Number); const d=new Date(base); d.setHours(h,m,0,0); return d; }
  function sortedTasks() { return [...state.data.tasks].sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0) || String(a.time).localeCompare(String(b.time))); }
  function status(task, now=new Date()) { if (task.done) return "complete"; return now >= timeToday(task.time, now) ? "overdue" : "upcoming"; }
  function personMap() { return Object.fromEntries(state.data.people.map(p => [p.id,p])); }
  function flash(type, msg) { state[type] = msg; render(); setTimeout(()=>{ if(state[type]===msg){state[type]="";render();}}, 2500); }

  async function api(action, payload={}, admin=false) {
    if (cfg.USE_DEMO_DATA) return {ok:true, data:demoData};
    if (!cfg.API_URL || cfg.API_URL.includes("PASTE_YOUR")) throw new Error("Connect the Google Apps Script Web App URL in frontend/config.js first.");

    const attempt = async () => {
      const body = new URLSearchParams();
      body.set("action", action);
      body.set("payload", JSON.stringify(payload));
      if (admin) body.set("pin", state.pin);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(6000, Number(cfg.REQUEST_TIMEOUT_MS) || 15000));
      let res;
      try {
        res = await fetch(cfg.API_URL, { method:"POST", body, signal:controller.signal, redirect:"follow", cache:"no-store" });
      } catch (err) {
        if (err && err.name === "AbortError") throw new Error("Google Sheets is taking longer than expected. Your screen is still usable — try again or tap Refresh.");
        throw new Error("Could not reach Google Sheets. Check your connection and try again.");
      } finally { clearTimeout(timer); }

      const text = await res.text();
      const trimmed = text.trim();
      if (!res.ok) throw new Error(`Google returned HTTP ${res.status}. Try again in a moment.`);
      if (!trimmed || trimmed.startsWith("<") || /<!doctype|<html/i.test(trimmed.slice(0,200))) {
        throw new Error("Google returned a web page instead of runsheet data. Tap Refresh and try again. If this keeps happening, redeploy the Apps Script as 'Anyone' access.");
      }

      let json;
      try { json = JSON.parse(trimmed); }
      catch { throw new Error("Google returned an unreadable response. Tap Refresh and try again."); }
      if (!json.ok) throw new Error(json.error || "Request failed");
      return json;
    };

    // Reads and PIN checks are safe to retry once. Writes are deliberately NOT retried
    // because a lost response after a successful write could otherwise create duplicates.
    try { return await attempt(); }
    catch (err) {
      if (action === "getData" || action === "verifyPin") {
        await new Promise(r => setTimeout(r, 650));
        return await attempt();
      }
      throw err;
    }
  }

  async function loadData(silent=false) {
    if (state.syncing) return;
    state.syncing = true;
    if (!silent && !state.data.tasks.length && !state.data.people.length && !state.data.vendors.length) { state.loading = true; render(); }
    try {
      if (cfg.USE_DEMO_DATA) state.data = structuredClone(demoData);
      else { const out = await api("getData"); state.data = out.data; }
      state.lastSync = new Date();
      state.error = "";
      writeCache();
    } catch (e) {
      state.error = e.message;
    } finally {
      state.loading = false;
      state.syncing = false;
      render();
    }
  }

  function applyConfirmedMutation(action, payload, out={}) {
    const p = {...payload};
    if (out.id && !p.id) p.id = out.id;
    applyDemoMutation(action, p);
    state.lastSync = new Date();
    writeCache();
  }

  async function saveAction(action, payload, admin=true, success="Saved") {
    if (state.saving) return;
    state.saving = true;
    render();
    try {
      let out = {ok:true};
      if (cfg.USE_DEMO_DATA) applyDemoMutation(action,payload);
      else {
        out = await api(action, payload, admin);
        applyConfirmedMutation(action, payload, out);
      }
      if (cfg.USE_DEMO_DATA) writeCache();
      state.modal = null;
      state.error = "";
      state.success = success;
      render();
      setTimeout(()=>{ if(state.success===success){state.success="";render();}},2500);
      // Reconcile with any manual Sheet edits shortly afterwards, without blocking the save UI.
      setTimeout(()=>loadData(true), 800);
    } catch(e) {
      if (/PIN|Unauthorized/i.test(e.message)) lockAdmin();
      state.error = e.message;
      render();
    } finally { state.saving=false; render(); }
  }

  function applyDemoMutation(action,p) {
    const d=state.data;
    if(action==="toggleDone"){const t=d.tasks.find(x=>x.id===p.id); if(t)t.done=!t.done;}
    if(action==="saveTask"){const i=d.tasks.findIndex(x=>x.id===p.id); i>=0?d.tasks[i]={...d.tasks[i],...p}:d.tasks.push({...p,id:p.id||`t${Date.now()}`,done:false});}
    if(action==="deleteTask") d.tasks=d.tasks.filter(x=>x.id!==p.id);
    if(action==="savePerson"){const i=d.people.findIndex(x=>x.id===p.id); i>=0?d.people[i]={...d.people[i],...p}:d.people.push({...p,id:p.id||`p${Date.now()}`});}
    if(action==="deletePerson"){d.people=d.people.filter(x=>x.id!==p.id); d.tasks.forEach(t=>t.peopleIds=(t.peopleIds||[]).filter(id=>id!==p.id));}
    if(action==="saveVendor"){const i=d.vendors.findIndex(x=>x.id===p.id); i>=0?d.vendors[i]={...d.vendors[i],...p}:d.vendors.push({...p,id:p.id||`v${Date.now()}`});}
    if(action==="deleteVendor") d.vendors=d.vendors.filter(x=>x.id!==p.id);
  }

  function lockAdmin(){ state.pin=""; state.adminUnlocked=false; sessionStorage.removeItem("weddingAdminPin"); sessionStorage.removeItem("weddingAdminUnlocked"); }

  async function unlock(pin) {
    if (state.unlocking) return;
    state.pin = pin;
    state.unlocking = true;
    state.error = "";
    render();
    try {
      if (!cfg.USE_DEMO_DATA) await api("verifyPin", {}, true);
      state.adminUnlocked = true;
      sessionStorage.setItem("weddingAdminPin", pin);
      sessionStorage.setItem("weddingAdminUnlocked", "true");
      state.tab="admin";
      state.modal=null;
      state.error="";
    } catch(e){ lockAdmin(); state.error=e.message; }
    finally { state.unlocking=false; render(); }
  }

  async function toggleDone(id) {
    const task=state.data.tasks.find(t=>t.id===id); if(!task)return;
    const markingDone = !task.done;
    task.done=!task.done;
    state.celebratingTaskId = markingDone ? id : null;
    render();
    if (markingDone) setTimeout(()=>{ if(state.celebratingTaskId===id){ state.celebratingTaskId=null; render(); } }, 900);
    try { if(!cfg.USE_DEMO_DATA) { const out=await api("toggleDone",{id},false); if(typeof out.done==="boolean") task.done=out.done; state.lastSync=new Date(); writeCache(); render(); setTimeout(()=>loadData(true),800); } }
    catch(e){ task.done=!task.done; state.celebratingTaskId=null; state.error=e.message; render(); }
  }

  async function enableNotifications(){
    if(typeof Notification==="undefined"){flash("error","Notifications are not supported by this browser.");return;}
    const perm=await Notification.requestPermission(); state.notifOn=perm==="granted"; render();
  }

  function checkNotifications(){
    if(!state.notifOn)return; const now=new Date();
    state.data.tasks.forEach(t=>{const diff=now-timeToday(t.time,now); if(diff>=0&&diff<15000&&!t.done&&!state.notified.has(t.id)){state.notified.add(t.id); try{new Notification("Wedding day — due now",{body:t.title});}catch{}}});
  }

  function currentContext(now=new Date()){
    const tasks=sortedTasks(); let idx=-1; tasks.forEach((t,i)=>{if(timeToday(t.time,now)<=now)idx=i;});
    return {now:idx>=0?tasks[idx]:null,next:idx+1<tasks.length?tasks[idx+1]:null};
  }

  function renderHeader(){
    const now=new Date(), ctx=currentContext(now), overdue=state.data.tasks.filter(t=>status(t,now)==="overdue").length;
    const settings=state.data.settings||{}, title=settings.eventTitle||cfg.EVENT_TITLE||"The Wedding Day", label=settings.eventLabel||cfg.EVENT_LABEL||"";
    return `
      <div class="header">
        <div class="header-top">
          <div><div class="eyebrow">Live Runsheet</div><div class="title">${esc(title)}</div></div>
          <div class="header-actions"><button class="icon-btn" data-action="admin">${state.adminUnlocked?"🔓 Edit":"🔒 Edit"}</button></div>
        </div>
        <div class="sample-note">${esc(label)}</div>
        <div class="hero-divider"><span>✦</span></div>
        <div class="clock-row">◷ <span id="liveClock">${fmtClock(now)}</span></div>
        <div class="now-next">${ctx.now?`<div><b>Now:</b> ${esc(ctx.now.title)}</div>`:""}${ctx.next?`<div><b>Next:</b> ${esc(ctx.next.title)} at ${fmtTime(ctx.next.time)}</div>`:""}</div>
        <div class="header-meta"><button class="header-chip ${state.notifOn?"on":""}" data-action="notifications">${state.notifOn?"🔔 Alerts on":"🔕 Get alerts"}</button><button class="header-chip" data-action="refresh">↻ Refresh</button></div>
        <div class="sync-text">${state.syncing?"Syncing with Google Sheet…":state.lastSync?`Last synced ${state.lastSync.toLocaleTimeString([], {hour:"numeric",minute:"2-digit",second:"2-digit"})}`:"Connecting to Google Sheet…"}</div>
      </div>
      ${overdue?`<div class="overdue-banner">⚠ ${overdue} task${overdue===1?"":"s"} outstanding</div>`:""}
      ${state.error?`<div class="error-banner">⚠ ${esc(state.error)}</div>`:""}
      ${state.success?`<div class="success-banner">✓ ${esc(state.success)}</div>`:""}`;
  }

  function renderTabs(){
    const tabs=[['runsheet','☷','Runsheet'],['people','♙','My Tasks'],['vendors','▣','Vendors']]; if(state.adminUnlocked)tabs.push(['admin','⚙','Edit']);
    return `<div class="tabs">${tabs.map(([id,ic,l])=>`<button class="tab ${state.tab===id?'active':''}" data-tab="${id}">${ic} ${l}</button>`).join('')}</div>`;
  }

  function taskCard(t){
    const s=status(t), pm=personMap(), names=(t.peopleIds||[]).map(id=>pm[id]?.name).filter(Boolean).join(', ');
    const celebration = state.celebratingTaskId === t.id ? " just-completed" : "";
    return `<div class="item ${s}${celebration}"><div class="marker"><span class="dot">${s==='complete'?'✓':''}</span></div><div class="card"><div class="item-time">${fmtTime(t.time)}</div><div class="item-title">${esc(t.title)}</div>${names?`<div class="item-who">${esc(names)}</div>`:''}${t.notes?`<div class="item-notes">${esc(t.notes)}</div>`:''}${s==='overdue'?`<div class="status">⚠ Outstanding</div>`:''}<div><button class="check-btn" data-toggle="${esc(t.id)}">${t.done?'Mark not done':'Mark done'}</button></div><span class="card-ornament"></span></div></div>`;
  }

  function renderRunsheet(){ const tasks=sortedTasks(); return `<div class="panel">${tasks.length?`<div class="timeline">${tasks.map(taskCard).join('')}</div>`:`<div class="empty">No tasks have been added yet.</div>`}</div>`; }
  function renderPeople(){
    const p=state.data.people, selected=state.selectedPerson, tasks=selected?sortedTasks().filter(t=>(t.peopleIds||[]).includes(selected)):[];
    return `<div class="panel"><div class="pills">${p.map(x=>`<button class="pill ${selected===x.id?'active':''}" data-person="${esc(x.id)}">${esc(x.name)} <span class="pill-role">${esc(x.role||'')}</span></button>`).join('')}</div>${!selected?`<div class="empty">Tap a name to see that person's tasks<br>and what time they need to happen.</div>`:tasks.length?`<div class="timeline">${tasks.map(taskCard).join('')}</div>`:`<div class="empty">No tasks assigned yet.</div>`}</div>`;
  }
  function renderVendors(){
    return `<div class="panel">${state.data.vendors.length?state.data.vendors.map(v=>`<div class="vendor-card"><div class="vendor-role">${esc(v.role)}</div><div class="vendor-name">${esc(v.name)}</div><div class="vendor-actions">${v.phone?`<a class="vendor-link" href="tel:${esc(v.phone)}">☎ ${esc(v.phone)}</a>`:''}${v.email?`<a class="vendor-link" href="mailto:${esc(v.email)}">✉ ${esc(v.email)}</a>`:''}</div>${v.notes?`<div class="vendor-notes">${esc(v.notes)}</div>`:''}</div>`).join(''):`<div class="empty">No vendors have been added yet.</div>`}</div>`;
  }

  function adminRows(type, items){
    if(!items.length)return `<div class="empty">Nothing added yet.</div>`;
    return items.map(x=>{
      const lead=type==='task'?fmtTime(x.time):(type==='vendor'?esc(x.role):esc(x.role||''));
      const title=type==='task'?x.title:x.name;
      const sub=type==='task'?((x.peopleIds||[]).map(id=>personMap()[id]?.name).filter(Boolean).join(', ')||'No people assigned'):(type==='vendor'?(x.phone||x.email||'No contact details'):`ID: ${x.id}`);
      return `<div class="admin-row"><div class="admin-row-sub">${lead}</div><div class="admin-row-main"><div class="admin-row-title">${esc(title)}</div><div class="admin-row-sub">${esc(sub)}</div></div><div class="admin-row-actions"><button class="small-action" data-edit-${type}="${esc(x.id)}">Edit</button></div></div>`;
    }).join('');
  }

  function renderAdmin(){
    if(!state.adminUnlocked)return `<div class="panel">${unlockBox()}</div>`;
    return `<div class="panel">
      <div class="section-head"><div class="section-title">Running Order</div><button class="primary-btn" data-new-task>+ Add task</button></div><div class="admin-card">${adminRows('task',sortedTasks())}</div>
      <div class="section-head"><div class="section-title">People</div><button class="primary-btn" data-new-person>+ Add person</button></div><div class="admin-card">${adminRows('person',state.data.people)}</div>
      <div class="section-head"><div class="section-title">Vendors</div><button class="primary-btn" data-new-vendor>+ Add vendor</button></div><div class="admin-card">${adminRows('vendor',state.data.vendors)}</div>
      <div class="section-head"><div></div><button class="ghost-btn" data-lock>Lock edit mode</button></div>
    </div>`;
  }

  function unlockBox(){return `<div class="unlock-box"><div class="unlock-title">Unlock editing</div><div class="unlock-copy">Enter the admin PIN to add, edit or remove tasks, people and vendors. Marking tasks complete does not require the PIN.</div><form id="unlockForm"><div class="field"><label>Admin PIN</label><input id="pinInput" type="password" inputmode="numeric" autocomplete="current-password" value="${esc(state.pin)}" required ${state.unlocking?"disabled":""}></div><button class="primary-btn" type="submit" ${state.unlocking?"disabled":""}>${state.unlocking?"Checking PIN…":"Unlock"}</button></form></div>`;}

  function modalHtml(){
    const m=state.modal; if(!m)return '';
    if(m.type==='unlock')return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div class="modal-title">Edit mode</div><button class="close-btn" data-close>×</button></div>${unlockBox()}</div></div>`;
    if(m.type==='task'){
      const t=m.item||{id:'',time:'09:00',title:'',peopleIds:[],notes:'',sortOrder:(sortedTasks().length+1)*10};
      return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div class="modal-title">${m.isNew?'Add task':'Edit task'}</div><button class="close-btn" data-close>×</button></div><form id="taskForm"><input type="hidden" name="id" value="${esc(t.id)}"><div class="field"><label>Time</label><input name="time" type="time" value="${esc(t.time)}" required></div><div class="field"><label>Task</label><input name="title" value="${esc(t.title)}" required></div><div class="field"><label>Assigned people</label><div class="multi-select">${state.data.people.map(p=>`<button type="button" class="select-chip ${(t.peopleIds||[]).includes(p.id)?'selected':''}" data-select-person="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div><input type="hidden" name="peopleIds" value="${esc((t.peopleIds||[]).join(','))}"></div><div class="field"><label>Notes</label><textarea name="notes">${esc(t.notes||'')}</textarea></div><div class="field"><label>Sort order</label><input name="sortOrder" type="number" value="${Number(t.sortOrder)||0}"><div class="hint">Usually leave this alone. Lower numbers appear first when times match.</div></div><div class="modal-actions">${!m.isNew?`<button type="button" class="danger-btn" data-delete-task="${esc(t.id)}">Delete</button>`:''}<button type="button" class="ghost-btn" data-close>Cancel</button><button class="primary-btn" type="submit" ${state.saving?"disabled":""}>${state.saving?"Saving…":"Save task"}</button></div></form></div></div>`;
    }
    if(m.type==='person'){
      const p=m.item||{id:'',name:'',role:''}; return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div class="modal-title">${m.isNew?'Add person':'Edit person'}</div><button class="close-btn" data-close>×</button></div><form id="personForm"><input type="hidden" name="id" value="${esc(p.id)}"><div class="field"><label>Name</label><input name="name" value="${esc(p.name)}" required></div><div class="field"><label>Role</label><input name="role" value="${esc(p.role||'')}" placeholder="Bride, Groom, Maid of Honour…"></div><div class="modal-actions">${!m.isNew?`<button type="button" class="danger-btn" data-delete-person="${esc(p.id)}">Delete</button>`:''}<button type="button" class="ghost-btn" data-close>Cancel</button><button class="primary-btn" type="submit" ${state.saving?"disabled":""}>${state.saving?"Saving…":"Save person"}</button></div></form></div></div>`;
    }
    if(m.type==='vendor'){
      const v=m.item||{id:'',role:'',name:'',phone:'',email:'',notes:''}; return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div class="modal-title">${m.isNew?'Add vendor':'Edit vendor'}</div><button class="close-btn" data-close>×</button></div><form id="vendorForm"><input type="hidden" name="id" value="${esc(v.id)}"><div class="field"><label>Role</label><input name="role" value="${esc(v.role)}" required placeholder="Photographer"></div><div class="field"><label>Name</label><input name="name" value="${esc(v.name)}" required></div><div class="field"><label>Phone</label><input name="phone" value="${esc(v.phone||'')}" type="tel"></div><div class="field"><label>Email</label><input name="email" value="${esc(v.email||'')}" type="email"></div><div class="field"><label>Notes</label><textarea name="notes">${esc(v.notes||'')}</textarea></div><div class="modal-actions">${!m.isNew?`<button type="button" class="danger-btn" data-delete-vendor="${esc(v.id)}">Delete</button>`:''}<button type="button" class="ghost-btn" data-close>Cancel</button><button class="primary-btn" type="submit" ${state.saving?"disabled":""}>${state.saving?"Saving…":"Save vendor"}</button></div></form></div></div>`;
    }
    return '';
  }

  function render(){
    if(state.loading){app.innerHTML=`<div class="shell"><div class="header"><div class="eyebrow">Live Runsheet</div><div class="title">${esc(cfg.EVENT_TITLE||"The Wedding Day")}</div><div class="sample-note">${esc(cfg.EVENT_LABEL||"")}</div></div><div class="loading"><div class="spinner"></div><b>Connecting to the live schedule…</b><div class="loading-sub">First visits can take a few seconds. After this, the last synced runsheet opens instantly while Google refreshes in the background.</div></div></div>`;return;}
    const panel=state.tab==='runsheet'?renderRunsheet():state.tab==='people'?renderPeople():state.tab==='vendors'?renderVendors():renderAdmin();
    app.innerHTML=`<div class="shell">${renderHeader()}${renderTabs()}${panel}</div>${modalHtml()}`;
    bindEvents();
  }

  function bindEvents(){
    app.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;render();});
    app.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>toggleDone(b.dataset.toggle));
    app.querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>{state.selectedPerson=b.dataset.person;render();});
    app.querySelector('[data-action="refresh"]')?.addEventListener('click',()=>loadData(true));
    app.querySelector('[data-action="notifications"]')?.addEventListener('click',enableNotifications);
    app.querySelector('[data-action="admin"]')?.addEventListener('click',()=>{if(state.adminUnlocked){state.tab='admin';render();}else{state.modal={type:'unlock'};render();}});
    app.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{state.modal=null;render();});
    app.querySelector('[data-lock]')?.addEventListener('click',()=>{lockAdmin();state.tab='runsheet';render();});
    app.querySelector('[data-new-task]')?.addEventListener('click',()=>{const max=Math.max(0,...state.data.tasks.map(t=>Number(t.sortOrder)||0));state.modal={type:'task',isNew:true,item:{id:clientId('t'),time:'09:00',title:'',peopleIds:[],notes:'',sortOrder:max+10}};render();});
    app.querySelector('[data-new-person]')?.addEventListener('click',()=>{state.modal={type:'person',isNew:true,item:{id:clientId('p'),name:'',role:''}};render();});
    app.querySelector('[data-new-vendor]')?.addEventListener('click',()=>{state.modal={type:'vendor',isNew:true,item:{id:clientId('v'),role:'',name:'',phone:'',email:'',notes:''}};render();});
    app.querySelectorAll('[data-edit-task]').forEach(b=>b.onclick=()=>{state.modal={type:'task',item:state.data.tasks.find(x=>x.id===b.dataset.editTask)};render();});
    app.querySelectorAll('[data-edit-person]').forEach(b=>b.onclick=()=>{state.modal={type:'person',item:state.data.people.find(x=>x.id===b.dataset.editPerson)};render();});
    app.querySelectorAll('[data-edit-vendor]').forEach(b=>b.onclick=()=>{state.modal={type:'vendor',item:state.data.vendors.find(x=>x.id===b.dataset.editVendor)};render();});

    const unlockForm=app.querySelector('#unlockForm'); if(unlockForm)unlockForm.onsubmit=e=>{e.preventDefault();unlock(app.querySelector('#pinInput').value);};
    app.querySelectorAll('[data-select-person]').forEach(b=>b.onclick=()=>{b.classList.toggle('selected');const ids=[...app.querySelectorAll('[data-select-person].selected')].map(x=>x.dataset.selectPerson);app.querySelector('input[name="peopleIds"]').value=ids.join(',');});
    const tf=app.querySelector('#taskForm'); if(tf)tf.onsubmit=e=>{e.preventDefault();const f=new FormData(tf);saveAction('saveTask',{id:f.get('id')||'',time:f.get('time'),title:f.get('title'),peopleIds:String(f.get('peopleIds')||'').split(',').filter(Boolean),notes:f.get('notes')||'',sortOrder:Number(f.get('sortOrder')||0)},true,'Task saved');};
    const pf=app.querySelector('#personForm'); if(pf)pf.onsubmit=e=>{e.preventDefault();const f=new FormData(pf);saveAction('savePerson',{id:f.get('id')||'',name:f.get('name'),role:f.get('role')||''},true,'Person saved');};
    const vf=app.querySelector('#vendorForm'); if(vf)vf.onsubmit=e=>{e.preventDefault();const f=new FormData(vf);saveAction('saveVendor',{id:f.get('id')||'',role:f.get('role'),name:f.get('name'),phone:f.get('phone')||'',email:f.get('email')||'',notes:f.get('notes')||''},true,'Vendor saved');};
    app.querySelector('[data-delete-task]')?.addEventListener('click',e=>{if(confirm('Delete this task?'))saveAction('deleteTask',{id:e.currentTarget.dataset.deleteTask},true,'Task deleted');});
    app.querySelector('[data-delete-person]')?.addEventListener('click',e=>{if(confirm('Delete this person? They will also be removed from assigned tasks.'))saveAction('deletePerson',{id:e.currentTarget.dataset.deletePerson},true,'Person deleted');});
    app.querySelector('[data-delete-vendor]')?.addEventListener('click',e=>{if(confirm('Delete this vendor?'))saveAction('deleteVendor',{id:e.currentTarget.dataset.deleteVendor},true,'Vendor deleted');});
  }

  setInterval(()=>{const el=document.getElementById('liveClock');if(el)el.textContent=fmtClock(new Date());checkNotifications();},1000);
  setInterval(()=>{ if (!state.modal && !state.saving) loadData(true); }, Math.max(5000, Number(cfg.POLL_MS)||10000));
  const hasCache = readCache();
  if (hasCache) render();
  loadData(hasCache);
})();
