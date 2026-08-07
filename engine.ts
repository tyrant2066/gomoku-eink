// =========================================================
// 五子棋 WASM 棋圣引擎（AssemblyScript）
// 威胁空间搜索 TSS：VCF/VCT 连杀算杀 + Negamax/Alpha-Beta
// + Zobrist 置换表 + 杀手启发 + 迭代加深
// =========================================================

const EMPTY: i32 = 0;
const BLACK: i32 = 1;
const WHITE: i32 = 2;
const MAXN: i32 = 19;
const WIN_BASE: i32 = 1000000000;

const PT_FIVE: i32 = 8;
const PT_LIVE4: i32 = 7;
const PT_RUSH4: i32 = 6;
const PT_LIVE3: i32 = 5;
const PT_RUSH3: i32 = 4;

let N: i32 = 15;
let me: i32 = BLACK;
let opp: i32 = WHITE;

const board = new Int8Array(MAXN * MAXN);

const DIR8 = new Int32Array(8);
const DIR8b = new Int32Array(8);

// ---- 节点预算 ----
let budget: i32 = 100000;
let nodes: i32 = 0;

// ---- Zobrist（双 32-bit） ----
let zTab: Uint32Array = new Uint32Array(0);
let zh1: u32 = 0;
let zh2: u32 = 0;
let sRand: u32 = 0x9E3779B9;

function rnd(): u32 {
  sRand += 0x6D2B79F5;
  let t = sRand;
  t = (t ^ (t >>> 15)) * (t | 1);
  t = (t ^ (t >>> 7)) * (t | 61);
  return t ^ (t >>> 14);
}

function zobInit(): void {
  if (zTab.length > 0) return;
  DIR8[0] = 1; DIR8[1] = 0; DIR8[2] = 0; DIR8[3] = 1; DIR8[4] = 1; DIR8[5] = 1; DIR8[6] = 1; DIR8[7] = -1;
  DIR8b[0] = 0; DIR8b[1] = 1; DIR8b[2] = 1; DIR8b[3] = 0; DIR8b[4] = 1; DIR8b[5] = 1; DIR8b[6] = 1; DIR8b[7] = -1;
  zTab = new Uint32Array(2 * MAXN * MAXN * 2);
  for (let c = 1; c <= 2; c++) {
    const base = (c - 1) * (MAXN * MAXN * 2);
    for (let i = 0; i < MAXN * MAXN; i++) {
      zTab[base + i * 2] = rnd();
      zTab[base + i * 2 + 1] = rnd();
    }
  }
}

function placeHash(r: i32, c: i32, col: i32): void {
  const i = r * MAXN + c;
  const base = (col - 1) * (MAXN * MAXN * 2);
  zh1 ^= zTab[base + i * 2];
  zh2 ^= zTab[base + i * 2 + 1];
}

function hashNow(): u32 { return zh1 ^ (zh2 << 1); }

// ---- 置换表 ----
const TT_SIZE: i32 = 1 << 18;
const TT_MASK: i32 = TT_SIZE - 1;
let ttKey = new Uint32Array(TT_SIZE);
let ttDepth = new Int8Array(TT_SIZE);
let ttFlag = new Int8Array(TT_SIZE);
let ttVal = new Int32Array(TT_SIZE);
let ttMr = new Int16Array(TT_SIZE);
let ttMc = new Int16Array(TT_SIZE);

function ttClear(): void {
  ttKey.fill(0);
  ttDepth.fill(-1);
}

// ---- 杀手启发 ----
let killers = new Int16Array(32);

// ---- 棋型统计（全局暂存，避免分配） ----
let gFive: i32 = 0, gLive4: i32 = 0, gRush4: i32 = 0, gLive3: i32 = 0, gRush3: i32 = 0;
// 叶子评估聚合（全局）
let gS5: i32 = 0, gS4: i32 = 0, gS4r: i32 = 0, gS3: i32 = 0, gS3r: i32 = 0;
let gO5: i32 = 0, gO4: i32 = 0, gO4r: i32 = 0, gO3: i32 = 0, gO3r: i32 = 0;
// 线扫描暂存
let lr = new Int16Array(MAXN);
let lc = new Int16Array(MAXN);

