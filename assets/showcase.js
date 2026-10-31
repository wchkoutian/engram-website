(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const playIcon = '<path d="m7 4 9 6-9 6z"/>';
  const pauseIcon = '<path d="M5 4h3v12H5zM12 4h3v12h-3z"/>';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  class Playback {
    constructor(prefix, videos, target, update = () => {}) {
      this.prefix = prefix; this.videos = videos; this.update = update;
      this.want = !reduced.matches; this.visible = false; this.ready = false;
      this.button = $(prefix + '-play'); this.seek = $(prefix + '-seek');
      this.frame = 0; this.raf = 0; this.hold = 0;
      this.button.onclick = () => {
        this.want = !this.want;
        this.want ? this.start() : this.pause();
        this.paintButton();
      };
      this.seek.oninput = () => {
        this.want = false; this.pause(); this.setFrame(Number(this.seek.value));
      };
      videos.forEach(v => {
        v.addEventListener('error', () => {
          const message = $(prefix + '-error');
          message.textContent = 'Video could not load. Refresh to try again.'; message.hidden = false;
          this.want = false; this.pause();
        });
      });
      videos[0].addEventListener('ended', () => {
        videos.forEach(v => v.pause()); cancelAnimationFrame(this.raf);
        this.display(152);
        if (this.want && this.visible) this.hold = setTimeout(() => {
          this.setFrame(0); this.start();
        }, 1300);
      });
      videos[0].addEventListener('seeked', () => this.display(Math.min(152, Math.floor(videos[0].currentTime * 24 + .001))));
      this.observer = new IntersectionObserver(entries => {
        this.visible = entries[0].isIntersecting;
        if (this.visible && this.want) this.start(); else this.pause();
      }, {threshold: .08});
      this.observer.observe(target);
      this.paintButton();
    }
    paintButton() {
      const active = this.want && this.visible && this.ready;
      this.button.querySelector('svg').innerHTML = active ? pauseIcon : playIcon;
      this.button.setAttribute('aria-label', `${active ? 'Pause' : 'Play'} ${this.prefix}`);
    }
    pause() {
      clearTimeout(this.hold); cancelAnimationFrame(this.raf);
      this.videos.forEach(v => v.pause()); this.paintButton();
    }
    async start() {
      if (!this.ready || !this.want || !this.visible || document.hidden) return;
      clearTimeout(this.hold);
      if (this.videos[0].ended || this.videos[0].currentTime >= 152 / 24) this.setFrame(0);
      try {
        await Promise.all(this.videos.map(v => v.play()));
        if (!this.want || !this.visible || document.hidden) { this.pause(); return; }
        this.paintButton(); cancelAnimationFrame(this.raf);
        this.raf = requestAnimationFrame(() => this.tick());
      } catch (e) {
        if (e.name !== 'AbortError') { this.want = false; this.pause(); }
      }
    }
    setFrame(frame) {
      this.videos.forEach(v => {
        if (v.readyState >= 1) v.currentTime = frame / 24;
      });
      this.display(frame);
    }
    display(frame) {
      this.frame = frame; this.seek.value = frame;
      this.seek.style.setProperty('--progress', `${frame / 152 * 100}%`);
      $(this.prefix + '-phase').textContent = frame >= 151 ? 'Returned' : frame > 76 ? 'Return' : 'Explore';
      this.update(frame);
    }
    tick() {
      const master = this.videos[0];
      if (master.paused || master.ended) return;
      this.videos.slice(1).forEach(v => {
        if (v.readyState >= 2 && Math.abs(v.currentTime - master.currentTime) > .10) v.currentTime = master.currentTime;
      });
      this.display(Math.min(152, Math.floor(master.currentTime * 24 + .001)));
      this.raf = requestAnimationFrame(() => this.tick());
    }
  }

  const canvas = $('memory'), ctx = canvas.getContext('2d');
  let scenes, currentScene, cloud, request = 0, yaw = -.38, pitch = .13, drag;
  let snapshot = 0, currentFrame = 0, interacted = false;
  const cache = new Map();

  function drawMemory() {
    if (!cloud || !currentScene) return;
    const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (!r.width || !r.height) return;
    const width = Math.round(r.width * dpr), height = Math.round(r.height * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
    const angle = yaw + (!interacted && !reduced.matches ? .10 * Math.sin(currentFrame / 152 * Math.PI * 2) : 0);
    const cy = Math.cos(angle), sy = Math.sin(angle), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const scale = Math.min(r.width * .85, r.height * 1.12) / currentScene.span;
    const project = p => {
      const x = p[0] - currentScene.center[0], y = p[1] - currentScene.center[1], z = p[2] - currentScene.center[2];
      const a = cy * x + sy * z, b = -sy * x + cy * z;
      return [r.width / 2 + a * scale, r.height * .49 + (cp * y - sp * b) * scale, sp * y + cp * b];
    };
    const projected = [];
    for (const [points, source] of [[cloud[0], 0], [snapshot ? cloud[snapshot] : [], 1]]) {
      for (let i = 0; i < points.length; i += 3) projected.push([...project(points.subarray(i, i + 3)), source]);
    }
    projected.sort((a, b) => b[2] - a[2]);
    for (const [x, y, z, source] of projected) {
      if (x < 0 || x > r.width || y < 0 || y > r.height) continue;
      ctx.fillStyle = source ? 'rgba(219,156,89,.60)' : 'rgba(17,126,137,.83)';
      const size = source ? 1.45 : 1.65;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    canvas.dataset.snapshot = String(snapshot); canvas.dataset.frame = String(currentFrame);
  }
  function updateMemory(frame) {
    if (frame === currentFrame && cloud) return;
    currentFrame = frame;
    if (!currentScene) return;
    snapshot = currentScene.writeFrames.filter(f => frame >= f).length;
    drawMemory();
  }
  const demo = new Playback('demo', [$('demo-video')], document.querySelector('.demo-grid'), updateMemory);

  async function loadCloud(s) {
    if (!cache.has(s.id)) {
      const promise = (async () => {
        const response = await fetch(s.points);
        if (!response.ok) throw Error('Memory unavailable');
        const buffer = await response.arrayBuffer(), view = new DataView(buffer);
        if (buffer.byteLength !== s.counts.reduce((a, b) => a + b, 0) * 6) throw Error('Invalid memory file');
        let offset = 0;
        return s.counts.map(count => {
          const points = new Float32Array(count * 3);
          for (let i = 0; i < points.length; i++, offset += 2) points[i] = s.offset[i % 3] + view.getUint16(offset, true) * s.scale[i % 3];
          return points;
        });
      })();
      cache.set(s.id, promise);
      promise.catch(() => cache.delete(s.id));
    }
    return cache.get(s.id);
  }
  async function selectScene(index) {
    if (!scenes) return;
    const version = ++request, s = scenes[index];
    demo.ready = false; demo.pause(); cloud = null; currentScene = s;
    yaw = -.38; pitch = .13; interacted = false; snapshot = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    $('memory-status').hidden = false; $('memory-status').textContent = 'Loading memory…';
    $('demo-error').hidden = true;
    document.querySelectorAll('[data-scene]').forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
    const video = $('demo-video');
    video.src = s.video; video.poster = s.poster; video.load();
    video.setAttribute('aria-label', `Engram generated camera journey through the ${s.label.toLowerCase()}`);
    $('observed-view').src = s.poster; $('returned-view').src = s.returned;
    $('observed-view').alt = `${s.label}: original observed view`;
    $('returned-view').alt = `${s.label}: Engram return to the original view`;
    demo.display(0);
    try {
      const points = await loadCloud(s);
      if (version !== request) return;
      cloud = points; $('memory-status').hidden = true;
      drawMemory(); demo.ready = true; demo.paintButton();
      if (demo.want) demo.start();
    } catch (e) {
      if (version !== request) return;
      $('memory-status').textContent = 'Memory could not load. Select the scene to retry.';
      demo.ready = true; demo.start();
    }
  }
  document.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => selectScene(Number(b.dataset.scene)));
  canvas.onpointerdown = e => {
    drag = [e.clientX, e.clientY, yaw, pitch]; interacted = true;
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = e => {
    if (!drag) return;
    yaw = drag[2] + (e.clientX - drag[0]) * .008;
    pitch = Math.max(-1.3, Math.min(1.3, drag[3] + (e.clientY - drag[1]) * .008)); drawMemory();
  };
  canvas.onpointerup = canvas.onpointercancel = () => drag = null;
  const resetView = () => { yaw = -.38; pitch = .13; interacted = false; drawMemory(); };
  canvas.ondblclick = resetView;
  canvas.onkeydown = e => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key)) return;
    e.preventDefault(); interacted = true;
    if (e.key === 'Home') { resetView(); return; }
    yaw += e.key === 'ArrowLeft' ? -.12 : e.key === 'ArrowRight' ? .12 : 0;
    pitch = Math.max(-1.3, Math.min(1.3, pitch + (e.key === 'ArrowUp' ? -.12 : e.key === 'ArrowDown' ? .12 : 0)));
    drawMemory();
  };
  new ResizeObserver(drawMemory).observe(canvas);

  const sample = DATA.scenes.find(s => s.id === '5b8b4c355672dbb3');
  $('comparison-players').innerHTML = ['Engram','Spatia','ViewCrafter'].map(method => {
    const item = sample.tasks.closed_loop[method];
    return `<figure><figcaption>${method}</figcaption><video muted playsinline preload="none" poster="${item.last_frame}" data-src="${item.video}" aria-label="${method} closed-loop comparison"></video></figure>`;
  }).join('');
  const compared = [...document.querySelectorAll('#comparison-players video')];
  const comparison = new Playback('comparison', compared, $('comparison-players'));
  const lazy = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    compared.forEach(v => { v.src = v.dataset.src; v.load(); });
    comparison.ready = true; comparison.start(); lazy.disconnect();
  }, {rootMargin: '200px'});
  lazy.observe($('comparison-players'));

  reduced.addEventListener('change', () => {
    if (reduced.matches) [demo, comparison].forEach(p => { p.want = false; p.pause(); });
    drawMemory();
  });
  document.addEventListener('visibilitychange', () => {
    [demo, comparison].forEach(p => document.hidden ? p.pause() : p.start());
  });

  const groups = ['Common 5 scenes · fixed sample', 'Engram test-100 · separate split, Local-10 excluded', 'Local-10 · reference results'];
  let groupIndex = 0;
  $('re10k-results').innerHTML = '<thead><tr><th rowspan="2">Method</th><th rowspan="2">Case set</th><th colspan="3">NVS · 81 frames</th><th colspan="3">Closed loop · 153 frames</th></tr><tr><th>PSNR ↑</th><th>SSIM ↑</th><th>LPIPS ↓</th><th>PSNR ↑</th><th>SSIM ↑</th><th>LPIPS ↓</th></tr></thead><tbody>' + DATA.re10k.agg.map(r => {
    if (r.grp) return `<tr class="group"><td colspan="8">${groups[groupIndex++]}</td></tr>`;
    if (!r.nvs.concat(r.closed).some(v => v != null)) return '';
    return `<tr class="${r.ours ? 'ours' : ''}"><td>${escape(r.method)}</td><td>${escape(r.cases)}</td>${r.nvs.concat(r.closed).map(v => `<td>${v == null ? '—' : escape(v)}</td>`).join('')}</tr>`;
  }).join('') + '</tbody>';
  $('worldscore-results').innerHTML = '<thead><tr><th>Method</th><th>Evaluation set</th><th>Average ↑</th><th>Static ↑</th><th>Dynamic ↑</th></tr></thead><tbody>' + DATA.ws.table.filter(r => r.vals.some(v => v != null)).map(r => `<tr class="${r.ours ? 'ours' : ''}"><td>${escape(r.method)}</td><td>${escape(r.cases)}</td>${r.vals.slice(0,3).map(v => `<td>${v == null ? '—' : v.toFixed(2)}</td>`).join('')}</tr>`).join('') + '</tbody>';
  fetch('assets/showcase/scenes.json').then(r => {
    if (!r.ok) throw Error('Scenes unavailable'); return r.json();
  }).then(data => { scenes = data.scenes; selectScene(0); }).catch(() => {
    $('memory-status').textContent = 'Demo could not load. Refresh to try again.';
    $('demo-play').disabled = true;
  });
})();
