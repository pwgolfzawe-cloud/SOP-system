
// สร้าง Supabase client ไว้บนสุดของสคริปต์ก่อนสิ่งอื่นใด — ต้องมาก่อน _loadKV()
// ที่เรียกใช้งานทันทีด้านล่าง ไม่งั้นจะ error "_SB is not defined"
const _SB = supabase.createClient(
  'https://lrxjngcsqtrvevbyjqdb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyeGpuZ2NzcXRydmV2YnlqcWRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDcyNTIsImV4cCI6MjA5ODYyMzI1Mn0.536QGLQEDFzNnTaA-tE5v_t8szCx41ygVnxj6yLb8KE'
);
// Init globals early so no reference errors even if later code fails
var _staffPhotos = {};
var _customStaffPhotos = {};
var _pendingStaffPhotos = [];
var _knownPersonNames = null;
var _mCtx = {svcId:'', stepId:0, selected:{}, laneIdx:0, primLanes:[0], laneTemp:{}};
var _sopFlat = [];
var _editModeSvc = '';
var _STEPS_KEY = 'int_custom_steps_v1';
var _stepCtx = {svcId:'', stepId:null, mode:'add'};
var _LANES_KEY = 'int_custom_lanes_v1';
var _laneModalSvcId = '';
var _laneModalLanesTmp = [];
var _raSvcEditMode = false;
var _curSvcDept = 'RA';
var DEPT_META = {
  RA:{abbr:'RA',full:'Research and Academic Service'},
  AD:{abbr:'AD',full:'Administration'},
  PP:{abbr:'PP',full:'Policy and Planning'}
};
var _svcModalCtx = {mode:'add', id:null};


function _showLoadError(msg){
  var id='_loadErrBanner';
  var el=document.getElementById(id);
  if(!el){
    el=document.createElement('div');
    el.id=id;
    el.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;padding:10px 16px;text-align:center;font-family:"Sarabun",sans-serif;font-size:13px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.2)';
    document.body.appendChild(el);
  }
  el.textContent='⚠️ '+msg+' — กด Ctrl+Shift+R เพื่อโหลดใหม่ก่อนใช้งานหรือนำเสนอ';
}
/* ---- Supabase Key-Value cache (แทน localStorage: int_custom_steps_v1, int_custom_lanes_v1, ra_journey_mapping) ---- */
var _kvCache = {};
async function _loadKV(){
  try{
    var {data,error} = await _SB.from('app_kv').select('key,value');
    if(error) throw error;
    (data||[]).forEach(function(row){ _kvCache[row.key] = row.value; });
  }catch(err){
    console.warn('โหลดข้อมูล app_kv จาก Supabase ไม่สำเร็จ (ใช้ localStorage สำรองแทนชั่วคราว):', err);
    _showLoadError('โหลดข้อมูล Journey Map/Lane ไม่สำเร็จ อาจเห็นข้อมูลไม่ตรงกับที่บันทึกไว้จริง');
  }
}
var _kvReadyPromise = _loadKV(); // เริ่มดึงข้อมูลทันทีที่ script โหลด ไม่ต้องรอ DOMContentLoaded
function _kvGet(key){
  if(_kvCache[key] !== undefined) return _kvCache[key];
  var raw = localStorage.getItem(key);
  if(raw){ try{ return JSON.parse(raw); }catch(e){} }
  return null;
}
function _kvSet(key, value){
  _kvCache[key] = value;
  return _SB.from('app_kv').upsert({key:key, value:value}, {onConflict:'key'}).then(function(r){
    if(r.error) console.error('บันทึก '+key+' ขึ้น Supabase ไม่สำเร็จ:', r.error);
  });
}

var SVC=[];
var _svcReadyPromise = _loadServices();
async function _loadServices(){
  try{
    var {data,error} = await _SB.from('services').select('*').order('sort_order');
    if(error) throw error;
    SVC = (data||[]).map(function(row){
      return {
        id: row.id, name: row.name, icon: row.icon, color: row.color,
        colorLight: row.color_light, tag: row.tag, desc: row.desc,
        chips: row.chips||[], lanes: row.lanes||['ทีมงาน'],
        laneColors: row.lane_colors||['#f8fafc'], steps: row.steps||[],
        department_id: row.department_id, sort_order: row.sort_order
      };
    });
  }catch(err){
    console.warn('โหลดข้อมูลบริการ (services) จาก Supabase ไม่สำเร็จ:', err);
    _showLoadError('โหลดรายการบริการไม่สำเร็จ อาจเห็นการ์ดไม่ครบ');
  }
}
function _lightenHex(hex, pct){
  hex=(hex||'#005992').replace('#','');
  if(hex.length!==6) hex='005992';
  var r=parseInt(hex.substring(0,2),16), g=parseInt(hex.substring(2,4),16), b=parseInt(hex.substring(4,6),16);
  r=Math.round(r+(255-r)*pct); g=Math.round(g+(255-g)*pct); b=Math.round(b+(255-b)*pct);
  return '#'+[r,g,b].map(function(v){return v.toString(16).padStart(2,'0');}).join('');
}