function cell(r: i32, c: i32): i32 { return board[r * MAXN + c]; }
function idx(r: i32, c: i32): i32 { return r * MAXN + c; }

function addDistinct(n: i32, pa: i32, pb: i32, pos: i32): i32 {
  if (n >= 2) return 2;
  if (n === 0) return 1;
  if (pa === pos) return 1;
  if (pb < 0) return 2;
  if (pb === pos) return 1;
  return 2;
}

// 单方向威胁分类（5 窗口法）
function classifyDir(r: i32, c: i32, dr: i32, dc: i32, col: i32): i32 {
  let wins = 0;
  let n4 = 0, p4a: i32 = -1, p4b: i32 = -1;
  let n3 = 0, p3a: i32 = -1, p3b: i32 = -1;
  for (let s = -4; s <= 0; s++) {
    let cnt = 0;
    let eA: i32 = -1, eB: i32 = -1;
    let inb = true;
    for (let i = 0; i < 5; i++) {
      const rr = r + (s + i) * dr;
      const cc = c + (s + i) * dc;
      if (rr < 0 || rr >= N || cc < 0 || cc >= N) { inb = false; break; }
      const v = cell(rr, cc);
      if (v === col) cnt++;
      else if (v === EMPTY) {
        const pos = idx(rr, cc);
        if (eA < 0) eA = pos; else if (eB < 0) eB = pos;
      }
    }
    if (!inb) continue;
    if (cnt === 5) wins++;
    else if (cnt === 4 && eA >= 0 && eB < 0) n4 = addDistinct(n4, p4a, p4b, eA);
    else if (cnt === 3) {
      if (eA >= 0) n3 = addDistinct(n3, p3a, p3b, eA);
      if (eB >= 0) n3 = addDistinct(n3, p3a, p3b, eB);
    }
  }
  if (wins > 0) return PT_FIVE;
  if (n4 >= 2) return PT_LIVE4;
  if (n4 === 1) return PT_RUSH4;
  if (n3 >= 2) return PT_LIVE3;
  if (n3 === 1) return PT_RUSH3;
  return 0;
}

// 统计 (r,c) 落 col 后的整体威胁（写入全局 g*）
function classifyPoint(r: i32, c: i32, col: i32): void {
  gFive = 0; gLive4 = 0; gRush4 = 0; gLive3 = 0; gRush3 = 0;
  for (let k = 0; k < 8; k += 2) {
    const t = classifyDir(r, c, DIR8[k], DIR8[k + 1], col);
    if (t === PT_FIVE) gFive++;
    else if (t === PT_LIVE4) gLive4++;
    else if (t === PT_RUSH4) gRush4++;
    else if (t === PT_LIVE3) gLive3++;
    else if (t === PT_RUSH3) gRush3++;
  }
}

function isDoubleThreat(): boolean {
  return gFive > 0 || gLive4 > 0 || gRush4 >= 2 || (gRush4 >= 1 && gLive3 >= 1) || gLive3 >= 2;
}

function threatValue(): i32 {
  if (gFive > 0) return 100000000;
  if (gLive4 > 0) return 10000000;
  let base = gRush4 * 1000000 + gLive3 * 100000 + gRush3 * 10000;
  if (gRush4 >= 2 || (gRush4 >= 1 && gLive3 >= 1) || gLive3 >= 2) base += 5000000;
  return base;
}

function lineLen(r: i32, c: i32, dr: i32, dc: i32, col: i32): i32 {
  let len = 1;
  let rr = r + dr, cc = c + dc;
  while (rr >= 0 && rr < N && cc >= 0 && cc < N && cell(rr, cc) === col) { len++; rr += dr; cc += dc; }
  rr = r - dr; cc = c - dc;
  while (rr >= 0 && rr < N && cc >= 0 && cc < N && cell(rr, cc) === col) { len++; rr -= dr; cc -= dc; }
  return len;
}

function hasNeighbor(r: i32, c: i32, dist: i32): boolean {
  for (let dr = -dist; dr <= dist; dr++) {
    for (let dc = -dist; dc <= dist; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N && cell(rr, cc) !== EMPTY) return true;
    }
  }
  return false;
}

function countStones(): i32 {
  let s = 0;
  for (let i = 0; i < MAXN * MAXN; i++) if (board[i] !== EMPTY) s++;
  return s;
}

