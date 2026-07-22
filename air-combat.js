// Combat aerien partage entre la ville et la vallee.
// IA, radar, verrouillage, missiles, degats, VFX, audio spatial et HUD.
(function () {
  'use strict';

  const CFG = {
    enemyCount: 10, radarRange: 650, lockRange: 480, lockCone: 0.92,
    lockSeconds: 3.8, lockDecay: 1.1, missileSpeed: 185,
    missileLife: 7, missileTurn: 2.25, enemyFireDelay: 7,
    respawnDelay: 12, maxParticles: 180
  };
  const enemies = [], missiles = [], particles = [];
  const cannonTracerGeometry=new THREE.CylinderGeometry(.14,.24,7.2,7);cannonTracerGeometry.rotateX(Math.PI/2);
  const cannonTracerMaterial=new THREE.MeshBasicMaterial({color:0xffed63,transparent:true,opacity:1,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false});
  const state = { active:false, lock:0, target:null, missiles:Infinity, hull:100,
    leftWing:100, rightWing:100, engine:100, radarAlert:'CALME', score:0 };
  let hud, radarCanvas, radarCtx, radarDiamond, seekerDiamond, audio, lastTime=performance.now(), spawnClock=0;
  let missileLatch=false, rearLatch=false, initialized=false, gunClock=0, lockBeepClock=0, lockTonePlayed=false, lockOscillator=null, lockContinuousGain=null;
  let enemyModelModulePromise=null;

  function getEnemyModelModule(){
    if(!enemyModelModulePromise) enemyModelModulePromise=import('./maps/enemy-fighter-model.js?v=red-black-direct-20260722');
    return enemyModelModulePromise;
  }
  // Start loading the definitive fighter before combat begins. No legacy jet
  // will be displayed while the OBJ is being prepared.
  getEnemyModelModule().then(module=>module.preloadEnemyFighterModel()).catch(()=>{});

  function available(){
    return typeof THREE!=='undefined' && typeof scene!=='undefined' && scene &&
      typeof player!=='undefined' && player && typeof isFlyingMode==='function' &&
      typeof gameStarted!=='undefined' && gameStarted && isFlyingMode();
  }
  function forwardOf(object){
    if(object===player && typeof velocity!=='undefined' && velocity && velocity.lengthSq && velocity.lengthSq()>1){
      return velocity.clone().normalize();
    }
    return new THREE.Vector3(0,0,-1).applyQuaternion(object.quaternion).normalize();
  }
  function terrainY(x,z){
    if(typeof window.getTerrainHeight==='function') return window.getTerrainHeight(x,z)||0;
    return 0;
  }
  function makeFighter(color){
    const g=new THREE.Group();
    const mat=new THREE.MeshStandardMaterial({color,metalness:.72,roughness:.28});
    const dark=new THREE.MeshStandardMaterial({color:0x17202a,metalness:.8,roughness:.2});
    const body=new THREE.Mesh(new THREE.ConeGeometry(1.05,7,10),mat); body.rotation.x=-Math.PI/2; g.add(body);
    const wing=new THREE.Mesh(new THREE.BoxGeometry(8,.18,2.2),mat); wing.position.z=.7; g.add(wing);
    const tail=new THREE.Mesh(new THREE.BoxGeometry(3,.14,1.2),dark); tail.position.z=2.5; g.add(tail);
    const fin=new THREE.Mesh(new THREE.BoxGeometry(.16,1.45,1.4),mat); fin.position.set(0,.7,2.4); g.add(fin);
    for(const x of [-.42,.42]){
      const jet=new THREE.Mesh(new THREE.SphereGeometry(.25,8,6),new THREE.MeshBasicMaterial({color:0x49cfff}));
      jet.scale.z=2.8; jet.position.set(x,0,3.5); g.add(jet);
    }
    g.scale.setScalar(1.05); return g;
  }
  function upgradeEnemyVisual(root){
    getEnemyModelModule()
      .then(module=>module.createEnemyFighterModel({targetLength:10,thrusters:true}))
      .then(model=>{
        root.clear();
        root.add(model);
        root.userData.flames=model.userData.flames||[];
        document.body.dataset.enemyFighterModel='loaded';
      })
      .catch(error=>{
        document.body.dataset.enemyFighterModel='error';
        console.warn('[air-combat] modele ennemi rouge et noir non charge',error);
      });
  }
  function spawnEnemy(index){
    if(!available()) return;
    const angle=Math.random()*Math.PI*2, distance=230+Math.random()*170;
    const p=player.position.clone().add(new THREE.Vector3(Math.sin(angle)*distance,55+Math.random()*90,Math.cos(angle)*distance));
    p.y=Math.max(p.y,terrainY(p.x,p.z)+30);
    const mesh=new THREE.Group(); mesh.name='enemy-fighter-loading'; mesh.position.copy(p); scene.add(mesh); upgradeEnemyVisual(mesh);
    enemies.push({mesh,vel:new THREE.Vector3(),speed:72+Math.random()*18,state:'PATROUILLE',
      health:100,leftWing:100,rightWing:100,engine:100,cooldown:4+Math.random()*5,
      patrol:p.clone().add(new THREE.Vector3((Math.random()-.5)*180,20,(Math.random()-.5)*180)),
      provoked:false,reaction:0,dead:false,respawn:0});
  }
  function init(){
    if(initialized||!available()) return; initialized=true; state.active=true;
    buildHud(); for(let i=0;i<CFG.enemyCount;i++) spawnEnemy(i);
  }
  function buildHud(){
    document.body.classList.add('ac-visor-active');
    hud=document.createElement('section'); hud.id='air-combat-hud';
    Object.assign(hud.style,{position:'fixed',inset:'0',pointerEvents:'none',zIndex:'42',fontFamily:'Consolas,monospace',color:'#f4f7f8'});
    const style=document.createElement('style');
    style.textContent=`
      body.ac-visor-active > #hud,body.ac-visor-active > #combat-crosshair,body.ac-visor-active > #combat-target-hud{display:none!important}
      #ac-visor{--hud:#f4f7f8;--glass:rgba(4,9,12,.66);position:absolute;left:50%;top:50%;width:min(740px,72vw);height:min(590px,72vh);transform:translate(-50%,-50%);filter:drop-shadow(0 3px 3px #000) drop-shadow(0 0 9px rgba(255,255,255,.12))}
      #ac-visor *{box-sizing:border-box}.ac-plate{background:linear-gradient(180deg,rgba(16,22,26,.94),rgba(2,5,7,.82));border:2px solid rgba(244,247,248,.9);color:var(--hud);font-weight:900;letter-spacing:.04em;text-align:center;text-shadow:0 2px 2px #000}
      #ac-top{position:absolute;left:13%;right:13%;top:0;height:46px;display:grid;grid-template-columns:1fr 1.45fr 1fr;align-items:center;clip-path:polygon(4% 0,96% 0,100% 82%,78% 82%,75% 100%,25% 100%,22% 82%,0 82%)}
      #ac-mode{font-size:clamp(10px,1.35vw,16px)}#ac-heading{font-size:clamp(14px,2vw,24px)}#ac-arm{font-size:clamp(11px,1.5vw,18px)}
      #ac-target{position:absolute;left:29%;right:29%;top:70px;height:32px;padding:4px;clip-path:polygon(8% 0,92% 0,100% 50%,92% 100%,8% 100%,0 50%)}
      #ac-core{position:absolute;left:50%;top:51%;width:min(430px,48vw);aspect-ratio:1;transform:translate(-50%,-50%);border:4px solid var(--hud);border-radius:50%;background:radial-gradient(circle,transparent 0 12%,rgba(255,255,255,.82) 12.5% 13%,transparent 13.5% 30%,rgba(255,255,255,.68) 30.5% 31%,transparent 31.5% 49%,rgba(255,255,255,.45) 49.5% 50%,transparent 50.5%),repeating-conic-gradient(from 0deg,rgba(255,255,255,.75) 0 1deg,transparent 1deg 15deg),radial-gradient(circle,rgba(0,0,0,.15),var(--glass));box-shadow:inset 0 0 0 14px rgba(255,255,255,.08),inset 0 0 28px #000,0 0 0 7px rgba(3,6,8,.75)}
      #ac-core:before,#ac-core:after{content:"";position:absolute;background:var(--hud);opacity:.9}#ac-core:before{left:-20%;right:-20%;top:50%;height:3px}#ac-core:after{top:-12%;bottom:-12%;left:50%;width:3px}
      #ac-reticle{position:absolute;inset:25%;border:3px solid var(--hud);border-radius:50%}#ac-reticle:before,#ac-reticle:after{content:"";position:absolute;inset:23%;border:2px solid var(--hud);border-radius:50%}#ac-reticle:after{inset:43%;background:var(--hud);box-shadow:0 0 0 7px rgba(0,0,0,.72),0 0 0 9px var(--hud)}
      #ac-left-scale,#ac-right-scale{position:absolute;top:29%;bottom:22%;width:48px;border:2px solid var(--hud);background:repeating-linear-gradient(to bottom,transparent 0 9%,var(--hud) 9.5% 10.5%,transparent 11% 20%),rgba(3,7,10,.72)}#ac-left-scale{left:2%;border-radius:18px 4px 4px 18px}#ac-right-scale{right:2%;border-radius:4px 18px 18px 4px}
      #ac-speed,#ac-alt{position:absolute;top:38%;min-width:145px;padding:7px 12px}#ac-speed{left:7%}#ac-alt{right:7%}
      #ac-status{position:absolute;left:8%;bottom:3%;width:31%;padding:8px 10px;line-height:1.35;text-align:left;font-size:clamp(9px,1.15vw,13px);clip-path:polygon(0 0,90% 0,100% 24%,92% 100%,8% 100%,0 76%)}
      #ac-score{position:absolute;right:8%;bottom:3%;width:31%;padding:8px 10px;line-height:1.35;text-align:right;font-size:clamp(9px,1.15vw,13px);clip-path:polygon(10% 0,100% 0,100% 76%,92% 100%,8% 100%,0 24%)}
      #ac-lock{position:absolute;left:31%;right:31%;bottom:-3%;padding:7px;font-size:clamp(11px,1.45vw,17px);clip-path:polygon(10% 0,90% 0,100% 50%,90% 100%,10% 100%,0 50%)}
      #ac-alert{position:absolute;left:50%;top:-46px;transform:translateX(-50%);font-size:20px;font-weight:900;color:#ff4b35;white-space:nowrap;text-shadow:0 0 8px #000}
      #air-combat-hud.locked #ac-core{--hud:#ffe45c;box-shadow:inset 0 0 0 14px rgba(255,228,92,.08),inset 0 0 28px #000,0 0 16px rgba(255,228,92,.4)}
      @media(max-width:700px){#ac-visor{width:96vw;height:62vh;top:47%}#ac-core{width:min(330px,67vw)}#ac-left-scale,#ac-right-scale{display:none}#ac-speed{left:1%}#ac-alt{right:1%}#ac-speed,#ac-alt{min-width:105px;font-size:11px}#ac-status,#ac-score{width:36%;bottom:5%}#ac-lock{left:28%;right:28%}}
    `;
    document.head.appendChild(style);
    hud.innerHTML='<div id="ac-visor"><div id="ac-alert"></div><div id="ac-top" class="ac-plate"><span id="ac-mode">LOCK</span><span id="ac-heading">HDG 000°</span><span id="ac-arm">ARMÉ</span></div><div id="ac-target" class="ac-plate">AUCUNE CIBLE</div><div id="ac-left-scale"></div><div id="ac-right-scale"></div><div id="ac-speed" class="ac-plate">SPD 000</div><div id="ac-alt" class="ac-plate">ALT 000 m</div><div id="ac-core"><div id="ac-reticle"></div></div><div id="ac-status" class="ac-plate"></div><div id="ac-score" class="ac-plate"></div><div id="ac-lock" class="ac-plate">RECHERCHE</div></div>';
    radarDiamond=document.createElement('div'); radarDiamond.id='ac-radar-diamond';
    seekerDiamond=document.createElement('div'); seekerDiamond.id='ac-seeker-diamond';
    Object.assign(radarDiamond.style,{display:'none',position:'absolute',width:'58px',height:'58px',margin:'-29px 0 0 -29px',border:'2px solid #aeb7c2',transform:'rotate(45deg)',boxShadow:'0 0 8px rgba(190,200,210,.28)'});
    Object.assign(seekerDiamond.style,{display:'none',position:'absolute',width:'58px',height:'58px',margin:'-29px 0 0 -29px',border:'2px solid #39a9ff',transform:'rotate(45deg)',boxShadow:'0 0 14px rgba(45,157,255,.58)'});
    hud.append(radarDiamond,seekerDiamond);
    radarCanvas=document.createElement('canvas'); radarCanvas.width=180; radarCanvas.height=180;
    Object.assign(radarCanvas.style,{position:'absolute',left:'50%',top:'51%',transform:'translate(-50%,-50%)',width:'min(180px,24vw)',height:'min(180px,24vw)',border:'0',borderRadius:'50%',background:'rgba(0,10,12,.42)',opacity:'.72'});
    hud.querySelector('#ac-visor').appendChild(radarCanvas); document.body.appendChild(hud); radarCtx=radarCanvas.getContext('2d');
  }
  function ensureAudio(){
    if(audio) return audio; const AC=window.AudioContext||window.webkitAudioContext; if(!AC)return null;
    const ctx=new AC(), master=ctx.createGain(); master.gain.value=.22; master.connect(ctx.destination);
    audio={ctx,master,lastAlert:0}; return audio;
  }
  function unlockAudio(){const a=ensureAudio();if(a&&a.ctx.state==='suspended')a.ctx.resume();}
  function tone(freq,duration=.12,type='sine',gain=.12){
    const a=ensureAudio(); if(!a)return; if(a.ctx.state==='suspended')a.ctx.resume();
    const o=a.ctx.createOscillator(),g=a.ctx.createGain(),n=a.ctx.currentTime;
    o.type=type;o.frequency.setValueAtTime(freq,n);g.gain.setValueAtTime(gain,n);g.gain.exponentialRampToValueAtTime(.0001,n+duration);
    o.connect(g).connect(a.master);o.start(n);o.stop(n+duration);
  }
  function setContinuousLockTone(active){
    if(!active){
      if(lockContinuousGain&&audio)lockContinuousGain.gain.setTargetAtTime(.0001,audio.ctx.currentTime,.025);
      if(lockOscillator&&audio){const oscillator=lockOscillator;oscillator.stop(audio.ctx.currentTime+.14);}
      lockOscillator=null;lockContinuousGain=null;return;
    }
    if(lockOscillator)return;
    const a=ensureAudio();if(!a)return;if(a.ctx.state==='suspended')a.ctx.resume();
    lockOscillator=a.ctx.createOscillator();lockContinuousGain=a.ctx.createGain();
    lockOscillator.type='square';lockOscillator.frequency.value=1080;
    lockContinuousGain.gain.setValueAtTime(.0001,a.ctx.currentTime);lockContinuousGain.gain.exponentialRampToValueAtTime(.11,a.ctx.currentTime+.08);
    lockOscillator.connect(lockContinuousGain).connect(a.master);lockOscillator.start();
  }
  function spatialTone(freq,position,duration=.22){
    const a=ensureAudio();if(!a)return;if(a.ctx.state==='suspended')a.ctx.resume();
    const o=a.ctx.createOscillator(),g=a.ctx.createGain(),p=a.ctx.createPanner(),n=a.ctx.currentTime;
    const rel=position.clone().sub(player.position);p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=20;p.maxDistance=650;p.rolloffFactor=1.25;
    if(p.positionX){p.positionX.value=rel.x;p.positionY.value=rel.y;p.positionZ.value=rel.z;}else p.setPosition(rel.x,rel.y,rel.z);
    o.type='sawtooth';o.frequency.value=freq;g.gain.setValueAtTime(.16,n);g.gain.exponentialRampToValueAtTime(.0001,n+duration);
    o.connect(g).connect(p).connect(a.master);o.start(n);o.stop(n+duration);
  }
  function acquireTarget(dt){
    const f=forwardOf(player); let best=null,bestScore=-Infinity;
    for(const e of enemies){ if(e.dead)continue; const to=e.mesh.position.clone().sub(player.position),d=to.length(); if(d>CFG.radarRange)continue;
      const alignment=f.dot(to.normalize()); const score=alignment-d/CFG.radarRange*.15; if(score>bestScore){bestScore=score;best=e;}
    }
    const targetAlignment=best?f.dot(best.mesh.position.clone().sub(player.position).normalize()):-1;
    if(best&&best.mesh.position.distanceTo(player.position)<CFG.lockRange&&targetAlignment>CFG.lockCone){
      if(state.target!==best)state.lock=0; state.target=best; state.lock=Math.min(1,state.lock+dt/CFG.lockSeconds);
      lockBeepClock-=dt;
      if(state.lock<1&&lockBeepClock<=0){tone(520+state.lock*520,.07,'square',.16);lockBeepClock=.48-state.lock*.34;lockTonePlayed=false;}
      if(state.lock>=1&&!lockTonePlayed)lockTonePlayed=true;
      setContinuousLockTone(state.lock>=1);
    }else{ state.lock=Math.max(0,state.lock-dt/CFG.lockDecay);lockBeepClock=0;lockTonePlayed=false;setContinuousLockTone(false);if(state.lock===0)state.target=best; }
  }
  function missilePressed(){
    const keyboard=(typeof keys!=='undefined'&&keys['KeyM']);
    let pad=false; const gps=navigator.getGamepads?navigator.getGamepads():[]; for(const gp of gps){if(gp&&gp.buttons[1]&&gp.buttons[1].pressed)pad=true;}
    return !!(keyboard||pad);
  }
  function launchMissile(owner,target,forcedDirection){
    if(owner==='player'&&((!forcedDirection&&state.lock<1)||!target))return;
    const source=owner==='player'?player:owner.mesh, f=forcedDirection?forcedDirection.clone().normalize():forwardOf(source);
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.13,.2,2.2,8),new THREE.MeshStandardMaterial({color:owner==='player'?0xe9f2f5:0xff593d,emissive:owner==='player'?0x335577:0x882000}));
    const flame=new THREE.Group(),outer=new THREE.Mesh(new THREE.ConeGeometry(.48,4.1,10,1,true),new THREE.MeshBasicMaterial({color:0xff5a08,transparent:true,opacity:.8,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false})),core=new THREE.Mesh(new THREE.ConeGeometry(.27,2.7,9,1,true),new THREE.MeshBasicMaterial({color:0xfff1a0,transparent:true,opacity:.98,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false}));
    outer.rotation.x=core.rotation.x=Math.PI/2;flame.position.z=1.65;flame.add(outer,core);mesh.add(flame);mesh.userData.missileFlame=flame;
    mesh.rotation.x=Math.PI/2; mesh.position.copy(source.position).addScaledVector(f,4); scene.add(mesh);
    missiles.push({mesh,vel:f.multiplyScalar(CFG.missileSpeed),target,owner,life:CFG.missileLife,lost:0});
    if(window.RaphaelMissileAudio)window.RaphaelMissileAudio.playLaunch();
    else if(owner==='player')tone(180,.35,'sawtooth',.18);else spatialTone(760,source.position,.24);
  }
  function rearMissilePressed(){
    const keyboard=typeof keys!=='undefined'&&keys['KeyR'];let pad=false;
    const gps=navigator.getGamepads?navigator.getGamepads():[];for(const gp of gps){if(gp&&gp.buttons[3]&&gp.buttons[3].pressed)pad=true;}
    return !!(keyboard||pad);
  }
  function launchRearMissile(){
    const f=forwardOf(player);let target=null,best=Infinity;
    for(const e of enemies){if(e.dead)continue;const to=e.mesh.position.clone().sub(player.position),d=to.length();if(d<320&&f.dot(to.normalize())<-.35&&d<best){target=e;best=d;}}
    if(target){launchMissile('player',target,f.multiplyScalar(-1));if(!window.RaphaelMissileAudio)tone(420,.16,'square',.12);}else tone(120,.1,'square',.05);
  }
  function updateMissiles(dt){
    for(let i=missiles.length-1;i>=0;i--){const m=missiles[i];m.life-=dt;
      const targetPos=m.target?(m.target===player?player.position:m.target.mesh.position):null;
      if(targetPos){const desired=targetPos.clone().sub(m.mesh.position).normalize().multiplyScalar(CFG.missileSpeed);m.vel.lerp(desired,Math.min(1,CFG.missileTurn*dt));}
      m.mesh.position.addScaledVector(m.vel,dt);m.mesh.lookAt(m.mesh.position.clone().add(m.vel));const flame=m.mesh.userData.missileFlame;if(flame)flame.scale.set(1+Math.sin(performance.now()*.047+i)*.12,1+Math.sin(performance.now()*.063+i)*.18,1);trail(m.mesh.position,m.owner==='player'?0xb9eaff:0xff7d32);
      let hit=false;if(targetPos&&m.mesh.position.distanceTo(targetPos)<4.8){hit=true; if(m.target===player)damagePlayer(38,m.mesh.position);else damageEnemy(m.target,55,m.mesh.position);}
      if(hit||m.life<=0||m.mesh.position.y<terrainY(m.mesh.position.x,m.mesh.position.z)){explode(m.mesh.position,hit?0xff9b32:0x778899);scene.remove(m.mesh);missiles.splice(i,1);}
    }
  }
  function damagePlayer(amount,hit){
    const local=player.worldToLocal(hit.clone()); let zone='engine';
    if(Math.abs(local.x)>1.4)zone=local.x<0?'leftWing':'rightWing';
    state[zone]=Math.max(0,state[zone]-amount);state.hull=Math.max(0,state.hull-amount*.55);tone(95,.45,'sawtooth',.2);
    if(state.hull<=0){state.hull=100;state.leftWing=100;state.rightWing=100;state.engine=100;player.position.set(0,60,80);}
  }
  function damageEnemy(e,amount,hit){
    e.provoked=true;e.reaction=14;
    const local=e.mesh.worldToLocal(hit.clone()); const zone=Math.abs(local.x)>1.3?(local.x<0?'leftWing':'rightWing'):'engine';
    e[zone]=Math.max(0,e[zone]-amount);e.health=Math.max(0,e.health-amount);if(e.health<=0){e.dead=true;e.respawn=CFG.respawnDelay;scene.remove(e.mesh);state.score++;state.target=null;state.lock=0;if(window.RaphaelMissileAudio)window.RaphaelMissileAudio.playDestruction();}
  }
  function updateEnemies(dt){
    let threat=0;
    for(const e of enemies){
      if(e.dead){e.respawn-=dt;if(e.respawn<=0){const idx=enemies.indexOf(e);enemies.splice(idx,1);spawnEnemy(idx);}continue;}
      const toPlayer=player.position.clone().sub(e.mesh.position),dist=toPlayer.length(),dir=toPlayer.clone().normalize();
      e.reaction=Math.max(0,e.reaction-dt);if(e.reaction===0)e.provoked=false;
      if(e.health<35)e.state='REPLI';
      else if(e.provoked)e.state=dist<210?'ATTAQUE':'INTERCEPTION';
      else if(e===state.target&&state.lock>.18)e.state='EVASION';
      else e.state='PATROUILLE';
      let desired;
      if(e.state==='PATROUILLE'){
        if(e.mesh.position.distanceTo(e.patrol)<22)e.patrol.add(new THREE.Vector3((Math.random()-.5)*220,(Math.random()-.5)*45,(Math.random()-.5)*220));
        desired=e.patrol.clone().sub(e.mesh.position).normalize();
      }else if(e.state==='REPLI')desired=dir.multiplyScalar(-1).add(new THREE.Vector3(0,.35,0)).normalize();
      else if(e.state==='EVASION')desired=new THREE.Vector3(-dir.z,.18,dir.x).multiplyScalar(Math.sin(performance.now()*.0025)>0?1:-1).add(dir.multiplyScalar(-.35)).normalize();
      else desired=dir;
      const ground=terrainY(e.mesh.position.x,e.mesh.position.z);if(e.mesh.position.y-ground<24)desired.y=Math.max(desired.y,.75);
      const agility=(e.leftWing+e.rightWing)/200; const desiredVel=desired.multiplyScalar(e.speed*(.45+.55*e.engine/100));e.vel.lerp(desiredVel,Math.min(1,dt*(.65+agility)));
      e.mesh.position.addScaledVector(e.vel,dt);e.mesh.lookAt(e.mesh.position.clone().add(e.vel));e.mesh.rotation.z+=(e.vel.x/e.speed-e.mesh.rotation.z)*Math.min(1,dt*2);
      e.cooldown-=dt;const aim=forwardOf(e.mesh).dot(toPlayer.normalize());if(e.provoked&&e.state==='ATTAQUE'&&aim>.94){threat=Math.max(threat,dist<150?2:1);if(e.cooldown<=0){launchMissile(e,player);e.cooldown=CFG.enemyFireDelay+Math.random()*4;}}
    }
    state.radarAlert=threat===2?'MISSILE / DANGER':threat===1?'ACCROCHAGE ENNEMI':'CALME';
    if(threat&&audio&&audio.ctx.currentTime-audio.lastAlert>1.2){tone(threat===2?1180:720,.15,'square',.1);audio.lastAlert=audio.ctx.currentTime;}
  }
  function updatePlayerGun(dt){
    const firing=typeof keys!=='undefined'&&(keys['Space']||keys[' ']);
    gunClock-=dt;if(!firing||gunClock>0)return;gunClock=.075;
    const f=forwardOf(player);let best=null,bestDist=Infinity;
    if(window.RaphaelFighterCannon)window.RaphaelFighterCannon.fireShot();
    cannonTracer(player.position.clone().addScaledVector(f,6),f);
    for(const e of enemies){if(e.dead)continue;const to=e.mesh.position.clone().sub(player.position),d=to.length();if(d>360)continue;
      if(f.dot(to.normalize())>.992&&d<bestDist){best=e;bestDist=d;}}
    if(best){damageEnemy(best,7,best.mesh.position.clone());trail(best.mesh.position,0xffd34d);}
  }
  function cannonTracer(pos,direction){
    if(particles.length>=CFG.maxParticles)return;
    const mesh=new THREE.Mesh(cannonTracerGeometry,cannonTracerMaterial);mesh.position.copy(pos);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction);mesh.renderOrder=40;scene.add(mesh);
    particles.push({mesh,life:.22,vel:direction.clone().multiplyScalar(430),shared:true});
  }
  function trail(pos,color){if(particles.length>=CFG.maxParticles)return;const m=new THREE.Mesh(new THREE.SphereGeometry(.16,5,4),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.55,depthWrite:false}));m.position.copy(pos);scene.add(m);particles.push({mesh:m,life:.65,vel:new THREE.Vector3(0,.6,0)});}
  function explode(pos,color){for(let j=0;j<18&&particles.length<CFG.maxParticles;j++){const m=new THREE.Mesh(new THREE.SphereGeometry(.22+Math.random()*.25,5,4),new THREE.MeshBasicMaterial({color,transparent:true,opacity:1}));m.position.copy(pos);scene.add(m);particles.push({mesh:m,life:.7+Math.random()*.5,vel:new THREE.Vector3((Math.random()-.5)*22,(Math.random()-.2)*20,(Math.random()-.5)*22)});}}
  function updateParticles(dt){for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;p.mesh.position.addScaledVector(p.vel,dt);p.vel.y-=5*dt;if(!p.shared)p.mesh.material.opacity=Math.max(0,p.life);if(p.life<=0){scene.remove(p.mesh);if(!p.shared){p.mesh.geometry.dispose();p.mesh.material.dispose();}particles.splice(i,1);}}}
  function renderRadar(){if(!radarCtx)return;const c=90,s=78;radarCtx.clearRect(0,0,180,180);radarCtx.strokeStyle='#34e8c2';radarCtx.globalAlpha=.55;for(const r of [26,52,78]){radarCtx.beginPath();radarCtx.arc(c,c,r,0,Math.PI*2);radarCtx.stroke();}radarCtx.globalAlpha=1;radarCtx.fillStyle='#7fffd4';radarCtx.fillRect(c-2,c-4,4,8);
    for(const e of enemies){if(e.dead)continue;const rel=e.mesh.position.clone().sub(player.position);if(rel.length()>CFG.radarRange)continue;const scale=s/CFG.radarRange;radarCtx.fillStyle=e===state.target?'#39a9ff':'#aeb7c2';radarCtx.beginPath();radarCtx.arc(c+rel.x*scale,c+rel.z*scale,4,0,Math.PI*2);radarCtx.fill();}}
  function updateHud(){if(!hud)return;hud.style.display=available()?'block':'none';if(!available())return;
    const s=document.getElementById('ac-status'),score=document.getElementById('ac-score'),l=document.getElementById('ac-lock'),a=document.getElementById('ac-alert'),mode=document.getElementById('ac-mode'),target=document.getElementById('ac-target'),heading=document.getElementById('ac-heading'),speed=document.getElementById('ac-speed'),alt=document.getElementById('ac-alt');
    const locked=state.lock>=1,targetDistance=state.target?Math.round(state.target.mesh.position.distanceTo(player.position)):0;
    const speedKmh=typeof flightSpeed==='number'?Math.round(Math.abs(flightSpeed)*3.6):0;
    const headingDeg=((THREE.MathUtils.radToDeg(player.rotation.y)%360)+360)%360;
    hud.classList.toggle('locked',locked);
    s.innerHTML=`COQUE ${Math.round(state.hull)}% · MOT ${Math.round(state.engine)}%<br>AILE G ${Math.round(state.leftWing)} · AILE D ${Math.round(state.rightWing)}`;
    score.innerHTML=`MISSILES ∞<br>VICTOIRES ${state.score}/10+`;
    l.textContent=state.target?`${locked?'MISSILE PRÊT':'ACQUISITION'} ${Math.round(state.lock*100)}%`:'RECHERCHE CIBLE';
    mode.textContent=locked?'LOCK':'SCAN';
    target.textContent=state.target?`CIBLE ${targetDistance} m`:'AUCUNE CIBLE';
    heading.textContent=`HDG ${String(Math.round(headingDeg)).padStart(3,'0')}°`;
    speed.textContent=`SPD ${String(speedKmh).padStart(3,'0')}`;
    alt.textContent=`ALT ${String(Math.max(0,Math.round(player.position.y))).padStart(3,'0')} m`;
    if(state.target&&typeof camera!=='undefined'){
      const screen=state.target.mesh.position.clone().project(camera);
      const visible=screen.z>-1&&screen.z<1&&Math.abs(screen.x)<1.15&&Math.abs(screen.y)<1.15;
      radarDiamond.style.display=seekerDiamond.style.display=visible?'block':'none';
      if(visible){const x=(screen.x*.5+.5)*innerWidth,y=(-screen.y*.5+.5)*innerHeight,phase=performance.now()*.0035,strength=locked?0:1-state.lock;radarDiamond.style.left=x+'px';radarDiamond.style.top=y+'px';seekerDiamond.style.left=(x+strength*(Math.cos(phase)*72+Math.sin(phase*1.7)*12))+'px';seekerDiamond.style.top=(y+strength*(Math.sin(phase)*46+Math.cos(phase*1.3)*9))+'px';seekerDiamond.style.opacity=state.lock>0?'1':'.72';}
    }else radarDiamond.style.display=seekerDiamond.style.display='none';
    a.style.color=state.radarAlert==='CALME'?'#70f0ca':'#ff4b35';a.textContent=state.radarAlert==='CALME'?'':state.radarAlert;renderRadar();}
  function loop(now){requestAnimationFrame(loop);const dt=Math.min(.05,(now-lastTime)/1000);lastTime=now;
    if(!available()){if(hud)hud.style.display='none';return;}init();acquireTarget(dt);const pressed=missilePressed();if(pressed&&!missileLatch)launchMissile('player',state.target);missileLatch=pressed;
    const rearPressed=rearMissilePressed();if(rearPressed&&!rearLatch)launchRearMissile();rearLatch=rearPressed;
    updateEnemies(dt);updatePlayerGun(dt);updateMissiles(dt);updateParticles(dt);updateHud();spawnClock+=dt;}
  window.RaphaelAirCombat={state,enemies,missiles,
    flightModifiers:()=>({speed:.45+.55*state.engine/100,yaw:.55+.45*Math.min(state.leftWing,state.rightWing)/100}),
    diagnostics:()=>({active:state.active,enemies:enemies.filter(e=>!e.dead).length,missiles:missiles.length,lock:state.lock,hull:state.hull})};
  requestAnimationFrame(loop);
  window.addEventListener('pointerdown',unlockAudio,{passive:true});
  window.addEventListener('keydown',unlockAudio,{passive:true});
})();