function showLayer(id){
  ['layer1','layerDept','layer2','layer3','layerPersonnel'].forEach(function(l){
    var el=document.getElementById(l);
    if(el) el.style.display=(l===id)?'flex':'none';
  });
}
function goHome(){ showLayer('layer1'); }
function showDeptCards(){ showLayer('layerDept'); }
async function showDeptServiceCards(dk){
  _curSvcDept=dk;
  await _svcReadyPromise;
  renderDeptServiceCards();
  var meta=DEPT_META[dk]||{abbr:dk,full:dk};
  var subEl=document.getElementById('l2subtitle'); if(subEl) subEl.textContent=meta.full+' ('+meta.abbr+') · เลือก Service ที่ต้องการดู';
  var bcEl=document.getElementById('l2breadcrumb'); if(bcEl) bcEl.innerHTML='หน้าหลัก &#x203A; บริการหลัก &#x203A; '+meta.abbr;
  showLayer('layer2');
}
function renderDeptServiceCards(){
  var list=SVC.filter(function(s){return s.department_id===_curSvcDept;}).slice().sort(function(a,b){return (a.sort_order||0)-(b.sort_order||0);});
  var h='';
  list.forEach(function(s){
    var titleBr = s.name.length>28 ? s.name.replace(/ /g,'<br>') : s.name;
    var editBtns='';
    if(_raSvcEditMode){
      editBtns='<div style="position:absolute;top:8px;right:8px;display:flex;gap:5px;z-index:2">'
        +'<button class="jm-edit-btn jm-edit" onclick="event.stopPropagation();openServiceModal(\''+s.id+'\')" title="แก้ไขบริการ">&#x270F;</button>'
        +'<button class="jm-edit-btn jm-del" onclick="event.stopPropagation();deleteService(\''+s.id+'\')" title="ลบบริการ">&#x1F5D1;</button>'
        +'</div>';
    }
    var chipsHtml=(s.chips||[]).map(function(c){return '<span class="chip" style="color:'+s.color+';border-color:'+s.color+'88">'+c+'</span>';}).join('');
    h+='<div class="card" style="--c:'+s.color+';position:relative" onclick="'+(_raSvcEditMode?'':"showDetail('"+s.id+"')")+'">'+editBtns
      +'<div class="c-ico" style="background:'+s.colorLight+'">'+s.icon+'</div>'
      +'<div><div class="c-tag" style="background:'+s.color+'">'+s.tag+'</div><div class="c-title">'+titleBr+'</div>'
      +'<div class="c-desc">'+s.desc+'</div><div class="chips">'+chipsHtml+'</div></div>'
      +(_raSvcEditMode?'':'<span class="c-arr">&#x2192;</span>')+'</div>';
  });
  if(_raSvcEditMode){
    h+='<div class="card" style="border:2px dashed #94a3b8;background:#f8fafc;display:flex;align-items:center;justify-content:center;cursor:pointer;min-height:160px" onclick="openServiceModal(null)">'
      +'<div style="text-align:center;color:#64748b"><div style="font-size:28px">&#xFF0B;</div><div style="font-size:13px;font-weight:700;margin-top:4px">เพิ่มบริการใหม่</div></div></div>';
  }
  document.getElementById('raCardsGrid').innerHTML=h;
}
function toggleSvcEditMode(){
  _raSvcEditMode=!_raSvcEditMode;
  var btn=document.getElementById('raSvcEditBtn');
  if(btn) btn.textContent=_raSvcEditMode?'\u2714 เสร็จสิ้น':'\u2699\uFE0F แก้ไขบริการ';
  renderDeptServiceCards();
}
function openServiceModal(svcId){
  _svcModalCtx.mode = svcId===null?'add':'edit';
  _svcModalCtx.id = svcId;
  if(svcId!==null){
    var s=SVC.find(function(x){return x.id===svcId;});
    if(!s) return;
    document.getElementById('svcNameInput').value=s.name;
    document.getElementById('svcIconInput').value=s.icon;
    document.getElementById('svcColorInput').value=s.color;
    document.getElementById('svcTagInput').value=s.tag;
    document.getElementById('svcDescInput').value=s.desc;
    document.getElementById('svcChipsInput').value=(s.chips||[]).join(', ');
    document.getElementById('svcModalTitle').textContent='✏️ แก้ไขบริการ';
  } else {
    document.getElementById('svcNameInput').value='';
    document.getElementById('svcIconInput').value='📁';
    document.getElementById('svcColorInput').value='#005992';
    document.getElementById('svcTagInput').value='';
    document.getElementById('svcDescInput').value='';
    document.getElementById('svcChipsInput').value='';
    document.getElementById('svcModalTitle').textContent='➕ เพิ่มบริการใหม่';
  }
  document.getElementById('svcModalBg').classList.add('open');
}
function closeServiceModal(){ document.getElementById('svcModalBg').classList.remove('open'); }
async function saveServiceModal(){
  var name=document.getElementById('svcNameInput').value.trim();
  if(!name){ alert('กรุณาระบุชื่อบริการ'); return; }
  var icon=document.getElementById('svcIconInput').value.trim()||'📁';
  var color=document.getElementById('svcColorInput').value||'#005992';
  var tag=document.getElementById('svcTagInput').value.trim()||name.slice(0,12);
  var desc=document.getElementById('svcDescInput').value.trim();
  var chips=document.getElementById('svcChipsInput').value.split(',').map(function(c){return c.trim();}).filter(Boolean);
  var colorLight=_lightenHex(color,0.88);
  var _btn=document.getElementById('svcSaveBtn'); if(_btn){_btn.disabled=true;_btn.textContent='กำลังบันทึก…';}
  try{
    if(_svcModalCtx.mode==='add'){
      var id='s_'+Date.now();
      var maxSort=SVC.filter(function(s){return s.department_id===_curSvcDept;}).reduce(function(m,s){return Math.max(m,s.sort_order||0);},-1);
      var row={id:id, department_id:_curSvcDept, sort_order:maxSort+1, name:name, icon:icon, color:color, color_light:colorLight, tag:tag, desc:desc, chips:chips, lanes:['ทีมงาน'], lane_colors:['#f8fafc'], steps:[]};
      var {error} = await _SB.from('services').insert(row);
      if(error) throw error;
      SVC.push({id:id, name:name, icon:icon, color:color, colorLight:colorLight, tag:tag, desc:desc, chips:chips, lanes:['ทีมงาน'], laneColors:['#f8fafc'], steps:[], department_id:_curSvcDept, sort_order:maxSort+1});
    } else {
      var s=SVC.find(function(x){return x.id===_svcModalCtx.id;});
      if(s){ s.name=name;s.icon=icon;s.color=color;s.colorLight=colorLight;s.tag=tag;s.desc=desc;s.chips=chips; }
      var {error} = await _SB.from('services').update({name:name, icon:icon, color:color, color_light:colorLight, tag:tag, desc:desc, chips:chips}).eq('id', _svcModalCtx.id);
      if(error) throw error;
    }
  }catch(err){
    console.error('บันทึกบริการไม่สำเร็จ:', err);
    alert('บันทึกไม่สำเร็จ: '+(err&&err.message||err));
  }
  if(_btn){_btn.disabled=false;_btn.textContent='✓ บันทึก';}
  closeServiceModal();
  renderDeptServiceCards();
}
async function deleteService(svcId){
  var s=SVC.find(function(x){return x.id===svcId;});
  if(!s) return;
  if(!confirm('ลบบริการ "'+s.name+'" ?\nขั้นตอน, Lane และ SOP ที่ผูกไว้ในบริการนี้จะถูกลบออกด้วย')) return;
  try{
    var {error} = await _SB.from('services').delete().eq('id', svcId);
    if(error) throw error;
    // เก็บกวาด custom steps/lanes/journey mapping ของบริการนี้ทิ้งด้วย
    var stepsCustom=_kvGet(_STEPS_KEY)||{}; if(stepsCustom[svcId]){ delete stepsCustom[svcId]; await _kvSet(_STEPS_KEY, stepsCustom); }
    var lanesCustom=_kvGet(_LANES_KEY)||{}; if(lanesCustom[svcId]){ delete lanesCustom[svcId]; await _kvSet(_LANES_KEY, lanesCustom); }
    var mapping=_getMapping(); var nm={}; var changed=false;
    Object.keys(mapping).forEach(function(k){ if(k.indexOf(svcId+'_')===0){changed=true;} else {nm[k]=mapping[k];} });
    if(changed) await _kvSet('ra_journey_mapping', nm);
  }catch(err){
    console.error('ลบบริการไม่สำเร็จ:', err);
    alert('ลบไม่สำเร็จ: '+(err&&err.message||err));
    return;
  }
  SVC=SVC.filter(function(x){return x.id!==svcId;});
  renderDeptServiceCards();
}
function showComingSoon(abbr){ document.getElementById('csmTitle').textContent=abbr+' — กำลังพัฒนา'; document.getElementById('csmOv').style.display='flex'; }
function goRACards(){ showDeptServiceCards(_curSvcDept); } // ปุ่มกลับจากหน้า Journey Map ต้องกลับไปฝ่ายเดิมที่กำลังดูอยู่ ไม่ใช่ RA ตายตัว
function toggleUsrMenu(){
  document.getElementById('usrDrop').classList.toggle('open');
}
document.addEventListener('click',function(e){
  var btn=document.getElementById('usrMenuBtn');
  var drop=document.getElementById('usrDrop');
  if(drop&&btn&&!drop.contains(e.target)&&!btn.contains(e.target)){
    drop.classList.remove('open');
  }
});

/* ─── My Profile ────────────────────────────── */
var _myProfile = null;

async function showPersonnel(){
  showLayer('layerPersonnel');
  await loadMyProfile();
}

async function loadMyProfile(){
  var res = await _SB.auth.getUser();
  var user = res.data && res.data.user;
  if(!user) return;
  var email = user.email || '';
  document.getElementById('profEmailBox').textContent = email;

  var res2 = await _SB.from('personnel').select('*').eq('email',email).maybeSingle();
  _myProfile = (res2.data) || {email:email};
  var p = _myProfile;

  /* Avatar */
  var av = document.getElementById('profAvatarLg');
  if(p.photo_url){
    av.innerHTML = '<img src="'+p.photo_url+'" alt="avatar">';
  } else {
    var nm = p.name_th || p.name || email;
    av.textContent = initials(nm);
  }

  /* Fields */
  setF('profPrefixTh', p.prefix_th||'');
  setF('profNameTh',   p.name_th||p.name||'');
  setF('profPrefixEn', p.prefix_en||'');
  setF('profNameEn',   p.name_en||'');
  setF('profPosition', p.position||'');
  setF('profPhone',    p.phone||'');
  setSel('profDept',     p.department||'');
  setSel('profFaculty',  p.faculty||'INT');
  setSel('profEmpType',  p.employee_type||'');
  document.getElementById('profSupervisorName').textContent = p.supervisor||'—';

  /* Role chips */
  var chips = document.getElementById('profRoleChips');
  var roles = p.role ? (Array.isArray(p.role)?p.role:[p.role]) : ['ปฏิบัติการ'];
  chips.innerHTML = roles.map(function(r){
    return '<span class="prof-role-chip">'+esc(r)+'</span>';
  }).join('');
}

function setF(id,val){var e=document.getElementById(id);if(e)e.value=val;}
function setSel(id,val){
  var e=document.getElementById(id); if(!e)return;
  for(var i=0;i<e.options.length;i++){if(e.options[i].value===val){e.selectedIndex=i;return;}}
}

async function saveProfile(){
  var alertEl = document.getElementById('profSaveAlert');
  var btn = document.querySelector('[onclick="saveProfile()"]');
  var res = await _SB.auth.getUser();
  var user = res.data && res.data.user;
  if(!user){showProfAlert('profSaveAlert','err','กรุณา Login ก่อน');return;}
  var payload = {
    email:          user.email,
    prefix_th:      document.getElementById('profPrefixTh').value,
    name_th:        document.getElementById('profNameTh').value.trim(),
    name:           document.getElementById('profNameTh').value.trim(),
    prefix_en:      document.getElementById('profPrefixEn').value,
    name_en:        document.getElementById('profNameEn').value.trim(),
    position:       document.getElementById('profPosition').value.trim(),
    phone:          document.getElementById('profPhone').value.trim(),
    department:     document.getElementById('profDept').value,
    faculty:        document.getElementById('profFaculty').value,
    employee_type:  document.getElementById('profEmpType').value,
  };
  if(btn){btn.textContent='กำลังบันทึก…';btn.disabled=true;}
  var {error} = await _SB.from('personnel').upsert(payload,{onConflict:'email'});
  if(btn){btn.textContent='บันทึก';btn.disabled=false;}
  if(error){
    showProfAlert('profSaveAlert','err','บันทึกไม่สำเร็จ: '+(error.message||''));
  } else {
    showProfAlert('profSaveAlert','ok','✓ บันทึกข้อมูลเรียบร้อยแล้ว');
  }
}