// 快速点评估（连续段）
function fastEval(r: i32, c: i32, col: i32): i32 {
  let s = 0;
  for (let k = 0; k < 8; k += 2) {
    const dr = DIR8[k], dc = DIR8[k + 1];
    board[idx(r, c)] = col;
    const len = lineLen(r, c, dr, dc, col);
    board[idx(r, c)] = EMPTY;
    let open = 0;
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < N && cc >= 0 && cc < N && cell(rr, cc) === col) { rr += dr; cc += dc; }
    if (rr >= 0 && rr < N && cc >= 0 && cc < N && cell(rr, cc) === EMPTY) open++;
    rr = r - dr; cc = c - dc;
    while (rr >= 0 && rr < N && cc >= 0 && cc < N && cell(rr, cc) === col) { rr -= dr; cc -= dc; }
    if (rr >= 0 && rr < N && cc >= 0 && cc < N && cell(rr, cc) === EMPTY) open++;
    if (len >= 5) s += 10000000;
    else if (len === 4) s += open >= 2 ? 1000000 : (open >= 1 ? 500000 : 10000);
    else if (len === 3) s += open >= 2 ? 100000 : (open >= 1 ? 20000 : 2000);
    else if (len === 2) s += open >= 2 ? 10000 : (open >= 1 ? 1000 : 100);
    else if (len === 1) s += open >= 2 ? 200 : (open >= 1 ? 50 : 10);
  }
  return s;
}

// 组合威胁点评估
function compositeEval(r: i32, c: i32, col: i32): i32 {
  board[idx(r, c)] = col;
  classifyPoint(r, c, col);
  const m = threatValue();
  board[idx(r, c)] = EMPTY;
  const op = col === BLACK ? WHITE : BLACK;
  board[idx(r, c)] = op;
  classifyPoint(r, c, op);
  const o = threatValue();
  board[idx(r, c)] = EMPTY;
  const mid = (N - 1) / 2;
  const drr = r - mid, dcc = c - mid;
  return m + ((o * 11) / 10) - ((drr < 0 ? -drr : drr) + (dcc < 0 ? -dcc : dcc));
}

// ---- 候选生成 ----
const CAND_SIZE: i32 = 361;
let candR = new Int16Array(CAND_SIZE);
let candC = new Int16Array(CAND_SIZE);
let candS = new Int32Array(CAND_SIZE);
let candCount: i32 = 0;

function genCandidates(col: i32, composite: boolean, cap: i32): void {
  candCount = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (cell(r, c) !== EMPTY) continue;
      if (!hasNeighbor(r, c, 2)) continue;
      const s = composite ? compositeEval(r, c, col) : fastEval(r, c, col);
      if (candCount < CAND_SIZE) {
        candR[candCount] = r; candC[candCount] = c; candS[candCount] = s;
        candCount++;
      }
    }
  }
  for (let i = 1; i < candCount; i++) {
    const r = candR[i], c = candC[i], s = candS[i];
    let j = i - 1;
    while (j >= 0 && candS[j] < s) {
      candR[j + 1] = candR[j]; candC[j + 1] = candC[j]; candS[j + 1] = candS[j];
      j--;
    }
    candR[j + 1] = r; candC[j + 1] = c; candS[j + 1] = s;
  }
  if (candCount > cap) candCount = cap;
}

// 候选快照（递归期间全局候选数组会被覆盖）
let bakR = new Int16Array(16);
let bakC = new Int16Array(16);
let bakS = new Int32Array(16);
let bakCount: i32 = 0;

function snapCand(): void {
  bakCount = candCount;
  for (let i = 0; i < candCount; i++) {
    bakR[i] = candR[i]; bakC[i] = candC[i]; bakS[i] = candS[i];
  }
}

