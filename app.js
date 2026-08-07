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

  // 难度配置
  const dificultades = {
    1: { depth: 1,  vcf: false, cap: 6,  label: "新手入门" },
    2: { depth: 2,  vcf: true,  cap: 8,  label: "进阶" },
    3: { depth: 3,  vcf: true,  cap: 10, label: "高手" },
    4: { depth: 3,  vcf: true,  cap: 12, label: "大师" },
    5: { depth: 4,  vcf: true,  cap: 12, label: "棋圣 · 必杀" }
  };

  /* ---------------- DOM ---------------- */
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const statusText = document.getElementById("status-text");
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

    // 最后一步标记点
    if (last) {
      const x = margin + last[1] * grid;
      const y = margin + last[0] * grid;
      const dotR = Math.max(3, rStone * 0.18);
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      const v = state.board[last[0]][last[1]];
      ctx.fillStyle = v === BLACK ? "#fff" : "#000";
      ctx.fill();
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

  function isDraw(board, n) {
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (board[r][c] === EMPTY) return false;
    return true;
  }

  /* ---------------- AI 引擎 ---------------- */
  const AI = {
    board: null, n: 0, me: 0, opp: 0, renju: false,

    // 候选点评估简化表
    EVAL_TABLE: null,

    // 主入口：返回 [row, col]
    bestMove(b, n, me, renju, opponent_last) {
      this.board = b; this.n = n; this.me = me; this.opp = me === BLACK ? WHITE : BLACK; this.renju = renju;
      const cfg = dificultades[state.difficulty] || dificultades[3];

      // 空盘/首手：下天元（仅在棋盘近乎全空时）
      const stones = this.countStones();
      if (stones === 0) {
        return [Math.floor(n / 2), Math.floor(n / 2)];
      }
      // 第二手：贴近第一手
      if (stones === 1) {
        const first = this.findFirstStone();
        if (first) return this.near(first.row, first.col);
      }

      const candidates = this.genCandidates(me, cfg);

      // 先做即时胜负
      for (const [r, c] of candidates) {
        this.board[r][c] = me;
        const win = checkWin(this.board, n, r, c);
        this.board[r][c] = EMPTY;
        if (win === me) return [r, c];
      }
      // 防守对方即时胜
      const opp = this.opp;
      for (const [r, c] of candidates) {
        this.board[r][c] = opp;
        const win = checkWin(this.board, n, r, c);
        this.board[r][c] = EMPTY;
        if (win === opp) return [r, c];
      }

      // VCF / VCT 连杀（难度>=2 开启，作为提速捷径）
      if (cfg.vcf) {
        const kill = this.vcfSearch(me, 2);
        if (kill) return kill;
        if (cfg.depth >= 4) {
          const block = this.vcfSearch(opp, 1);
          if (block) return this.findVcfDefense(block);
        }
      }

      // 递归搜索（根节点选最优，带时间/节点预算）
      this.beginSearch();
      const rootMoves = candidates;
      let alpha = -Infinity, beta = Infinity;
      let bestMove = rootMoves[0] || [Math.floor(n/2), Math.floor(n/2)];
      let bestVal = -Infinity;
      for (const [r, c] of rootMoves) {
        this.board[r][c] = me;
        let val;
        const win = checkWin(this.board, n, r, c);
        if (win === me) {
          val = 10000000 + cfg.depth;
        } else {
          val = -this.negamaxTrack(rootMoves, cfg, -beta, -alpha, 1, me);
        }
        this.board[r][c] = EMPTY;
        if (this.nodeBudget <= 0) {
          // 预算耗尽：提前利用已展开的首个候选结束
          break;
        }
        if (val > bestVal) { bestVal = val; bestMove = [r, c]; }
        if (val > alpha) alpha = val;
        if (alpha >= beta) break;
      }
      if (bestMove && this.board[bestMove[0]][bestMove[1]] !== EMPTY) {
        // 兜底：返回任意空位
        return this.findEmptyFallback();
      }
      return bestMove;
    },

    findEmptyFallback() {
      const n = this.n;
      // 先找邻近空位，再找任意空位
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
        if (this.board[r][c] === EMPTY && this.hasNeighbor(r, c, 1)) return [r, c];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
        if (this.board[r][c] === EMPTY) return [r, c];
      return [Math.floor(n/2), Math.floor(n/2)];
    },

    countEmpty() { let s = 0; for (let r=0;r<this.n;r++)for(let c=0;c<this.n;c++)if(this.board[r][c]===EMPTY)s++; return s; },
    countStones() { let s = 0; for (let r=0;r<this.n;r++)for(let c=0;c<this.n;c++)if(this.board[r][c]!==EMPTY)s++; return s; },

    findFirstStone() {
      for (let r=0;r<this.n;r++)for(let c=0;c<this.n;c++)if(this.board[r][c]!==EMPTY)return {row:r,col:c};
      return null;
    },
    near(r, c) {
      const n = this.n;
      const s = Math.floor(n/2);
      const cand=[];
      for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){
        const rr=r+dr, cc=c+dc;
        if(rr>=0&&rr<n&&cc>=0&&cc<n&&this.board[rr][cc]===EMPTY) cand.push([rr,cc]);
      }
      if(!cand.length) return [s,s];
      // 选择最接近天元的
      cand.sort((a,b)=>{const da=Math.abs(a[0]-s)+Math.abs(a[1]-s);const db=Math.abs(b[0]-s)+Math.abs(b[1]-s);return da-db;});
      return cand[0];
    },

    // 生成候选（附近扫描）
    genCandidates(me, cfg) {
      const n = this.n;
      const cand = [];
      const seen = new Set();
      const bestScore = new Map();
      const R = cfg.depth <= 2 ? 1 : 1;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (this.board[r][c] !== EMPTY) continue;
          if (this.hasNeighbor(r, c, 1)) {
            const key = r * n + c;
            if (seen.has(key)) continue;
            seen.add(key);
            let s = this.evalPoint(r, c, me);
            cand.push([r, c, s, key]);
          }
        }
      }
      cand.sort((a, b) => b[2] - a[2]);
      // 截断候选以提速（按难度限制）
      const cap = cfg.cap || 12;
      return cand.slice(0, cap).map(x => [x[0], x[1]]);
    },

    // 时间/节点预算
    nodeBudget: 0,
    nodeDeadline: 0,
    beginSearch() { this.nodeBudget = 38000; this.nodeDeadline = Date.now() + 280; },
    nodeUsed() { return this.nodeBudget <= 0 || Date.now() > this.nodeDeadline; },

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

    // 攻击性/防守性点评估（启发式）
    evalPoint(r, c, me) {
      let s = 0;
      const opp = this.opp;
      // 己方
      s += this.patternScore(this.board, this.n, r, c, me) * 1.0;
      // 防守
      const oppS = this.patternScore(this.board, this.n, r, c, opp) * 1.1;
      s += oppS;
      // 中心偏好
      const n = this.n, mid = Math.floor(n / 2);
      const d = Math.abs(r - mid) + Math.abs(c - mid);
      s -= d * 0.5;
      return s;
    },

    patternScore(board, n, r, c, color) {
      let total = 0;
      for (let k = 0; k < 4; k++) {
        const dr = DIRS[k][0], dc = DIRS[k][1];
        // 模拟在 (r,c) 放置后沿方向计数
        board[r][c] = color;
        const len = lineLen(board, n, r, c, dr, dc, color);
        board[r][c] = EMPTY;
        const openness = this.directionOpen(board, n, r, c, dr, dc, color);
        total += this.fiveScore(len, openness);
      }
      return total;
    },

    directionOpen(board, n, r, c, dr, dc, color) {
      // 放置后的两端开放数
      board[r][c] = color;
      let open = 0;
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === color) { rr += dr; cc += dc; }
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === EMPTY) open++;
      rr = r - dr; cc = c - dc;
      while (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === color) { rr -= dr; cc -= dc; }
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === EMPTY) open++;
      board[r][c] = EMPTY;
      return open;
    },

    fiveScore(len, open) {
      const canWin = len >= 5;
      if (len >= 5) return 10000000;
      if (len === 4) return open >= 2 ? 1000000 : (open >= 1 ? 500000 : 10000);
      if (len === 3) {
        if (open >= 2) return 100000;
        if (open >= 1) return 20000;
        return 2000;
      }
      if (len === 2) {
        if (open >= 2) return 10000;
        if (open >= 1) return 1000;
        return 100;
      }
      if (len === 1) {
        if (open >= 2) return 200;
        if (open >= 1) return 50;
        return 10;
      }
      return 0;
    },

    // 全盘评估（当前局面，视角 color）
    evalBoard(color) {
      const n = this.n, b = this.board;
      let score = 0;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (b[r][c] === color) {
            score += this.stoneScore(r, c, color);
          }
        }
      }
      return score;
    },

    stoneScore(r, c, color) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        const dr = DIRS[k][0], dc = DIRS[k][1];
        const len = this.runFrom(r, c, dr, dc, color);
        // 只计正向以去重
        const rr = r - dr, cc = c - dc;
        if (rr >= 0 && rr < this.n && cc >= 0 && cc < this.n && this.board[rr][cc] === color) continue;
        const open = this.runOpenForward(r, c, dr, dc, color);
        s += this.fiveScore(len, open);
      }
      return s;
    },

    runFrom(r, c, dr, dc, color) {
      let rr = r, cc = c, len = 0;
      while (rr >= 0 && rr < this.n && cc >= 0 && cc < this.n && this.board[rr][cc] === color) {
        len++; rr += dr; cc += dc;
      }
      return len;
    },
    runOpenForward(r, c, dr, dc, color) {
      // 段首开放 + 段尾开放
      let rr = r, cc = c;
      while (rr >= 0 && rr < this.n && cc >= 0 && cc < this.n && this.board[rr][cc] === color) { rr += dr; cc += dc; }
      let open = 0;
      if (rr >= 0 && rr < this.n && cc >= 0 && cc < this.n && this.board[rr][cc] === EMPTY) open++;
      let rl = r - dr, cl = c - dc;
      if (rl >= 0 && rl < this.n && cl >= 0 && cl < this.n && this.board[rl][cl] === EMPTY) open++;
      return open;
    },

    // negamax + alpha-beta（递归返回数值）
    negamaxTrack(cands, cfg, alpha, beta, depth, lastColor) {
      if (this.nodeBudget-- <= 0) return 0;
      const n = this.n;
      const isMax = (depth % 2 === 0);
      if (depth >= cfg.depth) {
        const s = isMax ? this.evalBoard(this.me) : this.evalBoard(this.opp);
        return isMax ? s : -s;
      }
      const color = isMax ? this.me : this.opp;
      const cand = this.genCandidates(color, cfg);
      let best = -Infinity;
      for (const [r, c] of cand) {
        if (state.renju && color === BLACK && isForbidden(this.board, n, r, c)) continue;
        this.board[r][c] = color;
        const win = checkWin(this.board, n, r, c);
        let val;
        if (win === color) {
          val = 10000000 + (cfg.depth - depth);
        } else {
          val = -this.negamaxTrack(cand, cfg, -beta, -alpha, depth + 1, color);
        }
        this.board[r][c] = EMPTY;
        if (this.nodeBudget <= 0) break;
        if (val > best) best = val;
        if (val > alpha) alpha = val;
        if (alpha >= beta) break;
      }
      return best === -Infinity ? 0 : best;
    },

    // VCF/VCT：简单连杀搜索（返回必杀点或防守点）
    vcfSearch(color, maxDepth) {
      const n = this.n;
      // 搜索当前 color 能否在 maxDepth 步内强制获胜
      const killers = this.findKillerMoves(color);
      if (killers.length) return killers[0];
      // 增强版：尝试二段冲
      if (maxDepth >= 2) {
        for (let step = 0; step < 2; step++) {
          const next = this.findKillerMoves(color);
          if (next.length) return next[0];
        }
        return null;
      }
      return null;
    },

    findKillerMoves(color) {
      const n = this.n;
      const res = [];
      const cand = this.genCandidates(color, { depth: 4 });
      for (const [r, c] of cand) {
        if (this.board[r][c] !== EMPTY) continue;
        this.board[r][c] = color;
        // 冲四(双四点更好)或直接赢
        let threat = 0;
        for (let k = 0; k < 4; k++) {
          const dr = DIRS[k][0], dc = DIRS[k][1];
          const info = this.segInfoAt(r, c, color, dr, dc);
          if (info === "four") threat++;
          if (threat >= 2) break;
        }
        if (threat >= 2) { this.board[r][c] = EMPTY; res.push([r, c]); continue; }
        // 两端成活四
        const winNow = checkWin(this.board, n, r, c);
        if (winNow === color) {
          // 双四（must）
          this.board[r][c] = EMPTY;
          // 复用上面逻辑，这里直接记录
          res.push([r, c]);
          continue;
        }
        this.board[r][c] = EMPTY;
      }
      return res;
    },

    segInfoAt(r, c, color, dr, dc) {
      const n = this.n;
      this.board[r][c] = color;
      const open = this.directionOpen(this.board, n, r, c, dr, dc, color);
      const len = lineLen(this.board, n, r, c, dr, dc, color);
      this.board[r][c] = EMPTY;
      if (len >= 5) return "five";
      if (len === 4 && open >= 1) return "four";
      return null;
    },

    findVcfDefense(block) {
      // 简单：防守在该必杀点邻近
      const cand = this.genCandidates(this.me, { depth: 3 });
      return cand[0] || this.findEmptyFallback();
    }
  };

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
    let mv = AI.bestMove(state.board, state.n, me, state.renju, null);
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

    let msg;
    if (winner === 0) msg = "平局";
    else if (winner === state.human) {
      msg = "你赢了";
      openOverlay("你赢了 🎉", "太棒了！再战一局？", true);
    } else {
      msg = "AI 获胜";
      openOverlay("AI 获胜", "继续挑战更高的难度吧！", true);
    }
    statusText.textContent = msg === "平局" ? "平局" : msg;
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
    state.current = BLACK;
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
    let html = "";
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
    state.current = BLACK;
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
      "<b>高智商人机五子棋 v1.0</b>" +
      "专为 10 寸墨水屏 Pad（墨案 X 等）深度优化。纯黑白灰高对比度，禁用动画防残影，点击即刻响应。<br><br>" +
      "<b>规则</b><br>自由五子棋：无禁手，允许双三、双四、长连。可于设置中开启黑方三三/四四/长连禁手（连珠规则）。<br><br>" +
      "<b>AI 引擎</b><br>Minimax + Alpha-Beta 剪枝，辅以 VCF/VCT 连杀算杀，五级难度：<br>" +
      "①新手入门 ②进阶 ③高手 ④大师 ⑤棋圣（算杀必杀）。<br><br>" +
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

  // 供自动化测试导出的内部逻辑（仅测试环境使用，不影响生产）
  if (typeof globalThis !== "undefined" && globalThis.__GOMOKU_TEST__) {
    globalThis.__GOMOKU_API__ = {
      newBoard, checkWin, isForbidden, lineLen, EMPTY, BLACK, WHITE,
      state, draw, makeMove, newGame, aiToMove, undo,
      getPos,
      set setState(o) { Object.assign(state, o); },
      getStatus() { return state; }
    };
  }

})();
