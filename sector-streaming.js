// Charge les secteurs voisins en arriere-plan et gere les transitions de carte.
(function(){
  'use strict';
  const isValley=location.pathname.toLowerCase().endsWith('/vallee.html');
  const assets=isValley
    ? ['archive/ville/raphael2.html','archive/ville/rzphzel.js','archive/ville/poilhes-game-map.js']
    : ['vallee.html','perso/chasseur-texture/Meshy_AI_Avion_type_chasseur_d_0708033342_texture.obj','perso/chasseur-texture/Meshy_AI_Avion_type_chasseur_d_0708033342_texture.png'];
  const preload=()=>assets.forEach(href=>{const l=document.createElement('link');l.rel='prefetch';l.href=href;document.head.appendChild(l);});
  if('requestIdleCallback' in window)requestIdleCallback(preload,{timeout:2500});else setTimeout(preload,500);

  function transition(title,url){
    let el=document.getElementById('sector-transition');
    if(!el){el=document.createElement('div');el.id='sector-transition';Object.assign(el.style,{position:'fixed',inset:'0',display:'grid',placeItems:'center',background:'radial-gradient(circle,#126c99ee,#020713 72%)',color:'#d9fbff',font:'700 26px Consolas,monospace',letterSpacing:'3px',zIndex:'10000',opacity:'0',transition:'opacity .25s'});document.body.appendChild(el);}
    el.innerHTML=`<div style="text-align:center">${title}<div style="font-size:13px;margin-top:14px;opacity:.75">SECTEUR PRÉCHARGÉ — TRANSFERT...</div></div>`;
    requestAnimationFrame(()=>el.style.opacity='1');setTimeout(()=>location.href=url,650);
  }
  if(!isValley){window.RaphaelSectors={transition};return;}

  let portal=null,triggered=false;
  function makePortal(){
    if(portal||typeof THREE==='undefined'||!window.scene)return;
    portal=new THREE.Group();portal.position.set(150,105,170);
    const a=new THREE.Mesh(new THREE.TorusGeometry(10,1.1,14,56),new THREE.MeshBasicMaterial({color:0x62ffb0,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));
    const b=new THREE.Mesh(new THREE.TorusGeometry(7.4,.32,10,42),new THREE.MeshBasicMaterial({color:0x58b8ff,transparent:true,opacity:.88,blending:THREE.AdditiveBlending,depthWrite:false}));
    const core=new THREE.Mesh(new THREE.CircleGeometry(8.5,42),new THREE.MeshBasicMaterial({color:0x1a9c80,transparent:true,opacity:.2,side:THREE.DoubleSide,depthWrite:false}));core.position.z=.08;
    portal.add(a,b,core);portal.userData.inner=b;window.scene.add(portal);
  }
  function tick(t){requestAnimationFrame(tick);makePortal();if(!portal)return;portal.rotation.z+=.006;portal.userData.inner.rotation.z-=.014;portal.scale.setScalar(1+Math.sin(t*.004)*.04);
    if(!triggered&&window.player&&window.player.position.distanceTo(portal.position)<12){triggered=true;portal.visible=false;transition('RETOUR VERS LA VILLE','archive/ville/raphael2.html');}}
  requestAnimationFrame(tick);window.RaphaelSectors={transition};
})();
