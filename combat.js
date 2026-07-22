// ==========================================================================
//  COMBAT  -  mode tir : cibles au sol + canon continu + viseur
// --------------------------------------------------------------------------
//  Actif uniquement en vol (chasseur / fly). Auto-branche sur le moteur :
//  lit les globaux scene, player, keys, gameStarted, isFlyingMode(), camera,
//  ISLAND_RADIUS. Boucle d'animation propre (requestAnimationFrame).
//
//  Tir : BARRE ESPACE (ou clic gauche). Vise une cible avec le viseur central,
//  pique dessus, tire. Touche = explosion + score.
// ==========================================================================
(function () {
  const TARGET_COUNT   = 8;
  const CANNON_SPEED   = 420;   // unites / s
  const CANNON_LIFE    = 1.35;  // s
  const HIT_RADIUS     = 5;     // generosite de visee
  const FIRE_INTERVAL  = 0.075; // environ 13 obus / s

  let targets = [];
  let cannonRounds = [];
  let explosions = [];
  let active = false;
  let prevFire = false;
  let fireTimer = 0;
  let lastT = performance.now();
  let score = 0;
  let crosshair = null, hudEl = null;
  let mouseFire = false;
  let cannonAudio = null;

  document.addEventListener("mousedown", e => { if (e.button === 0) mouseFire = true; });
  document.addEventListener("mouseup",   e => { if (e.button === 0) mouseFire = false; });
  window.addEventListener("blur", () => { mouseFire = false; stopCannonAudio(); });

  // Son de canon continu : bruit filtre et deux couches mecaniques graves.
  function ensureCannonAudio() {
    if (cannonAudio) return cannonAudio;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    const context = new AudioContextClass();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.12;
    compressor.connect(context.destination);

    const master = context.createGain();
    master.gain.value = 0.0001;
    master.connect(compressor);

    const noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = (Math.random() * 2 - 1) * (0.65 + Math.random() * 0.35);
    }
    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1150;
    noiseFilter.Q.value = 0.7;
    noise.connect(noiseFilter).connect(master);

    const rumble = context.createOscillator();
    rumble.type = "sawtooth";
    rumble.frequency.value = 58;
    const rumbleGain = context.createGain();
    rumbleGain.gain.value = 0.45;
    rumble.connect(rumbleGain).connect(master);

    const mechanical = context.createOscillator();
    mechanical.type = "square";
    mechanical.frequency.value = 116;
    const mechanicalGain = context.createGain();
    mechanicalGain.gain.value = 0.12;
    mechanical.connect(mechanicalGain).connect(master);

    noise.start();
    rumble.start();
    mechanical.start();
    cannonAudio = { context, master, firing: false };
    return cannonAudio;
  }

  function startCannonAudio() {
    if (window.RaphaelFighterCannon) return;
    const audio = ensureCannonAudio();
    if (!audio) return;
    if (audio.context.state === "suspended") audio.context.resume();
    if (audio.firing) return;
    audio.firing = true;
    const now = audio.context.currentTime;
    audio.master.gain.cancelScheduledValues(now);
    audio.master.gain.setValueAtTime(Math.max(0.0001, audio.master.gain.value), now);
    audio.master.gain.exponentialRampToValueAtTime(0.42, now + 0.018);
  }

  function pulseCannonAudio() {
    if (window.RaphaelFighterCannon) {
      window.RaphaelFighterCannon.fireShot();
      return;
    }
    if (!cannonAudio) return;
    const now = cannonAudio.context.currentTime;
    cannonAudio.master.gain.cancelScheduledValues(now);
    cannonAudio.master.gain.setValueAtTime(0.22, now);
    cannonAudio.master.gain.linearRampToValueAtTime(0.48, now + 0.006);
    cannonAudio.master.gain.exponentialRampToValueAtTime(0.22, now + FIRE_INTERVAL * 0.86);
  }

  function stopCannonAudio() {
    if (window.RaphaelFighterCannon) return;
    if (!cannonAudio || !cannonAudio.firing) return;
    cannonAudio.firing = false;
    const now = cannonAudio.context.currentTime;
    cannonAudio.master.gain.cancelScheduledValues(now);
    cannonAudio.master.gain.setValueAtTime(Math.max(0.0001, cannonAudio.master.gain.value), now);
    cannonAudio.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  }

  // Debloque WebAudio sur la premiere interaction utilisateur. Certains
  // navigateurs bloquent sinon tous les sons, meme lorsque le tir fonctionne.
  function unlockCannonAudio() {
    if (window.RaphaelFighterCannon) return;
    const audio = ensureCannonAudio();
    if (audio && audio.context.state === "suspended") audio.context.resume();
  }
  window.addEventListener("pointerdown", unlockCannonAudio, { passive: true });
  window.addEventListener("keydown", unlockCannonAudio, { passive: true });

  function ready() {
    return typeof scene !== "undefined" && scene &&
           typeof player !== "undefined" && player &&
           typeof isFlyingMode === "function" &&
           typeof gameStarted !== "undefined";
  }

  // ── VISEUR (overlay HTML) ───────────────────────────────────────────────
  function showCrosshair() {
    if (!crosshair) {
      crosshair = document.createElement("div");
      crosshair.id = "combat-crosshair";
      crosshair.innerHTML =
        '<svg width="80" height="80" viewBox="0 0 80 80">' +
        '<circle cx="40" cy="40" r="26" fill="none" stroke="#39ff88" stroke-width="2" opacity="0.85"/>' +
        '<line x1="40" y1="6"  x2="40" y2="22" stroke="#39ff88" stroke-width="2"/>' +
        '<line x1="40" y1="58" x2="40" y2="74" stroke="#39ff88" stroke-width="2"/>' +
        '<line x1="6"  y1="40" x2="22" y2="40" stroke="#39ff88" stroke-width="2"/>' +
        '<line x1="58" y1="40" x2="74" y2="40" stroke="#39ff88" stroke-width="2"/>' +
        '<circle cx="40" cy="40" r="2.5" fill="#39ff88"/>' +
        '</svg>';
      Object.assign(crosshair.style, {
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: "40"
      });
      document.body.appendChild(crosshair);

      hudEl = document.createElement("div");
      hudEl.id = "combat-target-hud";
      Object.assign(hudEl.style, {
        position: "absolute", top: "12px", right: "16px",
        color: "#39ff88", font: "bold 16px monospace", textShadow: "0 0 4px #000",
        zIndex: "40", pointerEvents: "none"
      });
      document.body.appendChild(hudEl);
    }
    crosshair.style.display = "block";
    hudEl.style.display = "block";
    updateHud();
  }
  function hideCrosshair() {
    if (crosshair) crosshair.style.display = "none";
    if (hudEl) hudEl.style.display = "none";
  }
  function updateHud() {
    if (hudEl) hudEl.textContent = "CIBLES  " + score + " / " + TARGET_COUNT + "   [ESPACE/manette = tir]";
  }

  // ── CIBLES ──────────────────────────────────────────────────────────────
  function spawnTargets() {
    const R = (typeof ISLAND_RADIUS === "number" ? ISLAND_RADIUS : 150) * 0.82;
    for (let i = 0; i < TARGET_COUNT; i++) {
      const ang = (i / TARGET_COUNT) * Math.PI * 2 + i * 0.7;
      const dist = R * (0.25 + 0.7 * ((i * 37 % 100) / 100));
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      targets.push(makeTarget(x, z));
    }
  }
  function makeTarget(x, z) {
    const g = new THREE.Group();
    // mat / poteau
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.7, 8, 10),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 })
    );
    pole.position.y = 4;
    g.add(pole);
    // sphere cible rouge lumineuse
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xaa0000, emissiveIntensity: 0.8, roughness: 0.4 })
    );
    orb.position.y = 10;
    g.add(orb);
    // anneau pour la visibilite du ciel
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.4, 0.35, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23a })
    );
    ring.position.y = 10;
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    g.position.set(x, 0, z);
    scene.add(g);
    return { mesh: g, orb, ring, pos: new THREE.Vector3(x, 10, z), alive: true, spin: 0 };
  }

  // ── MISSILES ──────────────────────────────────────────────────────────────
  function fireCannonRound() {
    // Le tangage visuel du modele OBJ est inverse. Les obus suivent donc la
    // trajectoire reelle de l'avion plutot que son axe graphique local.
    const hasFlightVelocity = typeof velocity !== "undefined" && velocity &&
      Number.isFinite(velocity.x) && Number.isFinite(velocity.y) && Number.isFinite(velocity.z) &&
      Math.hypot(velocity.x, velocity.y, velocity.z) > 0.001;
    const fwd = hasFlightVelocity
      ? new THREE.Vector3(velocity.x, velocity.y, velocity.z).normalize()
      : new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion).normalize();
    const start = player.position.clone().addScaledVector(fwd, 4);
    const tracer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.2, 7.5, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffec75,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      })
    );
    tracer.position.copy(start);
    tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), fwd);
    tracer.renderOrder = 40;
    scene.add(tracer);
    cannonRounds.push({ mesh: tracer, vel: fwd.multiplyScalar(CANNON_SPEED), life: CANNON_LIFE });
    pulseCannonAudio();
  }

  function updateCannonRounds(dt) {
    for (let i = cannonRounds.length - 1; i >= 0; i--) {
      const m = cannonRounds[i];
      m.mesh.position.addScaledVector(m.vel, dt);
      m.life -= dt;
      let dead = m.life <= 0;
      // sol
      if (m.mesh.position.y <= 0.3) { spawnExplosion(m.mesh.position, 0xffae2e, 4); dead = true; }
      // cibles
      if (!dead) {
        for (const t of targets) {
          if (t.alive && m.mesh.position.distanceTo(t.pos) < HIT_RADIUS) {
            destroyTarget(t);
            spawnExplosion(t.pos, 0xff5a1e, 9);
            dead = true;
            break;
          }
        }
      }
      if (dead) { scene.remove(m.mesh); cannonRounds.splice(i, 1); }
    }
  }

  function destroyTarget(t) {
    t.alive = false;
    scene.remove(t.mesh);
    score++;
    updateHud();
    // respawn la cible ailleurs apres un delai pour garder du jeu
    setTimeout(() => {
      if (!active) return;
      const R = (typeof ISLAND_RADIUS === "number" ? ISLAND_RADIUS : 150) * 0.82;
      const ang = Math.random() * Math.PI * 2, dist = R * (0.25 + 0.7 * Math.random());
      const nt = makeTarget(Math.cos(ang) * dist, Math.sin(ang) * dist);
      targets.push(nt);
    }, 2500);
  }

  // ── EXPLOSIONS ──────────────────────────────────────────────────────────
  function spawnExplosion(pos, color, size) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    m.position.copy(pos);
    scene.add(m);
    explosions.push({ mesh: m, age: 0, max: size });
  }
  function updateExplosions(dt) {
    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i];
      e.age += dt;
      const k = e.age / 0.5;
      e.mesh.scale.setScalar(1 + k * e.max);
      e.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) { scene.remove(e.mesh); explosions.splice(i, 1); }
    }
  }

  // ── CYCLE ─────────────────────────────────────────────────────────────────
  function start() {
    active = true; score = 0;
    spawnTargets();
    showCrosshair();
  }
  function stop() {
    active = false;
    targets.forEach(t => scene.remove(t.mesh)); targets = [];
    cannonRounds.forEach(m => scene.remove(m.mesh)); cannonRounds = [];
    explosions.forEach(e => scene.remove(e.mesh)); explosions = [];
    stopCannonAudio();
    hideCrosshair();
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!ready()) return;
    const flying = gameStarted && isFlyingMode();
    if (flying && !active) start();
    else if (!flying && active) stop();
    if (!active) return;

    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    fireTimer -= dt;

    const gamepadFire = typeof isFlightGamepadFirePressed === "function" && isFlightGamepadFirePressed();
    const fireKey = (typeof keys !== "undefined" && keys && keys["Space"]) || mouseFire || gamepadFire;
    if (fireKey) startCannonAudio();
    else stopCannonAudio();
    if (fireKey && fireTimer <= 0) {
      fireCannonRound();
      fireTimer = FIRE_INTERVAL;
    }
    prevFire = fireKey;

    // anime les cibles (rotation anneau + pulse)
    const t = now * 0.001;
    targets.forEach(tg => { if (tg.ring) tg.ring.rotation.z += dt * 1.5; if (tg.orb) tg.orb.material.emissiveIntensity = 0.6 + Math.sin(t * 4) * 0.3; });

    updateCannonRounds(dt);
    updateExplosions(dt);
  }
  loop();
})();
