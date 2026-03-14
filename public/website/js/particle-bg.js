(function initParticleBg() {
  var container = document.getElementById('pricingWaveCanvas');
  if (!container) return;

  var canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  // Config
  var PARTICLE_DENSITY = 0.00015;
  var BG_DENSITY = 0.00005;
  var MOUSE_RADIUS = 180;
  var RETURN_SPEED = 0.08;
  var DAMPING = 0.90;
  var REPULSION = 1.2;

  var particles = [];
  var bgParticles = [];
  var mouse = { x: -1000, y: -1000, active: false };
  var frameId = 0;
  var isVisible = false;
  var cssW = 0, cssH = 0;

  function rand(min, max) { return Math.random() * (max - min) + min; }

  function initParticles(w, h) {
    var count = Math.floor(w * h * PARTICLE_DENSITY);
    particles = [];
    for (var i = 0; i < count; i++) {
      var x = Math.random() * w;
      var y = Math.random() * h;
      particles.push({
        x: x, y: y,
        ox: x, oy: y,
        vx: 0, vy: 0,
        size: rand(1, 2.5),
        blue: Math.random() > 0.9
      });
    }

    var bgCount = Math.floor(w * h * BG_DENSITY);
    bgParticles = [];
    for (var j = 0; j < bgCount; j++) {
      bgParticles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        size: rand(0.5, 1.5),
        alpha: rand(0.1, 0.4),
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  function resize() {
    var rect = container.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = rect.width;
    cssH = rect.height;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initParticles(cssW, cssH);
  }

  function animate(time) {
    if (!isVisible) { frameId = requestAnimationFrame(animate); return; }

    ctx.clearRect(0, 0, cssW, cssH);

    // --- Background radial glow ---
    var cx = cssW / 2, cy = cssH / 2;
    var pulse = Math.sin(time * 0.0008) * 0.035 + 0.085;
    var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(cssW, cssH) * 0.7);
    grad.addColorStop(0, 'rgba(34, 211, 238, ' + pulse + ')');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cssW, cssH);

    // --- Background stars ---
    ctx.fillStyle = '#ffffff';
    for (var b = 0; b < bgParticles.length; b++) {
      var bp = bgParticles[b];
      bp.x += bp.vx;
      bp.y += bp.vy;
      if (bp.x < 0) bp.x = cssW;
      if (bp.x > cssW) bp.x = 0;
      if (bp.y < 0) bp.y = cssH;
      if (bp.y > cssH) bp.y = 0;

      var twinkle = Math.sin(time * 0.002 + bp.phase) * 0.5 + 0.5;
      ctx.globalAlpha = bp.alpha * (0.3 + 0.7 * twinkle);
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, bp.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // --- Main particles: forces ---
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];

      // Mouse repulsion
      var dx = mouse.x - p.x;
      var dy = mouse.y - p.y;
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (mouse.active && dist < MOUSE_RADIUS && dist > 0.01) {
        var force = (MOUSE_RADIUS - dist) / MOUSE_RADIUS * REPULSION;
        p.vx -= (dx / dist) * force * 5;
        p.vy -= (dy / dist) * force * 5;
      }

      // Spring back to origin
      p.vx += (p.ox - p.x) * RETURN_SPEED;
      p.vy += (p.oy - p.y) * RETURN_SPEED;
    }

    // --- Collisions (limited to nearby pairs for performance) ---
    for (var i2 = 0; i2 < particles.length; i2++) {
      for (var j2 = i2 + 1; j2 < particles.length; j2++) {
        var p1 = particles[i2], p2 = particles[j2];
        var cdx = p2.x - p1.x;
        var cdy = p2.y - p1.y;
        var distSq = cdx * cdx + cdy * cdy;
        var minDist = p1.size + p2.size;

        if (distSq < minDist * minDist) {
          var cDist = Math.sqrt(distSq);
          if (cDist > 0.01) {
            var nx = cdx / cDist;
            var ny = cdy / cDist;
            var overlap = minDist - cDist;
            p1.x -= nx * overlap * 0.5;
            p1.y -= ny * overlap * 0.5;
            p2.x += nx * overlap * 0.5;
            p2.y += ny * overlap * 0.5;

            var dvx = p1.vx - p2.vx;
            var dvy = p1.vy - p2.vy;
            var vn = dvx * nx + dvy * ny;

            if (vn > 0) {
              var m1 = p1.size, m2 = p2.size;
              var imp = (-(1 + 0.85) * vn) / (1 / m1 + 1 / m2);
              p1.vx += imp * nx / m1;
              p1.vy += imp * ny / m1;
              p2.vx -= imp * nx / m2;
              p2.vy -= imp * ny / m2;
            }
          }
        }
      }
    }

    // --- Integrate & draw ---
    for (var k = 0; k < particles.length; k++) {
      var pk = particles[k];
      pk.vx *= DAMPING;
      pk.vy *= DAMPING;
      pk.x += pk.vx;
      pk.y += pk.vy;

      var vel = Math.sqrt(pk.vx * pk.vx + pk.vy * pk.vy);
      var opacity = Math.min(0.3 + vel * 0.1, 1);

      ctx.beginPath();
      ctx.arc(pk.x, pk.y, pk.size, 0, Math.PI * 2);
      ctx.fillStyle = pk.blue
        ? '#22d3ee'
        : 'rgba(255,255,255,' + opacity + ')';
      ctx.fill();
    }

    frameId = requestAnimationFrame(animate);
  }

  // Pointer tracking on pricing section
  var section = container.parentElement;
  section.addEventListener('pointermove', function(e) {
    var r = container.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.active = true;
  }, { passive: true });

  section.addEventListener('pointerleave', function() {
    mouse.active = false;
  }, { passive: true });

  // Visibility
  var io = new IntersectionObserver(function(entries) {
    isVisible = entries[0].isIntersecting;
  }, { threshold: 0.05 });
  io.observe(section);

  // Resize
  var ro = new ResizeObserver(function() { resize(); });
  ro.observe(container);

  // Init
  resize();
  isVisible = true;
  frameId = requestAnimationFrame(animate);
})();
