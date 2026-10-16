// Reusable retrieval quiz. Markup: <div class="quiz"><div class="q" data-answer="1" data-why="..."><p>Q</p><button>..</button>...<p class="fb"></p></div></div>
document.querySelectorAll('.quiz .q').forEach(q=>{const btns=[...q.querySelectorAll('button')],fb=q.querySelector('.fb');
btns.forEach((b,i)=>b.addEventListener('click',()=>{btns.forEach(x=>x.classList.remove('right','wrong'));const ok=i==+q.dataset.answer;b.classList.add(ok?'right':'wrong');fb.textContent=(ok?'Correct. ':'Not quite. ')+(ok?q.dataset.why:'Try again.');}))});
