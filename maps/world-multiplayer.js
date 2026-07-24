import * as THREE from 'three';

const SEND_INTERVAL = 1 / 20;

function tintRemoteAircraft(root) {
  root.traverse(node => {
    if (!node.isMesh || !node.material) return;
    const source = Array.isArray(node.material) ? node.material : [node.material];
    const tinted = source.map(material => {
      const clone = material.clone();
      if (clone.color) clone.color.lerp(new THREE.Color(0x168dff), .48);
      if (clone.emissive) clone.emissive.lerp(new THREE.Color(0x073a80), .35);
      return clone;
    });
    node.material = Array.isArray(node.material) ? tinted : tinted[0];
  });
}

function makePilotLabel(username) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(3,12,18,.78)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#53d9ff';
  context.lineWidth = 4;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  context.fillStyle = '#effbff';
  context.font = '700 42px Segoe UI';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(username.slice(0, 24), canvas.width / 2, canvas.height / 2);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    depthTest: false,
  }));
  sprite.scale.set(24, 4.5, 1);
  sprite.position.y = 9;
  sprite.renderOrder = 80;
  return sprite;
}

export function createTwoPlayerMultiplayer({ scene, player, createRemoteAircraft, getForward, getSpeed, spawn }) {
  const params = new URLSearchParams(location.search);
  const active = params.get('multiplayer') === '1';
  const roomId = params.get('room');
  const panel = document.getElementById('multiplayer-panel');
  const status = document.getElementById('multiplayer-status');
  const health = document.getElementById('multiplayer-health');
  if (!active || !roomId) {
    if (panel) panel.hidden = true;
    return { active: false, update() {}, close() {} };
  }
  if (panel) panel.hidden = false;

  const remotes = new Map();
  const pendingRemotes = new Map();
  const effects = [];
  let socket = null;
  let closing = false;
  let localUserId = null;
  let localHp = 100;
  let dead = false;
  let sendClock = 0;
  let gunClock = 0;
  let previousMissile = false;
  let pingSentAt = 0;
  let ping = null;

  if (status) {
    status.hidden = false;
    status.textContent = 'MULTIJOUEUR · CONNEXION…';
  }
  if (health) health.textContent = 'INTÉGRITÉ 100';

  async function ensureRemote(userId, username = 'Pilote') {
    if (remotes.has(userId)) return remotes.get(userId);
    if (pendingRemotes.has(userId)) return pendingRemotes.get(userId);
    const pending = (async () => {
      const mesh = await createRemoteAircraft();
      tintRemoteAircraft(mesh);
      mesh.add(makePilotLabel(username));
      mesh.visible = false;
      scene.add(mesh);
      const remote = {
        mesh,
        username,
        targetPosition: mesh.position.clone(),
        targetQuaternion: mesh.quaternion.clone(),
        hp: 100,
        initialized: false,
      };
      remotes.set(userId, remote);
      renderStatus();
      return remote;
    })();
    pendingRemotes.set(userId, pending);
    try {
      return await pending;
    } finally {
      pendingRemotes.delete(userId);
    }
  }

  function removeRemote(userId) {
    const remote = remotes.get(userId);
    if (!remote) return;
    scene.remove(remote.mesh);
    remotes.delete(userId);
    renderStatus();
  }

  function renderStatus(message) {
    if (!status) return;
    const opponent = [...remotes.values()][0];
    status.textContent = message || (opponent
      ? `DUEL · ${opponent.username} · ${ping ?? '—'} ms`
      : 'DUEL · EN ATTENTE DU SECOND PILOTE');
  }

  function applyRemoteState(remote, state) {
    if (!state?.position || !state?.rotation) return;
    remote.targetPosition.fromArray(state.position);
    remote.targetQuaternion.setFromEuler(new THREE.Euler(...state.rotation, 'XYZ'));
    if (!remote.initialized) {
      remote.mesh.position.copy(remote.targetPosition);
      remote.mesh.quaternion.copy(remote.targetQuaternion);
      remote.mesh.visible = true;
      remote.initialized = true;
    }
  }

  function spawnShot(origin, forward, weapon) {
    if (!origin || !forward) return;
    const direction = new THREE.Vector3().fromArray(forward).normalize();
    const length = weapon === 'missile' ? 15 : 7;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(weapon === 'missile' ? .22 : .1, .1, length, 7),
      new THREE.MeshBasicMaterial({
        color: weapon === 'missile' ? 0xff742b : 0x79e7ff,
        transparent: true,
        opacity: .9,
      })
    );
    mesh.geometry.rotateX(Math.PI / 2);
    mesh.position.fromArray(origin).addScaledVector(direction, 8);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    scene.add(mesh);
    effects.push({ mesh, velocity: direction.multiplyScalar(weapon === 'missile' ? 280 : 560), life: weapon === 'missile' ? 3 : 1.2 });
  }

  function connect() {
    if (closing) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/api/multiplayer/ws/${encodeURIComponent(roomId)}`);
    socket.onmessage = async event => {
      const message = JSON.parse(event.data);
      if (message.type === 'welcome') {
        localUserId = message.user_id;
        for (const item of message.players) {
          const remote = await ensureRemote(item.user_id, item.username);
          remote.hp = item.hp;
          applyRemoteState(remote, item.state);
        }
        renderStatus();
      } else if (message.type === 'joined' && message.user_id !== localUserId) {
        await ensureRemote(message.user_id, message.username);
        renderStatus(`${message.username} A REJOINT LE DUEL`);
      } else if (message.type === 'state') {
        const remote = await ensureRemote(message.user_id);
        remote.hp = message.hp;
        applyRemoteState(remote, message.state);
      } else if (message.type === 'left') {
        removeRemote(message.user_id);
      } else if (message.type === 'shot') {
        spawnShot(message.origin, message.forward, message.weapon);
      } else if (message.type === 'damage') {
        if (message.target_id === localUserId) {
          localHp = message.hp;
          if (health) health.textContent = `INTÉGRITÉ ${localHp}`;
        } else {
          const remote = remotes.get(message.target_id);
          if (remote) remote.hp = message.hp;
        }
      } else if (message.type === 'destroyed') {
        if (message.user_id === localUserId) {
          dead = true;
          renderStatus('APPAREIL DÉTRUIT · RETOUR DANS 3 SECONDES');
        } else {
          const remote = remotes.get(message.user_id);
          if (remote) remote.mesh.visible = false;
          renderStatus('ADVERSAIRE ABATTU');
        }
      } else if (message.type === 'respawn') {
        if (message.user_id === localUserId) {
          localHp = 100;
          dead = false;
          player.position.set(spawn[0] + 18, spawn[1], spawn[2]);
          player.visible = true;
          if (health) health.textContent = 'INTÉGRITÉ 100';
        } else {
          const remote = remotes.get(message.user_id);
          if (remote) remote.mesh.visible = true;
        }
        renderStatus();
      } else if (message.type === 'pong') {
        ping = Math.max(0, Math.round(performance.now() - Number(message.sent_at || pingSentAt)));
        renderStatus();
      }
    };
    socket.onclose = event => {
      if (closing) return;
      if (event.code === 4409) renderStatus('SALON COMPLET');
      else if (event.code >= 4400) renderStatus('SESSION GHOST CHAT REQUISE');
      else {
        renderStatus('CONNEXION PERDUE · RECONNEXION…');
        window.setTimeout(connect, 1800);
      }
    };
  }

  connect();

  function send(payload) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  function update(dt, controls) {
    sendClock -= dt;
    gunClock -= dt;
    for (const remote of remotes.values()) {
      if (!remote.initialized) continue;
      remote.mesh.position.lerp(remote.targetPosition, Math.min(1, dt * 10));
      remote.mesh.quaternion.slerp(remote.targetQuaternion, Math.min(1, dt * 10));
    }
    for (let index = effects.length - 1; index >= 0; index--) {
      const effect = effects[index];
      effect.life -= dt;
      effect.mesh.position.addScaledVector(effect.velocity, dt);
      if (effect.life <= 0) {
        scene.remove(effect.mesh);
        effects.splice(index, 1);
      }
    }
    if (sendClock <= 0) {
      sendClock = SEND_INTERVAL;
      send({
        type: 'state',
        position: player.position.toArray(),
        rotation: player.rotation.toArray().slice(0, 3),
        speed: getSpeed(),
        sent_at: performance.now(),
      });
    }
    const forward = getForward().toArray();
    if (controls.fire && gunClock <= 0 && !dead) {
      gunClock = .085;
      send({ type: 'fire', weapon: 'gun', forward });
    }
    if (controls.missile && !previousMissile && !dead) {
      send({ type: 'fire', weapon: 'missile', forward });
    }
    previousMissile = controls.missile;
    if (performance.now() - pingSentAt > 2500) {
      pingSentAt = performance.now();
      send({ type: 'ping', sent_at: pingSentAt });
    }
    if (dead) player.visible = false;
  }

  return {
    active: true,
    update,
    close() {
      closing = true;
      socket?.close(1000);
      remotes.forEach(remote => scene.remove(remote.mesh));
      effects.forEach(effect => scene.remove(effect.mesh));
    },
    diagnostics: () => ({ roomId, localUserId, localHp, dead, remoteCount: remotes.size, ping }),
  };
}