// ---- 叶子评估（全盘 5 窗口聚合，视角：己方-对方） ----
function scanLine(r0: i32, c0: i32, dr: i32, dc: i32): void {
  let L = 0;
  let r = r0, c = c0;
  while (r >= 0 && r < N && c >= 0 && c < N) { lr[L] = r; lc[L] = c; L++; r += dr; c += dc; }
  if (L < 5) return;
  for (let col = 1; col <= 2; col++) {
    let wins = 0;
    let n4 = 0, p4a: i32 = -1, p4b: i32 = -1;
    let n3 = 0, p3a: i32 = -1, p3b: i32 = -1;
    for (let s = 0; s + 4 < L; s++) {
      let cnt = 0;
      let eA: i32 = -1, eB: i32 = -1;
      for (let i = s; i < s + 5; i++) {
        const v = cell(lr[i], lc[i]);
        if (v === col) cnt++;
        else if (v === EMPTY) {
          const pos = idx(lr[i], lc[i]);
          if (eA < 0) eA = pos; else if (eB < 0) eB = pos;
        }
      }
      if (cnt === 5) wins++;
      else if (cnt === 4 && eA >= 0 && eB < 0) n4 = addDistinct(n4, p4a, p4b, eA);
      else if (cnt === 3) {
        if (eA >= 0) n3 = addDistinct(n3, p3a, p3b, eA);
        if (eB >= 0) n3 = addDistinct(n3, p3a, p3b, eB);
      }
    }
    if (col === me) {
      if (wins > 0) gS5++;
      if (n4 >= 2) gS4++; else if (n4 === 1) gS4r++;
      gS3 += n3 / 2; gS3r += n3 % 2;
    } else {
      if (wins > 0) gO5++;
      if (n4 >= 2) gO4++; else if (n4 === 1) gO4r++;
      gO3 += n3 / 2; gO3r += n3 % 2;
    }
  }
}

function evalLeaf(): i32 {
  gS5 = 0; gS4 = 0; gS4r = 0; gS3 = 0; gS3r = 0;
  gO5 = 0; gO4 = 0; gO4r = 0; gO3 = 0; gO3r = 0;
  for (let d = 0; d < 8; d += 2) {
    const dr = DIR8b[d], dc = DIR8b[d + 1];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const pr = r - dr, pc = c - dc;
        if (pr >= 0 && pr < N && pc >= 0 && pc < N) continue;
        scanLine(r, c, dr, dc);
      }
    }
  }
  let sMe = gS5 * 100000000 + gS4 * 10000000 + gS4r * 1000000 + gS3 * 100000 + gS3r * 10000;
  let sOp = gO5 * 100000000 + gO4 * 10000000 + gO4r * 1000000 + gO3 * 100000 + gO3r * 10000;
  if (gS4 >= 1 || gS4r >= 2 || (gS4r >= 1 && gS3 >= 1) || gS3 >= 2) sMe += 5000000;
  if (gO4 >= 1 || gO4r >= 2 || (gO4r >= 1 && gO3 >= 1) || gO3 >= 2) sOp += 5000000;
  return sMe - sOp;
}

// ---- 搜索 ----
let gMoveR: i32 = -1;
let gMoveC: i32 = -1;

function checkWinAt(r: i32, c: i32, col: i32): boolean {
  for (let k = 0; k < 8; k += 2) {
    if (lineLen(r, c, DIR8[k], DIR8[k + 1], col) >= 5) return true;
  }
  return false;
}

function place(r: i32, c: i32, col: i32): void {
  board[idx(r, c)] = col;
  placeHash(r, c, col);
}
function unplace(r: i32, c: i32, col: i32): void {
  board[idx(r, c)] = EMPTY;
  placeHash(r, c, col);
}

function timeout(): boolean {
  nodes++;
  return nodes > budget;
}

// 完成点收集
let cpR = new Int16Array(16);
let cpC = new Int16Array(16);
let cpCount: i32 = 0;
let cqR = new Int16Array(16);
let cqC = new Int16Array(16);
let cqCount: i32 = 0;

function completionPoints(r: i32, c: i32, col: i32): void {
  cpCount = 0; cqCount = 0;
  for (let k = 0; k < 8; k += 2) {
    const dr = DIR8[k], dc = DIR8[k + 1];
    for (let s = -4; s <= 0; s++) {
      let cnt = 0;
      let eA: i32 = -1, eB: i32 = -1;
      let inb = true;
      for (let i = 0; i < 5; i++) {
        const rr = r + (s + i) * dr, cc = c + (s + i) * dc;
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) { inb = false; break; }
        const v = cell(rr, cc);
        if (v === col) cnt++;
        else if (v === EMPTY) {
          const pos = idx(rr, cc);
          if (eA < 0) eA = pos; else if (eB < 0) eB = pos;
        }
      }
      if (!inb) continue;
      if (cnt === 4 && eA >= 0 && eB < 0 && cpCount < 16) {
        cpR[cpCount] = eA / MAXN; cpC[cpCount] = eA % MAXN; cpCount++;
      } else if (cnt === 3) {
        if (eA >= 0 && cqCount < 16) { cqR[cqCount] = eA / MAXN; cqC[cqCount] = eA % MAXN; cqCount++; }
        if (eB >= 0 && cqCount < 16) { cqR[cqCount] = eB / MAXN; cqC[cqCount] = eB % MAXN; cqCount++; }
      }
    }
  }
}

