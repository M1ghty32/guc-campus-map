"use strict";
const CampusGitHub = (() => {
  const repo = "M1ghty32/guc-campus-fieldbook";
  const api = `https://api.github.com/repos/${repo}`;
  const folder = "文件材料";
  let token = "";
  function title(value) {
    return Array.from(String(value || "").normalize("NFC")
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,"_").trim().replace(/^[. ]+|[. ]+$/g,"")).slice(0,70).join("");
  }
  function filename(record) {
    const ext = record.originalName.match(/\.([a-z\d]{1,7})$/i)?.[1] ||
      ({jpeg:"jpg","svg+xml":"svg"}[record.mime?.split("/")[1]] || record.mime?.split("/")[1]?.match(/^[a-z0-9]{1,7}$/)?.[0] || "img");
    const base = title(record.photoName || record.originalName.replace(/\.[^.]+$/,"")) || "校园实景";
    return `${base.replace(new RegExp(`\\.${ext}$`,"i"),"") || "校园实景"}.${ext}`;
  }
  class ApiError extends Error {
    constructor(status) {
      super(({401:"授权已失效，请重新连接 GitHub",403:"请检查令牌的仓库内容写入权限或稍后重试",
        404:"找不到仓库或分支，请核对令牌可访问的仓库",409:"仓库正在更新，请重试",
        422:"提交发生冲突或被分支规则拒绝，请重试",429:"GitHub 暂时限流，请稍后重试"})[status] || `GitHub 返回 ${status}`);
      this.status=status;
    }
  }
  async function call(path, method="GET", data, allowMissing=false) {
    if (!token) throw Error("请先连接 GitHub");
    const response = await fetch(api+path,{method,cache:"no-store",redirect:"error",credentials:"omit",
      headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","Content-Type":"application/json"},
      body:data===undefined ? undefined : JSON.stringify(data)});
    if (allowMissing && response.status===404) return null;
    if (!response.ok) throw new ApiError(response.status);
    return response.json();
  }
  async function checkPrivate() {
    const info=await call("");
    if(info.private!==true || info.full_name.toLowerCase()!==repo.toLowerCase()) {
      throw Error("目标仓库须保持私有，照片已保留在本机");
    }
  }
  async function connect(value) {
    token=value.trim();
    try {await checkPrivate();await call("/git/ref/heads/main");}
    catch(e) {token="";throw e;}
  }
  function base64(file) {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result.slice(reader.result.indexOf(",")+1));
      reader.onerror=()=>reject(Error("读取照片原文件失败"));
      reader.readAsDataURL(file);
    });
  }
  function decodeText(data) {
    return new TextDecoder().decode(Uint8Array.from(atob(data.replace(/\s/g,"")), c=>c.charCodeAt(0)));
  }
  const apiPath = path => path.split("/").map(encodeURIComponent).join("/");
  async function upload(record, place, file) {
    await checkPrivate();
    if (file.size>95*1024*1024) throw Error("单个文件过大，请使用素材包导出");
    const filenamePath=`${folder}/${place.name}/${record.id}/${filename(record)}`;
    const indexPath=`${folder}/索引/${record.id}.json`;
    const {thumb,sync,...fields}=record;
    const metadata={...fields,photoName:title(record.photoName)||filename(record).replace(/\.[^.]+$/,""),
      schema:"guc-fieldbook/photo-v1",building:place.name,buildingNumber:place.number,model:"v16",modelXYZ:place.xyz,path:filenamePath};
    const text=JSON.stringify(metadata,null,2)+"\n";
    const ref=await call("/git/ref/heads/main");
    const head=ref.object.sha;
    const old=await call(`/contents/${apiPath(indexPath)}?ref=${head}`,"GET",undefined,true);
    let previousPath;
    if(old) {
      const stored=decodeText(old.content);
      if(stored===text) return {indexSha:old.sha,path:filenamePath,commit:head};
      if(sync?.indexSha!==old.sha) throw Error("远端记录已变更，请先核对仓库文件");
      const previous=JSON.parse(stored);
      const segments=String(previous.path).split("/");
      if(previous.id!==record.id || segments.length!==4 || segments[0]!==folder || segments[2]!==record.id ||
        segments.some(s=>!s || s==="." || s==="..")) throw Error("远端记录的路径异常");
      previousPath=previous.path;
    }
    const photo=await call("/git/blobs","POST",{encoding:"base64",content:await base64(file)});
    const sidecar=await call("/git/blobs","POST",{encoding:"utf-8",content:text});
    const entries=[{path:filenamePath,mode:"100644",type:"blob",sha:photo.sha},
      {path:indexPath,mode:"100644",type:"blob",sha:sidecar.sha}];
    if(previousPath && previousPath!==filenamePath) entries.push({path:previousPath,mode:"100644",type:"blob",sha:null});
    const base=await call(`/git/commits/${head}`);
    const tree=await call("/git/trees","POST",{base_tree:base.tree.sha,tree:entries});
    const commit=await call("/git/commits","POST",{message:`采集 ${place.name} · ${filename(record)}`,
      tree:tree.sha,parents:[head]});
    await call("/git/refs/heads/main","PATCH",{sha:commit.sha,force:false});
    return {indexSha:sidecar.sha,path:filenamePath,commit:commit.sha};
  }
  return {repo,title,filename,connect,upload,disconnect:()=>{token="";},connected:()=>Boolean(token)};
})();
