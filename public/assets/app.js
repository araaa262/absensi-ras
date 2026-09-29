const $=id=>document.getElementById(id);const adminPassword=sessionStorage.getItem('adminPassword')||'';
async function api(url,opt={}){const headers={'Content-Type':'application/json',...(opt.headers||{})};if(adminPassword)headers['x-admin-password']=adminPassword;const r=await fetch(url,{...opt,headers});const d=await r.json().catch(()=>({message:'Respons server tidak valid'}));if(!r.ok)throw new Error(d.message||'Terjadi kesalahan');return d}
function notice(id,msg,ok=true){const e=$(id);if(!e)return;e.textContent=msg;e.className='notice show '+(ok?'ok':'err')}
function nav(active){document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===active))}
