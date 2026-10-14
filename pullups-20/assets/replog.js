// Reusable rep logger, stored in localStorage on this device. Markup: <div class="logger" data-key="gtg"></div>
document.querySelectorAll('.logger').forEach(el=>{const k='pullups:'+el.dataset.key,today=new Date().toISOString().slice(0,10);
const load=()=>JSON.parse(localStorage.getItem(k)||'{}');const render=()=>{const d=load(),t=d[today]||[];el.querySelector('.out').textContent=`Today: ${t.length} sets, ${t.reduce((a,b)=>a+b,0)} reps`+(t.length?` (${t.join(', ')})`:'');};
el.innerHTML='<label>Reps this set <input type="number" min="0" max="30" value="4"></label> <button>Log set</button> <span class="out"></span>';
el.querySelector('button').onclick=()=>{const d=load();(d[today]=d[today]||[]).push(+el.querySelector('input').value);localStorage.setItem(k,JSON.stringify(d));render();};render();});