async function changePassword(){
  var newPw = document.getElementById('profNewPw').value;
  var conPw = document.getElementById('profConPw').value;
  if(newPw.length<6){showProfAlert('profPwAlert','err','รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');return;}
  if(newPw!==conPw){showProfAlert('profPwAlert','err','รหัสผ่านไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง');return;}
  var {error} = await _SB.auth.updateUser({password:newPw});
  if(error){
    showProfAlert('profPwAlert','err','เกิดข้อผิดพลาด: '+(error.message||''));
  } else {
    showProfAlert('profPwAlert','ok','✓ เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
    document.getElementById('profCurPw').value='';
    document.getElementById('profNewPw').value='';
    document.getElementById('profConPw').value='';
  }
}

async function uploadProfilePhoto(input){
  var file=input.files[0]; if(!file)return;
  if(file.size>5*1024*1024){alert('ไฟล์ใหญ่เกิน 5 MB');return;}
  var res=await _SB.auth.getUser(); var user=res.data&&res.data.user; if(!user)return;
  var ext=file.name.split('.').pop();
  var path='profile/'+user.id+'.'+ext;
  var {error:upErr}=await _SB.storage.from('personnel-photo').upload(path,file,{upsert:true});
  if(upErr){alert('อัปโหลดไม่สำเร็จ: '+upErr.message);return;}
  var {data:{publicUrl}}=_SB.storage.from('personnel-photo').getPublicUrl(path);
  var url=publicUrl+'?t='+Date.now();
  document.getElementById('profAvatarLg').innerHTML='<img src="'+url+'" alt="avatar">';
  await _SB.from('personnel').upsert({email:user.email,photo_url:publicUrl},{onConflict:'email'});
}

function showProfAlert(id,type,msg){
  var el=document.getElementById(id);
  el.className='prof-alert '+type; el.textContent=msg; el.style.display='block';
  if(type==='ok') setTimeout(function(){el.style.display='none';},3000);
}

function initials(name){
  if(!name)return '?';
  var parts=name.trim().split(/\s+/);
  return parts.length>=2?(parts[0][0]+(parts[1][0]||'')).toUpperCase():name[0].toUpperCase();
}
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}

async function showDetail(id){
  var svc=SVC.find(function(s){return s.id===id;});
  if(!svc) return;
  // รอให้ _loadKV() (custom steps/lanes/journey mapping จาก Supabase) โหลดเสร็จก่อนเสมอ
  // กันปัญหาเข้าเว็บเครื่อง/เน็ตที่โหลดช้ากว่า แล้วเห็นข้อมูล default แทนข้อมูลจริงที่เคยแก้ไว้
  await _svcReadyPromise;
  await _kvReadyPromise;
  // โหลดข้อมูล SOP (สำหรับสีป้าย/ชื่อผู้รับผิดชอบใน Journey Map + Swimlane) ให้เสร็จก่อน
  // render เสมอ — ไม่งั้นรอบแรกที่เข้าเว็บจะยังไม่มี _sopFlat ป้าย SOP เลยตกไปใช้สีบริการ
  // แทนสีฝ่ายเจ้าของ SOP จริง (เห็นเป็นสีเดียวกันหมดจนกว่าจะโหลดเสร็จรอบถัดไป)
  if(!_sopFlat.length) await _loadSopData();
  // จำตำแหน่งสกรอลปัจจุบันของ .detail-body ไว้ก่อน — เพราะ innerHTML re-render
  // ด้านล่างจะรีเซ็ตสกรอลกลับบนสุดถ้าไม่กู้คืนเอง (ทำให้ต้องเลื่อนหาใหม่ทุกครั้งที่บันทึก SOP)
  var _scrollEl=document.querySelector('.detail-body');
  var _savedScrollTop=_scrollEl?_scrollEl.scrollTop:0;
  var _slWrapOld=document.querySelector('.sl-wrap');
  var _savedSlScrollLeft=_slWrapOld?_slWrapOld.scrollLeft:0;
  var steps=_getSteps(id);
  var lanes=_getLanes(id);
  var svcW=Object.assign({},svc,{steps:steps,lanes:lanes});
  document.getElementById('l3title').innerHTML=svc.icon+' '+svc.name;
  document.getElementById('l3breadcrumb').innerHTML='หน้าหลัก &#x203A; งานบริการหลัก &#x203A; '+svc.name;
  var editMode=(_editModeSvc===id);
  var eBtnLabel=editMode?'&#x2714; เสร็จสิ้น':'&#x2699;&#xFE0F; แก้ไขขั้นตอน';
  var eBtnClass=editMode?'btn-edit-done':'btn-edit-toggle';
  var h='';

  // CATS special header
  if(id==='s5'){
    h+='<div class="cats-hero">';
    h+='<div class="cats-hero-content">';
    h+='<div class="cats-hero-tag">&#x2B50; iNT Mahidol · CATS</div>';
    h+='<div class="cats-hero-title">ศูนย์บริการวิชาการและฝึกอบรม<br>Center of Academic and Training Services</div>';
    h+='<div class="cats-hero-desc">บริหารจัดการหลักสูตรฝึกอบรมอย่างมืออาชีพ ตั้งแต่วิเคราะห์ความต้องการ ออกแบบหลักสูตร จนถึงประเมินผลและรายงาน</div>';
    h+='</div>';
    h+='<div class="cats-hero-icon">&#x1F393;</div>';
    h+='</div>';
  }

  h+='<div class="sec-label"><span class="sec-badge">A</span> Service Journey Map<span class="sec-note">— ภาพรวมการไหลของงานตั้งแต่ต้นจนจบ</span>';
  h+='<div style="margin-left:auto;display:flex;gap:7px">';
  if(editMode) h+='<button onclick="openLaneModal(\''+id+'\')" class="btn-lane-mgr">🏷 จัดการ Lane</button>';
  h+='<button onclick="toggleStepEdit(\''+id+'\')" class="'+eBtnClass+'">'+eBtnLabel+'</button>';
  h+='</div></div>';
  h+=buildJM(svcW,editMode);
  h+='<div class="sec-label" style="margin-top:26px"><span class="sec-badge">B</span> Swimlane Diagram<span class="sec-note">— บทบาทผู้รับผิดชอบในแต่ละขั้นตอน</span></div>';
  h+=buildSL(svcW);
  document.getElementById('l3content').innerHTML=h;
  showLayer('layer3');
  // กู้คืนตำแหน่งสกรอลเดิม (รอ 1 เฟรมให้ browser layout เสร็จก่อน เพื่อให้ scrollHeight ใหม่พร้อมใช้)
  if(_scrollEl){
    requestAnimationFrame(function(){ _scrollEl.scrollTop=_savedScrollTop; });
  }
  var _slWrapNew=document.querySelector('.sl-wrap');
  if(_slWrapNew && _savedSlScrollLeft){
    requestAnimationFrame(function(){ _slWrapNew.scrollLeft=_savedSlScrollLeft; });
  }
}

function buildJM(svc,editMode){
  var c=svc.color,cl=svc.colorLight;
  var mapping=_getMapping();
  var h='<div class="jm-wrap">';
  if(editMode){
    h+='<div style="display:flex;align-items:center;gap:7px;padding:8px 14px;margin-bottom:12px;background:#fef3c7;border-radius:10px;border:1px solid #fcd34d;font-size:12px;color:#92400e;font-weight:600">&#x26A0;&#xFE0F; โหมดแก้ไข — ปรับขั้นตอนได้เลย กด &quot;เสร็จสิ้น&quot; เมื่อเสร็จ</div>';
  }
  h+='<div class="jm-inner">';
  svc.steps.forEach(function(step,i){
    var primLanes=step.lanes||[step.lane||0];
    var firstLaneLabel=svc.lanes[primLanes[0]]||'';
    var laneTagHtml='<div class="jm-lane-tag" style="background:'+c+'">'+firstLaneLabel+(primLanes.length>1?' <span style="font-size:9px;opacity:.8">+' +(primLanes.length-1)+'</span>':'')+'</div>';
    var nextStep=i<svc.steps.length-1?svc.steps[i+1]:null;
    var nextPrimLanes=nextStep?(nextStep.lanes||[nextStep.lane||0]):primLanes;
    // combined SOPs: global key + all per-lane keys
    var linked={};
    Object.assign(linked,mapping[svc.id+'_'+step.id]||{});
    primLanes.forEach(function(li){Object.assign(linked,mapping[svc.id+'_'+step.id+'_L'+li]||{});});
    var linkedIds=Object.keys(linked);
    h+='<div class="jm-step"><div class="jm-num" style="background:'+c+'">'+step.id+'</div>';
    // JM card = display only — ไม่ clickable สำหรับ SOP (เพิ่ม SOP ได้ใน Swimlane)
    h+='<div class="jm-card" style="background:'+cl+';border-color:'+c+';cursor:default">';
    h+='<div class="jm-card-name">'+step.name+'</div>';
    h+=laneTagHtml;
    h+='<div class="jm-desc">'+step.desc+'</div>';
    if(!editMode){
      if(linkedIds.length){
        if(!_sopFlat.length) _loadSopData();
        h+='<div class="jm-sop-badges">';
        linkedIds.forEach(function(sid){
          var bVal=linked[sid];
          var _bSop=_sopFlat.find(function(x){return x.id===sid;})||null;
          // ยึดชื่อ/ผู้รับผิดชอบสดจาก _sopFlat (โหลดจาก Supabase ทุกครั้ง) เป็นหลัก
          // ใช้ snapshot เก่าที่เก็บไว้ตอน link (bVal.n / .a) เป็นแค่ fallback กรณี SOP ถูกลบไปแล้วเท่านั้น
          var bName=_bSop?_bSop.name:(typeof bVal==='object'?bVal.n:bVal);
          var bAppr=_bSop?(_bSop.approver||''):(typeof bVal==='object'?bVal.a:'');
          _bSop=_bSop||{};
          var bColor=_bSop.color||c;
          var bTitle=bAppr?'SOP : '+bName+' | ผู้รับผิดชอบ: '+bAppr:'SOP : '+bName;
          h+='<span class="jm-sop-badge" style="background:'+bColor+';color:#fff;flex-direction:column;align-items:flex-start;padding:4px 8px;gap:2px;margin-bottom:2px;cursor:pointer" title="'+bTitle+' — คลิกเพื่อดูเนื้อหา" onclick="event.stopPropagation();openSopContentView(\''+sid+'\')">';
          h+='<span style="font-size:8.5px;font-weight:800;opacity:.75;letter-spacing:.04em">SOP</span>';
          h+='<span style="font-size:10px;font-weight:700;line-height:1.35;word-break:break-word;white-space:normal">'+bName+'</span>';
          if(bAppr){
            h+='<span style="font-size:9px;font-weight:600;word-break:break-word;white-space:normal;display:flex;align-items:center;gap:3px;margin-top:1px">';
            h+=_personAvatar(bAppr);
            h+='<span style="opacity:.9">'+bAppr+'</span></span>';
          }
          h+='</span>';
        });
        h+='</div>';
      } else {
        h+='<div class="jm-add-hint" style="color:#cbd5e1;font-style:italic">ยังไม่มี SOP</div>';
      }
    } else {
      // Edit mode controls
      h+='<div class="jm-edit-controls">';
      if(i>0) h+='<button class="jm-edit-btn jm-move" onclick="moveStep(\''+svc.id+'\','+step.id+',\'up\')">&#x2191;</button>';
      if(i<svc.steps.length-1) h+='<button class="jm-edit-btn jm-move" onclick="moveStep(\''+svc.id+'\','+step.id+',\'down\')">&#x2193;</button>';
      h+='<button class="jm-edit-btn jm-edit" onclick="openStepModal(\''+svc.id+'\','+step.id+')">&#x270F;</button>';
      h+='<button class="jm-edit-btn jm-del" onclick="deleteStep(\''+svc.id+'\','+step.id+')">&#x1F5D1;</button>';
      h+='</div>';
    }
    h+='</div></div>';
    if(i<svc.steps.length-1){
      var ac=nextPrimLanes[0]!==primLanes[0]?c:'#cbd5e1';
      h+='<div class="jm-arrow"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="'+ac+'" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg></div>';
    }
  });
  if(editMode){
    h+='<div class="jm-arrow"></div><div class="jm-add-step-wrap">';
    h+='<button class="jm-add-step-btn" onclick="openStepModal(\''+svc.id+'\',null)" title="เพิ่มขั้นตอนใหม่">+</button>';
    h+='<div style="font-size:9.5px;color:#3b82f6;margin-top:4px;white-space:nowrap;font-weight:600">เพิ่มขั้นตอน</div></div>';
  }
  h+='</div></div>';
  return h;
}

