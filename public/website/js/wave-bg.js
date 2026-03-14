import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

(function initWaveBackground() {
  const container = document.getElementById('pricingWaveCanvas');
  if (!container) return;

  const gsap = window.gsap;
  if (!gsap) { console.warn('wave-bg: gsap not found'); return; }

  // --- Film Grain Shader ---
  const FilmGrainShader = {
    uniforms: {
      tDiffuse: { value: null },
      time: { value: 0 },
      intensity: { value: 0.9 },
      grainScale: { value: 0.3 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      precision mediump float;
      uniform sampler2D tDiffuse;
      uniform float time, intensity, grainScale;
      varying vec2 vUv;
      float sparkle(vec2 p) {
        vec2 j = p + vec2(37.0,17.0)*fract(time*0.07);
        vec3 p3 = fract(vec3(j.xyx)*vec3(.1031,.1030,.0973)+time*0.1);
        p3 += dot(p3, p3.yxz+19.19);
        return fract((p3.x+p3.y)*p3.z);
      }
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float n = sparkle(gl_FragCoord.xy*0.5*grainScale)*2.0-1.0;
        gl_FragColor = vec4(c.rgb + n*intensity*0.1, c.a);
      }
    `,
  };

  // --- Wave state ---
  const wave1 = { gain: 10, frequency: 0, waveLength: 0.5, currentAngle: 0 };
  const wave2 = { gain: 0, frequency: 0, waveLength: 0.5, currentAngle: 0 };

  const kf1 = [
    { time: 0, gain: 10, frequency: 0, waveLength: 0.5 },
    { time: 4, gain: 300, frequency: 1, waveLength: 0.5 },
    { time: 6, gain: 300, frequency: 4, waveLength: Math.PI * 1.5 },
    { time: 8, gain: 225, frequency: 4, waveLength: Math.PI * 1.5 },
    { time: 10, gain: 500, frequency: 1, waveLength: Math.PI * 1.5 },
    { time: 14, gain: 225, frequency: 3, waveLength: Math.PI * 1.5 },
    { time: 22, gain: 100, frequency: 6, waveLength: Math.PI * 1.5 },
    { time: 28, gain: 0, frequency: 0.9, waveLength: 0.5 },
    { time: 30, gain: 128, frequency: 0.9, waveLength: 0.5 },
    { time: 32, gain: 190, frequency: 1.42, waveLength: 0.5 },
    { time: 39, gain: 499, frequency: 4.0, waveLength: Math.PI * 1.5 },
    { time: 40, gain: 500, frequency: 4.0, waveLength: Math.PI * 1.5 },
    { time: 42, gain: 400, frequency: 2.82, waveLength: Math.PI * 1.5 },
    { time: 44, gain: 327, frequency: 2.56, waveLength: Math.PI * 1.5 },
    { time: 48, gain: 188, frequency: 5.4, waveLength: 0.5 },
    { time: 52, gain: 32, frequency: 0.1, waveLength: 0.5 },
    { time: 55, gain: 10, frequency: 0, waveLength: 0.5 },
  ];
  const kf2 = [
    { time: 0, gain: 0, frequency: 0, waveLength: 0.5 },
    { time: 9, gain: 0, frequency: 0, waveLength: 0.5 },
    { time: 10, gain: 400, frequency: 1, waveLength: 0.5 },
    { time: 13, gain: 300, frequency: 4, waveLength: Math.PI * 1.5 },
    { time: 24, gain: 96, frequency: 2, waveLength: 0.5 },
    { time: 28, gain: 0, frequency: 0.9, waveLength: 0.5 },
    { time: 30, gain: 142, frequency: 0.9, waveLength: 0.5 },
    { time: 36, gain: 374, frequency: 4.0, waveLength: Math.PI * 1.5 },
    { time: 38, gain: 375, frequency: 4.0, waveLength: Math.PI * 1.5 },
    { time: 40, gain: 300, frequency: 2.26, waveLength: Math.PI * 1.5 },
    { time: 44, gain: 245, frequency: 2.05, waveLength: Math.PI * 1.5 },
    { time: 48, gain: 141, frequency: 5.12, waveLength: 0.5 },
    { time: 52, gain: 24, frequency: 0.08, waveLength: 0.5 },
    { time: 55, gain: 8, frequency: 0, waveLength: 0.5 },
  ];

  // --- Mouse & glow ---
  const mouse = { x: 0, y: 0, active: false };
  let proxyMouseX = 0, proxyMouseY = 0, proxyInit = false;
  const glowCfg = { maxGlowDistance: 690, speedScale: 0.52, fadeSpeed: 4.4, glowFalloff: 0.6, mouseSmoothing: 30.0 };
  const glowDyn = { accumEase: 1.5, decay: 3.3, max: 40.0, speedEase: 8.5 };
  let smoothSpeed = 0;

  // --- Renderer ---
  const EFFECT_PR = Math.min(window.devicePixelRatio, 2) * 0.5;
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setPixelRatio(EFFECT_PR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.autoClear = false;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

  // --- Constants ---
  const MAX_BARS = 256;
  const BAR_W = 14, BAR_GAP = 10, EXTEND_LEFT = 320;
  const MAX_KF_GAIN = 500, SCREEN_COV = 0.6;

  let camera, composer, bloomPass, grainPass;
  let camW = 0, camH = 0, initialized = false;
  let instancedBars = null, currentBarCount = 0, barMaterial = null, barCenters = null;
  let setMouseNDC, setSmoothSpeed, setPhase1, setPhase2;
  let rect;

  function createMaterial() {
    return new THREE.ShaderMaterial({
      defines: { USE_INSTANCING: '' },
      uniforms: {
        uMouseClipX: { value: 0 }, uHalfW: { value: 0 },
        uMaxGlowDist: { value: glowCfg.maxGlowDistance }, uGlowFalloff: { value: glowCfg.glowFalloff },
        uSmoothSpeed: { value: 0 }, uGainMul: { value: 1 }, uBaseY: { value: 0 },
        w1Gain: { value: wave1.gain }, w1Len: { value: wave1.waveLength }, w1Phase: { value: 0 },
        w2Gain: { value: wave2.gain }, w2Len: { value: wave2.waveLength }, w2Phase: { value: 0 },
        uFixedTipPx: { value: 10 }, uMinBottomWidthPx: { value: 0 },
        uColor: { value: new THREE.Color('hsl(220,100%,50%)') },
        uEmissive: { value: new THREE.Color('#1f3dbc') },
        uBaseEmissive: { value: 0.05 },
        uRotationAngle: { value: THREE.MathUtils.degToRad(23.4) },
      },
      vertexShader: `
        attribute float aXPos, aPosNorm, aGroup, aGlow;
        uniform float uMouseClipX, uHalfW, uMaxGlowDist, uGlowFalloff;
        uniform float uGainMul, uBaseY;
        uniform float w1Gain, w1Len, w1Phase, w2Gain, w2Len, w2Phase;
        uniform float uRotationAngle;
        varying float vGlow, vPulse, vHeight;
        varying vec2 vUv;
        float sineH(float g, float len, float ph, float t){
          return max(20.0, (sin(ph + t*len)*0.5+0.6)*g*uGainMul);
        }
        void main(){
          vUv = uv;
          float h1 = sineH(w1Gain, w1Len, w1Phase, aPosNorm);
          float h2 = sineH(w2Gain, w2Len, w2Phase, aPosNorm);
          vHeight = mix(h1, h2, aGroup);
          vec3 pos = position;
          pos.x += aXPos;
          pos.y = 0.0;
          float height = vHeight * uv.y;
          pos.x += height * tan(uRotationAngle);
          pos.y += height + uBaseY;
          vec4 clip = projectionMatrix * modelViewMatrix * vec4(pos,1.0);
          float dxPx = abs(uMouseClipX - clip.x/clip.w) * uHalfW;
          float prox = clamp(1.0 - pow(dxPx/uMaxGlowDist, uGlowFalloff), 0.0, 1.0);
          vGlow = aGlow;
          vPulse = prox;
          gl_Position = clip;
        }
      `,
      fragmentShader: `
        precision mediump float;
        uniform vec3 uColor, uEmissive;
        uniform float uBaseEmissive, uFixedTipPx, uMinBottomWidthPx;
        varying float vGlow, vPulse, vHeight;
        varying vec2 vUv;
        void main(){
          float tipProp = clamp(uFixedTipPx/vHeight, 0.0, 0.95);
          float transY = 1.0 - tipProp;
          float xC = abs(vUv.x - 0.5)*2.0;
          float px = fwidth(vUv.x);
          float aw;
          if(vUv.y >= transY){
            float tp = (vUv.y - transY)/tipProp;
            aw = 1.0 - pow(tp, 0.9);
          } else {
            float bp = vUv.y/transY;
            aw = max(uMinBottomWidthPx*px*10.0, pow(bp, 0.5));
          }
          float alpha = smoothstep(-px, px, aw - xC);
          if(alpha < 0.01) discard;
          float es = uBaseEmissive + vGlow*0.9 + vPulse*0.15;
          gl_FragColor = vec4(uColor + uEmissive*es, 0.35*alpha);
        }
      `,
      side: THREE.FrontSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  function setupQuickSetters() {
    const u = barMaterial.uniforms;
    setMouseNDC = gsap.quickSetter(u.uMouseClipX, 'value');
    setSmoothSpeed = gsap.quickSetter(u.uSmoothSpeed, 'value');
    setPhase1 = gsap.quickSetter(u.w1Phase, 'value');
    setPhase2 = gsap.quickSetter(u.w2Phase, 'value');
  }

  function updateGlowDist() {
    if (!barMaterial) return;
    const span = currentBarCount * (BAR_W + BAR_GAP) - BAR_GAP;
    glowCfg.maxGlowDistance = span * 0.3;
    barMaterial.uniforms.uMaxGlowDist.value = glowCfg.maxGlowDistance;
  }

  function updateGainMul() {
    if (!barMaterial) return;
    barMaterial.uniforms.uGainMul.value = (camH * SCREEN_COV) / MAX_KF_GAIN;
  }

  function createBars() {
    if (instancedBars) {
      scene.remove(instancedBars);
      instancedBars.geometry.dispose();
      instancedBars.material.dispose();
      instancedBars = null;
    }
    const span = camW + EXTEND_LEFT;
    let count = Math.min(MAX_BARS, Math.max(1, Math.floor((span + BAR_GAP) / (BAR_W + BAR_GAP))));
    const gap = count > 1 ? (span - count * BAR_W) / (count - 1) : 0;
    currentBarCount = count;
    const startX = -camW / 2 - EXTEND_LEFT;
    const instCnt = count * 2;
    barCenters = new Float32Array(count);

    const aXPos = new Float32Array(instCnt);
    const aPosNorm = new Float32Array(instCnt);
    const aGroup = new Float32Array(instCnt);
    const aGlow = new Float32Array(instCnt).fill(0);

    for (let i = 0; i < count; i++) {
      const x = startX + BAR_W / 2 + i * (BAR_W + gap);
      barCenters[i] = x;
      const t = count > 1 ? i / (count - 1) : 0;
      aXPos[i] = aXPos[i + count] = x;
      aPosNorm[i] = aPosNorm[i + count] = t;
      aGroup[i] = 0; aGroup[i + count] = 1;
    }

    const geo = new THREE.PlaneGeometry(BAR_W, 1, 1, 1);
    geo.translate(0, 0.5, 0);
    geo.setAttribute('aXPos', new THREE.InstancedBufferAttribute(aXPos, 1));
    geo.setAttribute('aPosNorm', new THREE.InstancedBufferAttribute(aPosNorm, 1));
    geo.setAttribute('aGroup', new THREE.InstancedBufferAttribute(aGroup, 1));
    geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(aGlow, 1).setUsage(THREE.DynamicDrawUsage));

    barMaterial = createMaterial();
    instancedBars = new THREE.InstancedMesh(geo, barMaterial, instCnt);
    instancedBars.frustumCulled = false;
    scene.add(instancedBars);
    setupQuickSetters();
    updateGlowDist();
  }

  function accumulateGlow(dt) {
    if (!instancedBars) return;
    const attr = instancedBars.geometry.getAttribute('aGlow');
    const arr = attr.array;
    const mouseWorldX = proxyMouseX - camW * 0.5;
    const mDist = glowCfg.maxGlowDistance;
    const fall = glowCfg.glowFalloff;
    const decayLerp = 1 - Math.exp(-glowDyn.decay * dt);
    const addEase = 1 - Math.exp(-glowDyn.accumEase * dt);

    for (let i = 0; i < currentBarCount; i++) {
      const dx = Math.abs(mouseWorldX - barCenters[i]);
      const hit = dx < mDist ? 1 - Math.pow(dx / mDist, fall) : 0;
      const add = hit * smoothSpeed * addEase;
      let g = arr[i] + add - arr[i] * decayLerp;
      if (g > glowDyn.max) g = glowDyn.max;
      arr[i] = arr[i + currentBarCount] = g;
    }
    attr.needsUpdate = true;
  }

  // --- Init ---
  function init() {
    camW = container.clientWidth;
    camH = container.clientHeight;
    camera = new THREE.OrthographicCamera(-camW / 2, camW / 2, camH / 2, -camH / 2, -1000, 1000);
    camera.position.z = 10;
    camera.lookAt(0, 0, 0);
    renderer.setSize(camW, camH);

    composer = new EffectComposer(renderer);
    composer.setPixelRatio(EFFECT_PR);
    composer.addPass(new RenderPass(scene, camera));

    bloomPass = new UnrealBloomPass(new THREE.Vector2(camW, camH), 1.0, 0.68, 0.0);
    bloomPass.resolution.set(camW * 0.5, camH * 0.5);
    composer.addPass(bloomPass);

    grainPass = new ShaderPass(FilmGrainShader);
    composer.addPass(grainPass);

    createBars();
    updateGainMul();
    rect = renderer.domElement.getBoundingClientRect();
    initialized = true;
  }

  // --- Pointer tracking ---
  const pricingSection = container.parentElement;
  function onPointerMove(e) {
    const r = rect;
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.active = true;
    if (!proxyInit) { proxyMouseX = mouse.x; proxyMouseY = mouse.y; proxyInit = true; }
  }
  function onPointerLeave() { mouse.active = false; }
  pricingSection.addEventListener('pointermove', onPointerMove, { passive: true });
  pricingSection.addEventListener('pointerleave', onPointerLeave, { passive: true });

  // --- Resize ---
  let pendingW = 0, pendingH = 0, resizeTimer = null;
  function onResize(w, h) {
    if (!initialized) return;
    pendingW = w; pendingH = h;
    camW = w; camH = h;
    camera.left = -camW / 2; camera.right = camW / 2;
    camera.top = camH / 2; camera.bottom = -camH / 2;
    camera.updateProjectionMatrix();

    const span = camW + EXTEND_LEFT;
    const count = Math.min(MAX_BARS, Math.max(1, Math.floor((span + BAR_GAP) / (BAR_W + BAR_GAP))));
    if (count !== currentBarCount) {
      createBars();
    } else {
      const gap = count > 1 ? (span - count * BAR_W) / (count - 1) : 0;
      const startX = -camW / 2 - EXTEND_LEFT;
      const aX = instancedBars.geometry.getAttribute('aXPos');
      const aT = instancedBars.geometry.getAttribute('aPosNorm');
      for (let i = 0; i < count; i++) {
        const x = startX + BAR_W / 2 + i * (BAR_W + gap);
        const t = count > 1 ? i / (count - 1) : 0;
        aX.array[i] = aX.array[i + count] = x;
        aT.array[i] = aT.array[i + count] = t;
      }
      aX.needsUpdate = true;
      aT.needsUpdate = true;
    }
    barMaterial.uniforms.uHalfW.value = camW * 0.5;
    updateGainMul();
    updateGlowDist();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderer.setPixelRatio(EFFECT_PR);
      renderer.setSize(pendingW, pendingH);
      composer.setSize(pendingW, pendingH);
      bloomPass.setSize(pendingW, pendingH);
    }, 10);
    rect = renderer.domElement.getBoundingClientRect();
  }

  const ro = new ResizeObserver(entries => {
    for (const e of entries) {
      if (e.target === container) onResize(e.contentRect.width, e.contentRect.height);
    }
  });
  ro.observe(container);

  // --- Timeline ---
  function buildTweens(target, keyframes) {
    const tl = gsap.timeline();
    for (let i = 0; i < keyframes.length - 1; i++) {
      const c = keyframes[i], n = keyframes[i + 1];
      tl.to(target, { gain: n.gain, frequency: n.frequency, waveLength: n.waveLength, duration: n.time - c.time, ease: 'power2.inOut' }, c.time);
    }
    return tl;
  }

  // --- Visibility ---
  let isVisible = false;
  const io = new IntersectionObserver(entries => {
    isVisible = entries[0].isIntersecting;
  }, { threshold: 0.05 });
  io.observe(pricingSection);

  // --- Init & start ---
  init();
  const mainTL = gsap.timeline({ repeat: -1 });
  mainTL.add(buildTweens(wave1, kf1), 0);
  mainTL.add(buildTweens(wave2, kf2), 0);
  mainTL.play(0);

  // --- Tick ---
  function tick() {
    if (!initialized || !instancedBars || !isVisible) return;
    const dt = gsap.ticker.deltaRatio() * (1 / 60);

    wave1.currentAngle = (wave1.currentAngle + wave1.frequency * dt) % (Math.PI * 2);
    wave2.currentAngle = (wave2.currentAngle + wave2.frequency * dt) % (Math.PI * 2);
    setPhase1(wave1.currentAngle);
    setPhase2(wave2.currentAngle);

    const kM = 1 - Math.exp(-glowCfg.mouseSmoothing * dt);
    proxyMouseX += (mouse.x - proxyMouseX) * kM;
    proxyMouseY += (mouse.y - proxyMouseY) * kM;

    const dx = mouse.active ? mouse.x - proxyMouseX : 0;
    const dy = mouse.active ? mouse.y - proxyMouseY : 0;
    const raw = Math.hypot(dx, dy * 0.1) * glowCfg.speedScale;
    const kS = 1 - Math.exp(-glowDyn.speedEase * dt);
    smoothSpeed += (raw - smoothSpeed) * kS;
    setSmoothSpeed(smoothSpeed);

    const u = barMaterial.uniforms;
    u.w1Gain.value = wave1.gain;
    u.w1Len.value = wave1.waveLength;
    u.w2Gain.value = wave2.gain;
    u.w2Len.value = wave2.waveLength;
    setMouseNDC((proxyMouseX / camW) * 2 - 1);
    u.uBaseY.value = -camH * 0.5 + (window.innerWidth < 768 ? 20 : 40);
    grainPass.uniforms.time.value += dt * 0.2;

    accumulateGlow(dt);
    composer.render();
  }

  gsap.ticker.add(tick);
})();
