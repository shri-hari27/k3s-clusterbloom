(() => {
  const canvas = document.getElementById('garden');
  const ctx = canvas.getContext('2d');
  const tooltip = document.getElementById('tooltip');
  const connectionStatus = document.getElementById('connection-status');
  const podCountEl = document.getElementById('pod-count');
  const healthyCountEl = document.getElementById('healthy-count');
  const attentionCountEl = document.getElementById('attention-count');

  const COLORS = {
    Running: '#39ff88',
    Pending: '#ffd166',
    Failed: '#ff5c7a',
    Succeeded: '#9d7bff',
    Unknown: '#7fa89a'
  };

  let W, H, DPR;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // FNV-1a hash: mixes bits thoroughly per character, so even strings that
  // differ by a single trailing character (mock-pod-0 vs mock-pod-1) end up
  // with very different output values. The original polynomial hash here
  // did NOT have this property, which was the bug causing all blooms to
  // cluster in almost the same spot.
  function hashString(str) {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193); // FNV prime
    }
    // extra avalanche mixing
    h ^= h >>> 16;
    h = Math.imul(h, 0x45d9f3b);
    h ^= h >>> 16;
    return h >>> 0; // force unsigned
  }

  // Deterministic pseudo-random position from pod name, so a given pod
  // always appears in roughly the same spot between refreshes.
  // x and y come from two independently-salted hashes so they don't
  // correlate with each other.
  function positionFor(name) {
    const hx = hashString(name + '::x');
    const hy = hashString(name + '::y');
    const marginX = 0.14, marginY = 0.22;
    const x = marginX + ((hx % 1000) / 1000) * (1 - marginX * 2);
    const y = marginY + ((hy % 1000) / 1000) * (1 - marginY * 2);
    return { x, y };
  }

  // blooms: Map<podName, blossomState>
  const blooms = new Map();

  function upsertBloom(pod) {
    const pos = positionFor(pod.name);
    const existing = blooms.get(pod.name);
    if (existing) {
      existing.phase = pod.phase;
      existing.ready = pod.ready;
      existing.restarts = pod.restarts;
      existing.node = pod.node;
      existing.state = existing.state === 'wilting' ? 'blooming' : existing.state;
      return;
    }
    blooms.set(pod.name, {
      name: pod.name,
      phase: pod.phase,
      ready: pod.ready,
      restarts: pod.restarts,
      node: pod.node,
      x: pos.x,
      y: pos.y,
      scale: 0,
      state: 'blooming', // blooming -> alive -> wilting -> gone
      wobble: Math.random() * Math.PI * 2,
      baseRadius: 22 + Math.random() * 10
    });
  }

  function markMissing(currentNames) {
    for (const [name, b] of blooms) {
      if (!currentNames.has(name) && b.state !== 'wilting') {
        b.state = 'wilting';
      }
    }
  }

  async function poll() {
    try {
      const res = await fetch('/api/pods');
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();
      const names = new Set(data.pods.map(p => p.name));
      data.pods.forEach(upsertBloom);
      markMissing(names);
      connectionStatus.classList.add('hidden');

      podCountEl.textContent = data.pods.length;
      healthyCountEl.textContent = data.pods.filter(p => p.phase === 'Running' && p.ready).length;
      attentionCountEl.textContent = data.pods.filter(p => p.phase !== 'Running' || !p.ready).length;
    } catch (err) {
      connectionStatus.textContent = 'Reconnecting to cluster feed…';
      connectionStatus.classList.remove('hidden');
    }
  }

  poll();
  setInterval(poll, 3000);

  // ---------- interaction ----------
  let hovered = null;
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    hovered = null;
    for (const b of blooms.values()) {
      const bx = b.x * W, by = b.y * H;
      const r = b.baseRadius * b.scale + 10;
      if (Math.hypot(mx - bx, my - by) < r) { hovered = b; break; }
    }
    if (hovered) {
      tooltip.classList.remove('hidden');
      tooltip.style.left = (mx + 16) + 'px';
      tooltip.style.top = (my + 16) + 'px';
      tooltip.innerHTML = `<strong>${hovered.name}</strong><br/>
        phase: ${hovered.phase}<br/>
        ready: ${hovered.ready ? 'yes' : 'no'}<br/>
        restarts: ${hovered.restarts}<br/>
        node: ${hovered.node || '—'}`;
    } else {
      tooltip.classList.add('hidden');
    }
  });

  // ---------- render loop ----------
  let t = 0;
  function draw() {
    t += 0.016;
    ctx.clearRect(0, 0, W, H);

    for (const [name, b] of Array.from(blooms.entries())) {
      // lifecycle scale animation
      if (b.state === 'blooming') {
        b.scale += (1 - b.scale) * 0.08;
        if (b.scale > 0.97) { b.scale = 1; b.state = 'alive'; }
      } else if (b.state === 'wilting') {
        b.scale *= 0.90;
        if (b.scale < 0.03) { blooms.delete(name); continue; }
      }

      const color = COLORS[b.phase] || COLORS.Unknown;
      const notReady = !b.ready || b.phase !== 'Running';
      const pulseSpeed = notReady ? 3.2 : 1.1;
      const pulse = 0.75 + Math.sin(t * pulseSpeed + b.wobble) * 0.25;

      const bx = b.x * W;
      const by = b.y * H + Math.sin(t * 0.6 + b.wobble) * 4; // gentle drift
      const r = b.baseRadius * b.scale * pulse;

      // outer glow
      const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r * 2.4);
      grad.addColorStop(0, color + 'aa');
      grad.addColorStop(0.4, color + '33');
      grad.addColorStop(1, color + '00');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(bx, by, r * 2.4, 0, Math.PI * 2);
      ctx.fill();

      // core
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.shadowBlur = 0;

      // restart rings — one faint ring per restart, capped for sanity
      const ringCount = Math.min(b.restarts, 4);
      for (let i = 0; i < ringCount; i++) {
        ctx.beginPath();
        ctx.arc(bx, by, r + 8 + i * 6, 0, Math.PI * 2);
        ctx.strokeStyle = color + '55';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();