function buildSL(svc){
  var c=svc.color;
  var editMode=(_editModeSvc===svc.id); // inherit edit state from global
  var mapping=_getMapping();
  if(!_sopFlat.length) _loadSopData();
  var h='<div class="sl-wrap"><table class="sl-table"><thead><tr class="sl-head">';
  h+='<th>ผู้รับผิดชอบ</th>';
  svc.steps.forEach(function(step,si){
    h+='<th style="position:relative">';
    h+='<div><span class="snum" style="background:'+c+'">'+step.id+'</span></div>';
    h+=step.name;
    // edit mode: ปุ่ม ✎ แก้ไข และ 🗑 ลบ ใน column header
    if(editMode){
      h+='<div style="display:flex;gap:4px;justify-content:center;margin-top:4px">';
      h+='<button class="jm-edit-btn jm-edit" onclick="openStepModal(\''+svc.id+'\','+step.id+')" title="แก้ไข">&#x270F;</button>';
      h+='<button class="jm-edit-btn jm-del" onclick="deleteStep(\''+svc.id+'\','+step.id+')" title="ลบ">&#x1F5D1;</button>';
      if(si>0) h+='<button class="jm-edit-btn jm-move" onclick="moveStep(\''+svc.id+'\','+step.id+',\'up\')" title="เลื่อนซ้าย">&#x2190;</button>';
      if(si<svc.steps.length-1) h+='<button class="jm-edit-btn jm-move" onclick="moveStep(\''+svc.id+'\','+step.id+',\'down\')" title="เลื่อนขวา">&#x2192;</button>';
      h+='</div>';
    }
    h+='</th>';
  });
  // edit mode: ปุ่ม ➕ เพิ่มขั้นตอน เป็น column สุดท้าย
  if(editMode){
    h+='<th style="min-width:90px;vertical-align:middle">';
    h+='<button onclick="openStepModal(\''+svc.id+'\',null)" style="display:flex;flex-direction:column;align-items:center;gap:4px;background:#f0f9ff;border:2px dashed #38bdf8;border-radius:10px;padding:8px 14px;cursor:pointer;font-family:\'Sarabun\',sans-serif;color:#0369a1;font-size:11px;font-weight:700;width:100%">';
    h+='<span style="font-size:18px;line-height:1">&#xFF0B;</span>';
    h+='เพิ่มขั้นตอน</button>';
    h+='</th>';
  }
  h+='</tr></thead><tbody>';
  svc.lanes.forEach(function(lane,li){
    var lc=svc.laneColors?svc.laneColors[li]||'#f8fafc':'#f8fafc';
    h+='<tr class="sl-row"><td class="lane-hd" style="background:'+lc+'">'+lane+'</td>';
    svc.steps.forEach(function(step){
      var primLanes=step.lanes||[step.lane||0];
      var isPri=primLanes.indexOf(li)!==-1;
      var isInv=step.involves&&step.involves.indexOf(li)!==-1;
      // SOP: multi-primary → per-lane only (ไม่ merge global เพื่อไม่ให้ SOP ซ้ำทุก row)
      //       single-primary → merge global + per-lane เพื่อ backward compat
      var linked;
      if(primLanes.length>1){
        linked=mapping[svc.id+'_'+step.id+'_L'+li]||{};
      } else {
        linked=Object.assign({},mapping[svc.id+'_'+step.id]||{},mapping[svc.id+'_'+step.id+'_L'+li]||{});
      }
      var linkedIds=Object.keys(linked);
      if(isPri){
        h+='<td><div class="sl-cell" style="background:'+lc+';cursor:pointer;position:relative" title="คลิกเพื่อเลือก SOP" onclick="openSOPModal(\''+svc.id+'\','+step.id+','+li+')">';
        // ปุ่มแก้ไข step (edit mode เท่านั้น) — stopPropagation เพื่อไม่ trigger SOP modal
        if(editMode){
          h+='<button class="sl-cell-edit-btn" onclick="event.stopPropagation();openStepModal(\''+svc.id+'\','+step.id+')" title="แก้ไขขั้นตอน / เปลี่ยน Lane">&#x270F;</button>';
          if(primLanes.length>1) h+='<button class="sl-cell-edit-btn" style="right:28px;background:rgba(254,226,226,.9);color:#dc2626;border-color:#fca5a5" onclick="event.stopPropagation();_removePrimaryLane(\''+svc.id+'\','+step.id+','+li+')" title="ยกเลิก Lane นี้จากผู้รับผิดชอบหลัก">&#x2715;</button>';
        }
        h+='<div class="sl-cell-name">'+step.name+'</div>';
        // badge รับผิดชอบหลัก + X/N ถ้ามีหลาย primary lane
        var primBadge='<span class="rpill rpill-p" style="background:'+c+'">รับผิดชอบหลัก';
        if(primLanes.length>1) primBadge+=' <span style="opacity:.8;font-size:9px">('+(primLanes.indexOf(li)+1)+'/'+primLanes.length+')</span>';
        primBadge+='</span>';
        h+=primBadge;
        h+='<div class="sl-cell-desc">'+step.desc+'</div>';
        // SOP badges
        if(linkedIds.length){
          h+='<div class="sl-sop-badges">';
          linkedIds.forEach(function(sid){
            var bVal=linked[sid];
            var _bSop=_sopFlat.find(function(x){return x.id===sid;})||null;
            var bName=_bSop?_bSop.name:(typeof bVal==='object'?bVal.n:bVal);
            var bAppr=_bSop?(_bSop.approver||''):(typeof bVal==='object'?bVal.a:'');
            _bSop=_bSop||{};
            var bColor=_bSop.color||c;
            h+='<div class="sl-sop-badge" style="background:'+bColor+'">';
            h+='<span style="font-size:7.5px;font-weight:800;opacity:.7;letter-spacing:.04em">SOP</span>';
            h+='<span style="font-size:9.5px;font-weight:700;line-height:1.3">'+bName+'</span>';
            if(bAppr){
              h+='<span style="font-size:8.5px;opacity:.85;display:flex;align-items:center;gap:2px;margin-top:1px">';
              h+=_personAvatar(bAppr);
              h+='<span>'+bAppr+'</span></span>';
            }
            h+='</div>';
          });
          h+='</div>';
        }
        h+='</div></td>';
      } else if(isInv){
        h+='<td><div class="sl-cell" style="background:#f8fafc">';
        h+='<span class="rpill rpill-i">ประสานงาน</span>';
        if(editMode) h+='<button class="sl-add-primary-btn" onclick="_addPrimaryLane(\''+svc.id+'\','+step.id+','+li+')" title="เพิ่ม Lane นี้เป็นผู้รับผิดชอบหลัก">&#x1F4CC; ตั้งเป็นหลัก</button>';
        h+='</div></td>';
      } else {
        h+='<td><div class="sl-cell" style="background:#fafafa">';
        if(editMode) h+='<button class="sl-add-primary-btn" onclick="_addPrimaryLane(\''+svc.id+'\','+step.id+','+li+')" title="เพิ่ม Lane นี้เป็นผู้รับผิดชอบหลัก">&#x1F4CC; ตั้งเป็นหลัก</button>';
        h+='</div></td>';
      }
    });
    h+='</tr>';
  });
  h+='</tbody></table></div>';
  return h;
}

