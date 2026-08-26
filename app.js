
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
    syncWarning: "",
    pendingDone: {},
    activeWrites: 0,
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
    settings: { eventTitle: cfg.EVENT_TITLE || "Wedding Day", eventLabel: cfg.EVENT_LABEL || "26 September 2026", remindersEnabled:"FALSE" }
  };

  function clientId(prefix) { const r=(globalThis.crypto && crypto.randomUUID)?crypto.randomUUID().replace(/-/g,"").slice(0,12):Date.now().toString(36)+Math.random().toString(36).slice(2,7); return prefix+r; }
  function esc(v="") { return String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
  function fmtTime(hhmm) { const [h,m] = (hhmm || "00:00").split(":").map(Number); const p=h>=12?"PM":"AM"; const h12=h%12===0?12:h%12; return `${h12}:${String(m).padStart(2,"0")} ${p}`; }
  function personInitials(person){
    const name=String(person?.name||'').trim();
    if(!name)return '?';
    return name.split(/\s+/).slice(0,2).map(x=>x.charAt(0).toUpperCase()).join('');
  }
  function resolveImageUrl(src){
    src=String(src||'').trim();
    if(!src)return '';
    // Absolute URLs remain untouched. Relative paths resolve against GitHub Pages.
    try{return new URL(src, window.location.href).href;}catch(e){return src;}
  }
  function personAvatar(person,sizeClass=''){
    if(!person)return '';
    const src=resolveImageUrl(person.imageUrl);
    const initials=personInitials(person);
    return `<span class="person-avatar ${sizeClass}" title="${esc(person.name||'')}">${src?`<img src="${esc(src)}" alt="${esc(person.name||'')}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">`:''}<span class="person-avatar-fallback"${src?' style="display:none"':''}>${esc(initials)}</span></span>`;
  }
  function personInline(person){return person?`${personAvatar(person,'small')}<span>${esc(person.name)}</span>`:'';}
  function fmtClock(d) { return d.toLocaleTimeString("en-AU", {hour:"numeric", minute:"2-digit", second:"2-digit", hour12:true}); }
  function compactEventLabel(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      const day = parsed.getDate();
      const month = parsed.toLocaleDateString("en-AU", {month:"short"}) === "Sep" ? "Sept" : parsed.toLocaleDateString("en-AU", {month:"short"});
      const year = String(parsed.getFullYear()).slice(-2);
      return `${day} ${month} ${year}`;
    }
    return raw.replace(/\s+\d{1,2}:\d{2}:\d{2}.*$/i, "").replace(/\s+GMT[+-]\d{4}.*$/i, "").trim();
  }
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
  v322SetSync('syncing');
    // Never let background polling race an active write. The optimistic UI remains
    // authoritative until Google has confirmed the write.
    if (silent && state.activeWrites > 0) return;
    if (state.syncing) return;
    state.syncing = true;
    if (!silent && !state.data.tasks.length && !state.data.people.length && !state.data.vendors.length) { state.loading = true; render(); }
    try {
      let incoming;
      if (cfg.USE_DEMO_DATA) incoming = structuredClone(demoData);
      else { const out = await api("getData"); incoming = out.data; }

      // Preserve a just-confirmed completion across Google's briefly stale cached reads.
      const nowMs = Date.now();
      for (const [id, guard] of Object.entries(state.pendingDone)) {
        const t = (incoming.tasks || []).find(x => x.id === id);
        if (!t || nowMs >= guard.until || t.done === guard.done) {
          delete state.pendingDone[id];
        } else {
          t.done = guard.done;
        }
      }

      state.data = incoming;
      state.lastSync = new Date(); v322SetSync('live'); v322PreloadPeople();
      state.error = "";
      state.syncWarning = "";
      writeCache();
    } catch (e) {
      if (silent && (state.data.tasks.length || state.data.people.length || state.data.vendors.length)) {
        state.syncWarning = e.message;
      } else {
        state.error = e.message;
      }
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
    state.lastSync = new Date(); v322SetSync('live'); v322PreloadPeople();
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
      // Let the normal poll reconcile manual Sheet edits; an immediate read can be stale.
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
    const previous = !!task.done;
    const desired = !previous;

    // Install the guard BEFORE rendering/sending. A getData request that was already
    // in flight is therefore unable to paint the old Sheet value back over this tap.
    state.pendingDone[id] = {done:desired, until:Date.now()+30000, phase:"writing"};
    state.activeWrites += 1;
    task.done = desired;
    state.celebratingTaskId = desired ? id : null;
    state.error = "";
    render();
    if (desired) setTimeout(()=>{ if(state.celebratingTaskId===id){ state.celebratingTaskId=null; render(); } }, 900);

    try {
      if(!cfg.USE_DEMO_DATA) {
        const out=await api("toggleDone",{id},false);
        const confirmed = typeof out.done === "boolean" ? out.done : desired;
        // loadData may have replaced state.data while this request was in flight, so
        // always re-find the CURRENT task object instead of mutating the old reference.
        const currentTask = state.data.tasks.find(t=>t.id===id);
        if(currentTask) currentTask.done = confirmed;
        state.pendingDone[id] = {done:confirmed, until:Date.now()+30000, phase:"confirmed"};
        state.lastSync=new Date(); v322SetSync('live'); v322PreloadPeople();
        state.syncWarning="";
        writeCache();
        render();
      } else {
        state.pendingDone[id] = {done:desired, until:Date.now()+3000, phase:"confirmed"};
        writeCache();
      }
    } catch(e){
      const currentTask = state.data.tasks.find(t=>t.id===id);
      if(currentTask) currentTask.done=previous;
      delete state.pendingDone[id];
      state.celebratingTaskId=null;
      state.error=e.message;
      render();
    } finally {
      state.activeWrites = Math.max(0, state.activeWrites - 1);
    }
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
    const live=sortedTasks().filter(t=>!t.done);
    const overdue=live.filter(t=>now>=timeToday(t.time,now));
    const upcoming=live.filter(t=>now<timeToday(t.time,now));
    // Keep the status dock focused on unfinished work. The oldest outstanding item
    // is "Now"; the next future task is "Next up". When Now is completed, the
    // following task immediately takes its place.
    return {now:overdue[0]||null,next:upcoming[0]||null};
  }


  /* V3.15 — calendar export, inside app scope */
  function icsEscape(v){return String(v==null?'':v).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}
  function icsStamp(d){const z=n=>String(n).padStart(2,'0');return d.getUTCFullYear()+z(d.getUTCMonth()+1)+z(d.getUTCDate())+'T'+z(d.getUTCHours())+z(d.getUTCMinutes())+z(d.getUTCSeconds())+'Z';}
  function calendarEffectiveDate(){
    const st=state.data.settings||{},tz=String(st.timezone||'Australia/Sydney');
    const test=String(st.reminderTestMode||'FALSE').toUpperCase()==='TRUE';
    if(test && String(st.reminderTestDate||'').match(/^\d{4}-\d{2}-\d{2}/)) return String(st.reminderTestDate).slice(0,10);
    if(test){
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
      const get=k=>parts.find(p=>p.type===k)?.value||''; return `${get('year')}-${get('month')}-${get('day')}`;
    }
    return String(st.eventDate||'2026-09-26').slice(0,10);
  }
  function zonedLocalToUtc(dateStr,timeStr,timeZone){
    const [Y,M,D]=dateStr.split('-').map(Number),[h,m]=String(timeStr||'00:00').split(':').map(Number);
    let guess=Date.UTC(Y,M-1,D,h,m,0);
    // Iterate offset using Intl so DST and Australia/Sydney are handled correctly.
    for(let n=0;n<3;n++){
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));
      const get=k=>Number(parts.find(p=>p.type===k)?.value||0);
      const rendered=Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'));
      const wanted=Date.UTC(Y,M-1,D,h,m); guess += wanted-rendered;
    }
    return new Date(guess);
  }
  function buildWeddingIcs(personId,includeAlerts){
    const st=state.data.settings||{},tz=String(st.timezone||'Australia/Sydney'),date=calendarEffectiveDate();
    const person=personId==='all'?null:state.data.people.find(p=>p.id===personId);
    const tasks=state.data.tasks.filter(t=>personId==='all'||(t.peopleIds||[]).includes(personId)).slice().sort((a,b)=>String(a.time).localeCompare(String(b.time)));
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//JC Wedding Runsheet//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:'+icsEscape(person?`Jennifer & Charlie - ${person.name}`:'Jennifer & Charlie - Wedding Day')];
    tasks.forEach(t=>{
      const start=zonedLocalToUtc(date,t.time,tz),end=new Date(start.getTime()+30*60000);
      const assigned=(t.peopleIds||[]).map(id=>personMap()[id]).filter(Boolean).map(p=>p.name);
      const desc=[t.notes||'',assigned.length?'Assigned: '+assigned.join(', '):''].filter(Boolean).join('\n');
      lines.push('BEGIN:VEVENT','UID:'+icsEscape(`jc-${date}-${t.id}@wedding-runsheet`),'DTSTAMP:'+icsStamp(new Date()),'DTSTART:'+icsStamp(start),'DTEND:'+icsStamp(end),'SUMMARY:'+icsEscape(t.title||'Wedding task'));
      if(desc)lines.push('DESCRIPTION:'+icsEscape(desc));
      if(includeAlerts){
        [...new Set((t.reminderMinutes||[]).map(Number).filter(n=>Number.isFinite(n)&&n>=0))].forEach(n=>{
          lines.push('BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+icsEscape(t.title||'Wedding task'),n===0?'TRIGGER:PT0M':'TRIGGER:-PT'+Math.round(n)+'M','END:VALARM');
        });
      }
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return {text:lines.join('\r\n')+'\r\n',count:tasks.length,date,testMode:String(st.reminderTestMode||'FALSE').toUpperCase()==='TRUE',person};
  }
  async function deliverWeddingCalendar(personId,includeAlerts){
    const built=buildWeddingIcs(personId,includeAlerts);
    if(!built.count){alert('No runsheet tasks are assigned to this selection.');return;}
    const who=personId==='all'?'everyone':(built.person?.name||'wedding');
    const filename=('JC-Wedding-'+who).replace(/[^a-z0-9_-]+/gi,'-')+'.ics';
    const file=new File([built.text],filename,{type:'text/calendar;charset=utf-8'});
    // iPhone/iPad: native share sheet is much more reliable than synthetic downloads.
    if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
      try{await navigator.share({files:[file],title:'Jennifer & Charlie Wedding Schedule'});return;}catch(e){if(e?.name==='AbortError')return;}
    }
    const url=URL.createObjectURL(file);
    const a=document.createElement('a');
    a.href=url;a.download=filename;a.textContent='Open calendar file';
    a.className='calendar-download-fallback';
    document.body.appendChild(a);
    try{a.click();}catch(e){}
    setTimeout(()=>{try{a.remove();URL.revokeObjectURL(url);}catch(e){}},30000);
  }
  function openCalendarModal(){
    document.getElementById('calendarModal')?.remove();
    const people=(state.data.people||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));
    const m=document.createElement('div');m.id='calendarModal';m.className='calendar-modal-backdrop';
    m.innerHTML=`<div class="calendar-modal"><button class="calendar-close">×</button><div class="calendar-kicker">26 SEPT 26</div><h2>Add My Schedule</h2><p class="calendar-sub">Subscribe once and keep your personal wedding schedule in Calendar.</p><div id="calendarModeBanner"></div><label class="calendar-label">Schedule for</label><select id="calendarPerson"><option value="all">Everyone — full wedding runsheet</option>${people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.role||'')}</option>`).join('')}</select><div id="calendarSummary" class="calendar-summary"></div><a id="appleSubscribe" class="calendar-primary calendar-link-primary" href="#"> Subscribe in Apple Calendar</a><button id="copyCalendarUrl" class="calendar-secondary">Copy calendar URL for Google Calendar</button><button id="testCalendarFeed" class="calendar-secondary">Test live calendar feed</button><button id="calendarDownload" class="calendar-tertiary">Download .ics snapshot</button><p class="calendar-note"><b>Apple:</b> tap Subscribe and confirm the calendar subscription.<br><br><b>Google:</b> copy the URL and add it under Other calendars → From URL on Google Calendar web.<br><br>Pushover remains the immediate live-alert system for last-minute changes.</p></div>`;
    document.body.appendChild(m);
    const s=state.data.settings||{},testMode=String(s.reminderTestMode||'FALSE').toUpperCase()==='TRUE',banner=m.querySelector('#calendarModeBanner');
    banner.className=testMode?'calendar-test-banner':'calendar-live-banner';
    banner.innerHTML=testMode?'🧪 <strong>TEST MODE</strong><br>The live calendar feed currently uses your test date.':'💍 <strong>LIVE WEDDING DATE</strong><br>The live calendar feed uses 26 Sept 2026.';
    const sel=m.querySelector('#calendarPerson'),sum=m.querySelector('#calendarSummary');
    const upd=()=>{const id=sel.value,p=id==='all'?null:people.find(x=>x.id===id),ts=(state.data.tasks||[]).filter(t=>id==='all'||(t.peopleIds||[]).includes(id)),times=ts.map(t=>t.time).filter(Boolean).sort();sum.innerHTML=`${p?personAvatar(p):''}<strong>${ts.length} task${ts.length===1?'':'s'}</strong>${times.length?` · ${fmtTime(times[0])}–${fmtTime(times[times.length-1])}`:''}`;};
    const feedUrl=()=>{
      const base=String(cfg.API_URL||'').trim();
      if(!base||base.includes('PASTE_YOUR'))throw new Error('Google Apps Script URL is not configured in config.js.');
      return base+(base.includes('?')?'&':'?')+'calendar='+encodeURIComponent(sel.value);
    };
    const appleLink=m.querySelector('#appleSubscribe');
    const updateCalendarLinks=()=>{
      try{
        const u=feedUrl();
        appleLink.href=u.replace(/^https?:\/\//i,'webcal://');
        appleLink.removeAttribute('aria-disabled');
      }catch(err){
        appleLink.href='#';
        appleLink.setAttribute('aria-disabled','true');
      }
    };
    sel.onchange=()=>{upd();updateCalendarLinks();};
    upd();
    updateCalendarLinks();
    m.querySelector('.calendar-close').onclick=()=>m.remove();m.onclick=e=>{if(e.target===m)m.remove();};
    appleLink.addEventListener('click',e=>{
      if(appleLink.getAttribute('aria-disabled')==='true'){
        e.preventDefault();
        try{feedUrl();}catch(err){alert('Could not open Apple Calendar: '+(err?.message||err));}
      }
    });
    m.querySelector('#copyCalendarUrl').onclick=async()=>{
      let u;
      try{u=feedUrl();}catch(err){alert(err?.message||String(err));return;}
      try{
        await navigator.clipboard.writeText(u);
        const b=m.querySelector('#copyCalendarUrl');
        b.textContent='✓ Calendar URL copied';
        setTimeout(()=>b.textContent='Copy calendar URL for Google Calendar',1800);
      }catch(e){
        prompt('Copy this calendar URL:',u);
      }
    };
    m.querySelector('#testCalendarFeed').onclick=()=>{
      try{
        const u=feedUrl();
        const w=window.open(u,'_blank');
        if(!w) location.href=u;
      }catch(err){alert(err?.message||String(err));}
    };
    m.querySelector('#calendarDownload').onclick=async()=>{
      try{await deliverWeddingCalendar(sel.value,true);}
      catch(err){alert('Could not create calendar file: '+(err?.message||err));}
    };
  }

  
function sortTasksByTime(tasks){
  return (tasks||[]).slice().sort((a,b)=>
    String(a.time||'').localeCompare(String(b.time||'')) ||
    (Number(a.sortOrder||0)-Number(b.sortOrder||0)) ||
    String(a.title||'').localeCompare(String(b.title||'')) ||
    String(a.id||'').localeCompare(String(b.id||''))
  );
}


function v322SyncText(status){
  if(status==='syncing')return 'Syncing…';
  if(status==='delayed')return 'Sync delayed — showing saved copy';
  if(status==='offline')return 'Offline — showing saved copy';
  return 'Live';
}
function v322SetSync(status){
  state.v322Sync=status||'live';
  const el=document.getElementById('syncBadge');
  if(!el)return;
  el.className='sync-badge sync-'+state.v322Sync;
  const last=state.lastSync instanceof Date ? ' · '+fmtClock(state.lastSync) : '';
  el.textContent=v322SyncText(state.v322Sync)+(state.v322Sync==='live'?last:'');
}
function v322PreloadPeople(){
  (state.data?.people||[]).forEach(p=>{
    const src=String(p.imageUrl||'').trim();
    if(!src)return;
    const im=new Image();im.decoding='async';im.src=src;
  });
}

function renderHeader(){
    const now=new Date(), ctx=currentContext(now), overdue=state.data.tasks.filter(t=>status(t,now)==="overdue").length;
    const settings=state.data.settings||{}, label=compactEventLabel(settings.eventLabel||cfg.EVENT_LABEL||"");
    const remindersOn=String(settings.remindersEnabled||"").toUpperCase()==="TRUE";
    const nextMinutes = ctx.next ? Math.max(0, Math.round((timeToday(ctx.next.time, now)-now)/60000)) : null;
    const nextTone = nextMinutes === null ? "" : nextMinutes <= 5 ? "next-imminent" : nextMinutes <= 15 ? "next-near" : nextMinutes <= 30 ? "next-warming" : "next-soft";
    return `
      <div class="header">
        <div class="header-top">
          <div class="masthead-copy"><div class="couple-line">Jennifer and Charlie's</div><div class="title">Wedding Day</div><div class="sample-note">${esc(label)}</div></div>
        </div>
        <div class="hero-divider"><span>✦</span></div>
        <div class="header-meta icon-controls">
          <button class="header-chip control-icon" data-action="refresh" title="Refresh runsheet" aria-label="Refresh runsheet">↻</button>
          <button class="header-chip control-icon calendar-date-icon" data-action="calendar" title="Add wedding schedule to calendar" aria-label="Add wedding schedule to calendar"><span class="calendar-date-top">SEP</span><span class="calendar-date-day">26</span></button>
          <button class="header-chip control-icon ${remindersOn?"on":""}" data-action="reminders" title="Wedding reminders" aria-label="Wedding reminders">🔔</button>
          <button class="header-chip control-icon ${state.adminUnlocked?"unlocked":""}" data-action="admin" title="${state.adminUnlocked?"Edit mode unlocked":"Unlock edit mode"}" aria-label="${state.adminUnlocked?"Edit mode unlocked":"Unlock edit mode"}">${state.adminUnlocked?"🔓":"🔒"}</button>
        </div>
        <div class="sync-text ${state.syncWarning?"sync-warning":""}">${state.syncing?"Syncing with Google Sheet…":state.syncWarning?"Sync delayed — showing last saved copy":state.lastSync?`Last synced ${state.lastSync.toLocaleTimeString("en-AU", {hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true})}`:"Connecting to Google Sheet…"}</div>
      </div>
      <div class="status-dock">
        <div class="dock-clock"><span class="clock-label">CURRENT TIME</span><span id="liveClock">${fmtClock(now)}</span></div>
        <div class="dock-context">
          ${ctx.now?`<div class="dock-now now-bling"><span>NOW</span><strong>${esc(ctx.now.title)}</strong><em>${fmtTime(ctx.now.time)}</em></div>`:`<div class="dock-now dock-clear"><span>NOW</span><strong>Nothing outstanding</strong></div>`}
          ${ctx.next?`<div class="dock-next ${nextTone}"><span>NEXT UP</span><strong>${esc(ctx.next.title)}</strong><em>${fmtTime(ctx.next.time)}</em></div>`:""}
        </div>
      </div>
      ${overdue?`<div class="overdue-banner">⚠ ${overdue} task${overdue===1?"":"s"} outstanding</div>`:""}
      ${state.error?`<div class="error-banner">⚠ ${esc(state.error)}</div>`:""}
      ${state.success?`<div class="success-banner">✓ ${esc(state.success)}</div>`:""}`;
  }

  function renderTabs(){
    const tabs=[['runsheet','☷','Runsheet'],['people','♙','My Tasks'],['vendors','▣','Vendors']];
    return `<div class="tabs">${tabs.map(([id,ic,l])=>`<button class="tab ${state.tab===id?'active':''}" data-tab="${id}">${ic} ${l}</button>`).join('')}</div>`;
  }

  function taskCard(t, compact=false, stackIndex=0){
    const s=status(t), pm=personMap(), assignedPeople=(t.peopleIds||[]).map(id=>pm[id]).filter(Boolean), names=assignedPeople.map(p=>p.name).join(', '), peopleHtml=assignedPeople.map(p=>`<span class="task-person">${personInline(p)}</span>`).join('');
    const celebration = state.celebratingTaskId === t.id ? " just-completed" : "";
    if(compact){
      return `<button class="completed-inline-card" data-restore="${esc(t.id)}" title="Completed — tap to restore"><span class="stack-check">✓</span><span class="stack-time">${fmtTime(t.time)}</span><span class="stack-main"><span class="stack-title">${esc(t.title)}</span>${names?`<span class="stack-who">${assignedPeople.slice(0,4).map(p=>personAvatar(p,'micro')).join('')}<span>${esc(names)}</span></span>`:''}</span><span class="stack-back">↶</span></button>`;
    }
    return `<div class="item ${s}${celebration}"><div class="marker"><span class="dot">${s==='complete'?'✓':''}</span></div><div class="card"><div class="item-time">${fmtTime(t.time)}</div><div class="item-title">${esc(t.title)}</div>${peopleHtml?`<div class="item-who people-with-faces">${peopleHtml}</div>`:''}${t.notes?`<div class="item-notes">${esc(t.notes)}</div>`:''}${s==='overdue'?`<div class="status">⚠ Outstanding</div>`:''}<div><button class="check-btn" data-toggle="${esc(t.id)}">Mark done</button></div><span class="card-ornament"></span></div></div>`;
  }

  function dayTimeline(tasks){
    // Preserve chronological context for the whole day. Completed tasks collapse
    // in-place, while unfinished/upcoming tasks remain full cards. Consecutive
    // completed tasks overlap slightly to form a readable stack.
    let previousDone=false;
    return `<div class="timeline day-timeline">${tasks.map(t=>{
      if(t.done){
        const cls=previousDone?' completed-wrap stacked':' completed-wrap';
        previousDone=true;
        return `<div class="${cls}">${taskCard(t,true)}</div>`;
      }
      previousDone=false;
      return `<div class="live-wrap">${taskCard(t)}</div>`;
    }).join('')}</div>`;
  }

  function renderRunsheet(){
    const tasks=sortedTasks();
    if(!tasks.length) return `<div class="panel"><div class="empty">No tasks have been added yet.</div></div>`;
    return `<div class="panel"><div class="day-overview-note"><span>Full day schedule</span><small>Completed tasks collapse but stay in their original time position. Tap one to restore it.</small></div>${dayTimeline(tasks)}</div>`;
  }
  function renderPeople(){
    const p=state.data.people, selected=state.selectedPerson, tasks=selected?sortedTasks().filter(t=>(t.peopleIds||[]).includes(selected)):[];
    return `<div class="panel"><div class="pills">${p.map(x=>`<button class="pill person-pill ${selected===x.id?'active':''}" data-person="${esc(x.id)}">${personAvatar(x)}<span class="person-pill-copy"><span>${esc(x.name)}</span><span class="pill-role">${esc(x.role||'')}</span></span></button>`).join('')}</div>${!selected?`<div class="empty">Tap a name to see that person's tasks<br>and what time they need to happen.</div>`:tasks.length?`<div class="day-overview-note"><span>${esc(personMap()[selected]?.name||'My')} · full day</span><small>Completed tasks stay visible in the schedule.</small></div>${dayTimeline(tasks)}`:`<div class="empty">No tasks assigned yet.</div>`}</div>`;
  }
  function renderVendors(){
    return `<div class="panel">${state.data.vendors.length?state.data.vendors.map(v=>`<div class="vendor-card"><div class="vendor-role">${esc(v.role)}</div><div class="vendor-name">${esc(v.name)}</div><div class="vendor-actions">${v.phone?`<a class="vendor-link" href="tel:${esc(v.phone)}">☎ ${esc(v.phone)}</a>`:''}${v.email?`<a class="vendor-link" href="mailto:${esc(v.email)}">✉ ${esc(v.email)}</a>`:''}</div>${v.notes?`<div class="vendor-notes">${esc(v.notes)}</div>`:''}</div>`).join(''):`<div class="empty">No vendors have been added yet.</div>`}</div>`;
  }

  function adminRows(type, items){
    if(!items.length)return `<div class="empty">Nothing added yet.</div>`;
    return items.map(x=>{
      const lead=type==='task'?fmtTime(x.time):(type==='vendor'?esc(x.role):esc(x.role||''));
      const title=type==='task'?x.title:x.name;
      const avatar=type==='person'?personAvatar(x):'';
      const sub=type==='task'?((x.peopleIds||[]).map(id=>personMap()[id]?.name).filter(Boolean).join(', ')||'No people assigned'):(type==='vendor'?(x.phone||x.email||'No contact details'):`ID: ${x.id}`);
      return `<div class="admin-row"><div class="admin-row-sub">${lead}</div><div class="admin-row-main">${avatar}<div class="admin-row-title">${esc(title)}</div><div class="admin-row-sub">${esc(sub)}</div></div><div class="admin-row-actions"><button class="small-action" data-edit-${type}="${esc(x.id)}">Edit</button></div></div>`;
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
    if(m.type==='reminders'){
      const settings=state.data.settings||{};
      const enabled=String(settings.remindersEnabled||"").toUpperCase()==="TRUE";
      const connected=state.data.people.filter(p=>p.pushoverConnected).length;
      const configured=state.data.tasks.filter(t=>(t.reminderMinutes||[]).length).length;
      return `<div class="modal-backdrop"><div class="modal reminder-modal"><div class="modal-head"><div class="modal-title">Wedding reminders</div><button class="close-btn" data-close>×</button></div>
        <div class="reminder-status ${enabled?"ready":"off"}"><span>${enabled?"●":"○"}</span><div><b>${enabled?"Automatic reminders are active":"Automatic reminders are not active yet"}</b><small>${enabled?"Google Apps Script checks the runsheet every minute.":"Complete the Apps Script reminder setup to turn them on."}</small></div></div>
        <div class="reminder-stats"><div><strong>${connected}</strong><span>devices assigned</span></div><div><strong>${configured}</strong><span>tasks with reminders</span></div></div>
        <div class="reminder-copy">Reminder timing comes from the <b>Tasks</b> sheet and each recipient's device name comes from the <b>People</b> sheet. Example: <b>30,10,0</b> sends 30 minutes before, 10 minutes before and at the task time.</div>
        ${state.adminUnlocked?`<div class="reminder-admin"><b>Admin tools</b>${state.data.people.filter(p=>p.pushoverConnected).length?`<select id="testReminderPerson">${state.data.people.filter(p=>p.pushoverConnected).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select><button class="primary-btn" data-test-reminder>Send test notification</button>`:`<div class="hint">Assign a Pushover device name to a person first.</div>`}</div>`:""}
        <div class="modal-actions"><button class="primary-btn" data-close>Done</button></div>
      </div></div>`;
    }
    if(m.type==='unlock')return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div class="modal-title">Edit mode</div><button class="close-btn" data-close>×</button></div>${unlockBox()}</div></div>`;
    if(m.type==='task'){
      const t=m.item||{id:'',time:'09:00',title:'',peopleIds:[],notes:'',sortOrder:(sortedTasks().length+1)*10,reminderMinutes:[],reminderPriority:'normal'};
      return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div class="modal-title">${m.isNew?'Add task':'Edit task'}</div><button class="close-btn" data-close>×</button></div><form id="taskForm"><input type="hidden" name="id" value="${esc(t.id)}"><div class="field"><label>Time</label><input name="time" type="time" value="${esc(t.time)}" required></div><div class="field"><label>Task</label><input name="title" value="${esc(t.title)}" required></div><div class="field"><label>Assigned people</label><div class="multi-select">${state.data.people.map(p=>`<button type="button" class="select-chip ${(t.peopleIds||[]).includes(p.id)?'selected':''}" data-select-person="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div><input type="hidden" name="peopleIds" value="${esc((t.peopleIds||[]).join(','))}"></div><div class="field"><label>Notes</label><textarea name="notes">${esc(t.notes||'')}</textarea></div>
      <div class="field"><label>Reminder minutes</label><input name="reminderMinutes" value="${esc((t.reminderMinutes||[]).join(','))}" placeholder="30,10,0"><div class="hint">Comma-separated minutes before the task. Use 0 for “due now”. Leave blank for no Pushover reminder.</div></div>
      <div class="field"><label>Reminder priority</label><select name="reminderPriority"><option value="normal" ${(t.reminderPriority||'normal')==='normal'?'selected':''}>Normal</option><option value="high" ${t.reminderPriority==='high'?'selected':''}>High</option><option value="emergency" ${t.reminderPriority==='emergency'?'selected':''}>Emergency — repeats until acknowledged/expired</option><option value="low" ${t.reminderPriority==='low'?'selected':''}>Low</option></select></div>
      <div class="field"><label>Sort order</label><input name="sortOrder" type="number" value="${Number(t.sortOrder)||0}"><div class="hint">Usually leave this alone. Lower numbers appear first when times match.</div></div><div class="modal-actions">${!m.isNew?`<button type="button" class="danger-btn" data-delete-task="${esc(t.id)}">Delete</button>`:''}<button type="button" class="ghost-btn" data-close>Cancel</button><button class="primary-btn" type="submit" ${state.saving?"disabled":""}>${state.saving?"Saving…":"Save task"}</button></div></form></div></div>`;
    }
    if(m.type==='person'){
      const p=m.item||{id:'',name:'',role:'',pushoverDevice:'',
      imageUrl: String(fd.get('imageUrl')||'').trim()}; return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div class="modal-title">${m.isNew?'Add person':'Edit person'}</div><button class="close-btn" data-close>×</button></div><form id="personForm"><input type="hidden" name="id" value="${esc(p.id)}"><div class="field"><label>Name</label><input name="name" value="${esc(p.name)}" required></div><div class="field"><label>Role</label><input name="role" value="${esc(p.role||'')}" placeholder="Bride, Groom, Maid of Honour…"></div>
      <div class="field"><label>Pushover device name</label><input name="pushoverDevice" value="${esc(p.pushoverDevice||'')}" autocomplete="off" placeholder="jennifer"><label>Photo URL / path</label><input name="imageUrl" value="${esc(p.imageUrl||'')}" placeholder="images/people/charlie.jpg"><div class="hint">Use the exact device name registered in the shared Pushover account, for example <b>jennifer</b>, <b>charlie</b> or <b>mc</b>. All devices share one Pushover account/User Key; this field chooses which phone receives this person's reminders.</div></div>
      <div class="modal-actions">${!m.isNew?`<button type="button" class="danger-btn" data-delete-person="${esc(p.id)}">Delete</button>`:''}<button type="button" class="ghost-btn" data-close>Cancel</button><button class="primary-btn" type="submit" ${state.saving?"disabled":""}>${state.saving?"Saving…":"Save person"}</button></div></form></div></div>`;
    }
    if(m.type==='vendor'){
      const v=m.item||{id:'',role:'',name:'',phone:'',email:'',notes:''}; return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div class="modal-title">${m.isNew?'Add vendor':'Edit vendor'}</div><button class="close-btn" data-close>×</button></div><form id="vendorForm"><input type="hidden" name="id" value="${esc(v.id)}"><div class="field"><label>Role</label><input name="role" value="${esc(v.role)}" required placeholder="Photographer"></div><div class="field"><label>Name</label><input name="name" value="${esc(v.name)}" required></div><div class="field"><label>Phone</label><input name="phone" value="${esc(v.phone||'')}" type="tel"></div><div class="field"><label>Email</label><input name="email" value="${esc(v.email||'')}" type="email"></div><div class="field"><label>Notes</label><textarea name="notes">${esc(v.notes||'')}</textarea></div><div class="modal-actions">${!m.isNew?`<button type="button" class="danger-btn" data-delete-vendor="${esc(v.id)}">Delete</button>`:''}<button type="button" class="ghost-btn" data-close>Cancel</button><button class="primary-btn" type="submit" ${state.saving?"disabled":""}>${state.saving?"Saving…":"Save vendor"}</button></div></form></div></div>`;
    }
    return '';
  }

  function render(){
    if(state.loading){app.innerHTML=`<div class="shell"><div class="header"><div class="masthead-copy"><div class="couple-line">Jennifer and Charlie's</div><div class="title">Wedding Day</div><div class="sample-note">${esc(compactEventLabel(cfg.EVENT_LABEL||""))}</div></div></div><div class="loading"><div class="spinner"></div><b>Connecting to the live schedule…</b><div class="loading-sub">First visits can take a few seconds. After this, the last synced runsheet opens instantly while Google refreshes in the background.</div></div></div>`;return;}
    const panel=state.tab==='runsheet'?renderRunsheet():state.tab==='people'?renderPeople():state.tab==='vendors'?renderVendors():renderAdmin();
    app.innerHTML=`<div class="shell">${renderHeader()}${renderTabs()}${panel}</div>${modalHtml()}`;
    bindEvents();
  }

  function bindEvents(){
    app.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;render();});
    app.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>toggleDone(b.dataset.toggle));
    app.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>toggleDone(b.dataset.restore));
    app.querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>{state.selectedPerson=b.dataset.person;render();});
    app.querySelector('[data-action="refresh"]')?.addEventListener('click',()=>loadData(true));
    app.querySelector('[data-action="calendar"]')?.addEventListener('click',openCalendarModal);
    app.querySelector('[data-action="reminders"]')?.addEventListener('click',()=>{state.modal={type:'reminders'};render();});
    app.querySelector('[data-action="admin"]')?.addEventListener('click',()=>{if(state.adminUnlocked){state.tab='admin';render();}else{state.modal={type:'unlock'};render();}});
    app.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{state.modal=null;render();});
    app.querySelector('[data-test-reminder]')?.addEventListener('click',async()=>{const sel=app.querySelector('#testReminderPerson');if(!sel)return;const personId=sel.value;try{state.saving=true;await api('sendTestReminder',{personId},true);state.modal=null;state.success='Test notification sent';render();setTimeout(()=>{if(state.success==='Test notification sent'){state.success='';render();}},2500);}catch(e){state.error=e.message;render();}finally{state.saving=false;}});
    app.querySelector('[data-lock]')?.addEventListener('click',()=>{lockAdmin();state.tab='runsheet';render();});
    app.querySelector('[data-new-task]')?.addEventListener('click',()=>{const max=Math.max(0,...state.data.tasks.map(t=>Number(t.sortOrder)||0));state.modal={type:'task',isNew:true,item:{id:clientId('t'),time:'09:00',title:'',peopleIds:[],notes:'',sortOrder:max+10,reminderMinutes:[],reminderPriority:'normal'}};render();});
    app.querySelector('[data-new-person]')?.addEventListener('click',()=>{state.modal={type:'person',isNew:true,item:{id:clientId('p'),name:'',role:'',pushoverDevice:'',imageUrl:''}};render();});
    app.querySelector('[data-new-vendor]')?.addEventListener('click',()=>{state.modal={type:'vendor',isNew:true,item:{id:clientId('v'),role:'',name:'',phone:'',email:'',notes:''}};render();});
    app.querySelectorAll('[data-edit-task]').forEach(b=>b.onclick=()=>{state.modal={type:'task',item:state.data.tasks.find(x=>x.id===b.dataset.editTask)};render();});
    app.querySelectorAll('[data-edit-person]').forEach(b=>b.onclick=()=>{state.modal={type:'person',item:state.data.people.find(x=>x.id===b.dataset.editPerson)};render();});
    app.querySelectorAll('[data-edit-vendor]').forEach(b=>b.onclick=()=>{state.modal={type:'vendor',item:state.data.vendors.find(x=>x.id===b.dataset.editVendor)};render();});

    const unlockForm=app.querySelector('#unlockForm'); if(unlockForm)unlockForm.onsubmit=e=>{e.preventDefault();unlock(app.querySelector('#pinInput').value);};
    app.querySelectorAll('[data-select-person]').forEach(b=>b.onclick=()=>{b.classList.toggle('selected');const ids=[...app.querySelectorAll('[data-select-person].selected')].map(x=>x.dataset.selectPerson);app.querySelector('input[name="peopleIds"]').value=ids.join(',');});
    const tf=app.querySelector('#taskForm'); if(tf)tf.onsubmit=e=>{e.preventDefault();const f=new FormData(tf);saveAction('saveTask',{id:f.get('id')||'',time:f.get('time'),title:f.get('title'),peopleIds:String(f.get('peopleIds')||'').split(',').filter(Boolean),notes:f.get('notes')||'',sortOrder:Number(f.get('sortOrder')||0),reminderMinutes:String(f.get('reminderMinutes')||'').split(',').map(x=>Number(x.trim())).filter(x=>Number.isFinite(x)&&x>=0),reminderPriority:f.get('reminderPriority')||'normal'},true,'Task saved');};
    const pf=app.querySelector('#personForm'); if(pf)pf.onsubmit=e=>{e.preventDefault();const f=new FormData(pf);saveAction('savePerson',{id:f.get('id')||'',name:f.get('name'),role:f.get('role')||'',pushoverDevice:f.get('pushoverDevice')||'',imageUrl:String(f.get('imageUrl')||'').trim()},true,'Person saved');};
    const vf=app.querySelector('#vendorForm'); if(vf)vf.onsubmit=e=>{e.preventDefault();const f=new FormData(vf);saveAction('saveVendor',{id:f.get('id')||'',role:f.get('role'),name:f.get('name'),phone:f.get('phone')||'',email:f.get('email')||'',notes:f.get('notes')||''},true,'Vendor saved');};
    app.querySelector('[data-delete-task]')?.addEventListener('click',e=>{if(confirm('Delete this task?'))saveAction('deleteTask',{id:e.currentTarget.dataset.deleteTask},true,'Task deleted');});
    app.querySelector('[data-delete-person]')?.addEventListener('click',e=>{if(confirm('Delete this person? They will also be removed from assigned tasks.'))saveAction('deletePerson',{id:e.currentTarget.dataset.deletePerson},true,'Person deleted');});
    app.querySelector('[data-delete-vendor]')?.addEventListener('click',e=>{if(confirm('Delete this vendor?'))saveAction('deleteVendor',{id:e.currentTarget.dataset.deleteVendor},true,'Vendor deleted');});
  }

  setInterval(()=>{const el=document.getElementById('liveClock');if(el)el.textContent=fmtClock(new Date());},1000);
  setInterval(()=>{ if (!state.modal && !state.saving) loadData(true); }, Math.max(5000, Number(cfg.POLL_MS)||10000));
  const hasCache = readCache();
  if (hasCache) render();
  loadData(hasCache);
})();

document.addEventListener('click',e=>{
  const b=e.target.closest('button');
  if(!b)return;
  const t=(b.textContent||'').trim().toLowerCase();
  if(t==='mark done'||t==='mark not done'||t==='undo'){
    b.classList.add('v322TapFeedback');
    setTimeout(()=>b.classList.remove('v322TapFeedback'),220);
  }
});

document.addEventListener('DOMContentLoaded',()=>setTimeout(v322PreloadPeople,1200));
