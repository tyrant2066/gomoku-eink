// =========================================================
// 五子棋 WASM 引擎 v3（Gomocup 系架构）
// 威胁空间搜索 TSS + 完整 VCF/VCT 连杀 + 对手反威胁验证
// + Zobrist 置换表 + 迭代加深 + 开局库
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
let vctCap: i32 = 0;

// ---- 分层候选（每层递归独立存储，互不覆盖） ----
const MAX_PLY: i32 = 26;
const CAND_MAX: i32 = 24;
const CAND_SIZE: i32 = 361;
const LAYER_VCT1: i32 = 18;
const LAYER_BLOCK: i32 = 25;
let candR = new Int16Array(MAX_PLY * CAND_MAX);
let candC = new Int16Array(MAX_PLY * CAND_MAX);
let candS = new Int32Array(MAX_PLY * CAND_MAX);
let candCnt = new Int16Array(MAX_PLY);
let tmpR = new Int16Array(CAND_SIZE);
let tmpC = new Int16Array(CAND_SIZE);
let tmpS = new Int32Array(CAND_SIZE);

// ---- Zobrist ----
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

// ---- 棋型统计 ----
let gFive: i32 = 0, gLive4: i32 = 0, gRush4: i32 = 0, gLive3: i32 = 0, gRush3: i32 = 0;
let gS5: i32 = 0, gS4: i32 = 0, gS4r: i32 = 0, gS3: i32 = 0, gS3r: i32 = 0;
let gO5: i32 = 0, gO4: i32 = 0, gO4r: i32 = 0, gO3: i32 = 0, gO3r: i32 = 0;
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

// ---- 分层候选生成 ----
function genCandidates(col: i32, composite: boolean, cap: i32, layer: i32): void {
  let cnt = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (cell(r, c) !== EMPTY) continue;
      if (!hasNeighbor(r, c, 2)) continue;
      const s = composite ? compositeEval(r, c, col) : fastEval(r, c, col);
      if (cnt < CAND_SIZE) {
        tmpR[cnt] = r; tmpC[cnt] = c; tmpS[cnt] = s;
        cnt++;
      }
    }
  }
  for (let i = 1; i < cnt; i++) {
    const r = tmpR[i], c = tmpC[i], s = tmpS[i];
    let j = i - 1;
    while (j >= 0 && tmpS[j] < s) {
      tmpR[j + 1] = tmpR[j]; tmpC[j + 1] = tmpC[j]; tmpS[j + 1] = tmpS[j];
      j--;
    }
    tmpR[j + 1] = r; tmpC[j + 1] = c; tmpS[j + 1] = s;
  }
  const lim = cnt < cap ? cnt : cap;
  const base = layer * CAND_MAX;
  for (let i = 0; i < lim; i++) {
    candR[base + i] = tmpR[i];
    candC[base + i] = tmpC[i];
    candS[base + i] = tmpS[i];
  }
  candCnt[layer] = lim;
}

// ---- 威胁着法生成：仅保留能形成威胁的落点（威胁空间核心） ----
// 等级：5=活三以上 6=冲四 7=双威胁/活四 8=成五；返回是否有活三及以上着法
function genThreatMoves(col: i32, cap: i32, layer: i32): i32 {
  let cnt = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (cell(r, c) !== EMPTY) continue;
      if (!hasNeighbor(r, c, 2)) continue;
      board[idx(r, c)] = col;
      classifyPoint(r, c, col);
      let lvl: i32 = 0;
      if (gFive >= 1) lvl = 8;
      else if (gLive4 >= 1) lvl = 7;
      else if (isDoubleThreat()) lvl = 7;
      else if (gRush4 >= 1) lvl = 6;
      else if (gLive3 >= 1) lvl = 5;
      else if (gRush3 >= 1) lvl = 4;
      const v = lvl > 0 ? (lvl * 10000000 + threatValue()) : 0;
      board[idx(r, c)] = EMPTY;
      if (lvl >= 5 && cnt < CAND_SIZE) {
        tmpR[cnt] = r; tmpC[cnt] = c; tmpS[cnt] = v;
        cnt++;
      }
    }
  }
  for (let i = 1; i < cnt; i++) {
    const r = tmpR[i], c = tmpC[i], s = tmpS[i];
    let j = i - 1;
    while (j >= 0 && tmpS[j] < s) {
      tmpR[j + 1] = tmpR[j]; tmpC[j + 1] = tmpC[j]; tmpS[j + 1] = tmpS[j];
      j--;
    }
    tmpR[j + 1] = r; tmpC[j + 1] = c; tmpS[j + 1] = s;
  }
  const lim = cnt < cap ? cnt : cap;
  const base = layer * CAND_MAX;
  for (let i = 0; i < lim; i++) {
    candR[base + i] = tmpR[i];
    candC[base + i] = tmpC[i];
    candS[base + i] = tmpS[i];
  }
  candCnt[layer] = lim;
  return cnt > 0 ? 1 : 0;
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