/* ============================================================
   SOP Modal Logic
   ============================================================ */
// _mCtx, _sopFlat, _staffPhotos declared at top of script

async function _loadSopData() {
  try {
    var r1 = await _SB.from('departments').select('id,full_name,color');
    var r2 = await _SB.from('processes').select('id,name,department_id');
    var r3 = await _SB.from('sops').select('id,name,person,status,process_id');
    if (r1.error) throw r1.error; if (r2.error) throw r2.error; if (r3.error) throw r3.error;
    if (!r3.data || !r3.data.length) return false;
    var deptIdx = {}; (r1.data||[]).forEach(function(d){ deptIdx[d.id] = d; });
    var procIdx = {}; (r2.data||[]).forEach(function(p){ procIdx[p.id] = p; });
    _sopFlat = [];
    (r3.data||[]).forEach(function(sop) {
      var proc = procIdx[sop.process_id]; if (!proc) return;
      var dept = deptIdx[proc.department_id] || {};
      _sopFlat.push({
        id: sop.id, name: sop.name,
        dept: proc.department_id, deptFull: dept.full_name || proc.department_id,
        proc: proc.name, status: sop.status || '',
        approver: sop.person || '',
        color: dept.color || '#005992'
      });
    });
    return true;
  } catch(err) {
    console.warn('โหลดข้อมูล SOP จาก Supabase ไม่สำเร็จ:', err);
    _showLoadError('โหลดข้อมูล SOP ไม่สำเร็จ อาจเห็นสี/ชื่อ SOP ไม่ตรงกับข้อมูลจริง');
    return false;
  }
}

function _getMapping() {
  return _kvGet('ra_journey_mapping') || {};
}

function _updateFtrCount() {
  var n = Object.keys(_mCtx.selected).length;
  document.getElementById('sopFtrCount').textContent = n > 0 ? 'เลือกแล้ว ' + n + ' รายการ' : '';
}

async function openSOPModal(svcId, stepId, laneIdx) {
  if (!await _loadSopData()) {
    alert('ยังไม่พบข้อมูล SOP\nกรุณาเปิด "กระบวนการหลัก SOP" อย่างน้อย 1 ครั้งก่อน หรือตรวจสอบว่า login อยู่หรือไม่');
    return;
  }
  var steps = _getSteps(svcId);
  var step = steps.find(function(s) { return s.id === stepId; });
  if (!step) return;

  _mCtx.svcId = svcId;
  _mCtx.stepId = stepId;
  _mCtx.primLanes = step.lanes || [step.lane || 0];
  _mCtx.laneTemp = {};

  var activeLane = (laneIdx !== null && laneIdx !== undefined) ? laneIdx : _mCtx.primLanes[0];
  _mCtx.laneIdx = activeLane;

  var mapping = _getMapping();
  var key = svcId + '_' + stepId + '_L' + activeLane;
  var globalKey = svcId + '_' + stepId;
  // โหลด per-lane ก่อน ถ้าไม่มีให้ fallback global key (single-primary เท่านั้น) เพื่อให้เห็น SOP เดิม
  if (mapping[key]) {
    _mCtx.selected = JSON.parse(JSON.stringify(mapping[key]));
  } else if (_mCtx.primLanes.length === 1 && mapping[globalKey]) {
    _mCtx.selected = JSON.parse(JSON.stringify(mapping[globalKey]));
  } else {
    _mCtx.selected = {};
  }

  document.getElementById('sopModalTitle').textContent = 'เลือก SOP สำหรับขั้นตอนนี้';
  document.getElementById('sopModalSub').textContent = 'Step ' + stepId + ': ' + step.name;
  document.getElementById('sopSearchInput').value = '';
  _renderSopLaneTabs(_getLanes(svcId), _mCtx.primLanes, activeLane);
  _renderSopList('');
  _updateFtrCount();
  document.getElementById('sopModalBg').classList.add('open');
}

function _renderSopLaneTabs(lanes, primLanes, activeLaneIdx) {
  var el = document.getElementById('sopLaneTabs');
  if (!el) return;
  if (primLanes.length <= 1) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  var h = '';
  primLanes.forEach(function(li) {
    var active = li === activeLaneIdx;
    var s = active
      ? 'background:#005992;color:#fff;border:none'
      : 'background:#f1f5f9;color:#475569;border:1.5px solid #e2e8f0';
    h += '<button onclick="_switchSopLaneTab('+li+')" style="'+s+';padding:5px 14px;border-radius:8px;font-family:\'Sarabun\',sans-serif;font-size:12px;font-weight:700;cursor:pointer;transition:.15s">'+(lanes[li]||'Lane '+li)+'</button>';
  });
  el.innerHTML = h;
}

function _switchSopLaneTab(laneIdx) {
  if (!_mCtx.laneTemp) _mCtx.laneTemp = {};
  _mCtx.laneTemp[_mCtx.laneIdx] = JSON.parse(JSON.stringify(_mCtx.selected));
  _mCtx.laneIdx = laneIdx;
  if (_mCtx.laneTemp[laneIdx] !== undefined) {
    _mCtx.selected = JSON.parse(JSON.stringify(_mCtx.laneTemp[laneIdx]));
  } else {
    var m = _getMapping(); var k = _mCtx.svcId+'_'+_mCtx.stepId+'_L'+laneIdx;
    _mCtx.selected = m[k] ? JSON.parse(JSON.stringify(m[k])) : {};
  }
  _renderSopLaneTabs(_getLanes(_mCtx.svcId), _mCtx.primLanes, laneIdx);
  _renderSopList(document.getElementById('sopSearchInput').value);
  _updateFtrCount();
}

function _renderSopList(search) {
  var s = search.toLowerCase().trim();
  var list = document.getElementById('sopModalList');
  var filtered = s ? _sopFlat.filter(function(x) {
    return x.name.toLowerCase().indexOf(s) !== -1 ||
           x.dept.toLowerCase().indexOf(s) !== -1 ||
           x.proc.toLowerCase().indexOf(s) !== -1;
  }) : _sopFlat;

  if (!filtered.length) {
    list.innerHTML = '<div class="sop-empty">ไม่พบ SOP ที่ตรงกับคำค้นหา</div>';
    return;
  }

  // Group by dept + proc
  var groups = {};
  var order = [];
  filtered.forEach(function(sop) {
    var gk = sop.dept + ' — ' + sop.proc;
    if (!groups[gk]) { groups[gk] = []; order.push(gk); }
    groups[gk].push(sop);
  });

  var h = '';
  order.forEach(function(gk) {
    h += '<div class="sop-group-hdr">' + gk + '</div>';
    groups[gk].forEach(function(sop) {
      var chk = _mCtx.selected[sop.id] ? ' checked' : '';
      var safeId = sop.id.replace(/"/g, '');
      var safeName = sop.name.replace(/"/g, '&quot;');
      var safeAppr = (sop.approver||'').replace(/"/g, '&quot;');
      h += '<div class="sop-item">';
      h += '<input type="checkbox"' + chk + ' data-sid="' + safeId + '" data-sname="' + safeName + '" data-sappr="' + safeAppr + '">';
      h += '<div><div class="sop-item-name">' + sop.name + '</div>';
      h += '<div class="sop-item-meta">' + sop.dept + (sop.status ? ' \xb7 ' + sop.status : '') + (sop.approver ? ' \xb7 ' + sop.approver : '') + '</div></div>';
      h += '</div>';
    });
  });
  list.innerHTML = h;
}

function filterSOPList() {
  _renderSopList(document.getElementById('sopSearchInput').value);
}

// Event delegation — handles all checkbox changes inside the modal
document.addEventListener('change', function(e) {
  if (e.target.type === 'checkbox' && e.target.closest('#sopModalList')) {
    var sid  = e.target.getAttribute('data-sid');
    var name = e.target.getAttribute('data-sname');
    var appr = e.target.getAttribute('data-sappr');
    if (e.target.checked) _mCtx.selected[sid] = {n: name, a: appr};
    else delete _mCtx.selected[sid];
    _updateFtrCount();
  }
});

// Close on backdrop click — defer until DOM ready
document.addEventListener('DOMContentLoaded', function() {
  var bg = document.getElementById('sopModalBg');
  if (bg) bg.addEventListener('click', function(e) {
    if (e.target === this) closeSOPModal();
  });
});

function closeSOPModal() {
  document.getElementById('sopModalBg').classList.remove('open');
}

async function saveSOPModal() {
  var mapping = _getMapping();
  // commit current tab to laneTemp
  if (!_mCtx.laneTemp) _mCtx.laneTemp = {};
  _mCtx.laneTemp[_mCtx.laneIdx] = JSON.parse(JSON.stringify(_mCtx.selected));
  // write only lanes we visited (others unchanged in mapping)
  Object.keys(_mCtx.laneTemp).forEach(function(li) {
    var key = _mCtx.svcId + '_' + _mCtx.stepId + '_L' + li;
    var sops = _mCtx.laneTemp[li];
    if (Object.keys(sops).length === 0) delete mapping[key];
    else mapping[key] = sops;
  });
  // ลบ legacy global key (svcId_stepId) ที่ค้างจากระบบเก่า — migrate ไป per-lane แล้ว
  delete mapping[_mCtx.svcId + '_' + _mCtx.stepId];
  var _btn=document.getElementById('sopSaveBtn');if(_btn){_btn.disabled=true;_btn.textContent='กำลังบันทึก…';}
  await _kvSet('ra_journey_mapping', mapping);
  if(_btn){_btn.disabled=false;_btn.textContent='✓ บันทึก';}
  closeSOPModal();
  showDetail(_mCtx.svcId);
}
/* ============================================================ */

/* ============================================================
   Staff Photos — auto-fetch จากเว็บ iNT แล้ว cache ลง localStorage
   ============================================================ */
var _customPhotosReadyPromise = (async function(){
  try{
    var {data,error} = await _SB.from('staff_photos').select('name,photo_url');
    if(!error && data) data.forEach(function(r){ _customStaffPhotos[r.name] = r.photo_url; });
  }catch(e){ console.error('โหลดรูปพนักงาน (custom) ไม่สำเร็จ:', e); }
})();

(function() {
  var CACHE_KEY = 'int_staff_photos_v2';
  var cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try { _staffPhotos = JSON.parse(cached); } catch(e) {}
    return;
  }
  // ลอง fetch หน้า director-and-staff เพื่อดึง img src + alt
  fetch('https://int.mahidol.ac.th/director-and-staff/')
    .then(function(r) { return r.text(); })
    .then(function(raw) {
      // parse img: src + alt จาก HTML ดิบ
      var re = /<img[^>]+src="([^"]*wp-content\/uploads[^"]*)"[^>]*alt="([^"]+)"/g;
      var m;
      while ((m = re.exec(raw)) !== null) {
        var url = m[1], alt = m[2].trim();
        // ตัด position/dept ออก เหลือแค่ชื่อ
        var name = alt
          .replace(/\s+(หัวหน้า|รองหัวหน้า|เจ้าหน้าที่|นักวิชาการ|นักทรัพยากร|นักประชาสัมพันธ์|นักนิเทศ|นิติกร|ผู้อำนวยการ|รองผู้|ผู้ช่วย|สถาบัน|มหาวิทยาลัย).*/g, '')
          .trim();
        if (name.length >= 5) _staffPhotos[name] = url;
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(_staffPhotos));
    })
    .catch(function() {
      // CORS block หรือ network error → ใช้ initial avatar แทน
    });
})();

