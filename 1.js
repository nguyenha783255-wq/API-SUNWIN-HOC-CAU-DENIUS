
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = 'https://sunwin-taixiu-dulieu.onrender.com/data';
const HISTORY_LIMIT = 300;

const vnNow = () => {
    const d = new Date();
    return new Date(d.getTime() + (7 * 60 * 60 * 1000)).toISOString();
};

let stats = {
    total: 0,
    correct: 0,
    wrong: 0,
    last_prediction: null,
    start_time: vnNow(),
    history: [],
    total_predictions_made: 0,
    prediction_started: false
};

class TX_LogicPen_V4 {
    constructor() {
        this.error_streak = 0;
        this.last_prediction = null;
        this.history = [];
    }

    loadData(data) {
        this.history = [...data].sort((a, b) => (b.phien || 0) - (a.phien || 0));
    }

    _arr() {
        return this.history.map(s =>
            (s.ket_qua || '').toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI')
        );
    }

    _points() {
        return this.history
            .filter(s => s.tong !== undefined && s.tong !== null)
            .map(s => s.tong);
    }

    cauSap(arr) {
        if (arr.length < 2) return null;
        let length = 1;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] === arr[0]) length++;
            else break;
        }
        if (length >= 2 && length <= 5) {
            return { pred: arr[0], conf: 72, type: "Đu Bệt", reason: `Bệt ${length} phiên` };
        }
        if (length >= 6) {
            return { pred: arr[0] === "TAI" ? "XIU" : "TAI", conf: 80, type: "Bẻ Bệt Rồng", reason: `Bệt dài ${length} → hồi` };
        }
        return null;
    }

    cauNoi(arr) {
        if (arr.length < 5) return null;
        for (let i = 0; i < 4; i++) {
            if (arr[i] === arr[i + 1]) return null;
        }
        return { pred: arr[0] === "TAI" ? "XIU" : "TAI", conf: 82, type: "Cầu Nối 1-1", reason: "Nhịp 1-1 ổn định" };
    }

    cauDoi(arr) {
        if (arr.length < 4) return null;
        if (arr[0] === arr[1] && arr[2] === arr[3] && arr[0] !== arr[2]) {
            return { pred: arr[2], conf: 78, type: "Cầu 2-2", reason: "AABB → B" };
        }
        if (arr.length >= 6 && arr[0] === arr[1] && arr[1] === arr[2] &&
            arr[3] === arr[4] && arr[4] === arr[5] && arr[0] !== arr[3]) {
            return { pred: arr[3], conf: 80, type: "Cầu 3-3", reason: "AAABBB → B" };
        }
        return null;
    }

    cauGay(arr) {
        if (arr.length >= 5 && arr[0] === arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[3] === arr[4]) {
            return { pred: arr[3], conf: 74, type: "Gãy 3-2", reason: "AAABB → B" };
        }
        if (arr.length >= 5 && arr[0] === arr[1] && arr[1] !== arr[2] && arr[2] === arr[3] && arr[3] === arr[4]) {
            return { pred: arr[2], conf: 74, type: "Gãy 2-3", reason: "AABBB → B" };
        }
        if (arr.length >= 4 && arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[0] === arr[3]) {
            return { pred: arr[1], conf: 72, type: "Gãy 1-2-1", reason: "ABBA → B" };
        }
        return null;
    }

    phatHienMauLap(arr) {
        if (arr.length < 6) return null;
        for (let len = 2; len <= 4; len++) {
            let pattern = arr.slice(0, len);
            for (let i = len; i < arr.length - len; i++) {
                let sub = arr.slice(i, i + len);
                if (JSON.stringify(sub) === JSON.stringify(pattern) && arr[i - 1]) {
                    return { pred: arr[i - 1], conf: 88, type: "Mẫu Lặp", reason: `Mẫu "${pattern.join(',')}"` };
                }
            }
        }
        return null;
    }

    duDoanVi() {
        const points = this._points();
        if (points.length < 5) return null;
        const last = points[0], prev = points[1];
        const slice = points.slice(0, 5);
        const avg = slice.reduce((a, b) => a + b, 0) / slice.length;

        if (last >= 15) return { pred: "XIU", conf: 75, type: "Vị cực đại", reason: `Điểm ${last} → hồi Xỉu` };
        if (last <= 5) return { pred: "TAI", conf: 75, type: "Vị cực tiểu", reason: `Điểm ${last} → hồi Tài` };
        if (avg > 11 && last > prev) return { pred: "XIU", conf: 68, type: "Vị bão hòa", reason: "Đà tăng chạm ngưỡng" };
        if (avg < 10 && last < prev) return { pred: "TAI", conf: 68, type: "Vị cạn kiệt", reason: "Đà giảm chạm đáy" };
        if (avg >= 11 && last >= 11 && last <= 13) return { pred: "TAI", conf: 65, type: "Vị ổn định", reason: "Duy trì Tài nhẹ" };
        if (avg <= 9 && last >= 7 && last <= 9) return { pred: "XIU", conf: 65, type: "Vị ổn định", reason: "Duy trì Xỉu nhẹ" };
        return null;
    }

    tongHopDuDoan() {
        const arr = this._arr();
        if (arr.length < 2) return null;
        return this.phatHienMauLap(arr) || this.cauNoi(arr) || this.cauDoi(arr) ||
               this.cauGay(arr) || this.cauSap(arr) || this.duDoanVi() ||
               { pred: arr[0], conf: 55, type: "Theo", reason: "Bám phiên cuối" };
    }

    apDungDaoChieu(p) {
        if (!p || this.history.length < 1) return p;
        const currentResult = this._arr()[0];
        if (this.error_streak >= 2 && this.last_prediction && this.last_prediction !== currentResult) {
            return {
                ...p,
                pred: p.pred === "TAI" ? "XIU" : "TAI",
                conf: Math.min(88, p.conf + 10),
                reason: `🔄 Đảo: ${p.reason}`
            };
        }
        return p;
    }

    predict(data) {
        this.loadData(data);
        let result = this.tongHopDuDoan();
        if (result) result = this.apDungDaoChieu(result);
        else result = { pred: this._arr()[0] || "TAI", conf: 50, type: "Theo", reason: "Không đủ dữ liệu" };

        this.last_prediction = result.pred;
        return result;
    }

    updateStatus(actual) {
        if (this.last_prediction) {
            const a = actual.toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI');
            if (this.last_prediction === a) this.error_streak = 0;
            else this.error_streak++;
        }
    }
}