// ---- VCT 单步必杀 / 连续追杀 ----
function vctWinOne(col: i32): boolean {
  genCandidates(col, false, 16);
  for (let i = 0; i < candCount; i++) {
    if (timeout()) return false;
    const r = candR[i], c = candC[i];
    place(r, c, col);
    if (checkWinAt(r, c, col)) { gMoveR = r; gMoveC = c; unplace(r, c, col); return true; }
    classifyPoint(r, c, col);
    const dbl = isDoubleThreat();
    let safe = true;
    if (dbl) {
      completionPoints(r, c, col);
      for (let j = 0; j < cpCount; j++) {
        place(cpR[j], cpC[j], opp);
        if (checkWinAt(cpR[j], cpC[j], opp)) safe = false;
        unplace(cpR[j], cpC[j], opp);
        if (!safe) break;
      }
      if (safe) {
        for (let j = 0; j < cqCount; j++) {
          place(cqR[j], cqC[j], opp);
          if (checkWinAt(cqR[j], cqC[j], opp)) safe = false;
          unplace(cqR[j], cqC[j], opp);
          if (!safe) break;
        }
      }
    }
    unplace(r, c, col);
    if (dbl && safe) { gMoveR = r; gMoveC = c; return true; }
  }
  return false;
}

// VCT 递归（连续冲四/活三追杀）
function vctSearch(col: i32, plyLeft: i32): boolean {
  if (plyLeft <= 0 || timeout()) return false;
  genCandidates(col, false, 12);
  snapCand();
  for (let i = 0; i < bakCount; i++) {
    if (timeout()) return false;
    const r = bakR[i], c = bakC[i];
    place(r, c, col);
    if (checkWinAt(r, c, col)) { gMoveR = r; gMoveC = c; unplace(r, c, col); return true; }
    classifyPoint(r, c, col);
    if (isDoubleThreat()) {
      let safe = true;
      completionPoints(r, c, col);
      for (let j = 0; j < cpCount; j++) {
        place(cpR[j], cpC[j], opp);
        if (checkWinAt(cpR[j], cpC[j], opp)) safe = false;
        unplace(cpR[j], cpC[j], opp);
        if (!safe) break;
      }
      if (safe) {
        for (let j = 0; j < cqCount; j++) {
          place(cqR[j], cqC[j], opp);
          if (checkWinAt(cqR[j], cqC[j], opp)) safe = false;
          unplace(cqR[j], cqC[j], opp);
          if (!safe) break;
        }
      }
      if (safe) { unplace(r, c, col); gMoveR = r; gMoveC = c; return true; }
    } else if (gRush4 === 1) {
      completionPoints(r, c, col);
      if (cpCount > 0) {
        const br = cpR[0], bc = cpC[0];
        place(br, bc, opp);
        const oppWin = checkWinAt(br, bc, opp);
        const res = !oppWin && vctSearch(col, plyLeft - 2);
        unplace(br, bc, opp);
        if (res) { unplace(r, c, col); gMoveR = r; gMoveC = c; return true; }
      }
    } else if (gLive3 >= 1) {
      completionPoints(r, c, col);
      let allWin = cqCount > 0;
      for (let j = 0; j < cqCount; j++) {
        const br = cqR[j], bc = cqC[j];
        place(br, bc, opp);
        if (checkWinAt(br, bc, opp)) { unplace(br, bc, opp); allWin = false; break; }
        const r2 = vctSearch(col, plyLeft - 2);
        unplace(br, bc, opp);
        if (!r2) { allWin = false; break; }
      }
      if (allWin) { unplace(r, c, col); gMoveR = r; gMoveC = c; return true; }
    }
    unplace(r, c, col);
  }
  return false;
}