async function openSopContentView(sopId){
  var bg=document.getElementById('sopContentViewBg');
  var nameEl=document.getElementById('sopViewName');
  var metaEl=document.getElementById('sopViewMeta');
  var bodyEl=document.getElementById('sopViewBody');
  var editLink=document.getElementById('sopViewEditLink');
  nameEl.textContent='กำลังโหลด…';
  metaEl.textContent='';
  bodyEl.innerHTML='';
  editLink.href='int_sop_interactive.html?openSop='+encodeURIComponent(sopId);
  bg.classList.add('open');
  try{
    var {data,error}=await _SB.from('sops').select('name,content,person,status').eq('id',sopId).single();
    if(error)throw error;
    nameEl.textContent=(data&&data.name)||'SOP';
    metaEl.textContent=(data&&data.person?'ผู้รับผิดชอบ: '+data.person+'  ·  ':'')+'สถานะ: '+((data&&data.status)||'ร่าง');
    var html=(data&&data.content)||'';
    var plain=html.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,'').trim();
    bodyEl.innerHTML=plain?html:'<div style="color:#94a3b8;font-style:italic;padding:24px 0;text-align:center">ยังไม่มีเนื้อหา — คลิก "แก้ไขเนื้อหานี้" ด้านล่างเพื่อเริ่มเขียน</div>';
  }catch(err){
    console.error('โหลดเนื้อหา SOP ไม่สำเร็จ:',err);
    nameEl.textContent='โหลดไม่สำเร็จ';
    bodyEl.innerHTML='<div style="color:#dc2626">โหลดเนื้อหาไม่สำเร็จ: '+((err&&err.message)||err)+'</div>';
  }
}
function closeSopContentView(){document.getElementById('sopContentViewBg').classList.remove('open');}

/* ============================================================
   จัดการรูปพนักงาน — อัปโหลดหลายรูปพร้อมกัน ผูกกับชื่อคน
   ============================================================ */