const engine = new TX_LogicPen_V4();

let lastData = [];
let lastPrediction = null;
let predictionLog = [];

async function fetchAndAnalyze() {
    try {
        const res = await axios.get(API_URL, { timeout: 12000 });
        const raw = res.data;

        if (!raw || !raw.data || !Array.isArray(raw.data)) {
            console.log('API trả dữ liệu không hợp lệ');
            return;
        }

        const data = raw.data
            .filter(i => i.phien && i.ket_qua)
            .sort((a, b) => b.phien - a.phien)
            .slice(0, HISTORY_LIMIT);

        lastData = data;

        if (lastPrediction && data.length > 0) {
            const newest = data[0];
            if (newest.phien === lastPrediction.phienDuDoan) {
                const actualRaw = newest.ket_qua;
                const actual = actualRaw.toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI');
                const isCorrect = lastPrediction.pred === actual;

                engine.updateStatus(actualRaw);

                predictionLog.unshift({
                    phien: newest.phien,
                    predict: lastPrediction.pred,
                    actual: actual,
                    confidence: lastPrediction.conf,
                    type: lastPrediction.type,
                    correct: isCorrect,
                    time: newest.thoi_gian || vnNow()
                });
                if (predictionLog.length > 80) predictionLog.pop();

                stats.total++;
                if (isCorrect) stats.correct++;
                else stats.wrong++;
                stats.total_predictions_made++;
                stats.last_prediction = lastPrediction.pred;

                console.log(`[Kết quả] #${newest.phien} | Dự: ${lastPrediction.pred} → Thực: ${actual} → ${isCorrect ? 'ĐÚNG' : 'SAI'} | Streak lỗi: ${engine.error_streak}`);

                lastPrediction = null;
            }
        }

        if (data.length >= 5) {
            const result = engine.predict(data);
            const nextPhien = data[0].phien + 1;
            const displayPred = result.pred === 'TAI' ? 'Tài' : 'Xỉu';

            lastPrediction = {
                phienDuDoan: nextPhien,
                pred: result.pred,
                display: displayPred,
                conf: result.conf,
                type: result.type,
                reason: result.reason,
                timestamp: vnNow()
            };

            stats.prediction_started = true;

            console.log(`[Dự đoán] #${nextPhien} → \( {displayPred} ( \){result.conf}%) | ${result.type} | ${result.reason}`);
        }
    } catch (err) {
        console.error('Lỗi fetch API:', err.message);
    }
}