// ---- 搜索基础 ----
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
function timeoutVCT(): boolean {
  nodes++;
  return nodes > vctCap;
}

// 完成点收集
let cpR = new Int16Array(16);
let cpC = new Int16Array(16);
let cpCount: i32 = 0;
let cqR = new Int16Array(16);
let cqC = new Int16Array(16);
let cqCount: i32 = 0;
let cqLayR = new Int16Array(MAX_PLY * 16);
let cqLayC = new Int16Array(MAX_PLY * 16);

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

// ---- 我方速胜：直接成五 或 成活四（活四=必胜：对手仅一步堵，我方另一头成五） ----
function myFastWin(col: i32): boolean {
  genCandidates(col, false, 20, LAYER_VCT1);
  const base = LAYER_VCT1 * CAND_MAX;
  for (let i = 0; i < candCnt[LAYER_VCT1]; i++) {
    if (timeout()) return false;
    const r = candR[base + i], c = candC[base + i];
    place(r, c, col);
    const win = checkWinAt(r, c, col);
    let fast = win;
    if (!fast) {
      classifyPoint(r, c, col);
      fast = gLive4 >= 1;
    }
    unplace(r, c, col);
    if (fast) { gMoveR = r; gMoveC = c; return true; }
  }
  return false;
}

// 防守点评估：先最小化“堵截后对手最强下一手威胁”，再比较己方棋型
function defenseScore(br: i32, bc: i32): i32 {
  place(br, bc, me);
  if (checkWinAt(br, bc, me)) { unplace(br, bc, me); return WIN_BASE; }
  let worst = 0;
  const base2 = LAYER_BLOCK * CAND_MAX;
  for (let j = 0; j < candCnt[LAYER_BLOCK]; j++) {
    const rr = candR[base2 + j], cc = candC[base2 + j];
    if (cell(rr, cc) !== EMPTY) continue;
    place(rr, cc, opp);
    const win = checkWinAt(rr, cc, opp);
    classifyPoint(rr, cc, opp);
    let v = win ? 100000000 : threatValue();
    unplace(rr, cc, opp);
    if (v > worst) worst = v;
  }
  const myEval = evalLeaf();
  unplace(br, bc, me);
  return -worst * 10 + myEval / 1000;
}

// ---- 对手威胁强制防守（五连/组合杀/冲四/活三 全部覆盖） ----
function findOppBlock(): boolean {
  genCandidates(opp, false, 16, LAYER_BLOCK);
  const base = LAYER_BLOCK * CAND_MAX;
  let found = false;
  let bR: i32 = -1, bC: i32 = -1;
  let bestScore = -2147483647;
  for (let i = 0; i < candCnt[LAYER_BLOCK]; i++) {
    if (timeout()) return false;
    const r = candR[base + i], c = candC[base + i];
    place(r, c, opp);
    const win = checkWinAt(r, c, opp);
    classifyPoint(r, c, opp);
    const isThreat = win || gLive4 >= 1 || gRush4 >= 2 || (gRush4 >= 1 && gLive3 >= 1) ||
                     gLive3 >= 2 || gRush4 >= 1 || gLive3 >= 1;
    completionPoints(r, c, opp);
    unplace(r, c, opp);
    if (!isThreat) continue;
    const cpN = cpCount, cqN = cqCount;
    let s0 = defenseScore(r, c);
    if (s0 > bestScore) { bestScore = s0; bR = r; bC = c; found = true; }
    for (let j = 0; j < cpN; j++) {
      let s = defenseScore(cpR[j], cpC[j]);
      if (s > bestScore) { bestScore = s; bR = cpR[j]; bC = cpC[j]; found = true; }
    }
    for (let j = 0; j < cqN; j++) {
      let s = defenseScore(cqR[j], cqC[j]);
      if (s > bestScore) { bestScore = s; bR = cqR[j]; bC = cqC[j]; found = true; }
    }
  }
  if (found) { gMoveR = bR; gMoveC = bC; return true; }
  return false;
}

