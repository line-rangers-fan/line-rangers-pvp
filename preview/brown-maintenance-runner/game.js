"use strict";

(() => {
  const canvas = document.querySelector("#game");
  const overlay = document.querySelector("#game-overlay");
  const overlayKicker = document.querySelector("#overlay-kicker");
  const overlayTitle = document.querySelector("#overlay-title");
  const overlayCopy = document.querySelector("#overlay-copy");
  const startButton = document.querySelector("#start-button");
  const jumpButton = document.querySelector("#jump-button");
  const scoreNode = document.querySelector("#score");
  const bestNode = document.querySelector("#best-score");
  const speedNode = document.querySelector("#speed");

  if (!(canvas instanceof HTMLCanvasElement) || !overlay || !startButton || !jumpButton) return;
  const ctx = canvas.getContext("2d", {alpha: false});
  if (!ctx) return;

  const WIDTH = 960;
  const HEIGHT = 320;
  const GROUND_Y = 252;
  const PLAYER_X = 132;
  const PLAYER_SIZE = 62;
  const STORAGE_KEY = "lr-brown-runner-best-v1";
  const MAX_DT = 34;

  const palette = Object.freeze({
    outline: "#321d15",
    brown: "#6f412b",
    brown2: "#8d5938",
    muzzle: "#c6966a",
    dark: "#211611",
    light: "#f3dcc1",
  });

  const brownFrames = Object.freeze([
    [
      "....oo....oo....",
      "...obbo..obbo....",
      "..obbbbooobbbbo...",
      "..obbbbbbbbbbbo...",
      ".obbbbbbbbbbbbbo..",
      ".obbbdbbbbdbbbbo..",
      ".obbbbbbbbbbbbbo..",
      ".obbbbmmmmmbbbbo..",
      ".obbbbmdmdmbbbbo..",
      ".obbbbmmmmmbbbbo..",
      "..obbbbbbbbbbbo...",
      "...obbbbbbbbbo....",
      "....obbbbbbo......",
      "....obbbobbo......",
      "...obbbo.obbbo....",
      "...ooo...ooo......",
    ],
    [
      "....oo....oo....",
      "...obbo..obbo....",
      "..obbbbooobbbbo...",
      "..obbbbbbbbbbbo...",
      ".obbbbbbbbbbbbbo..",
      ".obbbdbbbbdbbbbo..",
      ".obbbbbbbbbbbbbo..",
      ".obbbbmmmmmbbbbo..",
      ".obbbbmdmdmbbbbo..",
      ".obbbbmmmmmbbbbo..",
      "..obbbbbbbbbbbo...",
      "...obbbbbbbbbo....",
      "....obbbbbbo......",
      "...obbboobbb......",
      "...ooo..obbbo.....",
      "........ooo.......",
    ],
  ]);

  const pixelMap = Object.freeze({
    o: palette.outline,
    b: palette.brown,
    d: palette.dark,
    m: palette.muzzle,
  });

  let best = readBest();
  let mode = "ready";
  let score = 0;
  let speed = 6;
  let lastTime = 0;
  let animationTime = 0;
  let distance = 0;
  let spawnDistance = 320;
  let flash = 0;
  let raf = 0;
  let pausedByVisibility = false;

  const player = {
    y: GROUND_Y - PLAYER_SIZE,
    velocityY: 0,
    grounded: true,
  };
  const obstacles = [];
  const clouds = [
    {x: 160, y: 58, w: 72},
    {x: 510, y: 88, w: 92},
    {x: 820, y: 46, w: 60},
  ];
  const signals = [
    {x: 350, y: 130, text: "UPDATE"},
    {x: 760, y: 102, text: "99%"},
  ];

  function readBest() {
    try {
      const value = Number(localStorage.getItem(STORAGE_KEY) || 0);
      return Number.isSafeInteger(value) && value >= 0 && value < 10_000_000 ? value : 0;
    } catch {
      return 0;
    }
  }

  function writeBest(value) {
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch {}
  }

  function padScore(value) {
    return String(Math.max(0, Math.floor(value))).padStart(5, "0").slice(-7);
  }

  function updateHud() {
    scoreNode.textContent = padScore(score);
    bestNode.textContent = padScore(best);
    speedNode.textContent = `${(speed / 6).toFixed(1)}×`;
  }

  function reset() {
    score = 0;
    speed = 6;
    distance = 0;
    spawnDistance = 300;
    flash = 0;
    player.y = GROUND_Y - PLAYER_SIZE;
    player.velocityY = 0;
    player.grounded = true;
    obstacles.length = 0;
    mode = "running";
    lastTime = performance.now();
    overlay.hidden = true;
    updateHud();
  }

  function start() {
    reset();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function endGame() {
    if (mode !== "running") return;
    mode = "over";
    flash = 130;
    const finalScore = Math.floor(score);
    if (finalScore > best) {
      best = finalScore;
      writeBest(best);
    }
    updateHud();
    overlayKicker.textContent = "MAINTENANCE CONTINUES";
    overlayTitle.textContent = `SCORE ${padScore(finalScore)}`;
    overlayCopy.textContent = "もう一度ジャンプして記録を更新しよう";
    startButton.textContent = "リトライ";
    overlay.hidden = false;
  }

  function jump() {
    if (mode === "ready" || mode === "over") {
      start();
      return;
    }
    if (mode !== "running" || !player.grounded) return;
    player.velocityY = -14.6;
    player.grounded = false;
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function addObstacle() {
    const hard = score > 600 && Math.random() < 0.28;
    const kind = hard ? "server" : (Math.random() < 0.62 ? "cone" : "box");
    let w = 34;
    let h = 46;
    if (kind === "box") { w = 48; h = 42; }
    if (kind === "server") { w = 34; h = 70; }
    obstacles.push({
      x: WIDTH + 30,
      y: GROUND_Y - h,
      w,
      h,
      kind,
      phase: Math.random() * Math.PI * 2,
    });
  }

  function update(dt) {
    const unit = dt / 16.6667;
    animationTime += dt;
    speed = Math.min(13.2, 6 + score / 720);
    distance += speed * unit;
    score += speed * 0.047 * unit;

    player.velocityY += 0.86 * unit;
    player.y += player.velocityY * unit;
    const floor = GROUND_Y - PLAYER_SIZE;
    if (player.y >= floor) {
      player.y = floor;
      player.velocityY = 0;
      player.grounded = true;
    }

    spawnDistance -= speed * unit;
    if (spawnDistance <= 0) {
      addObstacle();
      const difficulty = Math.min(110, score * 0.045);
      spawnDistance = randomBetween(250 - difficulty, 390 - difficulty * 0.4);
    }

    for (const obstacle of obstacles) obstacle.x -= speed * unit;
    while (obstacles.length && obstacles[0].x + obstacles[0].w < -30) obstacles.shift();

    for (const cloud of clouds) {
      cloud.x -= speed * 0.08 * unit;
      if (cloud.x + cloud.w < -30) cloud.x = WIDTH + randomBetween(40, 240);
    }
    for (const signal of signals) {
      signal.x -= speed * 0.18 * unit;
      if (signal.x < -120) signal.x = WIDTH + randomBetween(180, 440);
    }

    if (collides()) endGame();
    if (flash > 0) flash = Math.max(0, flash - dt);
    updateHud();
  }

  function collides() {
    const px = PLAYER_X + 12;
    const py = player.y + 7;
    const pw = PLAYER_SIZE - 24;
    const ph = PLAYER_SIZE - 10;
    for (const o of obstacles) {
      const padX = o.kind === "cone" ? 5 : 3;
      const ox = o.x + padX;
      const oy = o.y + 4;
      const ow = o.w - padX * 2;
      const oh = o.h - 4;
      if (px < ox + ow && px + pw > ox && py < oy + oh && py + ph > oy) return true;
    }
    return false;
  }

  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function drawBackground() {
    rect(0, 0, WIDTH, HEIGHT, flash > 0 ? "#fff1e3" : "#e8eef7");
    for (let x = -((distance * 0.08) % 48); x < WIDTH; x += 48) {
      rect(x, 30, 1, 175, "rgba(66,91,121,.055)");
    }

    for (const cloud of clouds) drawCloud(cloud.x, cloud.y, cloud.w);
    for (const signal of signals) drawSignal(signal);

    rect(0, GROUND_Y, WIDTH, 3, "#43556b");
    rect(0, GROUND_Y + 3, WIDTH, HEIGHT - GROUND_Y, "#d2dbe7");
    const stripeOffset = -((distance * 0.72) % 42);
    for (let x = stripeOffset; x < WIDTH; x += 42) {
      rect(x, GROUND_Y + 18, 22, 3, "#a8b7c8");
    }
  }

  function drawCloud(x, y, w) {
    const unit = Math.max(4, Math.round(w / 14));
    const color = "rgba(112,139,171,.22)";
    rect(x + unit * 2, y + unit, unit * 7, unit * 2, color);
    rect(x + unit * 4, y, unit * 4, unit * 3, color);
    rect(x + unit * 8, y + unit * 1.3, unit * 4, unit * 1.7, color);
  }

  function drawSignal(signal) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#51739c";
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(signal.x), signal.y, 78, 28);
    ctx.fillStyle = "#3c5d83";
    ctx.font = "bold 12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(signal.text, Math.round(signal.x + 39), signal.y + 14);
    ctx.restore();
  }

  function drawBrown() {
    const frameIndex = player.grounded ? Math.floor(animationTime / 115) % brownFrames.length : 0;
    const frame = brownFrames[frameIndex];
    const pixel = 4;
    const spriteW = frame[0].length * pixel;
    const x = PLAYER_X + Math.round((PLAYER_SIZE - spriteW) / 2);
    const y = Math.round(player.y - 1);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let row = 0; row < frame.length; row += 1) {
      const line = frame[row];
      for (let col = 0; col < line.length; col += 1) {
        const color = pixelMap[line[col]];
        if (!color) continue;
        rect(x + col * pixel, y + row * pixel, pixel, pixel, color);
      }
    }
    ctx.restore();
  }

  function drawCone(o) {
    const unit = 5;
    const x = Math.round(o.x);
    const y = Math.round(o.y);
    rect(x + 14, y, 6, 6, "#ff8a2a");
    rect(x + 10, y + 6, 14, 8, "#ff8a2a");
    rect(x + 7, y + 14, 20, 8, "#f26d16");
    rect(x + 4, y + 22, 26, 8, "#ff8a2a");
    rect(x + 1, y + 30, 32, 7, "#f26d16");
    rect(x, y + 37, 34, 6, "#5e6670");
    rect(x + 8, y + 16, 18, unit, "#f6f0df");
    rect(x + 4, y + 28, 26, unit, "#f6f0df");
  }

  function drawBox(o) {
    const x = Math.round(o.x);
    const y = Math.round(o.y);
    rect(x, y, o.w, o.h, "#6683a5");
    rect(x + 4, y + 4, o.w - 8, o.h - 8, "#8da5c0");
    rect(x + 9, y + 10, o.w - 18, 7, "#d6e1ec");
    rect(x + 9, y + 23, o.w - 24, 6, "#4c6686");
    rect(x + o.w - 12, y + 23, 4, 6, "#6ee4a1");
  }

  function drawServer(o) {
    const x = Math.round(o.x);
    const y = Math.round(o.y);
    rect(x, y, o.w, o.h, "#394a5e");
    rect(x + 4, y + 5, o.w - 8, o.h - 10, "#65798f");
    for (let i = 0; i < 3; i += 1) {
      const yy = y + 11 + i * 17;
      rect(x + 8, yy, o.w - 16, 7, "#c2cfdd");
      rect(x + o.w - 12, yy + 2, 3, 3, i === 2 ? "#ff786d" : "#67e39a");
    }
  }

  function drawObstacles() {
    for (const o of obstacles) {
      if (o.kind === "cone") drawCone(o);
      else if (o.kind === "server") drawServer(o);
      else drawBox(o);
    }
  }

  function drawReadyHint() {
    if (mode !== "ready") return;
    ctx.save();
    ctx.fillStyle = "rgba(54,76,103,.55)";
    ctx.font = "bold 13px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText("TAP / SPACE TO JUMP", WIDTH - 24, 30);
    ctx.restore();
  }

  function draw() {
    drawBackground();
    drawObstacles();
    drawBrown();
    drawReadyHint();
  }

  function loop(now) {
    if (mode !== "running") {
      draw();
      return;
    }
    const dt = Math.min(MAX_DT, Math.max(0, now - lastTime));
    lastTime = now;
    update(dt);
    draw();
    if (mode === "running") raf = requestAnimationFrame(loop);
  }

  function activate(event) {
    if (event && "preventDefault" in event) event.preventDefault();
    jump();
  }

  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" && event.code !== "ArrowUp") return;
    activate(event);
  }, {passive: false});

  canvas.addEventListener("pointerdown", activate, {passive: false});
  jumpButton.addEventListener("click", activate);
  startButton.addEventListener("click", activate);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && mode === "running") {
      pausedByVisibility = true;
      cancelAnimationFrame(raf);
      return;
    }
    if (document.visibilityState === "visible" && mode === "running" && pausedByVisibility) {
      pausedByVisibility = false;
      lastTime = performance.now();
      raf = requestAnimationFrame(loop);
    }
  });

  bestNode.textContent = padScore(best);
  updateHud();
  draw();
})();