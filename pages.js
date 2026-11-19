(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ESC = (x) => String(x).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const day = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  ['nutrition-date','measure-date','activity-date'].forEach((id) => { $(id).value = day(); });
  const config = () => { try { return JSON.parse(localStorage.getItem('duofit-v1-config') || '{}'); } catch { return {}; } };
  const readLocal = () => { try { return JSON.parse(localStorage.getItem('duofit-v1-body') || '[]'); } catch { return []; } };
  const saveLocal = (records) => localStorage.setItem('duofit-v1-body', JSON.stringify(records));
  document.querySelectorAll('.page-tab').forEach((button) => button.addEventListener('click', () => {
    const page = button.dataset.page;
    document.querySelectorAll('.page-tab').forEach((tab) => { tab.classList.toggle('active', tab === button); if(tab === button)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current'); });
    document.querySelectorAll('.page-view').forEach((view) => { view.hidden = view.id !== `page-${page}`; });
    if(page === 'nutrition') loadNutrition();
    if(page === 'body') renderHistory();
  }));
  const nutrients = [['energy','热量','kcal'],['protein','蛋白质','g'],['carbs','碳水化合物','g'],['fat','脂肪','g'],['fiber','膳食纤维','g']];
  async function loadNutrition() {
    const {apiUrl,token} = config();
    if (!apiUrl) { $('nutrition-message').textContent = '尚未配置 Neon Function，无法取得当前生效计划及已核实摄入。'; return; }
    $('nutrition-message').textContent = '正在读取…';
    try {
      const params = new URLSearchParams({date:$('nutrition-date').value, day_class:$('nutrition-day').value});
      const response = await fetch(`${apiUrl.replace(/\/+$/,'')}/api/nutrition/overview?${params}`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !data.plan || !data.targets) throw new Error('API 尚未提供营养计划结构');
      const select = $('nutrition-day');const choice = select.value;
      select.innerHTML = '<option value="actual">当天实际运动（自动匹配）</option>'+(data.scenarios||[]).map((s)=>`<option value="${ESC(s.code)}">${ESC(s.label)}</option>`).join('');
      select.value = [...select.options].some((o)=>o.value===choice)?choice:'actual';
      $('nutrition-state').textContent = `计划 v${data.plan.version}`;
      $('nutrition-state').classList.add('live');
      $('plan-summary').innerHTML = `<strong>${ESC(data.plan.label||'当前生效计划')}</strong><div>生效日期：${ESC(data.plan.effective_from||'未知')} · 活动分类：${ESC(data.day_class_label||'待核实')}</div>`;
      $('nutrient-list').innerHTML = nutrients.map(([key,label,unit])=>{
        const t=data.targets[key],v=data.actual?.[key];
        const center=t?.center == null?null:Number(t.center);
        const actual=v==null?null:Number(v);
        const percent=center>0&&actual!=null?Math.min(100,Math.max(0,actual/center*100)):0;
        return `<div class="nutrient"><div class="nutrient-title"><span>${label}</span><span>${actual==null?'摄入待核实':`${actual.toFixed(1)} ${unit}`} / ${center==null?'目标未设置':`${center.toFixed(1)} ${unit}`}</span></div><div class="progress-track"><div class="progress-bar" style="width:${percent}%"></div></div><div class="progress-caption">${t?.min==null?'':`下限 ${ESC(t.min)} ${unit} `}${t?.max==null?'':` · 上限 ${ESC(t.max)} ${unit}`}</div></div>`;
      }).join('');
      $('nutrition-message').textContent = data.actual_verified === false ? '实际摄入尚未全部核实；以上进度可能不完整。' : '当前计划与摄入来自 API。';
    } catch(e) { $('nutrition-state').textContent='待连接';$('plan-summary').textContent='尚未获得营养计划数据';$('nutrient-list').innerHTML='';$('nutrition-message').textContent=`读取失败：${e.message}。不会显示旧的或推测的目标。`; }
  }
  $('reload-nutrition').addEventListener('click',loadNutrition);
  $('nutrition-date').addEventListener('change',loadNutrition);
  $('nutrition-day').addEventListener('change',loadNutrition);
  function openImagesDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('duofit-images',1);req.onupgradeneeded=()=>req.result.createObjectStore('images',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async function saveImages(id,files){const db=await openImagesDB();return new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put({id,files});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
  async function deleteImages(id){const db=await openImagesDB();return new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').delete(id);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
  $('body-form').addEventListener('submit',(event)=>{
    event.preventDefault();const weight=$('morning-weight').value,waist=$('waist').value;
    if(!weight&&!waist){$('body-message').textContent='请至少填写晨重或腰围。';return;}
    const records=readLocal();records.unshift({id:crypto.randomUUID(),type:'measurement',date:$('measure-date').value,weight:weight||null,waist:waist||null,note:$('measure-note').value.trim(),state:'local',created_at:new Date().toISOString()});saveLocal(records);
    $('morning-weight').value='';$('waist').value='';$('measure-note').value='';$('body-message').textContent='测量草稿已保存在本机，尚未写入 Neon。';renderHistory();
  });
  $('activity-images').addEventListener('change',()=>{const files=[...$('activity-images').files];$('upload-preview').innerHTML='';files.slice(0,5).forEach((file)=>{const image=document.createElement('img');image.alt=file.name;image.src=URL.createObjectURL(file);image.onload=()=>URL.revokeObjectURL(image.src);$('upload-preview').appendChild(image);});});
  $('activity-form').addEventListener('submit',async(event)=>{
    event.preventDefault();const files=[...$('activity-images').files];
    if(!files.length){$('body-message').textContent='请至少选择一张运动截图。';return;}
    if(files.length>5||files.some((f)=>f.size>8*1024*1024||!['image/jpeg','image/png','image/webp'].includes(f.type))){$('body-message').textContent='最多 5 张 JPG/PNG/WebP，每张不超过 8 MB。';return;}
    const id=crypto.randomUUID();
    try{await saveImages(id,files);const records=readLocal();records.unshift({id,type:'activity',date:$('activity-date').value,kind:$('activity-kind').value,names:files.map((f)=>f.name),note:$('activity-note').value.trim(),state:'local',created_at:new Date().toISOString()});saveLocal(records);$('activity-form').reset();$('activity-date').value=day();$('upload-preview').innerHTML='';$('body-message').textContent='运动截图保存在本机，尚未上传云端。';renderHistory();}
    catch(e){$('body-message').textContent=`保存失败：${e.message}`;}
  });
  function renderHistory(){const records=readLocal();$('body-history').innerHTML=records.length?records.map((r)=>`<div class="local-record"><strong>${ESC(r.date)} · ${r.type==='measurement'?'身体测量':'运动截图'}</strong><small>${r.type==='measurement'?`${r.weight?'晨重 '+ESC(r.weight)+'kg　':''}${r.waist?'腰围 '+ESC(r.waist)+'cm':''}`:`${ESC(r.names.length)} 张截图 · ${ESC(r.kind)}`}${r.note?' · '+ESC(r.note):''}</small><small>仅本机 · 未提交云端</small><button type="button" data-remove="${r.id}">删除本地草稿</button></div>`).join(''):'<div class="empty">暂无记录</div>';
    $('body-history').querySelectorAll('[data-remove]').forEach((b)=>b.addEventListener('click',async()=>{if(!confirm('删除这条尚未上传的本地记录？'))return;const r=readLocal().find((x)=>x.id===b.dataset.remove);if(r?.type==='activity')await deleteImages(r.id);saveLocal(readLocal().filter((x)=>x.id!==b.dataset.remove));renderHistory();}));}
  $('refresh-body').addEventListener('click',renderHistory);
})();
