"use strict";
const el = id => document.getElementById(id);
const angles = ["正立面", "侧立面", "背立面", "入口铭牌", "转角", "细部", "周边"];
const directions = ["未记录", "北", "东北", "东", "东南", "南", "西南", "西", "西北"];
const mapWidth = 2014, mapHeight = 941;
let places = [], current, records = [], db, angle = angles[0], zoom = 1;
let watch = null, lastFix = null, shot = null, edited = null, busy = false, messageTimer;
let journalUrls = [], downloadUrls = [], editUrl;
const getPlace = id => places.find(p => p.index === Number(id));
const option = (label, value = label) => new Option(label, value);
const formattedTime = value => new Date(value).toLocaleString("zh-CN", {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("class","ic"); svg.setAttribute("aria-hidden","true");
  const use = document.createElementNS(svg.namespaceURI,"use");
  use.setAttribute("href",`assets/icons.svg#${name}`); svg.append(use);
  return svg;
}
document.querySelectorAll("[data-icon]").forEach(n => {
  const svg = icon(n.dataset.icon);
  if (n.classList.contains("brandmark")) n.append(svg); else n.replaceWith(svg);
});
function node(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function notice(text) {
  el("notice").textContent=text; el("notice").hidden=false;
  clearTimeout(messageTimer); messageTimer=setTimeout(()=>el("notice").hidden=true,4800);
}
function openDb() {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open("guc-fieldbook",1);
    req.onupgradeneeded=()=>{
      req.result.createObjectStore("records",{keyPath:"id"});
      req.result.createObjectStore("files");
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
function read(store, id) {
  return new Promise((resolve,reject)=>{
    const table=db.transaction(store).objectStore(store);
    const req=id===undefined ? table.getAll() : table.get(id);
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
function change(record, file, remove=false) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(["records","files"],"readwrite");
    tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error || Error("写入失败"));
    const meta=tx.objectStore("records"), blobs=tx.objectStore("files");
    if (remove) {meta.delete(record.id); blobs.delete(record.id);}
    else {meta.put(record); if (file) blobs.put(file, record.id);}
  });
}
function free(urls) {urls.forEach(URL.revokeObjectURL); urls.length=0;}
function setMode(journal) {
  el("field").hidden=journal; el("journal").hidden=!journal;
  el(journal?"journal-tab":"map-tab").setAttribute("aria-current","page");
  el(journal?"map-tab":"journal-tab").removeAttribute("aria-current");
  if(journal) renderJournal(); else sizeMap();
  window.scrollTo(0,0);
}
function selectPlace(id, center=false) {
  const next=getPlace(id);
  if (current && current.index!==next.index) {el("notes").value=""; el("direction").selectedIndex=0;}
  current=next;
  el("site-name").textContent=current.name;
  el("site-group").textContent=[current.section,current.number && `${current.number} 号楼`].filter(Boolean).join(" · ");
  el("detail-image").src=current.image; el("detail-image").alt=`${current.name}模型参考`;
  markers();
  if (center) centerOn(current.uv);
}
function centerOn(uv) {
  const scroll=el("map-scroll"), plane=el("plane");
  scroll.scrollLeft=uv[0]/mapWidth*plane.offsetWidth-scroll.clientWidth/2;
  scroll.scrollTop=uv[1]/mapHeight*plane.offsetHeight-scroll.clientHeight/2;
}
function sizeMap(focus) {
  const sc=el("map-scroll"), plane=el("plane");
  if (!sc.clientWidth) return;
  const w=Math.max(sc.clientWidth,sc.clientHeight*mapWidth/mapHeight)*zoom;
  plane.style.width=`${w}px`; plane.style.height=`${w*mapHeight/mapWidth}px`;
  centerOn(focus || current?.uv || [mapWidth/2,mapHeight/2]); markers();
}
function changeZoom(step) {
  const sc=el("map-scroll"), plane=el("plane");
  const uv=[(sc.scrollLeft+sc.clientWidth/2)/plane.offsetWidth*mapWidth,(sc.scrollTop+sc.clientHeight/2)/plane.offsetHeight*mapHeight];
  zoom=Math.max(1,Math.min(4,zoom+step)); sizeMap(uv);
}
function markers() {
  if (!current) return;
  const plane=el("plane"); const placed=[];
  const base=[current.index,1,6,33,16,24,11,3,28,18,22,8,49,48];
  const ids=zoom>=2 ? [...base,...places.map(p=>p.index)] : base;
  const target=el("markers"); target.replaceChildren();
  for (const id of new Set(ids)) {
    const p=getPlace(id), [u,v]=p.uv;
    const x=u/mapWidth*plane.offsetWidth,y=v/mapHeight*plane.offsetHeight;
    const half=(p.name.length*13+16)/2;
    if(placed.some(([xx,yy,hh])=>Math.abs(y-yy)<32 && Math.abs(x-xx)<hh+half+5)) continue;
    placed.push([x,y,half]);
    const btn=node("button",p.name,`map-label${id===current.index?" selected":""}`);
    btn.style.left=`${100*u/mapWidth}%`;btn.style.top=`${100*v/mapHeight}%`;
    btn.onclick=()=>selectPlace(id); target.append(btn);
  }
  el("zoom-in").disabled=zoom>=4; el("zoom-out").disabled=zoom<=1;
}
function showPicker() {
  el("query").value=""; listPlaces(); el("picker").showModal();
}
function listPlaces() {
  const q=el("query").value.trim().replace(/\s/g,"").replace(/号楼$/,"");
  const matches=places.filter(p=>!q || `${p.name}${p.section}`.includes(q) || String(p.number)===q);
  el("place-list").replaceChildren(...matches.map(p=>{
    const button=node("button",undefined,"listrow");
    button.append(node("b",p.name),node("small",p.number?`${p.number} 号楼`:p.section));
    if(p===current) button.setAttribute("aria-current","true");
    button.onclick=()=>{el("picker").close();selectPlace(p.index,true);};
    return button;
  }));
  if(!matches.length) el("place-list").append(node("p","没有匹配的地点","local-info"));
}
function renderAngles() {
  el("angles").replaceChildren(...angles.map(a=>{
    const b=node("button",a); b.setAttribute("aria-pressed",String(a===angle));
    b.onclick=()=>{angle=a;renderAngles();}; return b;
  }));
}
function makeSuggestions() {
  const items=[[6,"沿街立面"],[48,"门厅与广场"],[11,"入口与相邻道路"],[57,"端墙与楼梯间"]];
  el("suggestions").replaceChildren(...items.map(([id,hint])=>{
    const p=getPlace(id), b=node("button",undefined,"recommend"), image=node("img"), text=node("div");
    image.src=p.image; image.alt=""; text.append(node("b",p.name),node("small",hint));
    b.append(image,text); b.onclick=()=>{selectPlace(id,true);el("field").scrollIntoView({block:"start"});};
    return b;
  }));
}
function locateOnModel(fix) {
  const x=(fix.longitude-104.42309)*111320*Math.cos(30.49427*Math.PI/180);
  const y=(fix.latitude-30.49427)*110860;
  if (Math.abs(x)>950 || Math.abs(y)>950) return null;
  const v=(1772.28268-y)/(4.427426+.00228356210*y);
  const u=(x*(1+.00228356210*v)+.351967716*v+1661.19524)/1.89830349;
  return u>=0 && u<=mapWidth && v>=0 && v<=mapHeight ? [u,v] : null;
}
function stopGps(text="定位已关闭") {
  if (watch!==null) navigator.geolocation.clearWatch(watch);
  watch=null;lastFix=null;el("gps-dot").hidden=true;
  el("gps").querySelector("span").textContent="开启定位"; el("geo-status").textContent=text;
}
function toggleGps() {
  if(watch!==null) return stopGps();
  if(!window.isSecureContext || !navigator.geolocation) return stopGps("此浏览器无法定位，可直接拍摄");
  el("geo-status").textContent="正在获取位置…"; el("gps").querySelector("span").textContent="关闭定位";
  watch=navigator.geolocation.watchPosition(pos=>{
    const c=pos.coords;
    lastFix={latitude:c.latitude,longitude:c.longitude,accuracyM:c.accuracy,altitudeM:c.altitude,fixTime:new Date(pos.timestamp).toISOString()};
    const uv=locateOnModel(lastFix);
    el("gps-dot").hidden=!uv;
    if(uv) {el("gps-dot").style.left=`${uv[0]/mapWidth*100}%`;el("gps-dot").style.top=`${uv[1]/mapHeight*100}%`;}
    el("geo-status").textContent=`${uv?"站位估算":"图外站位"} · 精度约 ${Math.round(c.accuracy)} 米`;
  },err=>{
    stopGps(err.code===1?"定位权限已关闭，可手动选楼拍摄":"暂未取得位置，可重试定位");
  },{enableHighAccuracy:true,timeout:16000,maximumAge:0});
}
function snapshot(source) {
  const opened=Date.now();
  const fix=source==="camera" && lastFix && Math.abs(opened-Date.parse(lastFix.fixTime))<=45000 ? {...lastFix} : null;
  return {placeId:current.index,angle,photoName:CampusGitHub.title(el("photo-name").value),
    direction:el("direction").value,note:el("notes").value.trim(),source,
    cameraOpenedAt:source==="camera"?new Date(opened).toISOString():null,position:fix};
}
function startFile(source) {
  shot=snapshot(source);
  const input=el(source==="camera"?"camera-file":"album-file");
  input.value=""; input.click();
}
async function thumbnail(file) {
  let url=URL.createObjectURL(file);
  try {
    const image=new Image(); image.src=url; await image.decode();
    const scale=Math.min(1,360/Math.max(image.width,image.height));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(image.width*scale)); canvas.height=Math.max(1,Math.round(image.height*scale));
    canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
    return await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.7));
  } catch {return null;} finally {URL.revokeObjectURL(url);}
}
async function acceptFiles(input,source) {
  if(busy || !input.files.length) return;
  const files=Array.from(input.files), meta=shot?.source===source?shot:snapshot(source);
  shot=null; busy=true;el("shoot").disabled=el("import").disabled=true;
  let saved=0, skipped=0;
  const added=[];
  try {
    for(const file of files) {
      if(!file.size || (!file.type.startsWith("image/") && !/\.(heic|heif|jpe?g|png|webp|dng|avif|tiff?)$/i.test(file.name))) {skipped++;continue;}
      const record={...meta,id:crypto.randomUUID(),savedAt:new Date().toISOString(),
        originalName:file.name,fileModifiedAt:file.lastModified?new Date(file.lastModified).toISOString():null,
        mime:file.type,bytes:file.size,thumb:await thumbnail(file)};
      record.photoName=meta.photoName ? meta.photoName+(files.length>1?`_${saved+1}`:"") :
        `${getPlace(record.placeId).name}_${record.angle}_${formattedTime(record.savedAt).replace(/\D/g,"")}`;
      await change(record,file); records.unshift(record);added.push(record.id);saved++;
    }
    notice(`已保存 ${saved} 张${skipped?`，跳过 ${skipped} 个非图片文件`:""}${saved && !meta.position?" · 无现场定位":""}`);
  } catch {notice(`已保存 ${saved} 张。其余写入失败，请检查本机空间后重试。`);}
  finally {
    busy=false; input.value=""; el("shoot").disabled=el("import").disabled=false;
    if(added.length) el("photo-name").value="";
    updateCount(); if(!el("journal").hidden) renderJournal();
    if(added.length && CampusGitHub.connected() && el("auto-sync").checked) queueUpload(added);
  }
}
let syncTasks=Promise.resolve();
const syncing=new Set();
const pending=r=>!r.sync || r.sync.dirty;
function gitStatus(message) {
  el("capture-status").textContent=message;
  el("git-message").textContent=message;
}
function gitUi() {
  const connected=CampusGitHub.connected();
  document.querySelectorAll(".git-open span").forEach(s=>s.textContent=connected?"GitHub 已连接":"连接 GitHub");
  el("auth-fields").hidden=el("connect-git").hidden=connected;
  el("disconnect-git").hidden=!connected;
  el("sync-all").disabled=!filtered().some(r=>pending(r)&&!syncing.has(r.id));
}
function queueUpload(ids) {
  if (!CampusGitHub.connected()) {el("git-dialog").showModal();return;}
  for(const id of ids) {
    if(syncing.has(id)) continue;
    syncing.add(id);
    syncTasks=syncTasks.then(async()=>{
      const r=records.find(item=>item.id===id);
      if(!r || !pending(r)) return;
      gitStatus(`正在上传 ${CampusGitHub.filename(r)}`);
      const file=await read("files",id);
      if(!file) throw Error("找不到本机原图");
      const receipt=await CampusGitHub.upload(r,getPlace(r.placeId),file);
      const updated={...r,sync:{...receipt,dirty:false}};
      await change(updated);
      records=records.map(item=>item.id===id?updated:item);
      gitStatus(`已上传 ${CampusGitHub.filename(r)}`);
    }).catch(e=>{
      const message=`已保存在本机，待上传。${navigator.onLine?e.message:"当前离线"}`;
      gitStatus(message);notice(message);
    }).finally(()=>{syncing.delete(id);gitUi();if(!el("journal").hidden) renderJournal();});
  }
  gitUi();
}
function initGit() {
  for(const b of document.querySelectorAll(".git-open")) b.onclick=()=>{gitUi();el("git-dialog").showModal();};
  el("connect-git").onclick=async()=>{
    const value=el("git-token").value.trim(), button=el("connect-git");
    if(!value.startsWith("github_pat_")) {gitStatus("请输入仅限这个仓库的细粒度令牌");return;}
    button.disabled=true;el("git-token").value="";
    try {
      await CampusGitHub.connect(value);gitUi();gitStatus("已连接私有仓库");
      el("git-dialog").close();notice("已连接 GitHub");
    } catch(e) {gitStatus(e.message);}
    finally {button.disabled=false;}
  };
  el("disconnect-git").onclick=()=>{CampusGitHub.disconnect();gitUi();gitStatus("已断开 GitHub");};
  el("git-dialog").onclose=()=>{el("git-token").value="";};
  el("sync-all").onclick=()=>queueUpload(filtered().filter(pending).map(r=>r.id));
}
function updateCount() {el("nav-count").textContent=records.length;}
const filtered=()=>records.filter(r=>!el("log-filter").value || String(r.placeId)===el("log-filter").value);
function renderJournal() {
  free(journalUrls);
  const select=el("log-filter"), previous=select.value;
  const ids=new Set(records.map(r=>r.placeId));
  select.replaceChildren(option("全部地点",""),...places.filter(p=>ids.has(p.index)).map(p=>option(p.name,String(p.index))));
  if(ids.has(Number(previous))) select.value=previous;
  const list=filtered();el("logs").replaceChildren();
  el("log-count").textContent=list.length;el("export").disabled=!list.length;updateCount();gitUi();
  if (!list.length) {
    const box=node("div",undefined,"empty"), b=node("button","去采集","light");
    b.onclick=()=>setMode(false);box.append(icon("camera"),node("h3","还没有采集照片"),b);
    el("logs").append(box);return;
  }
  for(const r of list) {
    const b=node("button",undefined,"logcard"), image=node("img"), text=node("div");
    if(r.thumb) {image.src=URL.createObjectURL(r.thumb);journalUrls.push(image.src);}
    else {image.src="assets/touch.png";image.alt="原文件已保存";}
    text.append(node("b",r.photoName || CampusGitHub.filename(r)),
      node("small",`${getPlace(r.placeId).name} · ${r.angle} · ${syncing.has(r.id)?"正在上传":pending(r)?"待上传":"已上传 GitHub"}`),
      node("small",`${formattedTime(r.savedAt)} · ${r.position?`精度约 ${Math.round(r.position.accuracyM)} 米`:"无站位"}`));
    b.append(image,text);b.onclick=()=>openEditor(r);el("logs").append(b);
  }
}
async function openEditor(r) {
  edited=r; const file=await read("files",r.id); if(!file) return notice("未找到照片原文件");
  editUrl=URL.createObjectURL(file);el("edit-img").src=editUrl;
  el("edit-img").onerror=()=>{el("edit-img").hidden=true;}; el("edit-img").hidden=false;
  const f=r.position;
  el("edit-name").value=r.photoName || r.originalName.replace(/\.[^.]+$/,"");
  el("edit-meta").textContent=[r.originalName,formattedTime(r.savedAt),f?`${f.latitude.toFixed(6)}, ${f.longitude.toFixed(6)} · ±${Math.round(f.accuracyM)} 米`:"无现场定位"].join(" · ");
  el("edit-place").value=r.placeId;el("edit-angle").value=r.angle;el("edit-dir").value=r.direction;el("edit-note").value=r.note;
  el("editor").showModal();
}
async function editRecord(remove) {
  if(!edited || (remove && !confirm("删除这张照片及其本机采集记录？"))) return;
  if(syncing.has(edited.id)) return notice("照片正在上传，请完成后再修改");
  const live=records.find(r=>r.id===edited.id);
  if(!live) return;
  const record={...live,photoName:CampusGitHub.title(el("edit-name").value) || live.originalName.replace(/\.[^.]+$/,""),
    placeId:Number(el("edit-place").value),angle:el("edit-angle").value,
    direction:el("edit-dir").value,note:el("edit-note").value.trim()};
  if(record.sync) record.sync={...record.sync,dirty:true};
  await change(record,null,remove);
  records=remove?records.filter(r=>r.id!==record.id):records.map(r=>r.id===record.id?record:r);
  el("editor").close();renderJournal();
  if(!remove && CampusGitHub.connected() && el("auto-sync").checked) queueUpload([record.id]);
}
function exportDialog() {
  const all=filtered(), batches=[], limit=48*1024*1024;
  let bytes=0, batch=[];
  for(const r of all) {
    if(batch.length && bytes+r.bytes>limit) {batches.push(batch);batch=[];bytes=0;}
    batch.push(r);bytes+=r.bytes;
  }
  if (batch.length) batches.push(batch);
  el("export-info").textContent=`${all.length} 张照片 · ${batches.length} 个 ZIP 包 · ${el("log-filter").selectedOptions[0].text}`;
  el("bundles").replaceChildren(...batches.map((items,i)=>{
    const b=node("button",`生成素材包 ${i+1}（${items.length} 张）`,"primary");
    b.onclick=()=>createBundle(items,i+1,b);return b;
  }));
  el("exporter").showModal();
}
async function createBundle(items,part,button) {
  button.disabled=true;
  try {
    const zip=new JSZip(), entries=[];
    for(const [i,r] of items.entries()) {
      button.textContent=`整理照片 ${i+1} / ${items.length}`;
      const p=getPlace(r.placeId), file=await read("files",r.id);
      if(!file) throw Error("原文件缺失");
      const path=`photos/${p.name}/${r.id}/${CampusGitHub.filename(r)}`;
      zip.file(path,await file.arrayBuffer());
      const {thumb,...meta}=r;
      entries.push({...meta,path,building:p.name,buildingNumber:p.number,modelXYZ:p.xyz});
    }
    zip.file("manifest.json",JSON.stringify({schema:"guc-fieldbook/1",model:"v16",createdAt:new Date().toISOString(),
      positionReference:"WGS84 browser fix at camera launch; camera position, accuracy in meters",entries},null,2));
    const columns=["地点","楼号","部位","镜头朝向","备注","站位纬度","站位经度","精度(米)","定位时间","打开相机时间","入库时间","文件"];
    const rows=entries.map(r=>[r.building,r.buildingNumber,r.angle,r.direction,r.note,r.position?.latitude,r.position?.longitude,r.position?.accuracyM,r.position?.fixTime,r.cameraOpenedAt,r.savedAt,r.path]);
    const csv=[columns,...rows].map(row=>row.map(v=>{
      let s=String(v??""); if (/^[=+@-]/.test(s) && typeof v!=="number") s="'"+s;
      return `"${s.replace(/"/g,'""')}"`;
    }).join(",")).join("\r\n");
    zip.file("采集索引.csv","\ufeff"+csv);
    const blob=await zip.generateAsync({type:"blob",compression:"STORE"});
    if(!el("exporter").open) return;
    const url=URL.createObjectURL(blob);downloadUrls.push(url);
    const a=node("a",`下载第 ${part} 包 · ${(blob.size/1048576).toFixed(1)} MB`);
    a.href=url;a.download=`吉利校园采集_${new Date().toISOString().slice(0,10)}_${part}.zip`;
    button.replaceWith(a);
  } catch {button.textContent="生成失败，点此重试";button.disabled=false;}
}
async function init() {
  const res=await fetch("assets/places.json"); if(!res.ok) throw Error("地点索引读取失败");
  places=await res.json();
  el("direction").replaceChildren(...directions.map(s=>option(s)));el("edit-dir").replaceChildren(...directions.map(s=>option(s)));
  el("edit-place").replaceChildren(...places.map(p=>option(p.name,p.index)));el("edit-angle").replaceChildren(...angles.map(a=>option(a)));
  renderAngles();selectPlace(1);makeSuggestions();sizeMap();
  new ResizeObserver(()=>sizeMap()).observe(el("map-area"));
  el("zoom-in").onclick=()=>changeZoom(.5);el("zoom-out").onclick=()=>changeZoom(-.5);
  el("reset-map").onclick=()=>{zoom=1;sizeMap([mapWidth/2,mapHeight/2]);};
  el("gps").onclick=toggleGps;el("pick").onclick=el("all-places").onclick=showPicker;el("query").oninput=listPlaces;
  el("journal-tab").onclick=()=>setMode(true);el("map-tab").onclick=()=>setMode(false);
  el("shoot").onclick=()=>startFile("camera");el("import").onclick=()=>startFile("album");
  el("camera-file").onchange=e=>acceptFiles(e.target,"camera");el("album-file").onchange=e=>acceptFiles(e.target,"album");
  el("log-filter").onchange=renderJournal;el("export").onclick=exportDialog;
  el("save-edit").onclick=()=>editRecord(false).catch(()=>notice("修改写入失败，请重试"));
  el("remove").onclick=()=>editRecord(true).catch(()=>notice("删除失败，请重试"));
  document.querySelectorAll(".close").forEach(b=>b.onclick=()=>b.closest("dialog").close());
  el("editor").onclose=()=>{URL.revokeObjectURL(editUrl);edited=null;el("edit-img").removeAttribute("src");};
  el("exporter").onclose=()=>free(downloadUrls);
  initGit();
  db=await openDb();records=(await read("records")).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
  updateCount();el("shoot").disabled=el("import").disabled=false;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
}
init().catch(()=>notice("无法读取地图或本机存储，请在 Safari 中重新打开。"));
