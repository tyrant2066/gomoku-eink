/* =========================================================
   高智商人机五子棋 - 游戏逻辑 + AI 引擎
   零依赖纯前端实现
   ========================================================= */
(function () {
  "use strict";

  /* ---------------- 常量 ---------------- */
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const DIRS = [[1,0],[0,1],[1,1],[1,-1]];

  // 棋盘规格
  const SIZES = {
    small: { n: 11, label: "小 · 11×11" },
    medium: { n: 15, label: "中 · 15×15" },
    large: { n: 19, label: "大 · 19×19" }
  };

  // 难度配置（迭代加深深度 / 候选上限 / VCT 连杀追杀深度）
  const dificultades = {
    1: { depth: 2,  cap: 8,  vct: false, vctPly: 0,  label: "新手入门" },
    2: { depth: 3,  cap: 10, vct: true,  vctPly: 4,  label: "进阶" },
    3: { depth: 4,  cap: 12, vct: true,  vctPly: 6,  label: "高手" },
    4: { depth: 5,  cap: 14, vct: true,  vctPly: 8,  label: "大师" },
    5: { depth: 6,  cap: 16, vct: true,  vctPly: 10, label: "棋圣 · 必杀" }
  };

  /* ---------------- DOM ---------------- */
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const statusText = document.getElementById("status-text");
  const statusBar = document.getElementById("status-bar");
  const wrap = document.getElementById("board-wrap");
  const pBlack = document.getElementById("player-black");
  const pWhite = document.getElementById("player-white");
  const scoreBlack = document.getElementById("score-black");
  const scoreWhite = document.getElementById("score-white");

  /* ---------------- 状态 ---------------- */
  let state = {
    n: SIZES.medium.n,
    size: "medium",
    board: null,
    moves: [],          // 落子历史 [row,col]
    current: BLACK,     // 当前轮到谁走
    human: BLACK,       // 人类执子
    over: false,
    winner: 0,
    winning: null,      // 终局五连高亮：成五的 5 颗棋子数组 [[r,c],...]
    renju: false,       // 禁手开关
    difficulty: 3,
    score: { black: 0, white: 0 }
  };

  /* ---------------- 初始化棋盘 ---------------- */
  function newBoard(n) {
    const b = new Array(n);
    for (let i = 0; i < n; i++) { b[i] = new Array(n).fill(EMPTY); }
    return b;
  }

  /* ---------------- Canvas 绘制 ---------------- */
  function draw() {
    const n = state.n;
    const size = Math.floor(Math.min(wrap.clientWidth - 8, wrap.clientHeight - 70));
    canvas.width = size;
    canvas.height = size;
    const grid = size / (n - 1);
    const margin = grid / 2;

    // 背景
    ctx.fillStyle = "#f2ecd8";
    ctx.fillRect(0, 0, size, size);

    // 网格线
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(margin, margin + i * grid);
      ctx.lineTo(size - margin, margin + i * grid);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(margin + i * grid, margin);
      ctx.lineTo(margin + i * grid, size - margin);
      ctx.stroke();
    }

    // 星位
    const starN = n >= 15 ? 5 : (n >= 11 ? 4 : 0);
    const stars = [];
    if (starN === 5) {
      const s = [n / 2 - 0.5];
      s.push(3, n - 1 - 3);
      s.forEach(r => s.forEach(c => stars.push([r, c])));
    } else if (starN === 4) {
      stars.push([3,3],[3,n-1-3],[n-1-3,3],[n-1-3,n-1-3]);
    }
    stars.forEach(([r, c]) => {
      ctx.beginPath();
      ctx.arc(margin + c * grid, margin + r * grid, Math.max(3, grid * 0.08), 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
    });

    // 棋子
    const last = state.moves.length ? state.moves[state.moves.length - 1] : null;
    const rStone = Math.min(22, grid * 0.42);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = state.board[r][c];
        if (v === EMPTY) continue;
        const x = margin + c * grid;
        const y = margin + r * grid;
        drawStone(x, y, rStone, v);
      }
    }

    // 最后一手标记：仅中心一枚极简对比圆点（黑棋白点 / 白棋黑点），不画外框
    if (last) {
      const x = margin + last[1] * grid;
      const y = margin + last[0] * grid;
      const v = state.board[last[0]][last[1]];
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3.5, rStone * 0.16), 0, Math.PI * 2);
      ctx.fillStyle = v === BLACK ? "#ffffff" : "#000000";
      ctx.fill();
    }

    // 胜局高亮：仅沿成五的 5 颗棋子中心绘制一条加粗贯穿线，不加任何外框
    if (state.over && state.winning && state.winning.length) {
      const cells = state.winning;
      const x0 = margin + cells[0][1] * grid;
      const y0 = margin + cells[0][0] * grid;
      const x1 = margin + cells[cells.length - 1][1] * grid;
      const y1 = margin + cells[cells.length - 1][0] * grid;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(4, rStone * 0.35);
      ctx.stroke();
    }
  }

  // 立体棋子
  function drawStone(x, y, r, color) {
    if (color === BLACK) {
      // 黑棋：深色球体 + 高光
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, "#6a6a6a");
      g.addColorStop(0.35, "#2a2a2a");
      g.addColorStop(1, "#000");
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.stroke();
      // 高光
      ctx.beginPath();
      ctx.arc(x - r * 0.32, y - r * 0.36, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
    } else {
      // 白棋：立体阴影 + 边框
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.7, "#e6e6e6");
      g.addColorStop(1, "#b0b0b0");
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.stroke();
      // 底部内阴影
      ctx.beginPath();
      ctx.arc(x, y + r * 0.25, r * 0.5, 0, Math.PI);
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fill();
    }
  }

  /* ---------------- 规则 / 胜负 ---------------- */

  // 计算单个方向连续长度
  function lineLen(board, n, r, c, dr, dc, color) {
    let len = 1;
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === color) { len++; rr += dr; cc += dc; }
    rr = r - dr; cc = c - dc;
    while (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === color) { len++; rr -= dr; cc -= dc; }
    return len;
  }

  // 在 (r,c) 落 color 子是否会直接赢
  function winsAt(board, n, r, c, color) {
    for (let k = 0; k < 4; k++) {
      if (lineLen(board, n, r, c, DIRS[k][0], DIRS[k][1], color) >= 5) return true;
    }
    return false;
  }

    // 判断黑方在 (r,c) 是否构成三三 / 四四 / 长连禁手
  function isForbidden(board, n, r, c) {
    if (board[r][c] !== EMPTY) return false;
    // 模拟落子
    board[r][c] = BLACK;
    let tri = 0, quad = 0, overline = false;
    let maxLen = 0;

    for (let k = 0; k < 4; k++) {
      const dr = DIRS[k][0], dc = DIRS[k][1];
      // 长连
      const len = lineLen(board, n, r, c, dr, dc, BLACK);
      if (len > maxLen) maxLen = len;
      if (len > 5) overline = true;
      // 计数活三 / 活四等
      const seg = segmentInfo(board, n, r, c, dr, dc);
      if (seg === "three") tri++;
      if (seg === "four") quad++;
    }

    board[r][c] = EMPTY;

    // 禁手：落子立刻长连（>5）
    if (maxLen > 5) return "长连禁手";
    if (quad >= 2) return "四四禁手";
    if (tri >= 2) return "三三禁手";
    return false;
  }

  // 识别某方向段（活/冲）：返回 "three"/"four"/null
  function segmentInfo(board, n, r, c, dr, dc) {
    const color = BLACK;
    // 沿正负方向延伸一段，检查两端是否可延伸
    const fwd = [];  // 从 (r,c) 向 + 方向连续同色
    let rr = r + dr, cc = c + dc;
    let count = 1;
    while (count < 5 && rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === color) { count++; rr += dr; cc += dc; }
    const openF = (rr >= 0 && rr < n && cc >= 0 && cc < n) ? (board[rr][cc] === EMPTY ? 1 : 0) : 0;
    let rl = r - dr, cl = c - dc;
    let lcount = 1;
    while (lcount < 5 && rl >= 0 && rl < n && cl >= 0 && cl < n && board[rl][cl] === color) { lcount++; rl -= dr; cl -= dc; }
    const openL = (rl >= 0 && rl < n && cl >= 0 && cl < n) ? (board[rl][cl] === EMPTY ? 1 : 0) : 0;

    const total = count + lcount - 1;

    // 活四：4 连两端开放
    if (total === 4 && openF === 1 && openL === 1) return "four";
    // 冲四：4 连一端开放 或 有断点可冲（简化：total>=4 且一边开放）
    if (total >= 4 && (openF === 1 || openL === 1)) return "four";
    // 活三：3 连或总长>=3 的延伸
    if (total === 3 && openF === 1 && openL === 1) return "three";
    // 跳三（_xx_x 形态近似判断）简化
    return null;
  }

  // 检查整盘胜负
  function checkWin(board, n, r, c) {
    const color = board[r][c];
    if (color === EMPTY) return 0;
    for (let k = 0; k < 4; k++) {
      if (lineLen(board, n, r, c, DIRS[k][0], DIRS[k][1], color) >= 5) return color;
    }
    return 0;
  }

  // 检测以 (r,c) 为落点、包含它的精确 5 颗连珠（用于胜局高亮）。
  // 返回 5 颗棋子的坐标数组 [[r,c],...]；若连长 >5（长连）则取包含 (r,c) 的连续 5 颗。
  function findWinningLine(board, n, r, c) {
    const color = board[r][c];
    if (color === EMPTY) return null;
    for (let k = 0; k < 4; k++) {
      const dr = DIRS[k][0], dc = DIRS[k][1];
      const len = lineLen(board, n, r, c, dr, dc, color);
      if (len < 5) continue;
      // 找连续段起点（沿负方向）
      let sr = r, sc = c;
      while (sr - dr >= 0 && sr - dr < n && sc - dc >= 0 && sc - dc < n &&
             board[sr - dr][sc - dc] === color) {
        sr -= dr; sc -= dc;
      }
      // 连续段为 [sr,sc] 起的 len 颗，取包含 (r,c) 的 5 颗（长连时尽量以 (r,c) 居中）
      let idx = (dr !== 0) ? (r - sr) / Math.abs(dr) : (c - sc) / Math.abs(dc);
      let start = Math.max(0, idx - 2);
      if (start > len - 5) start = len - 5;
      const cells = [];
      let rr = sr + start * dr, cc = sc + start * dc;
      for (let i = 0; i < 5; i++) {
        cells.push([rr, cc]);
        rr += dr; cc += dc;
      }
      return cells;
    }
    return null;
  }

  function isDraw(board, n) {
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (board[r][c] === EMPTY) return false;
    return true;
  }

  /* ---------------- AI 引擎（重构版：组合杀招 + Zobrist置换表 + 迭代加深 + VCT算杀） ---------------- */

  // ---- 棋型常量 ----
  const PT = { FIVE: 8, LIVE4: 7, RUSH4: 6, LIVE3: 5, RUSH3: 4, LIVE2: 3, RUSH2: 2, NONE: 0 };
  const WIN_BASE = 1000000000;           // 五连必胜分（大于任何评估值）

  // ---- 确定性 PRNG（生成 Zobrist 表） ----
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- 威胁分类（5 格窗口法）：评估在 (r,c) 落 color 后某方向的棋型 ----
  function classifyDirection(board, n, r, c, dr, dc, color) {
    let wins = 0;
    const fourPts = new Set();
    const threePts = new Set();
    for (let s = -4; s <= 0; s++) {
      let cnt = 0;
      const empties = [];
      let inb = true;
      for (let i = 0; i < 5; i++) {
        const rr = r + (s + i) * dr, cc = c + (s + i) * dc;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) { inb = false; break; }
        const v = board[rr][cc];
        if (v === color) cnt++;
        else if (v === EMPTY) empties.push(rr + "|" + cc);
      }
      if (!inb) continue;
      if (cnt === 5) wins++;
      else if (cnt === 4 && empties.length === 1) fourPts.add(empties[0]);
      else if (cnt === 3) empties.forEach(function (e) { threePts.add(e); });
    }
    if (wins > 0) return PT.FIVE;
    if (fourPts.size >= 2) return PT.LIVE4;
    if (fourPts.size === 1) return PT.RUSH4;
    if (threePts.size >= 2) return PT.LIVE3;
    if (threePts.size === 1) return PT.RUSH3;
    return PT.NONE;
  }

  // ---- 统计 (r,c) 落 color 后的整体威胁（四方向合计） ----
  function classifyPointAt(board, n, r, c, color) {
    const res = { five: 0, live4: 0, rush4: 0, live3: 0, rush3: 0 };
    for (let k = 0; k < 4; k++) {
      const t = classifyDirection(board, n, r, c, DIRS[k][0], DIRS[k][1], color);
      if (t === PT.FIVE) res.five++;
      else if (t === PT.LIVE4) res.live4++;
      else if (t === PT.RUSH4) res.rush4++;
      else if (t === PT.LIVE3) res.live3++;
      else if (t === PT.RUSH3) res.rush3++;
    }
    return res;
  }

  // ---- 组合威胁判定：双三 / 三四 / 双四 / 活四 / 五连 ----
  function isDoubleThreat(t) {
    return t.five > 0 || t.live4 > 0 || t.rush4 >= 2 || (t.rush4 >= 1 && t.live3 >= 1) || t.live3 >= 2;
  }

  // ---- 威胁价值（组合杀招赋予接近必胜的极高权重 ~5,000,000） ----
  function threatValue(t) {
    if (t.five > 0) return 100000000;
    if (t.live4 > 0) return 10000000;
    let base = t.rush4 * 1000000 + t.live3 * 100000 + t.rush3 * 10000;
    if (t.rush4 >= 2 || (t.rush4 >= 1 && t.live3 >= 1) || t.live3 >= 2) base += 5000000;
    return base;
  }

  const AI = {
    board: null, n: 0, me: 0, opp: 0, renju: false,

    // 时间预算
    deadline: 0, nodes: 0,

    // Zobrist 置换表
    zTable: null, zHi: 0, zLo: 0, tt: null,

    // 杀手启发
    killers: [],

    // ---- 主入口：返回 [row, col] ----
    bestMove(b, n, me, renju, opponent_last) {
      this.board = b; this.n = n; this.me = me; this.opp = me === BLACK ? WHITE : BLACK; this.renju = renju;
      const cfg = dificultades[state.difficulty] || dificultades[3];

      const stones = this.countStones();
      if (stones === 0) return [Math.floor(n / 2), Math.floor(n / 2)];
      if (stones === 1) {
        const first = this.findFirstStone();
        if (first) return this.near(first.row, first.col);
      }

      // 前段预算（直接成五 / 防守探测 / 算杀）：用完立即释放，保证主搜索有充足时间
      this.resetSearch(80);
      this.zobInit();   // place()/unplace() 需要 Zobrist 表（幂等，仅初始化一次）

      // 1) 我方直接成五（最高优先级）
      const winNow = this.myDirectWin(me);
      if (winNow) return winNow;

      // 2) 对手威胁强制防守（成五/活四/双威胁/冲四/活三）：
      //    对手活三=两步杀且先手，我方双三=三步杀来不及；防守必须优先于非直接成五的进攻
      if (this.isTimeout()) return this.findEmptyFallback();
      const oppT = this.findOppThreat(this.opp);
      if (oppT) {
        const blk = this.findBlockAgainst(oppT);
        if (blk) return blk;
      }

      // 3) 我方单步组合杀（双三/三四/双四/活四）——此时已确认对手无即时威胁
      const one = this.vctWinOne(me);
      if (one) return one;

      // 4) VCT 连续追杀（难度 >=2 开启）：递归“连续冲四/活三”强制五连
      if (cfg.vct) {
        const kill = this.vct(me, cfg.vctPly);
        if (kill) return kill;
      }

      // 5) 迭代加深 + Alpha-Beta + 置换表搜索（全新完整预算）
      this.resetSearch(260);
      const mv = this.searchRoot(cfg);
      if (mv) return mv;
      return this.findEmptyFallback();
    },

    // ---- 我方直接成五 ----
    myDirectWin(color) {
      const cand = this.genCandidates(color, { depth: 6, cap: 20 }, false);
      for (let i = 0; i < cand.length; i++) {
        if (this.isTimeout()) return null;
        const r = cand[i][0], c = cand[i][1];
        if (state.renju && color === BLACK && isForbidden(this.board, this.n, r, c)) continue;
        this.place(r, c, color);
        const win = checkWin(this.board, this.n, r, c) === color;
        this.unplace(r, c, color);
        if (win) return [r, c];
      }
      return null;
    },

    // ---- 时间控制（每次调用都核对时钟，Date.now() 开销可忽略） ----
    resetSearch(ms) { this.deadline = Date.now() + (ms || 320); this.nodes = 0; },
    isTimeout() { ++this.nodes; return Date.now() > this.deadline; },

    // ---- Zobrist 初始化（52-bit：双 26-bit 半段） ----
    zobInit() {
      if (this.zTable) return;
      const rnd = mulberry32(20260806);
      const tbl = [[], [], []];
      for (let c = 1; c <= 2; c++) {
        const arr = new Array(361);
        for (let i = 0; i < 361; i++) arr[i] = [(rnd() * 0x4000000) | 0, (rnd() * 0x4000000) | 0];
        tbl[c] = arr;
      }
      this.zTable = tbl;
    },
    zobKeyAt(color, r, c) { return this.zTable[color][r * this.n + c]; },
    place(r, c, color) {
      this.board[r][c] = color;
      const k = this.zobKeyAt(color, r, c);
      this.zHi ^= k[0]; this.zLo ^= k[1];
    },
    unplace(r, c, color) {
      this.board[r][c] = EMPTY;
      const k = this.zobKeyAt(color, r, c);
      this.zHi ^= k[0]; this.zLo ^= k[1];
    },
    hashNow() { return (this.zHi << 26) | this.zLo; },

    // ---- 置换表 ----
    ttClear() { this.tt = new Map(); this.ttMax = 262144; },
    ttPut(depth, flag, val, move) {
      const k = this.hashNow();
      if (this.tt.size >= this.ttMax) this.tt.clear();
      this.tt.set(k, { d: depth, f: flag, v: val, m: move });
    },

    // ---- 杀手启发 ----
    killReset() { this.killers = []; },
    addKiller(ply, r, c) {
      if (!this.killers[ply]) this.killers[ply] = [];
      const k = this.killers[ply];
      if (k.length && k[0][0] === r && k[0][1] === c) return;
      k.unshift([r, c]);
      if (k.length > 2) k.pop();
    },

    findEmptyFallback() {
      const n = this.n;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
        if (this.board[r][c] === EMPTY && this.hasNeighbor(r, c, 1)) return [r, c];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
        if (this.board[r][c] === EMPTY) return [r, c];
      return [Math.floor(n / 2), Math.floor(n / 2)];
    },

    countStones() {
      let s = 0;
      for (let r = 0; r < this.n; r++) for (let c = 0; c < this.n; c++) if (this.board[r][c] !== EMPTY) s++;
      return s;
    },

    findFirstStone() {
      for (let r = 0; r < this.n; r++) for (let c = 0; c < this.n; c++)
        if (this.board[r][c] !== EMPTY) return { row: r, col: c };
      return null;
    },
    near(r, c) {
      const n = this.n;
      const s = Math.floor(n / 2);
      const cand = [];
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && this.board[rr][cc] === EMPTY) cand.push([rr, cc]);
      }
      if (!cand.length) return [s, s];
      cand.sort(function (a, b) {
        return (Math.abs(a[0] - s) + Math.abs(a[1] - s)) - (Math.abs(b[0] - s) + Math.abs(b[1] - s));
      });
      return cand[0];
    },

    hasNeighbor(r, c, dist) {
      const n = this.n;
      for (let dr = -dist; dr <= dist; dr++)
        for (let dc = -dist; dc <= dist; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n && this.board[rr][cc] !== EMPTY) return true;
        }
      return false;
    },

    // ---- 候选生成（radius=2 邻域；useComposite=true 时用组合威胁精排） ----
    genCandidates(color, cfg, useComposite) {
      const n = this.n;
      const arr = [];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (this.board[r][c] !== EMPTY) continue;
        if (!this.hasNeighbor(r, c, 2)) continue;
        const s = useComposite ? this.evalPoint(r, c, color) : this.fastEvalPoint(r, c, color);
        arr.push([r, c, s]);
      }
      arr.sort(function (a, b) { return b[2] - a[2]; });
      const cap = cfg.cap || 12;
      return arr.slice(0, cap).map(function (x) { return [x[0], x[1]]; });
    },

    // ---- 组合威胁感知的点评估（用于根节点与 VCT 排序） ----
    evalPoint(r, c, color) {
      const b = this.board, n = this.n;
      const opp = color === BLACK ? WHITE : BLACK;
      b[r][c] = color;
      const tMe = classifyPointAt(b, n, r, c, color);
      b[r][c] = EMPTY;
      b[r][c] = opp;
      const tOpp = classifyPointAt(b, n, r, c, opp);
      b[r][c] = EMPTY;
      let s = threatValue(tMe) + threatValue(tOpp) * 1.1;
      const mid = (n - 1) / 2;
      s -= (Math.abs(r - mid) + Math.abs(c - mid)) * 0.5;
      return s;
    },

    // ---- 快速点评估（内部节点排序用，连续段计分） ----
    fastEvalPoint(r, c, color) {
      const n = this.n, b = this.board;
      let s = 0;
      for (let k = 0; k < 4; k++) {
        const dr = DIRS[k][0], dc = DIRS[k][1];
        b[r][c] = color;
        const len = lineLen(b, n, r, c, dr, dc, color);
        b[r][c] = EMPTY;
        const open = this.directionOpen(r, c, dr, dc, color);
        s += this.fiveScore(len, open);
      }
      const mid = (n - 1) / 2;
      s -= (Math.abs(r - mid) + Math.abs(c - mid)) * 0.5;
      return s;
    },

    directionOpen(r, c, dr, dc, color) {
      const n = this.n, b = this.board;
      b[r][c] = color;
      let open = 0;
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < n && cc >= 0 && cc < n && b[rr][cc] === color) { rr += dr; cc += dc; }
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && b[rr][cc] === EMPTY) open++;
      rr = r - dr; cc = c - dc;
      while (rr >= 0 && rr < n && cc >= 0 && cc < n && b[rr][cc] === color) { rr -= dr; cc -= dc; }
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && b[rr][cc] === EMPTY) open++;
      b[r][c] = EMPTY;
      return open;
    },

    fiveScore(len, open) {
      if (len >= 5) return 10000000;
      if (len === 4) return open >= 2 ? 1000000 : (open >= 1 ? 500000 : 10000);
      if (len === 3) return open >= 2 ? 100000 : (open >= 1 ? 20000 : 2000);
      if (len === 2) return open >= 2 ? 10000 : (open >= 1 ? 1000 : 100);
      if (len === 1) return open >= 2 ? 200 : (open >= 1 ? 50 : 10);
      return 0;
    },

    // ---- 叶子评估（全盘 5 窗口扫描 + 组合威胁聚合），视角 = 己方 - 对方 ----
    evalLeaf() {
      const n = this.n, b = this.board;
      const agg = [
        { five: 0, live4: 0, rush4: 0, live3: 0, rush3: 0 },
        { five: 0, live4: 0, rush4: 0, live3: 0, rush3: 0 }
      ];
      const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (let di = 0; di < 4; di++) {
        const dr = dirs[di][0], dc = dirs[di][1];
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
          const pr = r - dr, pc = c - dc;
          if (pr >= 0 && pr < n && pc >= 0 && pc < n) continue;   // 仅从线起点出发
          this.scanLine(r, c, dr, dc, agg);
        }
      }
      const myA = agg[this.me - 1], opA = agg[this.opp - 1];
      const w = function (a) {
        return a.five * 100000000 + a.live4 * 10000000 + a.rush4 * 1000000 +
               a.live3 * 100000 + a.rush3 * 10000;
      };
      let sMe = w(myA), sOpp = w(opA);
      if (myA.live4 >= 1 || myA.rush4 >= 2 || (myA.rush4 >= 1 && myA.live3 >= 1) || myA.live3 >= 2) sMe += 5000000;
      if (opA.live4 >= 1 || opA.rush4 >= 2 || (opA.rush4 >= 1 && opA.live3 >= 1) || opA.live3 >= 2) sOpp += 5000000;
      return sMe - sOpp;
    },

    scanLine(r0, c0, dr, dc, agg) {
      const n = this.n, b = this.board;
      const cells = [];
      let r = r0, c = c0;
      while (r >= 0 && r < n && c >= 0 && c < n) { cells.push([r, c]); r += dr; c += dc; }
      const L = cells.length;
      if (L < 5) return;
      for (let col = 1; col <= 2; col++) {
        const fourPts = new Set(), threePts = new Set();
        let wins = 0;
        for (let s = 0; s + 4 < L; s++) {
          let cnt = 0, e = null, e2 = null;
          for (let i = s; i < s + 5; i++) {
            const v = b[cells[i][0]][cells[i][1]];
            if (v === col) cnt++;
            else if (v === EMPTY) { if (e === null) e = i; else if (e2 === null) e2 = i; }
          }
          if (cnt === 5) wins++;
          else if (cnt === 4 && e !== null && e2 === null) fourPts.add(e);
          else if (cnt === 3) { if (e !== null) threePts.add(e); if (e2 !== null) threePts.add(e2); }
        }
        const a = agg[col - 1];
        if (wins > 0) a.five++;
        if (fourPts.size >= 2) a.live4++; else if (fourPts.size === 1) a.rush4++;
        a.live3 += Math.floor(threePts.size / 2);
        a.rush3 += threePts.size % 2;
      }
    },

    // ---- Negamax + Alpha-Beta + Zobrist 置换表 + 杀手启发 ----
    search(cfg, depth, alpha, beta, ply) {
      if (this.isTimeout()) return 0;
      const key = this.hashNow();
      const ttE = this.tt.get(key);
      if (ttE && ttE.d >= depth) {
        if (ttE.f === 1) return ttE.v;
        if (ttE.f === 2 && ttE.v <= alpha) return ttE.v;
        if (ttE.f === 3 && ttE.v >= beta) return ttE.v;
      }
      if (depth <= 0) {
        const s = this.evalLeaf();
        return (ply % 2 === 0) ? s : -s;
      }
      const color = (ply % 2 === 0) ? this.me : this.opp;
      const cand = this.orderCandidates(color, cfg, ply, ttE ? ttE.m : null);
      let best = -Infinity, bestMove = null;
      let alpha0 = alpha;
      for (let i = 0; i < cand.length; i++) {
        const r = cand[i][0], c = cand[i][1];
        if (state.renju && color === BLACK && isForbidden(this.board, this.n, r, c)) continue;
        this.place(r, c, color);
        let val;
        if (checkWin(this.board, this.n, r, c) === color) {
          val = WIN_BASE - depth;
        } else {
          val = -this.search(cfg, depth - 1, -beta, -alpha0, ply + 1);
        }
        this.unplace(r, c, color);
        if (this.isTimeout()) return 0;
        if (val > best) { best = val; bestMove = [r, c]; }
        if (val > alpha0) alpha0 = val;
        if (alpha0 >= beta) { this.addKiller(ply, r, c); break; }
      }
      if (best === -Infinity) return 0;
      if (bestMove) {
        let flag = 1;
        if (best <= alpha) flag = 2;
        else if (best >= beta) flag = 3;
        this.ttPut(depth, flag, best, bestMove);
      }
      return best;
    },

    // ---- 候选排序：TT 着法 + 杀手着法优先 ----
    orderCandidates(color, cfg, ply, ttMove) {
      const cand = this.genCandidates(color, cfg, false);
      if (ttMove) {
        for (let i = 0; i < cand.length; i++) {
          if (cand[i][0] === ttMove[0] && cand[i][1] === ttMove[1]) {
            if (i > 0) cand.unshift(cand.splice(i, 1)[0]);
            break;
          }
        }
      }
      const kk = this.killers[ply];
      if (kk) {
        for (let j = 0; j < kk.length; j++) {
          for (let i = 1; i < cand.length; i++) {
            if (cand[i][0] === kk[j][0] && cand[i][1] === kk[j][1]) {
              cand.unshift(cand.splice(i, 1)[0]);
              break;
            }
          }
        }
      }
      return cand;
    },

    // ---- 迭代加深根搜索 ----
    searchRoot(cfg) {
      this.zobInit();
      this.ttClear();
      this.killReset();
      this.zHi = 0; this.zLo = 0;
      const n = this.n, b = this.board;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const v = b[r][c];
        if (v !== EMPTY) { const k = this.zobKeyAt(v, r, c); this.zHi ^= k[0]; this.zLo ^= k[1]; }
      }
      let bestMove = null;
      for (let d = 1; d <= cfg.depth; d++) {
        if (this.isTimeout()) break;
        const moves = this.genCandidates(this.me, cfg, true);
        let alpha = -Infinity, beta = Infinity, bm = null, bv = -Infinity;
        for (let i = 0; i < moves.length; i++) {
          const r = moves[i][0], c = moves[i][1];
          if (state.renju && this.me === BLACK && isForbidden(this.board, n, r, c)) continue;
          this.place(r, c, this.me);
          let val;
          if (checkWin(this.board, n, r, c) === this.me) {
            val = WIN_BASE;
          } else {
            val = -this.search(cfg, d - 1, -beta, -alpha, 1);
          }
          this.unplace(r, c, this.me);
          if (this.isTimeout()) break;
          if (val > bv) { bv = val; bm = [r, c]; }
          if (val > alpha) alpha = val;
          if (alpha >= beta) break;
        }
        if (this.isTimeout()) break;
        if (bm) bestMove = bm;
      }
      return bestMove;
    },

    // ---- 单步必杀：直接五连 或 一步组合杀（双三/三四/双四/活四） ----
    vctWinOne(color) {
      // 快速排序即可：组合威胁在逐点落子后精确判定
      const cand = this.genCandidates(color, { depth: 6, cap: 20 }, false);
      for (let i = 0; i < cand.length; i++) {
        if (this.isTimeout()) return null;
        const r = cand[i][0], c = cand[i][1];
        if (state.renju && color === BLACK && isForbidden(this.board, this.n, r, c)) continue;
        this.place(r, c, color);
        if (checkWin(this.board, this.n, r, c) === color) { this.unplace(r, c, color); return [r, c]; }
        const t = classifyPointAt(this.board, this.n, r, c, color);
        const dbl = isDoubleThreat(t);
        let safe = true;
        if (dbl) {
          const comps = this.completionPointsOf(r, c, color);
          const pts = comps.four.concat(comps.three);
          for (let j = 0; j < pts.length; j++) {
            const br = pts[j][0], bc = pts[j][1];
            this.place(br, bc, this.opp);
            if (checkWin(this.board, this.n, br, bc) === this.opp) safe = false;
            this.unplace(br, bc, this.opp);
            if (!safe) break;
          }
        }
        this.unplace(r, c, color);
        if (dbl && safe) return [r, c];
      }
      return null;
    },

    // ---- 落子后 (r,c) 的全部威胁完成点（4 石窗空白 + 3 石窗空白） ----
    completionPointsOf(r, c, color) {
      const n = this.n, b = this.board;
      const four = [], three = [];
      for (let k = 0; k < 4; k++) {
        const dr = DIRS[k][0], dc = DIRS[k][1];
        for (let s = -4; s <= 0; s++) {
          let cnt = 0;
          const empties = [];
          let inb = true;
          for (let i = 0; i < 5; i++) {
            const rr = r + (s + i) * dr, cc = c + (s + i) * dc;
            if (rr < 0 || rr >= n || cc < 0 || cc >= n) { inb = false; break; }
            const v = b[rr][cc];
            if (v === color) cnt++;
            else if (v === EMPTY) empties.push([rr, cc]);
          }
          if (!inb) continue;
          if (cnt === 4 && empties.length === 1) four.push(empties[0]);
          else if (cnt === 3) for (let j = 0; j < empties.length; j++) three.push(empties[j]);
        }
      }
      return { four: four, three: three };
    },

    // ---- 强化 VCT：递归“连续冲四/活三”追杀，返回必杀落点或 null ----
    vct(color, plyLeft) {
      if (plyLeft <= 0 || this.isTimeout()) return null;
      // 快速排序即可（组合威胁在落子后逐点精确判定）
      const cand = this.genCandidates(color, { depth: 6, cap: 14 }, false);
      for (let i = 0; i < cand.length; i++) {
        if (this.isTimeout()) return null;
        const r = cand[i][0], c = cand[i][1];
        if (state.renju && color === BLACK && isForbidden(this.board, this.n, r, c)) continue;
        this.place(r, c, color);
        if (checkWin(this.board, this.n, r, c) === color) { this.unplace(r, c, color); return [r, c]; }
        const t = classifyPointAt(this.board, this.n, r, c, color);
        if (isDoubleThreat(t)) {
          // 组合杀：对手无法一子全堵（逐一验证无反杀）
          let safe = true;
          const comps = this.completionPointsOf(r, c, color);
          const pts = comps.four.concat(comps.three);
          for (let j = 0; j < pts.length; j++) {
            const br = pts[j][0], bc = pts[j][1];
            this.place(br, bc, this.opp);
            if (checkWin(this.board, this.n, br, bc) === this.opp) safe = false;
            this.unplace(br, bc, this.opp);
            if (!safe) break;
          }
          if (safe) { this.unplace(r, c, color); return [r, c]; }
        } else if (t.rush4 === 1) {
          // 单冲四：对手被迫堵唯一完成点，继续追杀
          const comps = this.completionPointsOf(r, c, color);
          if (comps.four.length) {
            const br = comps.four[0][0], bc = comps.four[0][1];
            this.place(br, bc, this.opp);
            const oppWin = checkWin(this.board, this.n, br, bc) === this.opp;
            const res = oppWin ? null : this.vct(color, plyLeft - 2);
            this.unplace(br, bc, this.opp);
            if (res) { this.unplace(r, c, color); return [r, c]; }
          }
        } else if (t.live3 >= 1) {
          // 活三：对手全部防守都挡不住，才算追杀成功
          const comps = this.completionPointsOf(r, c, color);
          const blocks = comps.three;
          let allWin = blocks.length > 0;
          for (let j = 0; j < blocks.length; j++) {
            const br = blocks[j][0], bc = blocks[j][1];
            this.place(br, bc, this.opp);
            if (checkWin(this.board, this.n, br, bc) === this.opp) {
              this.unplace(br, bc, this.opp); allWin = false; break;
            }
            const r2 = this.vct(color, plyLeft - 2);
            this.unplace(br, bc, this.opp);
            if (!r2) { allWin = false; break; }
          }
          if (allWin) { this.unplace(r, c, color); return [r, c]; }
        }
        this.unplace(r, c, color);
      }
      return null;
    },

    // ---- 探测对手的最强威胁（五连 / 组合杀），返回 { point, win, t } 或 null ----
    findOppThreat(colorOpp) {
      const cand = this.genCandidates(colorOpp, { depth: 6, cap: 16 }, false);
      for (let i = 0; i < cand.length; i++) {
        if (this.isTimeout()) return null;
        const r = cand[i][0], c = cand[i][1];
        this.place(r, c, colorOpp);
        const win = checkWin(this.board, this.n, r, c) === colorOpp;
        const t = win ? { five: 1, live4: 0, rush4: 0, live3: 0, rush3: 0 } : classifyPointAt(this.board, this.n, r, c, colorOpp);
        this.unplace(r, c, colorOpp);
        // 覆盖全部威胁：五连 / 活四 / 双三 / 三四 / 双四 / 单冲四 / 单活三（一律强制防守）
        if (win || isDoubleThreat(t) || t.rush4 >= 1 || t.live3 >= 1) {
          return { point: [r, c], win: win, t: t };
        }
      }
      return null;
    },

    // ---- 对对手威胁的最优堵截点 ----
    findBlockAgainst(oppT) {
      const pts = new Set();
      pts.add(oppT.point[0] + "|" + oppT.point[1]);
      const comps = this.completionPointsOf(oppT.point[0], oppT.point[1], this.opp);
      for (let i = 0; i < comps.four.length; i++) pts.add(comps.four[i][0] + "|" + comps.four[i][1]);
      for (let i = 0; i < comps.three.length; i++) pts.add(comps.three[i][0] + "|" + comps.three[i][1]);
      let best = null, bestScore = -Infinity;
      const keys = Array.from(pts);
      for (let i = 0; i < keys.length; i++) {
        if (this.isTimeout()) break;
        const p = keys[i].split("|");
        const br = parseInt(p[0], 10), bc = parseInt(p[1], 10);
        if (this.board[br][bc] !== EMPTY) continue;
        this.place(br, bc, this.me);
        let s = checkWin(this.board, this.n, br, bc) === this.me ? WIN_BASE : this.evalLeaf();
        this.unplace(br, bc, this.me);
        if (s > bestScore) { bestScore = s; best = [br, bc]; }
      }
      return best || this.findEmptyFallback();
    }
  };

  /* ---------------- WASM 棋圣引擎（按需异步加载） ---------------- */

  // 难度 -> 目标思考时长（毫秒），配合设备测速校准
  const WASM_TARGET_MS = [0, 50, 100, 200, 350, 500];

  let wasmEngine = null;        // 已实例化的 exports
  let wasmLoading = null;       // 进行中的加载 Promise
  let wasmError = false;        // 加载失败标记
  let wasmRate = 0;             // 节点预算/毫秒（校准值，0 = 未校准）

  // 校准局面（威胁结构型中盘：多列交错活二/活三，保证校准触发真实搜索；
  // 散子局面搜索极快会导致速率虚高、预算爆炸）
  const WASM_CALIB_STONES = [];
  (function () {
    const blackRows = [9, 7, 5, 11, 13];
    const whiteRows = [10, 8, 6, 12, 14];
    for (let i = 0; i < blackRows.length; i++) {
      const cols = [9, 10, 12, 13];
      for (let j = 0; j < cols.length; j++) {
        WASM_CALIB_STONES.push([blackRows[i], cols[j]]);
        WASM_CALIB_STONES.push([whiteRows[i], cols[j]]);
      }
    }
  })();

  // AssemblyScript 运行时需要的最小导入
  const WASM_IMPORTS = { env: { abort: function () {} } };

  function loadWasmEngine() {
    if (wasmEngine) return Promise.resolve(wasmEngine);
    if (wasmLoading) return wasmLoading;
    wasmLoading = (async function () {
      const wasmOk = typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function";
      if (!wasmOk) throw new Error("当前设备不支持 WebAssembly");
      let mod;
      if (typeof WebAssembly.instantiateStreaming === "function") {
        try {
          mod = await WebAssembly.instantiateStreaming(fetch("engine.wasm", { cache: "force-cache" }), WASM_IMPORTS);
        } catch (err) {
          const buf = await (await fetch("engine.wasm", { cache: "force-cache" })).arrayBuffer();
          mod = await WebAssembly.instantiate(buf, WASM_IMPORTS);
        }
      } else {
        const buf = await (await fetch("engine.wasm", { cache: "force-cache" })).arrayBuffer();
        mod = await WebAssembly.instantiate(buf, WASM_IMPORTS);
      }
      wasmEngine = mod.instance.exports;
      calibrateWasm();
      return wasmEngine;
    })().catch(function (err) {
      wasmLoading = null;
      wasmError = true;
      statusText.textContent = "WASM 引擎加载失败，已回退原生引擎";
      throw err;
    });
    return wasmLoading;
  }

  // 用固定中盘局面测量设备节点速度，随后各难度按目标时长换算节点预算
  function calibrateWasm() {
    try {
      const w = wasmEngine;
      w.init(19);
      for (let i = 0; i < WASM_CALIB_STONES.length; i++) {
        w.setCell(WASM_CALIB_STONES[i][0], WASM_CALIB_STONES[i][1], (i % 2 === 0) ? BLACK : WHITE);
      }
      const t0 = Date.now();
      w.think(BLACK, 80000);
      const ms = Date.now() - t0;
      wasmRate = ms > 5 ? (80000 / ms) * 0.85 : 0;   // 85% 安全系数
      w.init(state.n);
    } catch (err) {
      wasmRate = 0;
    }
  }

  // WASM 预算：按目标时长 × 测速速率（0.7 安全系数，节点成本随盘面复杂度上升）
  function wasmBudget() {
    if (wasmRate <= 0) return 60000;   // 未校准时保守默认
    let b = Math.round(wasmRate * ((WASM_TARGET_MS[state.difficulty] || 200) * 0.7));
    if (b < 10000) b = 10000;          // 下限：保证基础搜索深度
    if (b > 300000) b = 300000;        // 上限：防止校准偏差导致单步超时
    return b;
  }

  // 同步当前棋盘到 WASM 引擎（init 同时完成规格同步与 Zobrist 初始化）
  function wasmSyncBoard() {
    const w = wasmEngine;
    w.init(state.n);
    for (let r = 0; r < state.n; r++) {
      for (let c = 0; c < state.n; c++) {
        const v = state.board[r][c];
        if (v !== EMPTY) w.setCell(r, c, v);
      }
    }
  }

  // WASM 走棋：返回 [row,col] 或 null（非法/失败时回退原生引擎）
  function wasmBestMove(me) {
    try {
      wasmSyncBoard();
      const w = wasmEngine;
      w.think(me, wasmBudget());
      const r = w.moveR(), c = w.moveC();
      if (r < 0 || r >= state.n || c < 0 || c >= state.n) return null;
      if (state.board[r][c] !== EMPTY) return null;
      // 禁手模式下 WASM 着法需复核
      if (state.renju && me === BLACK && isForbidden(state.board, state.n, r, c)) return null;
      // 防守兜底（双保险）：JS 侧独立探测对手威胁，
      // 若 WASM 着法未落在防守点上，强制替换为最优堵截点
      const safe = jsDefenseCheck(me, [r, c]);
      return safe;
    } catch (err) {
      return null;
    }
  }

  // JS 侧防守校验：对手存在成五/活四/双威胁/冲四/活三时，返回最优堵截点
  function jsDefenseCheck(me, wasmMove) {
    const opp = me === BLACK ? WHITE : BLACK;
    const savedDeadline = AI.deadline, savedNodes = AI.nodes;
    // 关键：同步 AI 引擎的棋盘引用（WASM 模式下 AI.board 可能残留旧棋盘）
    AI.board = state.board;
    AI.n = state.n;
    AI.me = me;
    AI.opp = opp;
    AI.renju = state.renju;
    AI.zobInit();   // 幂等；findOppThreat 内部 place() 需要 Zobrist 表
    AI.resetSearch(60);
    let result = wasmMove;
    try {
      const oppT = AI.findOppThreat(opp);
      if (oppT) {
        const blk = AI.findBlockAgainst(oppT);
        if (blk) {
          // 禁手模式下堵截点也需复核
          if (!(state.renju && me === BLACK && isForbidden(state.board, state.n, blk[0], blk[1]))) {
            result = blk;
          }
        }
      }
    } finally {
      AI.deadline = savedDeadline;
      AI.nodes = savedNodes;
    }
    return result;
  }

  /* ---------------- UI 交互 ---------------- */

  // 防抖：忽略极短时间内对同一交叉点的重复触发（规避 PointerEvent 与 TouchEvent 双发）
  let lastTap = { t: 0, r: -1, c: -1 };

  function clickHandler(e) {
    if (state.over) return;
    if (state.current !== state.human) return;
    const pos = getPos(e);
    if (!pos) return;
    const { row, col } = pos;
    if (row < 0 || row >= state.n || col < 0 || col >= state.n) return;
    if (state.board[row][col] !== EMPTY) return;

    // 防抖阈值：500ms 内同一交叉点只落一子
    const now = Date.now();
    if (row === lastTap.r && col === lastTap.c && (now - lastTap.t) < 500) return;
    lastTap = { t: now, r: row, c: col };

    // 禁手判断
    if (state.human === BLACK && state.renju && isForbidden(state.board, state.n, row, col)) {
      statusText.textContent = "落子违反禁手，请重下";
      draw();
      return;
    }

    makeMove(row, col);
  }

  function makeMove(row, col) {
    const color = state.current;
    state.board[row][col] = color;
    state.moves.push([row, col]);

    const win = checkWin(state.board, state.n, row, col);
    if (win) {
      state.winning = findWinningLine(state.board, state.n, row, col);
      endGame(color, state.moves.length, [row, col]);
      draw();
      return;
    }
    if (isDraw(state.board, state.n)) {
      endGame(0, state.moves.length, null);
      draw();
      return;
    }

    state.current = color === BLACK ? WHITE : BLACK;
    updateTopBar();

    if (state.current === state.human) {
      // 玩家回合结束
    } else {
      statusText.textContent = "AI 思考中…";
      statusText.textContent = state.human === BLACK ? "白方走棋" : "黑方走棋";
      // AI 走棋（延迟处理，点击后立即返回，避免阻塞）
      aiMoveAsync();
    }
    draw();
  }

  function aiMoveAsync() {
    // 用 setTimeout 让绘制先完成，保持界面敏捷
    setTimeout(aiToMove, 30);
  }

  function aiToMove() {
    if (state.over) return;
    if (state.current === state.human) return;
    const me = state.current;
    let mv = null;

    // 统一大师级 WASM 引擎；未就绪/异常/禁手非法时回退 JS 轻量引擎
    if (wasmEngine) {
      mv = wasmBestMove(me);
      if (!mv) mv = AI.bestMove(state.board, state.n, me, state.renju, null);
    } else {
      mv = AI.bestMove(state.board, state.n, me, state.renju, null);
    }

    if (mv && (mv[0] < 0 || mv[0] >= state.n || mv[1] < 0 || mv[1] >= state.n || state.board[mv[0]][mv[1]] !== EMPTY)) {
      mv = AI.findEmptyFallback();
    }
    if (!state.over && state.current === me) {
      makeMove(mv[0], mv[1]);
    }
  }

  function endGame(winner, ply, last) {
    state.over = true;
    state.winner = winner;
    if (winner === BLACK) state.score.black++;
    if (winner === WHITE) state.score.white++;
    updateScore();
    updateTopBar();
    // draw() 此时已绘制出五连高亮，先让玩家看清成五，再延迟弹出结果
    if (winner === 0) {
      statusBar.classList.add("game-over");
      statusText.textContent = "平局";
      openOverlay("平局", "棋盘已满，势均力敌！", true);
    } else {
      const humanWin = winner === state.human;
      statusBar.classList.add("game-over");
      statusText.textContent = humanWin ? "你赢了" : "AI 获胜";
      const title = humanWin ? "你赢了 🎉" : "AI 获胜";
      const desc = humanWin ? "太棒了！再战一局？" : "继续挑战更高的难度吧！";
      setTimeout(function () {
        // 若期间已新开棋局则不再弹窗
        if (!state.over) return;
        openOverlay(title, desc, true);
      }, 900);
    }
    void ply; void last;
  }

  function updateScore() {
    scoreBlack.textContent = state.score.black;
    scoreWhite.textContent = state.score.white;
  }

  function updateTopBar() {
    const active = state.current;
    if (state.over || active === 0) {
      pBlack.classList.remove("active");
      pWhite.classList.remove("active");
      return;
    }
    if (active === BLACK) { pBlack.classList.add("active"); pWhite.classList.remove("active"); }
    else { pWhite.classList.add("active"); pBlack.classList.remove("active"); }

    // 主动提示当前走棋方名称
    pBlack.querySelector(".mark").textContent = "●";
    pWhite.querySelector(".mark").textContent = "●";
  }

  // 取事件坐标（TouchEvent / PointerEvent / MouseEvent 兼容）
  function eventClientXY(e) {
    if (e.touches && e.touches.length) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  // 坐标映射：屏幕坐标 -> 棋盘交叉点（row, col）
  // 使用 getBoundingClientRect() + CSS比例换算到画布内部像素，确保 11/15/19 网格均精确对称吸附
  function getPos(e) {
    const { x: clx, y: cly } = eventClientXY(e);
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    // 由 CSS 显示尺寸换算到画布内部像素（一统处理 DPR 与 CSS 缩放），与 draw() 同基准
    const x = (clx - rect.left) * (canvas.width / rect.width);
    const y = (cly - rect.top) * (canvas.height / rect.height);

    const grid = canvas.width / (state.n - 1);   // 画布内部每格像素
    const margin = grid / 2;                     // 首条网格线相对原点(左上)的偏移

    // 相对第一条网格线的偏移（去除左侧/顶部外边距），Y 轴与之完全对称
    const sx = x - margin;
    const sy = y - margin;

    // 标准最近邻吸附：Math.floor(v + 0.5) 对落在网格线左右半格内均精确归一到该列/行，
    // 避免使用浮点敏感的 Math.round 带来整体偏一列的问题
    const col = Math.floor(sx / grid + 0.5);
    const row = Math.floor(sy / grid + 0.5);
    return { row, col };
  }

  /* ---------------- 新开 / 悔棋 ---------------- */

  function openNewGame() {
    openOverlay("新开一局", "请选择执子颜色：", false);
    const row = document.getElementById("choice-row");
    row.innerHTML = "";
    const b = document.createElement("button");
    b.innerHTML = "⚫ 先手黑";
    b.onclick = () => { state.human = BLACK; newGame(); };
    const w = document.createElement("button");
    w.innerHTML = "⚪ 执白";
    w.onclick = () => { state.human = WHITE; newGame(); };
    row.appendChild(b);
    row.appendChild(w);
  }

  function newGame() {
    state.board = newBoard(state.n);
    state.moves = [];
    state.over = false;
    state.winner = 0;
    state.winning = null;
    state.current = BLACK;
    statusBar.classList.remove("game-over");
    hideOverlay();
    updateTopBar();
    statusText.textContent = "黑方先行";
    draw();
    // 若玩家执白，AI 先行
    if (state.human === WHITE) {
      statusText.textContent = "AI（黑）先行";
      aiToMove();
    }
  }

  function undo() {
    if (state.over) {
      statusText.textContent = "本局已结束，请新开一局";
      return;
    }
    if (state.moves.length === 0) {
      statusText.textContent = "尚无落子可悔";
      return;
    }
    // 回退两步（玩家+AI），若轮到玩家，则玩家上一步在 last
    // 根据当前轮次决定回退数量
    let target = state.moves.length;
    const rollback = state.current === state.human ? 2 : 1;
    const cnt = Math.min(rollback, target);
    for (let i = 0; i < cnt; i++) {
      const [r, c] = state.moves.pop();
      state.board[r][c] = EMPTY;
    }
    state.over = false;
    state.winner = 0;
    state.winning = null;
    state.current = state.human;
    updateTopBar();
    statusText.textContent = (state.human === BLACK ? "黑方" : "白方") + "走棋";
    draw();
  }

  /* ---------------- 弹窗 ---------------- */
  const overlay = document.getElementById("overlay");
  function openOverlay(title, desc, isEnd) {
    document.getElementById("ov-title").textContent = title;
    document.getElementById("ov-desc").textContent = desc;
    document.getElementById("choice-row").innerHTML = "";
    // 设置/关于/新开弹窗一律显示“关闭”按钮
    document.getElementById("ov-close").style.display = "block";
    document.getElementById("ov-close").textContent = isEnd ? "再来一局" : "关闭";
    overlay.classList.remove("hidden");
  }
  function hideOverlay() {
    overlay.classList.add("hidden");
  }
  document.getElementById("ov-close").onclick = hideOverlay;

  /* ---------------- 设置 ---------------- */
  function openSettings() {
    openOverlay("设置", "", false);
    document.getElementById("ov-title").textContent = "设置";
    const row = document.getElementById("choice-row");
    row.innerHTML = "";

    const panel = document.createElement("div");
    panel.style.width = "100%";
    panel.innerHTML = wrapSettingsHTML();
    row.appendChild(panel);
    row.style.display = "block";

    bindSettingsEvents(panel);
  }

  function wrapSettingsHTML() {
    const d = state.difficulty;
    const sz = state.size;
    const renjuOn = state.renju;
    const wasmOk = typeof WebAssembly !== "undefined";
    let html = "";
    html += `<div class="setting-group"><h3>AI 引擎</h3><div class="hint" id="engine-hint">${!wasmOk ? '当前设备不支持 WebAssembly' : (wasmEngine ? '大师级引擎已就绪（威胁空间算杀 + 开局库）' : (wasmError ? '引擎加载失败，已回退轻量引擎' : '大师级引擎加载中…'))}</div></div>`;

    html += `<div class="setting-group"><h3>AI 智商等级</h3><div class="seg-row">`;
    for (let lv = 1; lv <= 5; lv++) {
      html += `<div class="seg ${d === lv ? 'active' : ''}" data-d="${lv}">${lv}</div>`;
    }
    html += `</div><div style="text-align:center;margin-top:6px;font-size:16px;color:#000;" id="lv-desc">${dificultades[d].label}</div></div>`;

    html += `<div class="setting-group"><h3>棋盘规格</h3><div class="seg-row">`;
    html += `<div class="seg ${sz==='small'?'active':''}" data-size="small">${SIZES.small.label}</div>`;
    html += `<div class="seg ${sz==='medium'?'active':''}" data-size="medium">${SIZES.medium.label}</div>`;
    html += `<div class="seg ${sz==='large'?'active':''}" data-size="large">${SIZES.large.label}</div>`;
    html += `</div></div>`;

    html += `<div class="setting-group"><h3>禁手规则（黑方）</h3><div class="switch-label"><span>三三 / 四四 / 长连禁手</span><div class="switch ${renjuOn?'on':''}" id="renju-switch"></div></div></div>`;
    return html;
  }

  function bindSettingsEvents(panel) {
    const segs = panel.querySelectorAll(".seg[data-d]");
    segs.forEach(function (s) {
      s.onclick = function () {
        segs.forEach(x => x.classList.remove("active"));
        s.classList.add("active");
        state.difficulty = parseInt(s.dataset.d, 10);
        const desc = document.getElementById("lv-desc");
        if (desc) desc.textContent = dificultades[state.difficulty].label;
      };
    });

    const sizeSegs = panel.querySelectorAll(".seg[data-size]");
    sizeSegs.forEach(function (s) {
      s.onclick = function () {
        sizeSegs.forEach(x => x.classList.remove("active"));
        s.classList.add("active");
        const key = s.dataset.size;
        state.size = key;
        resizeBoard(key);
      };
    });

    const sw = document.getElementById("renju-switch");
    if (sw) {
      sw.onclick = function () {
        state.renju = !state.renju;
        sw.classList.toggle("on", state.renju);
      };
    }
  }

  function resizeBoard(key) {
    const sz = SIZES[key];
    state.n = sz.n;
    // 保留当前对局比例？重置棋盘
    const keep = state.moves.length > 0;
    if (keep) {
      // 简单重置
    }
    state.board = newBoard(state.n);
    state.moves = [];
    state.over = false;
    state.winner = 0;
    state.winning = null;
    state.current = BLACK;
    statusBar.classList.remove("game-over");
    // 若玩家执白则 AI 先行
    updateTopBar();
    statusText.textContent = "棋盘已切换为" + sz.label;
    draw();
    if (state.human === WHITE) {
      setTimeout(function(){ if(!state.over && state.moves.length===0){ aiToMove(); } }, 400);
    }
  }

  /* ---------------- 关于 ---------------- */
  function openAbout() {
    openOverlay("关于", "", false);
    document.getElementById("ov-title").textContent = "关于";
    const row = document.getElementById("choice-row");
    row.innerHTML = "";
    row.style.display = "block";
    const box = document.createElement("div");
    box.id = "about-text";
    box.innerHTML =
      "<b>高智商人机五子棋 v2.0</b>" +
      "专为 10 寸墨水屏 Pad（墨案 X 等）深度优化。纯黑白灰高对比度，禁用动画防残影，点击即刻响应。<br><br>" +
      "<b>规则</b><br>自由五子棋：无禁手，允许双三、双四、长连。可于设置中开启黑方三三/四四/长连禁手（连珠规则）。<br><br>" +
      "<b>AI 引擎</b><br>统一大师级引擎（Gomocup 系架构）：威胁空间搜索 TSS + 完整 VCF/VCT 连杀 + 对手反威胁验证 + 开局定式库 + Zobrist 置换表 + 迭代加深。<br>" +
      "五级难度按思考预算分级：①新手入门 ②进阶 ③高手 ④大师 ⑤棋圣（算杀必杀）。<br><br>" +
      "<b>操作</b><br>新开-选执子色重开；悔棋-回退玩家+AI 各一步；设置-调难度/棋盘/禁手。<br><br>" +
      "零依赖单页应用，双击 index.html 或部署 Vercel 即用。";
    row.appendChild(box);
  }

  /* ---------------- 事件绑定 ---------------- */

  // 全局去重锁：同一物理按下在极短时间内（约 350ms）只处理一次，
  // 彻底防止 PointerEvent 与 TouchEvent/MouseEvent 在支持指针事件的设备上双发落子。
  let lastEventGuard = { t: 0, x: 0, y: 0 };
  function guardedClick(e) {
    // 鼠标仅响应主键
    if (e.type === "mousedown" && e.button !== 0) return;
    e.preventDefault();
    const { x, y } = eventClientXY(e);
    const now = Date.now();
    if ((now - lastEventGuard.t) < 350 &&
        Math.abs(x - lastEventGuard.x) < 6 &&
        Math.abs(y - lastEventGuard.y) < 6) {
      return; // 判定为双发事件，忽略
    }
    lastEventGuard = { t: now, x, y };
    clickHandler(e);
  }

  const supportsPointer = "PointerEvent" in window;
  if (supportsPointer) {
    // 指针事件优先：鼠标主键 / 触摸 / 触控笔
    canvas.addEventListener("pointerdown", guardedClick, { passive: false });
    // 兜底：某些老浏览器光标点触发不了 pointerdown 时
    canvas.addEventListener("mousedown", guardedClick, { passive: false });
  } else {
    canvas.addEventListener("mousedown", guardedClick, { passive: false });
    canvas.addEventListener("touchstart", guardedClick, { passive: false });
  }

  document.getElementById("btn-new").onclick = openNewGame;
  document.getElementById("btn-undo").onclick = undo;
  document.getElementById("btn-settings").onclick = openSettings;
  document.getElementById("btn-about").onclick = openAbout;

  window.addEventListener("resize", function () { draw(); });

  // 初始黑方先行（人类执黑），构造
  state.human = BLACK;
  // 初始清空棋盘，等待开始
  // 默认给一局：人类执黑先手。（不自动开始，让用户点新开）
  state.board = newBoard(state.n);
  newGameUIInit();
  function newGameUIInit() {
    hideOverlay();
    updateScore();
    draw();
  }

  // 后台预加载大师级 WASM 引擎（不影响首屏渲染与输入响应）
  if (typeof WebAssembly !== "undefined") {
    loadWasmEngine().then(function () {
      statusText.textContent = "大师级引擎已就绪，黑方先行";
    }).catch(function () {});
  }

  // 供自动化测试导出的内部逻辑（仅测试环境使用，不影响生产）
  if (typeof globalThis !== "undefined" && globalThis.__GOMOKU_TEST__) {
    globalThis.__GOMOKU_API__ = {
      newBoard, checkWin, isForbidden, lineLen, EMPTY, BLACK, WHITE,
      state, draw, makeMove, newGame, aiToMove, undo,
      getPos, findWinningLine,
      classifyPointAt, isDoubleThreat, threatValue, AI,
      loadWasmEngine, wasmBestMove, wasmBudget, calibrateWasm, wasmEngine,
      set setState(o) { Object.assign(state, o); },
      getStatus() { return state; }
    };
  }

})();