function _escHtml(s){
  return (s+'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
}
function _guessNameFromFilename(fn){
  var n=fn.replace(/\.[^.]+$/,'');
  n=n.replace(/[_\-]+/g,' ').replace(/\s+/g,' ').trim();
  n=n.replace(/^\d+\s*/,'');
  return n;
}
async function _loadKnownPersonNames(){
  if(_knownPersonNames) return _knownPersonNames;
  var names={};
  try{
    var [r1,r2]=await Promise.all([
      _SB.from('processes').select('owner,approver,deputy,director'),
      _SB.from('sops').select('person')
    ]);
    (r1.data||[]).forEach(function(row){
      [row.owner,row.approver,row.deputy,row.director].forEach(function(n){
        if(n&&n.trim()) names[n.trim()]=true;
      });
    });
    (r2.data||[]).forEach(function(row){
      if(row.person&&row.person.trim()) names[row.person.trim()]=true;
    });
  }catch(e){ console.error('โหลดรายชื่อในระบบไม่สำเร็จ:',e); }
  _knownPersonNames=names;
  var dl=document.getElementById('staffPhotoNameList');
  dl.innerHTML=Object.keys(names).sort().map(function(n){return '<option value="'+_escHtml(n)+'">';}).join('');
  return names;
}
function _isKnownPersonName(name){
  if(!_knownPersonNames||!name) return false;
  var clean=name.trim();
  var clean2=clean.replace(/^(นาย|นาง|นางสาว)\s*/,'').trim();
  return !!(_knownPersonNames[clean]||_knownPersonNames[clean2]);
}
function _staffPhotoMatchBadge(name){
  var ok=_isKnownPersonName(name);
  return ok
    ? '<span style="font-size:10.5px;color:#16a34a;font-weight:700;white-space:nowrap">&#10003; ตรงกับชื่อในระบบ</span>'
    : '<span style="font-size:10.5px;color:#ea580c;font-weight:700;white-space:nowrap">&#9888; ไม่พบชื่อนี้ในระบบ</span>';
}
function _onStaffPhotoNameInput(idx,el){
  _pendingStaffPhotos[idx].name=el.value;
  var badge=el.parentElement.querySelector('.staff-photo-badge');
  if(badge) badge.outerHTML=_staffPhotoMatchBadge(el.value).replace('<span','<span class="staff-photo-badge"');
}
async function openStaffPhotoManager(){
  _pendingStaffPhotos=[];
  document.getElementById('staffPhotoList').innerHTML='';
  document.getElementById('staffPhotoFiles').value='';
  document.getElementById('staffPhotoStatus').textContent='กำลังโหลดรายชื่อในระบบ…';
  document.getElementById('staffPhotoBg').classList.add('open');
  await _loadKnownPersonNames();
  document.getElementById('staffPhotoStatus').textContent='';
}
function closeStaffPhotoManager(){document.getElementById('staffPhotoBg').classList.remove('open');}
function _onStaffPhotoFilesChosen(ev){
  var files=Array.from(ev.target.files||[]);
  var list=document.getElementById('staffPhotoList');
  files.forEach(function(file){
    var idx=_pendingStaffPhotos.length;
    var guessed=_guessNameFromFilename(file.name);
    var previewUrl=URL.createObjectURL(file);
    _pendingStaffPhotos.push({file:file,name:guessed,previewUrl:previewUrl});
    var row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:8px;border:1px solid #e2e8f0;border-radius:8px';
    row.innerHTML=
      '<img src="'+previewUrl+'" style="width:56px;height:56px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid #e2e8f0">'+
      '<div style="flex:1;display:flex;flex-direction:column;gap:3px">'+
        '<input type="text" list="staffPhotoNameList" value="'+_escHtml(guessed)+'" placeholder="ชื่อ-นามสกุล" oninput="_onStaffPhotoNameInput('+idx+',this)" style="padding:7px 9px;border:1.5px solid #e2e8f0;border-radius:6px;font-family:inherit;font-size:13px">'+
        _staffPhotoMatchBadge(guessed).replace('<span','<span class="staff-photo-badge"')+
      '</div>'+
      '<span style="font-size:11px;color:#94a3b8;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+_escHtml(file.name)+'">'+_escHtml(file.name)+'</span>';
    list.appendChild(row);
  });
}
async function _uploadAllStaffPhotos(){
  if(!_pendingStaffPhotos.length){alert('ยังไม่ได้เลือกไฟล์');return;}
  var btn=document.getElementById('staffPhotoUploadBtn');
  var statusEl=document.getElementById('staffPhotoStatus');
  btn.disabled=true;
  var ok=0,fail=0,lastErr='';
  for(var i=0;i<_pendingStaffPhotos.length;i++){
    var item=_pendingStaffPhotos[i];
    var name=(item.name||'').trim();
    statusEl.textContent='กำลังอัปโหลด '+(i+1)+'/'+_pendingStaffPhotos.length+'…';
    if(!name){fail++;continue;}
    try{
      var ext=(item.file.name.split('.').pop()||'jpg').toLowerCase();
      // Supabase Storage ไม่ยอมรับตัวอักษรไทยในชื่อไฟล์/พาธ (key) — ใช้ path ที่เป็น ASCII ล้วน
      // ชื่อจริงเก็บอยู่ใน staff_photos.name (คอลัมน์ text ธรรมดา ใส่ภาษาไทยได้ปกติ) แยกจาก path
      var path='staff/'+Date.now()+'_'+Math.random().toString(36).slice(2,8)+'.'+ext;
      var {error:upErr}=await _SB.storage.from('personnel-photo').upload(path,item.file,{upsert:true});
      if(upErr)throw upErr;
      var {data:pu}=_SB.storage.from('personnel-photo').getPublicUrl(path);
      var publicUrl=pu&&pu.publicUrl;
      var {error:dbErr}=await _SB.from('staff_photos').upsert({name:name,photo_url:publicUrl,updated_by:(_myProfile&&_myProfile.email)||''},{onConflict:'name'});
      if(dbErr)throw dbErr;
      _customStaffPhotos[name]=publicUrl;
      ok++;
    }catch(err){
      console.error('อัปโหลดรูป '+name+' ไม่สำเร็จ:',err);
      fail++;
      lastErr=(err&&err.message)||String(err);
    }
  }
  btn.disabled=false;
  statusEl.innerHTML='เสร็จแล้ว: สำเร็จ '+ok+' รูป'+(fail?' · ล้มเหลว '+fail+' รูป':'')+(ok?' — รีเฟรชหน้าเพื่อดูรูปใหม่':'')+
    (lastErr?'<div style="color:#dc2626;margin-top:4px">สาเหตุ: '+_escHtml(lastErr)+'</div>':'');
  if(ok){_pendingStaffPhotos=[];document.getElementById('staffPhotoList').innerHTML='';document.getElementById('staffPhotoFiles').value='';}
}
function _staffPhoto(name) {
  if (!name) return '';
  var clean = name.replace(/^(นาย|นาง|นางสาว)\s*/, '').trim();
  return _customStaffPhotos[name] || _customStaffPhotos[clean] ||
         _staffPhotos[name] || _staffPhotos[clean] || '';
}

function _personAvatar(name) {
  var url = _staffPhoto(name);
  var style = 'width:26px;height:26px;border-radius:50%;vertical-align:middle;flex-shrink:0;';
  if (url) {
    return '<img src="' + url + '" style="' + style + 'object-fit:cover;border:1.5px solid rgba(255,255,255,.5)" onerror="this.style.display=\'none\'">';
  }
  // Initial avatar
  var clean = name.replace(/^(นาย|นาง|นางสาว)\s*/, '').trim();
  var ch = clean.charAt(0) || '?';
  return '<span style="' + style + 'display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.28);font-size:10px;font-weight:800;color:#fff">' + ch + '</span>';
}
/* ============================================================ */

/* ============================================================
   Step CRUD — localStorage key: int_custom_steps_v1
   ============================================================ */
function _getSteps(svcId){
  var custom=_kvGet(_STEPS_KEY)||{};
  var steps;
  if(custom[svcId]) steps=custom[svcId];
  else{var svc=SVC.find(function(s){return s.id===svcId;});steps=svc?JSON.parse(JSON.stringify(svc.steps)):[];}
  // normalize: ensure step.lanes always exists (backward compat with old step.lane)
  steps.forEach(function(step){
    if(!step.lanes) step.lanes=[step.lane!==undefined?step.lane:0];
  });
  return steps;
}
async function _saveSteps(svcId,steps){
  var custom=_kvGet(_STEPS_KEY)||{};
  custom[svcId]=steps;
  return _kvSet(_STEPS_KEY,custom);
}
async function _reindexAndSave(svcId,steps){
  var mapping=_getMapping();
  var remap={};
  steps.forEach(function(s,i){remap[s.id]=i+1;});
  var nm={};
  Object.keys(mapping).forEach(function(k){
    var parts=k.split('_');
    if(parts[0]===svcId){
      var oid=parseInt(parts[1]);
      if(remap[oid]!==undefined){
        // preserve per-lane suffix (_L0, _L1, ...) if present
        var suffix=parts.length>2?'_'+parts.slice(2).join('_'):'';
        nm[svcId+'_'+remap[oid]+suffix]=mapping[k];
      }
    } else { nm[k]=mapping[k]; }
  });
  await _kvSet('ra_journey_mapping',nm);
  steps.forEach(function(s,i){s.id=i+1;});
  await _saveSteps(svcId,steps);
}
function toggleStepEdit(svcId){
  _editModeSvc=(_editModeSvc===svcId)?'':svcId;
  showDetail(svcId);
}
async function moveStep(svcId,stepId,dir){
  var steps=_getSteps(svcId);
  var idx=steps.findIndex(function(s){return s.id===stepId;});
  if(idx<0) return;
  var swap=dir==='up'?idx-1:idx+1;
  if(swap<0||swap>=steps.length) return;
  var tmp=steps[idx];steps[idx]=steps[swap];steps[swap]=tmp;
  await _reindexAndSave(svcId,steps);
  showDetail(svcId);
}
async function deleteStep(svcId,stepId){
  var steps=_getSteps(svcId);
  var step=steps.find(function(s){return s.id===stepId;});
  if(!step) return;
  if(!confirm('ลบขั้นตอน "'+step.name+'" ?\nSOP ที่ผูกกับขั้นตอนนี้จะถูกลบออกด้วย')) return;
  steps=steps.filter(function(s){return s.id!==stepId;});
  await _reindexAndSave(svcId,steps);
  showDetail(svcId);
}
function _rebuildStepModalLanes(svcId,primaryChecked,involvesChecked){
  var lanes=_getLanes(svcId);
  var chk=function(arr,i){return arr&&arr.indexOf(i)!==-1?' checked':'';};
  document.getElementById('stepLanesCheckboxes').innerHTML=
    lanes.map(function(l,i){return '<label class="step-involves-item"><input type="checkbox" value="'+i+'"'+chk(primaryChecked,i)+'> '+l+'</label>';}).join('');
  document.getElementById('stepInvCheckboxes').innerHTML=
    lanes.map(function(l,i){return '<label class="step-involves-item"><input type="checkbox" value="'+i+'"'+chk(involvesChecked,i)+'> '+l+'</label>';}).join('');
}
// backward compat alias (used by addLaneFromStep indirectly)
function _rebuildStepModalInvolves(svcId,checkedIndices){ _rebuildStepModalLanes(svcId,[],checkedIndices); }
function openStepModal(svcId,stepId){
  _stepCtx.svcId=svcId;_stepCtx.stepId=stepId;_stepCtx.mode=stepId===null?'add':'edit';
  document.getElementById('stepModalTitle').textContent=stepId===null?'➕ เพิ่มขั้นตอนใหม่':'✏️ แก้ไขขั้นตอน';
  if(stepId!==null){
    var steps=_getSteps(svcId);
    var step=steps.find(function(s){return s.id===stepId;});
    if(step){
      document.getElementById('stepNameInput').value=step.name;
      document.getElementById('stepDescInput').value=step.desc||'';
      var primLanes=step.lanes||[step.lane||0];
      _rebuildStepModalLanes(svcId,primLanes,step.involves||[]);
    }
  } else {
    document.getElementById('stepNameInput').value='';
    document.getElementById('stepDescInput').value='';
    _rebuildStepModalLanes(svcId,[0],[]);
  }
  document.getElementById('stepModalBg').classList.add('open');
}
function closeStepModal(){document.getElementById('stepModalBg').classList.remove('open');}
async function addLaneFromStep(){
  var inp=document.getElementById('stepNewLaneInput');
  var val=(inp.value||'').trim();
  if(!val) return;
  var svcId=_stepCtx.svcId;
  var lanes=_getLanes(svcId);
  if(lanes.indexOf(val)===-1){ lanes.push(val); await _saveLanes(svcId,lanes); }
  // collect currently checked before rebuild
  var priChecked=[],invChecked=[];
  document.getElementById('stepLanesCheckboxes').querySelectorAll('input[type=checkbox]:checked').forEach(function(cb){priChecked.push(parseInt(cb.value));});
  document.getElementById('stepInvCheckboxes').querySelectorAll('input[type=checkbox]:checked').forEach(function(cb){invChecked.push(parseInt(cb.value));});
  _rebuildStepModalLanes(svcId,priChecked,invChecked);
  // auto-check new lane in involves
  var newIdx=_getLanes(svcId).indexOf(val);
  var invBoxes=document.getElementById('stepInvCheckboxes').querySelectorAll('input[type=checkbox]');
  if(invBoxes[newIdx]) invBoxes[newIdx].checked=true;
  inp.value='';
}
async function saveStepModal(){
  var name=document.getElementById('stepNameInput').value.trim();
  if(!name){alert('กรุณาระบุชื่อขั้นตอน');return;}
  var desc=document.getElementById('stepDescInput').value.trim();
  var primLanes=[];
  document.getElementById('stepLanesCheckboxes').querySelectorAll('input[type=checkbox]:checked').forEach(function(cb){primLanes.push(parseInt(cb.value));});
  if(primLanes.length===0){alert('กรุณาเลือกผู้รับผิดชอบหลักอย่างน้อย 1 คน');return;}
  var lane=primLanes[0]; // backward compat: keep first as step.lane
  var involves=[];
  document.getElementById('stepInvCheckboxes').querySelectorAll('input[type=checkbox]:checked').forEach(function(cb){involves.push(parseInt(cb.value));});
  var svcId=_stepCtx.svcId;
  var steps=_getSteps(svcId);
  var _btn=document.getElementById('stepSaveBtn');if(_btn){_btn.disabled=true;_btn.textContent='กำลังบันทึก…';}
  if(_stepCtx.mode==='add'){
    var maxId=steps.reduce(function(m,s){return Math.max(m,s.id);},0);
    steps.push({id:maxId+1,name:name,lane:lane,lanes:primLanes,involves:involves,desc:desc});
    await _saveSteps(svcId,steps);
  } else {
    var idx=steps.findIndex(function(s){return s.id===_stepCtx.stepId;});
    if(idx>=0){steps[idx].name=name;steps[idx].desc=desc;steps[idx].lane=lane;steps[idx].lanes=primLanes;steps[idx].involves=involves;}
    await _saveSteps(svcId,steps);
  }
  if(_btn){_btn.disabled=false;_btn.textContent='✓ บันทึก';}
  closeStepModal();
  showDetail(svcId);
}
/* ============================================================ */

/* ============================================================
   Lane Management — localStorage key: int_custom_lanes_v1
   ============================================================ */
function _getLanes(svcId){
  var custom=_kvGet(_LANES_KEY)||{};
  if(custom[svcId]) return custom[svcId];
  var svc=SVC.find(function(s){return s.id===svcId;});
  return svc?svc.lanes.slice():[];
}
async function _saveLanes(svcId,lanes){
  var custom=_kvGet(_LANES_KEY)||{};
  custom[svcId]=lanes;
  return _kvSet(_LANES_KEY,custom);
}
// เพิ่ม/ลบ lane เป็นผู้รับผิดชอบหลักของ step (จาก Swimlane edit mode)
async function _addPrimaryLane(svcId,stepId,laneIdx){
  var steps=_getSteps(svcId);
  var step=steps.find(function(s){return s.id===stepId;});
  if(!step) return;
  if(!step.lanes) step.lanes=[step.lane||0];
  if(step.lanes.indexOf(laneIdx)===-1){
    step.lanes.push(laneIdx);
    step.lane=step.lanes[0]; // backward compat
  }
  await _saveSteps(svcId,steps);
  showDetail(svcId);
}
async function _removePrimaryLane(svcId,stepId,laneIdx){
  var steps=_getSteps(svcId);
  var step=steps.find(function(s){return s.id===stepId;});
  if(!step) return;
  if(!step.lanes) step.lanes=[step.lane||0];
  if(step.lanes.length<=1){alert('ขั้นตอนต้องมีผู้รับผิดชอบหลักอย่างน้อย 1 Lane');return;}
  step.lanes=step.lanes.filter(function(i){return i!==laneIdx;});
  step.lane=step.lanes[0];
  await _saveSteps(svcId,steps);
  showDetail(svcId);
}
async function _remapAndSaveLanes(svcId,newLanes){
  var oldLanes=_getLanes(svcId);
  var steps=_getSteps(svcId);
  steps.forEach(function(step){
    // remap primary lanes array
    step.lanes=(step.lanes||[step.lane||0]).map(function(li){
      return newLanes.indexOf(oldLanes[li]);
    }).filter(function(i){return i>=0;});
    if(step.lanes.length===0) step.lanes=[0];
    step.lane=step.lanes[0]; // backward compat
    // remap involves
    step.involves=(step.involves||[]).map(function(i){
      return newLanes.indexOf(oldLanes[i]);
    }).filter(function(i){return i>=0;});
  });
  await _saveSteps(svcId,steps);
  // remap per-lane SOP keys
  var mapping=_getMapping();
  var nm={};
  Object.keys(mapping).forEach(function(k){
    var parts=k.split('_');
    if(parts[0]===svcId&&parts[2]&&parts[2].charAt(0)==='L'){
      var oldIdx=parseInt(parts[2].substring(1));
      if(!isNaN(oldIdx)&&oldIdx<oldLanes.length){
        var newIdx=newLanes.indexOf(oldLanes[oldIdx]);
        if(newIdx>=0) nm[svcId+'_'+parts[1]+'_L'+newIdx]=mapping[k];
        // if lane deleted, drop the key
      } else { nm[k]=mapping[k]; }
    } else { nm[k]=mapping[k]; }
  });
  await _kvSet('ra_journey_mapping',nm);
  await _saveLanes(svcId,newLanes);
}
function openLaneModal(svcId){
  _laneModalSvcId=svcId;
  _laneModalLanesTmp=_getLanes(svcId).slice();
  _renderLaneModal();
  document.getElementById('laneModalBg').classList.add('open');
}
function closeLaneModal(){document.getElementById('laneModalBg').classList.remove('open');}
function _renderLaneModal(){
  var h='';
  _laneModalLanesTmp.forEach(function(name,i){
    h+='<div class="lane-modal-row">';
    h+='<span class="lane-modal-num">'+(i+1)+'</span>';
    h+='<span class="lane-modal-name">'+name+'</span>';
    h+='<div class="lane-modal-btns">';
    if(i>0) h+='<button class="jm-edit-btn jm-move" onclick="_moveLaneM('+i+',\'up\')">&#x2191;</button>';
    if(i<_laneModalLanesTmp.length-1) h+='<button class="jm-edit-btn jm-move" onclick="_moveLaneM('+i+',\'down\')">&#x2193;</button>';
    h+='<button class="jm-edit-btn jm-edit" onclick="_editLaneM('+i+')" title="แก้ไขชื่อ">&#x270F;</button>';
    h+='<button class="jm-edit-btn jm-del" onclick="_deleteLaneM('+i+')">&#x1F5D1;</button>';
    h+='</div></div>';
  });
  document.getElementById('laneModalList').innerHTML=h;
}

function _editLaneM(idx){
  var rows=document.getElementById('laneModalList').querySelectorAll('.lane-modal-row');
  var row=rows[idx];
  if(!row) return;
  var nameSpan=row.querySelector('.lane-modal-name');
  var inp=document.createElement('input');
  inp.className='lane-modal-input';
  inp.style.flex='1';inp.style.minWidth='0';
  inp.value=_laneModalLanesTmp[idx]||'';
  inp.onblur=function(){_saveLaneName(idx,inp.value);};
  inp.onkeydown=function(e){
    if(e.key==='Enter'){e.preventDefault();inp.blur();}
    if(e.key==='Escape'){_renderLaneModal();}
  };
  nameSpan.parentNode.replaceChild(inp,nameSpan);
  inp.focus();inp.select();
}

function _saveLaneName(idx,val){
  val=(val||'').trim();
  if(val) _laneModalLanesTmp[idx]=val;
  _renderLaneModal();
}
function _moveLaneM(idx,dir){
  var swap=dir==='up'?idx-1:idx+1;
  if(swap<0||swap>=_laneModalLanesTmp.length) return;
  var tmp=_laneModalLanesTmp[idx];_laneModalLanesTmp[idx]=_laneModalLanesTmp[swap];_laneModalLanesTmp[swap]=tmp;
  _renderLaneModal();
}
function _deleteLaneM(idx){
  if(!confirm('ลบ "'+_laneModalLanesTmp[idx]+'" ?\nขั้นตอนที่ใช้ Lane นี้เป็นหลักจะถูกย้ายไป Lane แรกโดยอัตโนมัติ')) return;
  _laneModalLanesTmp.splice(idx,1);
  _renderLaneModal();
}
function _addLaneFromModal(){
  var inp=document.getElementById('laneModalInput');
  var val=(inp.value||'').trim();
  if(!val) return;
  if(_laneModalLanesTmp.indexOf(val)===-1) _laneModalLanesTmp.push(val);
  inp.value='';
  _renderLaneModal();
}
async function saveLaneModal(){
  if(_laneModalLanesTmp.length===0){alert('ต้องมีอย่างน้อย 1 Lane');return;}
  var _btn=document.getElementById('laneSaveBtn');if(_btn){_btn.disabled=true;_btn.textContent='กำลังบันทึก…';}
  await _remapAndSaveLanes(_laneModalSvcId,_laneModalLanesTmp);
  if(_btn){_btn.disabled=false;_btn.textContent='✓ บันทึก';}
  closeLaneModal();
  showDetail(_laneModalSvcId);
}
/* ============================================================ */



// ─── Supabase Auth ──────────────────────────────────────────────────────────────────
// _SB ถูกสร้างไว้แล้วในสคริปต์บล็อกแรกด้านบนของไฟล์ (ต้องมาก่อน _loadKV())

function _authShow(session){
  const ls = document.getElementById('loginScreen');
  const lb = document.getElementById('logoutBtn');
  if(session){ if(ls) ls.style.display='none'; if(lb) lb.style.display='block'; }
  else        { if(ls) ls.style.display='flex'; if(lb) lb.style.display='none'; }
}

_SB.auth.getSession().then(({data:{session}}) => _authShow(session));
_SB.auth.onAuthStateChange((_,session) => _authShow(session));

async function doLogin(){
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');
  errEl.style.display='none';
  btn.textContent='กำลังเข้าสู่ระบบ…'; btn.disabled=true;
  const {error} = await _SB.auth.signInWithPassword({email,password});
  btn.textContent='เข้าสู่ระบบ'; btn.disabled=false;
  if(error) errEl.style.display='block';
}

async function doLogout(){
  await _SB.auth.signOut();
}