// ---- Negamax + Alpha-Beta + TT + 杀手 ----
function search(depth: i32, alpha: i32, beta: i32, ply: i32): i32 {
  if (timeout()) return 0;
  const key = hashNow();
  const ti = <i32>(key & <u32>TT_MASK);
  if (ttKey[ti] === key && ttDepth[ti] >= depth) {
    if (ttFlag[ti] === 1) return ttVal[ti];
    if (ttFlag[ti] === 2 && ttVal[ti] <= alpha) return ttVal[ti];
    if (ttFlag[ti] === 3 && ttVal[ti] >= beta) return ttVal[ti];
  }
  if (depth <= 0) {
    const s = evalLeaf();
    return (ply % 2 === 0) ? s : -s;
  }
  const col = (ply % 2 === 0) ? me : opp;
  genCandidates(col, false, 12);
  // TT 着法 / 杀手提前
  let ttUse = false;
  if (ttKey[ti] === key && ttMr[ti] >= 0) {
    for (let i = 0; i < candCount; i++) {
      if (candR[i] === ttMr[ti] && candC[i] === ttMc[ti]) {
        const r = candR[0], c = candC[0], s = candS[0];
        candR[0] = candR[i]; candC[0] = candC[i]; candS[0] = candS[i];
        candR[i] = r; candC[i] = c; candS[i] = s;
        ttUse = true;
        break;
      }
    }
  }
  if (!ttUse) {
    const kr = killers[ply * 2], kc = killers[ply * 2 + 1];
    if (kr >= 0) {
      for (let i = 0; i < candCount; i++) {
        if (candR[i] === kr && candC[i] === kc) {
          const r = candR[0], c = candC[0], s = candS[0];
          candR[0] = candR[i]; candC[0] = candC[i]; candS[0] = candS[i];
          candR[i] = r; candC[i] = c; candS[i] = s;
          break;
        }
      }
    }
  }
  snapCand();
  let best = -2147483647;
  let bestR: i32 = -1, bestC: i32 = -1;
  let alpha0 = alpha;
  for (let i = 0; i < bakCount; i++) {
    if (timeout()) return 0;
    const r = bakR[i], c = bakC[i];
    place(r, c, col);
    let val: i32;
    if (checkWinAt(r, c, col)) {
      val = WIN_BASE - depth;
    } else {
      val = -search(depth - 1, -beta, -alpha0, ply + 1);
    }
    unplace(r, c, col);
    if (timeout()) return 0;
    if (val > best) { best = val; bestR = r; bestC = c; }
    if (val > alpha0) alpha0 = val;
    if (alpha0 >= beta) {
      if (ply < 8) { killers[ply * 2] = r; killers[ply * 2 + 1] = c; }
      break;
    }
  }
  if (best === -2147483647) return 0;
  if (bestR >= 0) {
    let flag: i32 = 1;
    if (best <= alpha) flag = 2;
    else if (best >= beta) flag = 3;
    ttKey[ti] = key; ttDepth[ti] = depth; ttFlag[ti] = flag; ttVal[ti] = best;
    ttMr[ti] = bestR; ttMc[ti] = bestC;
  }
  return best;
}

// ---- 迭代加深根搜索 ----
function searchRoot(maxDepth: i32): boolean {
  let bestR: i32 = -1, bestC: i32 = -1;
  for (let d = 1; d <= maxDepth; d++) {
    if (timeout()) break;
    genCandidates(me, true, 14);
    snapCand();
    let alpha = -2147483647;
    let beta = 2147483647;
    let bmR: i32 = -1, bmC: i32 = -1;
    let bv = -2147483647;
    for (let i = 0; i < bakCount; i++) {
      const r = bakR[i], c = bakC[i];
      place(r, c, me);
      let val: i32;
      if (checkWinAt(r, c, me)) val = WIN_BASE;
      else val = -search(d - 1, -beta, -alpha, 1);
      unplace(r, c, me);
      if (timeout()) break;
      if (val > bv) { bv = val; bmR = r; bmC = c; }
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }
    if (timeout()) break;
    if (bmR >= 0) { bestR = bmR; bestC = bmC; }
  }
  if (bestR >= 0) { gMoveR = bestR; gMoveC = bestC; return true; }
  return false;
}

