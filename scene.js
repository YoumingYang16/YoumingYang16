const film = document.getElementById('scene');
const sound = document.getElementById('sound');
const motion = document.getElementById('motion');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
function updateControls() {
  const audible = !film.muted && !film.paused && !film.ended;
  sound.classList.toggle('on', audible);
  sound.querySelector('span').textContent = audible ? '静音播放' : '听英文问候';
  sound.setAttribute('aria-pressed', String(audible));
  motion.classList.toggle('on', !film.paused);
  motion.setAttribute('aria-label', film.paused ? '播放场景' : '暂停场景');
}
for(const event of ['play','pause','ended','volumechange']) film.addEventListener(event,updateControls);
motion.addEventListener('click',()=>{ if(film.paused) { if(film.ended) film.currentTime=0; film.play().catch(updateControls); } else film.pause(); });
sound.addEventListener('click',()=>{
  if (!film.muted && !film.paused) {film.muted=true;film.loop=true;return;}
  film.muted=false; film.loop=false;film.currentTime=0;film.play().catch(()=>{film.muted=true;updateControls();});
});
reduced.addEventListener('change', e=>{if(e.matches)film.pause();});
if(!reduced.matches)film.play().catch(updateControls);
updateControls();