// ---- 对手抢先威胁检测：对手下一手能成五或成活四（= 对手已有活三/冲四/活四） ----
function oppHasFastThreat(): boolean {
  genCandidates(opp, false, 16, LAYER_BLOCK);
  const base = LAYER_BLOCK * CAND_MAX;
  for (let i = 0; i < candCnt[LAYER_BLOCK]; i++) {
    if (timeoutVCT()) return false;
    const r = candR[base + i], c = candC[base + i];
    place(r, c, opp);
    const win = checkWinAt(r, c, opp);
    classifyPoint(r, c, opp);
    const th = win || gLive4 >= 1 || gRush4 >= 2 || (gRush4 >= 1 && gLive3 >= 1) ||
               gLive3 >= 2 || gRush4 >= 1 || gLive3 >= 1;
    unplace(r, c, opp);
    if (th) return true;
  }
  return false;
}

// ---- 完整 VCF：连续冲四必杀（对手被迫应接），返回是否找到必杀落点 ----
function vcfSearch(col: i32, plyLeft: i32): boolean {
  if (plyLeft <= 0 || timeoutVCT()) return false;
  // 对手抢先威胁（活三/冲四/活四）存在时，冲四追杀前必须先防守 → 追杀无效
  if (oppHasFastThreat()) return false;
  const layer = 13 + (12 - plyLeft) / 2;
  genThreatMoves(col, 10, layer);
  const base = layer * CAND_MAX;
  for (let i = 0; i < candCnt[layer]; i++) {
    if (timeoutVCT()) return false;
    const r = candR[base + i], c = candC[base + i];
    place(r, c, col);
    if (checkWinAt(r, c, col)) { gMoveR = r; gMoveC = c; unplace(r, c, col); return true; }
    classifyPoint(r, c, col);
    if (gLive4 >= 1 || gRush4 >= 2 || (gRush4 >= 1 && gLive3 >= 1) || gLive3 >= 2) {
      // 双威胁/活四：对手无法一子全堵（验证完成点无对手反杀）
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
      // 单冲四：对手被迫堵唯一完成点，递归追杀
      completionPoints(r, c, col);
      if (cpCount > 0) {
        const br = cpR[0], bc = cpC[0];
        place(br, bc, opp);
        const oppWin = checkWinAt(br, bc, opp);
        const res = !oppWin && vcfSearch(col, plyLeft - 2);
        unplace(br, bc, opp);
        if (res) { unplace(r, c, col); gMoveR = r; gMoveC = c; return true; }
      }
    }
    unplace(r, c, col);
  }
  return false;
}