fetchAndAnalyze();
setInterval(fetchAndAnalyze, 25000);

// ====================== DASHBOARD CYBER ======================
app.get('/', (req, res) => {
    const html = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>| CYBER CORE</title>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #05070f;
      --card: rgba(10, 16, 32, 0.85);
      --border: rgba(0, 240, 255, 0.25);
      --cyan: #00f0ff;
      --magenta: #ff00aa;
      --green: #00ff9d;
      --red: #ff2a6d;
      --yellow: #fcee0a;
      --text: #e0f7ff;
      --muted: #7a9bb8;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Rajdhani', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      overflow-x: hidden;
      background-image: 
        radial-gradient(ellipse at 20% 20%, rgba(0, 240, 255, 0.08) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 80%, rgba(255, 0, 170, 0.06) 0%, transparent 50%),
        linear-gradient(180deg, #05070f 0%, #0a0f1c 100%);
    }

    /* Grid background */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image: 
        linear-gradient(rgba(0, 240, 255, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 240, 255, 0.03) 1px, transparent 1px);
      background-size: 40px 40px;
      pointer-events: none;
      z-index: 0;
    }

    .container {
      position: relative;
      z-index: 1;
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px 20px 50px;
    }

    /* Header */
    header {
      text-align: center;
      margin-bottom: 32px;
      position: relative;
    }

    .logo {
      font-family: 'Orbitron', sans-serif;
      font-size: 2.1rem;
      font-weight: 800;
      letter-spacing: 4px;
      background: linear-gradient(90deg, var(--cyan), #ffffff, var(--magenta));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-shadow: 0 0 30px rgba(0, 240, 255, 0.4);
      margin-bottom: 6px;
    }

    .tagline {
      font-size: 0.95rem;
      color: var(--muted);
      letter-spacing: 2px;
      text-transform: uppercase;
    }

    .status-bar {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 14px;
      padding: 6px 16px;
      background: rgba(0, 240, 255, 0.08);
      border: 1px solid rgba(0, 240, 255, 0.3);
      border-radius: 999px;
      font-size: 0.8rem;
      color: var(--cyan);
    }

    .pulse {
      width: 8px;
      height: 8px;
      background: var(--green);
      border-radius: 50%;
      box-shadow: 0 0 10px var(--green);
      animation: pulse 1.6s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }

    /* Grid layout */
    .grid {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }

    @media (max-width: 860px) {
      .grid { grid-template-columns: 1fr; }
      .logo { font-size: 1.6rem; letter-spacing: 2px; }
    }

    /* Card */
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 22px;
      position: relative;
      backdrop-filter: blur(12px);
      box-shadow: 
        0 0 0 1px rgba(0, 240, 255, 0.05),
        0 10px 40px rgba(0, 0, 0, 0.4),
        inset 0 1px 0 rgba(255, 255, 255, 0.03);
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--cyan), var(--magenta), transparent);
      opacity: 0.7;
    }

    .card-title {
      font-family: 'Orbitron', sans-serif;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 2px;
      color: var(--cyan);
      text-transform: uppercase;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card-title::before {
      content: '';
      width: 6px;
      height: 6px;
      background: var(--cyan);
      box-shadow: 0 0 8px var(--cyan);
    }

    /* Prediction */
    .pred-value {
      font-family: 'Orbitron', sans-serif;
      font-size: 3.2rem;
      font-weight: 800;
      letter-spacing: 3px;
      line-height: 1;
      margin-bottom: 8px;
      text-shadow: 0 0 40px currentColor;
    }

    .pred-tai { color: var(--green); }
    .pred-xiu { color: var(--red); }

    .pred-conf {
      font-family: 'Orbitron', sans-serif;
      font-size: 1.5rem;
      color: var(--yellow);
      margin-bottom: 14px;
    }

    .pred-meta {
      font-size: 0.95rem;
      color: var(--muted);
      line-height: 1.6;
    }

    .pred-meta span {
      color: var(--text);
    }

    /* Stats */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
    }

    .stat-box {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(0, 240, 255, 0.15);
      border-radius: 12px;
      padding: 14px 10px;
      text-align: center;
    }

    .stat-num {
      font-family: 'Orbitron', sans-serif;
      font-size: 1.7rem;
      font-weight: 700;
      margin-bottom: 2px;
    }

    .stat-label {
      font-size: 0.75rem;
      color: var(--muted);
      letter-spacing: 1px;
      text-transform: uppercase;
    }

    .ok { color: var(--green); }
    .err { color: var(--red); }
    .acc { color: var(--cyan); }

    .streak-box {
      margin-top: 16px;
      padding: 10px 14px;
      background: rgba(255, 42, 109, 0.08);
      border: 1px solid rgba(255, 42, 109, 0.25);
      border-radius: 10px;
      font-size: 0.9rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* History table */
    .table-wrap {
      overflow-x: auto;
      margin-top: 4px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.92rem;
    }

    th {
      font-family: 'Orbitron', sans-serif;
      font-size: 0.68rem;
      letter-spacing: 1.5px;
      color: var(--cyan);
      text-align: left;
      padding: 10px 8px;
      border-bottom: 1px solid rgba(0, 240, 255, 0.2);
      text-transform: uppercase;
    }

    td {
      padding: 11px 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text);
    }

    tr:hover td {
      background: rgba(0, 240, 255, 0.04);
    }

    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 6px;
      font-family: 'Orbitron', sans-serif;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    .b-tai {
      background: rgba(0, 255, 157, 0.15);
      color: var(--green);
      border: 1px solid rgba(0, 255, 157, 0.35);
    }

    .b-xiu {
      background: rgba(255, 42, 109, 0.15);
      color: var(--red);
      border: 1px solid rgba(255, 42, 109, 0.35);
    }

    .result-ok { color: var(--green); font-weight: 600; }
    .result-err { color: var(--red); font-weight: 600; }

    /* Footer */
    footer {
      text-align: center;
      margin-top: 28px;
      font-size: 0.8rem;
      color: var(--muted);
      letter-spacing: 1px;
    }

    /* Scanline effect */
    .scanline {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(
        to bottom,
        transparent 50%,
        rgba(0, 240, 255, 0.015) 50%
      );
      background-size: 100% 4px;
      pointer-events: none;
      z-index: 999;
      animation: scan 8s linear infinite;
    }

    @keyframes scan {
      0% { background-position: 0 0; }
      100% { background-position: 0 100%; }
    }
  </style>