// ---- 对手威胁防守 ----
function findOppBlock(): boolean {
  genCandidates(opp, false, 16);
  snapCand();
  let found = false;
  let bR: i32 = -1, bC: i32 = -1;
  let bestScore = -2147483647;
  for (let i = 0; i < bakCount; i++) {
    if (timeout()) return false;
    const r = bakR[i], c = bakC[i];
    place(r, c, opp);
    const win = checkWinAt(r, c, opp);
    classifyPoint(r, c, opp);
    const dbl = isDoubleThreat();
    unplace(r, c, opp);
    if (!win && !dbl) continue;
    place(r, c, me);
    let s = checkWinAt(r, c, me) ? WIN_BASE : evalLeaf();
    unplace(r, c, me);
    if (s > bestScore) { bestScore = s; bR = r; bC = c; found = true; }
    place(r, c, opp);
    completionPoints(r, c, opp);
    unplace(r, c, opp);
    for (let j = 0; j < cpCount; j++) {
      place(cpR[j], cpC[j], me);
      let s2 = checkWinAt(cpR[j], cpC[j], me) ? WIN_BASE : evalLeaf();
      unplace(cpR[j], cpC[j], me);
      if (s2 > bestScore) { bestScore = s2; bR = cpR[j]; bC = cpC[j]; found = true; }
    }
    for (let j = 0; j < cqCount; j++) {
      place(cqR[j], cqC[j], me);
      let s2 = checkWinAt(cqR[j], cqC[j], me) ? WIN_BASE : evalLeaf();
      unplace(cqR[j], cqC[j], me);
      if (s2 > bestScore) { bestScore = s2; bR = cqR[j]; bC = cqC[j]; found = true; }
    }
  }
  if (found) { gMoveR = bR; gMoveC = bC; return true; }
  return false;
}

// =========================================================
// 导出 API
// =========================================================

export function init(n: i32): void {
  zobInit();
  N = n;
  for (let i = 0; i < MAXN * MAXN; i++) board[i] = EMPTY;
  zh1 = 0; zh2 = 0;
  ttClear();
  killers.fill(-1);
}

export function clear(): void {
  for (let i = 0; i < MAXN * MAXN; i++) board[i] = EMPTY;
  zh1 = 0; zh2 = 0;
}

export function setCell(r: i32, c: i32, col: i32): void {
  board[idx(r, c)] = col;
  placeHash(r, c, col);
}

export function think(col: i32, nodeBudget: i32): i32 {
  me = col;
  opp = col === BLACK ? WHITE : BLACK;
  budget = nodeBudget;
  nodes = 0;
  gMoveR = -1; gMoveC = -1;
  ttClear();
  killers.fill(-1);
  const stones = countStones();
  if (stones === 0) { gMoveR = N / 2; gMoveC = N / 2; return 1; }
  if (stones === 1) {
    let fr: i32 = -1, fc: i32 = -1;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (cell(r, c) !== EMPTY) { fr = r; fc = c; break; }
    }
    if (fr >= 0) {
      let best = -1; let br: i32 = -1, bc: i32 = -1;
      const mid = (N - 1) / 2;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const rr = fr + dr, cc = fc + dc;
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
        if (cell(rr, cc) !== EMPTY) continue;
        const d = (rr - mid < 0 ? mid - rr : rr - mid) + (cc - mid < 0 ? mid - cc : cc - mid);
        if (best < 0 || d < best) { best = d; br = rr; bc = cc; }
      }
      gMoveR = br; gMoveC = bc; return 1;
    }
  }
  // 1) 单步必杀 / 组合杀
  if (vctWinOne(me)) return 1;
  // 2) VCT 连续追杀
  if (vctSearch(me, 10)) return 1;
  // 3) 防守对手威胁
  if (findOppBlock()) return 1;
  // 4) 迭代加深
  if (timeout()) return 0;
  const maxDepth = budget > 400000 ? 8 : (budget > 150000 ? 7 : (budget > 40000 ? 6 : (budget > 12000 ? 5 : 4)));
  if (searchRoot(maxDepth)) return 1;
  return 0;
}

export function moveR(): i32 { return gMoveR; }
export function moveC(): i32 { return gMoveC; }