// ---- 完整 VCT：活三/冲四混合追杀（含对手反威胁验证） ----
function vctSearch(col: i32, plyLeft: i32): boolean {
  if (plyLeft <= 0 || timeoutVCT()) return false;
  if (oppHasFastThreat()) return false;
  const layer = 19 + (10 - plyLeft) / 2;
  genThreatMoves(col, 12, layer);
  const base = layer * CAND_MAX;
  for (let i = 0; i < candCnt[layer]; i++) {
    if (timeoutVCT()) return false;
    const r = candR[base + i], c = candC[base + i];
    place(r, c, col);
    if (checkWinAt(r, c, col)) { gMoveR = r; gMoveC = c; unplace(r, c, col); return true; }
    classifyPoint(r, c, col);
    if (gLive4 >= 1 || gRush4 >= 2 || (gRush4 >= 1 && gLive3 >= 1) || gLive3 >= 2) {
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
      // 活三：对手全部端点防守都挡不住才算追杀成功
      completionPoints(r, c, col);
      const nBlocks = cqCount;
      const cqBase = layer * 16;
      for (let j = 0; j < nBlocks; j++) {
        cqLayR[cqBase + j] = cqR[j];
        cqLayC[cqBase + j] = cqC[j];
      }
      let allWin = nBlocks > 0;
      for (let j = 0; j < nBlocks; j++) {
        const br = cqLayR[cqBase + j], bc = cqLayC[cqBase + j];
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

// ---- 威胁空间主搜索（Negamax + Alpha-Beta + TT + 杀手） ----
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
  const layer = 1 + ply;
  // 威胁空间：有威胁着法就用威胁着法（分支少、深度有效翻倍）
  const hasThreat = genThreatMoves(col, 10, layer);
  if (!hasThreat) genCandidates(col, false, 10, layer);
  const base = layer * CAND_MAX;
  let ttUse = false;
  if (ttKey[ti] === key && ttMr[ti] >= 0) {
    for (let i = 0; i < candCnt[layer]; i++) {
      if (candR[base + i] === ttMr[ti] && candC[base + i] === ttMc[ti]) {
        const r = candR[base], c = candC[base], s = candS[base];
        candR[base] = candR[base + i]; candC[base] = candC[base + i]; candS[base] = candS[base + i];
        candR[base + i] = r; candC[base + i] = c; candS[base + i] = s;
        ttUse = true;
        break;
      }
    }
  }
  if (!ttUse) {
    const kr = killers[ply * 2], kc = killers[ply * 2 + 1];
    if (kr >= 0) {
      for (let i = 0; i < candCnt[layer]; i++) {
        if (candR[base + i] === kr && candC[base + i] === kc) {
          const r = candR[base], c = candC[base], s = candS[base];
          candR[base] = candR[base + i]; candC[base] = candC[base + i]; candS[base] = candS[base + i];
          candR[base + i] = r; candC[base + i] = c; candS[base + i] = s;
          break;
        }
      }
    }
  }
  let best = -2147483647;
  let bestR: i32 = -1, bestC: i32 = -1;
  let alpha0 = alpha;
  for (let i = 0; i < candCnt[layer]; i++) {
    if (timeout()) return 0;
    const r = candR[base + i], c = candC[base + i];
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

// ---- 迭代加深根搜索（威胁空间） ----
function searchRoot(maxDepth: i32): boolean {
  let bestR: i32 = -1, bestC: i32 = -1;
  for (let d = 1; d <= maxDepth; d++) {
    if (timeout()) break;
    const hasThreat = genThreatMoves(me, 14, 0);
    if (!hasThreat) genCandidates(me, true, 14, 0);
    let alpha = -2147483647;
    let beta = 2147483647;
    let bmR: i32 = -1, bmC: i32 = -1;
    let bv = -2147483647;
    for (let i = 0; i < candCnt[0]; i++) {
      const r = candR[i], c = candC[i];
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

// ---- 开局库（相对天元坐标，8 对称匹配） ----
// 每条：黑1..黑n 序列（相对坐标，最多 6 手）+ 推荐下一手
const BOOK_MAX: i32 = 14;
const BOOK = new Int32Array(BOOK_MAX * 12);
const BOOK_N = new Int16Array(BOOK_MAX);
const BOOK_REPLY = new Int16Array(BOOK_MAX * 2);
let bookCount: i32 = 0;

function bookAdd(x0: i32, y0: i32, x1: i32, y1: i32, x2: i32, y2: i32, x3: i32, y3: i32, x4: i32, y4: i32, x5: i32, y5: i32, n: i32, rr: i32, rc: i32): void {
  const base = bookCount * 12;
  BOOK[base] = x0; BOOK[base + 1] = y0;
  if (n > 2) { BOOK[base + 2] = x1; BOOK[base + 3] = y1; }
  if (n > 3) { BOOK[base + 4] = x2; BOOK[base + 5] = y2; }
  if (n > 4) { BOOK[base + 6] = x3; BOOK[base + 7] = y3; }
  if (n > 5) { BOOK[base + 8] = x4; BOOK[base + 9] = y4; }
  if (n > 6) { BOOK[base + 10] = x5; BOOK[base + 11] = y5; }
  BOOK_N[bookCount] = n;
  BOOK_REPLY[bookCount * 2] = rr;
  BOOK_REPLY[bookCount * 2 + 1] = rc;
  bookCount++;
}

function bookInit(): void {
  if (bookCount > 0) return;
  // 直指开局：白2 横邻
  bookAdd(0,0, 1,0, 0,0, 0,0, 0,0, 0,0, 2, 1, 1);                   // 黑3 斜二
  bookAdd(0,0, 1,0, 1,1, 0,0, 0,0, 0,0, 3, 0, 1);                  // 白4 常见点
  bookAdd(0,0, 1,0, 1,1, 0,1, 0,0, 0,0, 4, 1,-1);                  // 黑5 花月变
  bookAdd(0,0, 1,0, 1,1, 0,1, 1,-1, 0,0, 5, 2,-1);                 // 白6
  bookAdd(0,0, 1,0, 1,1, 0,1, 2,1, 0,0, 5, 2,0);                   // 黑5 另一型
  // 斜指开局：白2 斜邻
  bookAdd(0,0, 1,1, 0,0, 0,0, 0,0, 0,0, 2, 1,-1);                 // 黑3 斜二
  bookAdd(0,0, 1,1, 1,-1, 0,0, 0,0, 0,0, 3, 0,-1);                // 白4
  bookAdd(0,0, 1,1, 1,-1, 0,-1, 0,0, 0,0, 4, 2,0);                // 黑5 流星变
  bookAdd(0,0, 1,1, 1,-1, 0,-1, 2,0, 0,0, 5, 3,1);                // 白6
  bookAdd(0,0, 1,1, 1,-1, 0,-1, 2,-2, 0,0, 5, 3,-1);              // 白6 另一型
  // 白2 远指（距2）
  bookAdd(0,0, 2,0, 0,0, 0,0, 0,0, 0,0, 2, 1,1);                  // 黑3 居中斜二
  bookAdd(0,0, 2,0, 1,1, 0,0, 0,0, 0,0, 3, 1,-1);                 // 白4
  bookAdd(0,0, 2,0, 1,1, 1,-1, 0,0, 0,0, 4, 0,1);                 // 黑5 寒星变
  bookAdd(0,0, 2,0, 1,1, 1,-1, 0,1, 0,0, 5, 2,1);                 // 白6
}

const ST = new Int16Array(12);

function openingMove(): i32 {
  bookInit();
  const stones = countStones();
  if (stones > 6 || stones < 2) return -1;
  const mid = (N - 1) / 2;
  let hasCenter = false;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (cell(r, c) === BLACK && (r - mid) * (r - mid) + (c - mid) * (c - mid) <= 2) hasCenter = true;
  }
  if (!hasCenter) return -1;
  let b1r: i32 = -1, b1c: i32 = -1;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (cell(r, c) === BLACK) { b1r = r; b1c = c; }
  if (b1r < 0) return -1;
  {
    let k = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (cell(r, c) !== EMPTY && k < 6) { ST[k * 2] = r - b1r; ST[k * 2 + 1] = c - b1c; k++; }
    }
  }
  for (let b = 0; b < bookCount; b++) {
    const bn = BOOK_N[b];
    if (bn !== stones) continue;
    for (let rot = 0; rot < 4; rot++) {
      for (let mir = 0; mir < 2; mir++) {
        let ok = true;
        for (let k = 0; k < stones; k++) {
          const bx = BOOK[b * 12 + k * 2], by = BOOK[b * 12 + k * 2 + 1];
          let sx = ST[k * 2], sy = ST[k * 2 + 1];
          if (mir) sy = -sy;
          if (rot === 1) { const t = sx; sx = sy; sy = t; }
          else if (rot === 2) { sx = -sx; sy = -sy; }
          else if (rot === 3) { const t = sx; sx = -sy; sy = -t; }
          if (sx !== bx || sy !== by) { ok = false; break; }
        }
        if (ok) {
          let rr = BOOK_REPLY[b * 2], cc = BOOK_REPLY[b * 2 + 1];
          if (mir) cc = -cc;
          if (rot === 1) { const t = rr; rr = cc; cc = t; }
          else if (rot === 2) { rr = -rr; cc = -cc; }
          else if (rot === 3) { const t = rr; rr = -cc; cc = -t; }
          const pr = b1r + rr, pc = b1c + cc;
          if (pr >= 0 && pr < N && pc >= 0 && pc < N && cell(pr, pc) === EMPTY) {
            gMoveR = pr; gMoveC = pc; return 1;
          }
        }
      }
    }
  }
  return -1;
}

// =========================================================
// 导出 API
// =========================================================

export function init(n: i32): void {
  zobInit();
  bookInit();
  N = n;
  for (let i = 0; i < MAXN * MAXN; i++) board[i] = EMPTY;
  zh1 = 0; zh2 = 0;
  // TT/杀手由 think() 每次开局前清空即可，init 不再重复清（每步同步更轻）
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
  // 开局库（前 6 手）
  if (openingMove() > 0) return 1;
  // 优先级（Gomocup 系棋理）：
  // 1) 我方直接成五
  // 2) 对手威胁强制防守（成五/活四/双威胁/冲四/活三）
  // 3) VCF 连续冲四必杀（对手无抢先威胁时）
  // 4) VCT 活三/冲四混合追杀（对手无抢先威胁时）
  // 5) 威胁空间迭代加深主搜索
  if (myFastWin(me)) return 1;
  if (findOppBlock()) return 1;
  vctCap = budget / 4 + 5000;
  if (vcfSearch(me, 12)) return 1;
  if (vctSearch(me, 12)) return 1;
  if (timeout()) return 0;
  const maxDepth = budget > 400000 ? 8 : (budget > 150000 ? 7 : (budget > 40000 ? 6 : (budget > 12000 ? 5 : 4)));
  if (searchRoot(maxDepth)) return 1;
  return 0;
}

export function moveR(): i32 { return gMoveR; }
export function moveC(): i32 { return gMoveC; }