</head>
<body>
  <div class="scanline"></div>

  <div class="container">
    <header>
      <div class="logo">Sunwin Vip</div>
      <div class="tagline">Cyber Neural Prediction Core</div>
      <div class="status-bar">
        <div class="pulse"></div>
        <span>SYSTEM ONLINE </span>
      </div>
    </header>

    <div class="grid">
      <!-- Prediction Card -->
      <div class="card">
        <div class="card-title">Next Session Prediction</div>
        <div id="pred" class="pred-value">---</div>
        <div id="conf" class="pred-conf">--%</div>
        <div class="pred-meta">
          <div>Phiên: <span id="phien">#---</span></div>
          <div>Loại cầu: <span id="type">---</span></div>
          <div style="margin-top:6px" id="reason">Đang phân tích tín hiệu...</div>
        </div>
      </div>

      <!-- Stats Card -->
      <div class="card">
        <div class="card-title">Performance Matrix</div>
        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-num" id="total">0</div>
            <div class="stat-label">Total</div>
          </div>
          <div class="stat-box">
            <div class="stat-num ok" id="correct">0</div>
            <div class="stat-label">Correct</div>
          </div>
          <div class="stat-box">
            <div class="stat-num err" id="wrong">0</div>
            <div class="stat-label">Wrong</div>
          </div>
          <div class="stat-box">
            <div class="stat-num acc" id="acc">0%</div>
            <div class="stat-label">Accuracy</div>
          </div>
        </div>
        <div class="streak-box">
          <span>ERROR STREAK</span>
          <span id="streak" style="font-family:'Orbitron';font-weight:700;color:var(--red)">0</span>
        </div>
      </div>
    </div>

    <!-- History -->
    <div class="card">
      <div class="card-title">Prediction History Log</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Phiên</th>
              <th>Dự đoán</th>
              <th>Thực tế</th>
              <th>Conf</th>
              <th>Loại</th>
              <th>Kết quả</th>
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="6" style="color:var(--muted);padding:20px;text-align:center">Awaiting data stream...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <footer>
      AUTO-SYNC EVERY 8s · NEURAL ENGINE ACTIVE
    </footer>
  </div>

  <script>
    async function load() {
      try {
        const r = await fetch('/api/dashboard');
        const d = await r.json();

        if (d.prediction) {
          const p = d.prediction;
          const el = document.getElementById('pred');
          el.textContent = p.display;
          el.className = 'pred-value ' + (p.display === 'Tài' ? 'pred-tai' : 'pred-xiu');
          document.getElementById('conf').textContent = p.conf + '%';
          document.getElementById('phien').textContent = '#' + p.phienDuDoan;
          document.getElementById('type').textContent = p.type || '---';
          document.getElementById('reason').textContent = p.reason || '';
        }

        document.getElementById('total').textContent = d.stats.total;
        document.getElementById('correct').textContent = d.stats.correct;
        document.getElementById('wrong').textContent = d.stats.wrong;
        const acc = d.stats.total > 0 ? ((d.stats.correct / d.stats.total) * 100).toFixed(1) : 0;
        document.getElementById('acc').textContent = acc + '%';
        document.getElementById('streak').textContent = d.error_streak || 0;

        const tb = document.getElementById('tbody');
        if (d.log && d.log.length) {
          tb.innerHTML = d.log.map(i => \`
            <tr>
              <td>#\${i.phien}</td>
              <td><span class="badge \${i.predict==='TAI'?'b-tai':'b-xiu'}">\${i.predict==='TAI'?'TÀI':'XỈU'}</span></td>
              <td><span class="badge \${i.actual==='TAI'?'b-tai':'b-xiu'}">\${i.actual==='TAI'?'TÀI':'XỈU'}</span></td>
              <td>\${i.confidence}%</td>
              <td style="color:var(--muted)">\${i.type||''}</td>
              <td class="\${i.correct?'result-ok':'result-err'}">\${i.correct?'ĐÚNG':'SAI'}</td>
            </tr>
          \`).join('');
        }
      } catch(e) {
        console.error(e);
      }
    }

    load();
    setInterval(load, 8000);
  </script>
</body>
</html>`;
    res.send(html);
});

app.get('/api/dashboard', (req, res) => {
    res.json({
        prediction: lastPrediction,
        stats,
        log: predictionLog.slice(0, 40),
        error_streak: engine.error_streak,
        lastUpdate: vnNow(),
        dataCount: lastData.length
    });
});

app.get('/api/raw', (req, res) => {
    res.json({ data: lastData.slice(0, 30) });
});

app.listen(PORT, () => {
    console.log(\`Server chạy tại http://localhost:\${PORT}\`);
    console.log('Dashboard Cyber UI: http://localhost:' + PORT);
});