const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SOURCE_URL =
  "https://kwinstore.com/sunwin/tx/history/b54b32ca9f748d5dbe64f421f14f1f04fa8d30012b17d0f5?t=1785972733235";

const ADMIN = "@DENIUS09";
const POLL_MS = 8000;

/*
==========================================================
 DENIUS PERSISTENT EXPERIENCE AI
 ---------------------------------------------------------
 KHÔNG DÙNG:
 - Monte Carlo
 - Markov Chain
 - Bayesian cũ
 - Ensemble 35/35/30
 - Math.random()
 - thay đổi trọng số kiểu cũ

 KIẾN TRÚC:
 - Persistent Experience Memory
 - Case Based Reasoning
 - Sequence Fingerprint
 - Pattern Discovery
 - Similar Case Retrieval
 - Outcome Memory
 - Contradiction Analysis
 - Online Experience Accumulation
==========================================================
*/

if (!process.env.DATABASE_URL) {
  console.error("");
  console.error("================================================");
  console.error("DATABASE_URL CHƯA ĐƯỢC CẤU HÌNH");
  console.error("Render cần PostgreSQL để AI KHÔNG BỊ RESET.");
  console.error("================================================");
  console.error("");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : undefined
});

let memoryFallback = {
  predictions: new Map(),
  experiences: []
};

let workerRunning = false;
let lastSourceSession = null;
let lastWorkerAt = null;
let lastError = null;


/* ========================================================
   DATABASE
======================================================== */

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn("[DB] Chạy fallback memory - DỮ LIỆU CÓ THỂ RESET.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tx_predictions (
      id BIGSERIAL PRIMARY KEY,

      session_id BIGINT UNIQUE NOT NULL,

      prediction TEXT NOT NULL,
      confidence NUMERIC(6,2) NOT NULL DEFAULT 0,

      status TEXT NOT NULL DEFAULT 'WAITING',

      actual_result TEXT,
      d1 INTEGER,
      d2 INTEGER,
      d3 INTEGER,
      total INTEGER,

      feature_snapshot JSONB,
      reasoning JSONB,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_tx_predictions_session
    ON tx_predictions(session_id DESC);

    CREATE INDEX IF NOT EXISTS idx_tx_predictions_status
    ON tx_predictions(status);

    CREATE TABLE IF NOT EXISTS tx_experiences (
      id BIGSERIAL PRIMARY KEY,

      session_id BIGINT UNIQUE NOT NULL,

      result TEXT NOT NULL,

      d1 INTEGER,
      d2 INTEGER,
      d3 INTEGER,
      total INTEGER,

      context JSONB NOT NULL,
      fingerprint TEXT NOT NULL,

      prediction TEXT,
      prediction_correct BOOLEAN,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      learned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_tx_exp_session
    ON tx_experiences(session_id DESC);

    CREATE INDEX IF NOT EXISTS idx_tx_exp_fingerprint
    ON tx_experiences(fingerprint);

    CREATE INDEX IF NOT EXISTS idx_tx_exp_result
    ON tx_experiences(result);
  `);

  console.log("[DB] Persistent Experience Memory: ONLINE");
}


/* ========================================================
   SOURCE
======================================================== */

async function fetchSource() {
  const separator = SOURCE_URL.includes("?") ? "&" : "?";

  const url =
    SOURCE_URL +
    separator +
    "_=" +
    Date.now();

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "User-Agent": "DENIUS-PERSISTENT-AI/3.0"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(
      `SOURCE_HTTP_${response.status}`
    );
  }

  const json = await response.json();

  if (!json || !Array.isArray(json.data)) {
    throw new Error("SOURCE_INVALID_DATA");
  }

  return normalizeSource(json.data);
}


/* ========================================================
   NORMALIZE
======================================================== */

function normalizeSource(rows) {
  const result = [];

  for (const row of rows) {
    const session = Number(row["phiên"]);

    const d1 = Number(row.d1);
    const d2 = Number(row.d2);
    const d3 = Number(row.d3);

    const total = Number(row["tổng"]);

    const rawResult = String(
      row["kết quả"] || ""
    ).trim();

    let outcome = null;

    if (/^tài$/i.test(rawResult)) {
      outcome = "Tài";
    }

    if (/^xỉu$/i.test(rawResult)) {
      outcome = "Xỉu";
    }

    if (
      !Number.isFinite(session) ||
      !Number.isFinite(d1) ||
      !Number.isFinite(d2) ||
      !Number.isFinite(d3) ||
      !Number.isFinite(total) ||
      !outcome
    ) {
      continue;
    }

    result.push({
      session,
      d1,
      d2,
      d3,
      total,
      result: outcome
    });
  }

  result.sort((a, b) => a.session - b.session);

  return result;
}


/* ========================================================
   FEATURE ENGINE
======================================================== */

function sideOf(total) {
  return total >= 11 ? "Tài" : "Xỉu";
}

function parity(n) {
  return n % 2 === 0 ? "E" : "O";
}

function diceShape(d1, d2, d3) {
  const sorted = [d1, d2, d3].sort((a, b) => a - b);

  if (
    sorted[0] === sorted[1] &&
    sorted[1] === sorted[2]
  ) {
    return "TRIPLE";
  }

  if (
    sorted[0] === sorted[1] ||
    sorted[1] === sorted[2]
  ) {
    return "PAIR";
  }

  return "NORMAL";
}

function rangeOf(total) {
  if (total <= 6) return "LOW";
  if (total <= 10) return "MID_LOW";
  if (total <= 14) return "MID_HIGH";
  return "HIGH";
}

function streakLength(history) {
  if (!history.length) return 0;

  const last = history[history.length - 1].result;

  let count = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].result !== last) break;
    count++;
  }

  return count;
}

function alternateLength(history) {
  if (history.length < 2) return 0;

  let count = 1;

  for (
    let i = history.length - 1;
    i > 0;
    i--
  ) {
    if (
      history[i].result ===
      history[i - 1].result
    ) {
      break;
    }

    count++;
  }

  return count;
}


/*
  Fingerprint không phải hash dự đoán.
  Nó là "dấu vân tay tình huống" để tìm case tương tự.
*/

function buildFingerprint(history) {
  if (!history.length) return "EMPTY";

  const recent = history.slice(-12);

  const resultSeq = recent
    .map(x => x.result === "Tài" ? "T" : "X")
    .join("");

  const paritySeq = recent
    .map(x => parity(x.total))
    .join("");

  const rangeSeq = recent
    .map(x => rangeOf(x.total))
    .join("|");

  const last = recent[recent.length - 1];

  const shape = diceShape(
    last.d1,
    last.d2,
    last.d3
  );

  return [
    resultSeq,
    paritySeq,
    rangeSeq,
    shape
  ].join("::");
}


function extractContext(history) {
  if (!history.length) {
    return {
      sequence: "",
      totals: [],
      dice: [],
      parities: [],
      ranges: [],
      streak: 0,
      alternating: 0,
      fingerprint: "EMPTY"
    };
  }

  const recent = history.slice(-30);

  return {
    sequence: recent.map(x =>
      x.result === "Tài" ? "T" : "X"
    ),

    totals: recent.map(x => x.total),

    dice: recent.map(x => [
      x.d1,
      x.d2,
      x.d3
    ]),

    parities: recent.map(x =>
      parity(x.total)
    ),

    ranges: recent.map(x =>
      rangeOf(x.total)
    ),

    streak: streakLength(recent),

    alternating: alternateLength(recent),

    fingerprint: buildFingerprint(recent)
  };
}


/* ========================================================
   SEQUENCE REASONING
======================================================== */

function makeSequence(history, length) {
  return history
    .slice(-length)
    .map(x =>
      x.result === "Tài" ? "T" : "X"
    )
    .join("");
}


/*
  Tìm các đoạn lịch sử trong chính dữ liệu hiện tại
  có cùng chuỗi bối cảnh.

  Ví dụ:
      T X T T X
      ...
      T X T T X -> T
      T X T T X -> X

  AI xem những tình huống từng xảy ra như "kinh nghiệm".
*/

function discoverSequencePatterns(history) {
  const patterns = [];

  for (const size of [3, 4, 5, 6, 7, 8]) {
    if (history.length <= size) continue;

    for (
      let i = 0;
      i + size < history.length;
      i++
    ) {
      const seq = history
        .slice(i, i + size)
        .map(x =>
          x.result === "Tài" ? "T" : "X"
        )
        .join("");

      const next = history[i + size].result;

      patterns.push({
        sequence: seq,
        next,
        session: history[i + size].session
      });
    }
  }

  return patterns;
}


/* ========================================================
   DATABASE EXPERIENCE
======================================================== */

async function countExperiences() {
  if (!process.env.DATABASE_URL) {
    return memoryFallback.experiences.length;
  }

  const r = await pool.query(`
    SELECT COUNT(*)::BIGINT AS count
    FROM tx_experiences
  `);

  return Number(r.rows[0].count);
}


/*
  Lấy toàn bộ knowledge cần thiết theo từng tầng.

  DB vẫn lưu VÔ HẠN theo khả năng lưu trữ của database.
  Khi suy luận, hệ thống không kéo hàng triệu dòng vào RAM
  một lúc; nó truy xuất các kinh nghiệm liên quan.
*/

async function loadExperienceMemory(currentHistory) {
  if (!process.env.DATABASE_URL) {
    return memoryFallback.experiences;
  }

  const fingerprint =
    buildFingerprint(currentHistory);

  const exact = await pool.query(
    `
    SELECT *
    FROM tx_experiences
    WHERE fingerprint = $1
    ORDER BY session_id DESC
    LIMIT 500
    `,
    [fingerprint]
  );

  const recent = await pool.query(`
    SELECT *
    FROM tx_experiences
    ORDER BY session_id DESC
    LIMIT 1000
  `);

  const map = new Map();

  for (const row of [
    ...exact.rows,
    ...recent.rows
  ]) {
    map.set(row.session_id, row);
  }

  return [...map.values()];
}


/* ========================================================
   EXPERIENCE SIMILARITY
======================================================== */

function sequenceSimilarity(a, b) {
  if (!a || !b) return 0;

  const n = Math.min(
    a.length,
    b.length
  );

  if (!n) return 0;

  let same = 0;

  for (let i = 1; i <= n; i++) {
    if (
      a[a.length - i] ===
      b[b.length - i]
    ) {
      same++;
    }
  }

  return same / n;
}


function numericSimilarity(a, b) {
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b)
  ) {
    return 0;
  }

  const difference =
    Math.abs(a - b);

  return Math.max(
    0,
    1 - difference / 18
  );
}


function contextSimilarity(
  current,
  experience
) {
  const context =
    experience.context || {};

  const currentSeq =
    Array.isArray(current.sequence)
      ? current.sequence.join("")
      : "";

  const oldSeq =
    Array.isArray(context.sequence)
      ? context.sequence.join("")
      : "";

  const seqScore =
    sequenceSimilarity(
      currentSeq,
      oldSeq
    );

  const currentTotals =
    current.totals || [];

  const oldTotals =
    context.totals || [];

  const currentLast =
    currentTotals.length
      ? currentTotals[currentTotals.length - 1]
      : null;

  const oldLast =
    oldTotals.length
      ? oldTotals[oldTotals.length - 1]
      : null;

  const totalScore =
    numericSimilarity(
      currentLast,
      oldLast
    );

  const streakScore =
    Math.max(
      0,
      1 -
        Math.abs(
          Number(current.streak || 0) -
          Number(context.streak || 0)
        ) /
          10
    );

  const altScore =
    Math.max(
      0,
      1 -
        Math.abs(
          Number(current.alternating || 0) -
          Number(context.alternating || 0)
        ) /
          10
    );

  /*
    Không phải "vote".
    Đây là đo mức tương đồng của case hiện tại
    với case lịch sử.
  */

  return (
    seqScore * 0.50 +
    totalScore * 0.20 +
    streakScore * 0.15 +
    altScore * 0.15
  );
}


/* ========================================================
   RETRIEVE SIMILAR EXPERIENCES
======================================================== */

function retrieveSimilarExperiences(
  currentContext,
  experiences
) {
  return experiences
    .map(exp => ({
      ...exp,
      similarity:
        contextSimilarity(
          currentContext,
          exp
        )
    }))
    .filter(x =>
      x.similarity >= 0.35
    )
    .sort(
      (a, b) =>
        b.similarity -
        a.similarity
    )
    .slice(0, 100);
}


/* ========================================================
   PATTERN ANALYSIS
======================================================== */

function analyzePatterns(
  history,
  currentContext
) {
  const discovered =
    discoverSequencePatterns(
      history
    );

  const results = [];

  for (
    const size of [3, 4, 5, 6, 7, 8]
  ) {
    const seq =
      makeSequence(
        history,
        size
      );

    if (!seq) continue;

    const matches =
      discovered.filter(
        p => p.sequence === seq
      );

    if (!matches.length) continue;

    let tai = 0;
    let xiu = 0;

    for (const match of matches) {
      if (match.next === "Tài") {
        tai++;
      } else {
        xiu++;
      }
    }

    results.push({
      size,
      sequence: seq,
      occurrences: matches.length,
      tai,
      xiu,
      strength:
        matches.length >= 2
          ? Math.min(
              1,
              matches.length / 10
            )
          : 0
    });
  }

  return results.sort(
    (a, b) =>
      b.size - a.size ||
      b.occurrences -
        a.occurrences
  );
}


/* ========================================================
   CONTRADICTION ENGINE
======================================================== */

function contradictionAnalysis(
  similar,
  patterns
) {
  let taiEvidence = 0;
  let xiuEvidence = 0;

  for (const item of similar) {
    const strength =
      Number(
        item.similarity || 0
      );

    if (item.result === "Tài") {
      taiEvidence += strength;
    } else if (
      item.result === "Xỉu"
    ) {
      xiuEvidence += strength;
    }
  }

  for (const pattern of patterns) {
    const strength =
      Number(
        pattern.strength || 0
      );

    if (pattern.tai > pattern.xiu) {
      taiEvidence += strength;
    }

    if (pattern.xiu > pattern.tai) {
      xiuEvidence += strength;
    }
  }

  const difference =
    Math.abs(
      taiEvidence -
      xiuEvidence
    );

  const contradiction =
    taiEvidence > 0 &&
    xiuEvidence > 0 &&
    difference <
      Math.max(
        taiEvidence,
        xiuEvidence
      ) *
        0.15;

  return {
    taiEvidence,
    xiuEvidence,
    contradiction
  };
}


/* ========================================================
   EXPERIENCE AI CORE
======================================================== */

async function think(history) {
  if (!history.length) {
    return {
      prediction: "Tài",
      confidence: 0,
      reasoning: {
        mode: "NO_DATA"
      }
    };
  }

  const context =
    extractContext(history);

  const experiences =
    await loadExperienceMemory(
      history
    );

  const similar =
    retrieveSimilarExperiences(
      context,
      experiences
    );

  const patterns =
    analyzePatterns(
      history,
      context
    );

  const contradiction =
    contradictionAnalysis(
      similar,
      patterns
    );

  /*
    Đây là reasoning dựa trên kinh nghiệm,
    KHÔNG phải cơ chế bầu cử đơn giản.

    AI tìm:
      1. case tương tự
      2. pattern trùng
      3. độ tương đồng
      4. mức mâu thuẫn
      5. chất lượng ký ức

    Sau đó tạo một "decision field".
  */

  let taiSignal =
    contradiction.taiEvidence;

  let xiuSignal =
    contradiction.xiuEvidence;

  /*
    Pattern càng dài và từng xuất hiện nhiều,
    càng có giá trị mô tả tình huống.
  */

  for (const p of patterns) {
    const occurrenceFactor =
      Math.min(
        1,
        p.occurrences / 8
      );

    const sequenceFactor =
      Math.min(
        1,
        p.size / 8
      );

    const signal =
      occurrenceFactor *
      sequenceFactor;

    if (p.tai > p.xiu) {
      taiSignal += signal;
    }

    if (p.xiu > p.tai) {
      xiuSignal += signal;
    }
  }

  /*
    Nếu ký ức tương tự cực kỳ rõ,
    tăng mức tin tưởng vào case retrieval.
  */

  const strongest =
    similar.length
      ? similar[0].similarity
      : 0;

  const evidenceTotal =
    taiSignal +
    xiuSignal;

  let prediction = "Tài";

  if (
    xiuSignal >
    taiSignal
  ) {
    prediction = "Xỉu";
  }

  /*
    Confidence không phải xác suất thắng thật.
    Nó là độ chắc chắn nội bộ của hệ thống.
  */

  let confidence = 0;

  if (evidenceTotal > 0) {
    confidence =
      Math.abs(
        taiSignal -
        xiuSignal
      ) /
      evidenceTotal;
  }

  confidence =
    confidence * 0.75 +
    strongest * 0.25;

  if (
    contradiction.contradiction
  ) {
    confidence *= 0.70;
  }

  confidence = Math.max(
    0,
    Math.min(
      0.99,
      confidence
    )
  );

  return {
    prediction,
    confidence:
      Number(
        (confidence * 100)
          .toFixed(2)
      ),

    reasoning: {
      engine:
        "DENIUS_PERSISTENT_EXPERIENCE_AI",

      memoryCount:
        experiences.length,

      similarCases:
        similar.length,

      strongestSimilarity:
        Number(
          (
            strongest * 100
          ).toFixed(2)
        ),

      patternCount:
        patterns.length,

      taiEvidence:
        Number(
          taiSignal.toFixed(4)
        ),

      xiuEvidence:
        Number(
          xiuSignal.toFixed(4)
        ),

      contradiction:
        contradiction.contradiction,

      currentFingerprint:
        context.fingerprint
    },

    featureSnapshot:
      context
  };
}


/* ========================================================
   SAVE PREDICTION
======================================================== */

async function savePrediction(
  session,
  ai
) {
  if (!process.env.DATABASE_URL) {
    memoryFallback.predictions.set(
      session,
      {
        session,
        prediction:
          ai.prediction,
        confidence:
          ai.confidence,
        status: "WAITING",
        reasoning:
          ai.reasoning,
        feature_snapshot:
          ai.featureSnapshot
      }
    );

    return;
  }

  await pool.query(
    `
    INSERT INTO tx_predictions (
      session_id,
      prediction,
      confidence,
      status,
      feature_snapshot,
      reasoning
    )
    VALUES ($1, $2, $3, 'WAITING', $4, $5)
    ON CONFLICT (session_id)
    DO NOTHING
    `,
    [
      session,
      ai.prediction,
      ai.confidence,
      JSON.stringify(
        ai.featureSnapshot
      ),
      JSON.stringify(
        ai.reasoning
      )
    ]
  );
}


/* ========================================================
   RESOLVE PREDICTION
======================================================== */

async function resolvePrediction(
  row
) {
  const prediction =
    await getPrediction(
      row.session
    );

  if (!prediction) {
    return;
  }

  if (
    prediction.status !==
    "WAITING"
  ) {
    return;
  }

  const correct =
    prediction.prediction ===
    row.result;

  if (!process.env.DATABASE_URL) {
    const item =
      memoryFallback.predictions.get(
        row.session
      );

    if (item) {
      item.status =
        correct
          ? "CORRECT"
          : "WRONG";

      item.actual_result =
        row.result;

      item.d1 = row.d1;
      item.d2 = row.d2;
      item.d3 = row.d3;
      item.total = row.total;

      item.resolved_at =
        new Date().toISOString();
    }

    return;
  }

  await pool.query(
    `
    UPDATE tx_predictions
    SET
      status = $1,
      actual_result = $2,
      d1 = $3,
      d2 = $4,
      d3 = $5,
      total = $6,
      resolved_at = NOW()
    WHERE session_id = $7
      AND status = 'WAITING'
    `,
    [
      correct
        ? "CORRECT"
        : "WRONG",
      row.result,
      row.d1,
      row.d2,
      row.d3,
      row.total,
      row.session
    ]
  );
}


/* ========================================================
   SAVE EXPERIENCE / LEARN
======================================================== */

async function learnFromResult(
  row,
  history
) {
  const prediction =
    await getPrediction(
      row.session
    );

  const context =
    extractContext(
      history
    );

  const fingerprint =
    buildFingerprint(
      history
    );

  const correct =
    prediction
      ? prediction.prediction ===
        row.result
      : null;

  const experience = {
    session_id:
      row.session,

    result:
      row.result,

    d1:
      row.d1,

    d2:
      row.d2,

    d3:
      row.d3,

    total:
      row.total,

    context,

    fingerprint,

    prediction:
      prediction
        ? prediction.prediction
        : null,

    prediction_correct:
      correct
  };

  if (!process.env.DATABASE_URL) {
    const exists =
      memoryFallback.experiences.some(
        x =>
          x.session_id ===
          row.session
      );

    if (!exists) {
      memoryFallback.experiences.push(
        experience
      );
    }

    return;
  }

  await pool.query(
    `
    INSERT INTO tx_experiences (
      session_id,
      result,
      d1,
      d2,
      d3,
      total,
      context,
      fingerprint,
      prediction,
      prediction_correct
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
    )
    ON CONFLICT (session_id)
    DO UPDATE SET
      result = EXCLUDED.result,
      d1 = EXCLUDED.d1,
      d2 = EXCLUDED.d2,
      d3 = EXCLUDED.d3,
      total = EXCLUDED.total,
      context = EXCLUDED.context,
      fingerprint = EXCLUDED.fingerprint,
      prediction = EXCLUDED.prediction,
      prediction_correct =
        EXCLUDED.prediction_correct,
      learned_at = NOW()
    `,
    [
      experience.session_id,
      experience.result,
      experience.d1,
      experience.d2,
      experience.d3,
      experience.total,
      JSON.stringify(
        experience.context
      ),
      experience.fingerprint,
      experience.prediction,
      experience.prediction_correct
    ]
  );
}


/* ========================================================
   GET PREDICTION
======================================================== */

async function getPrediction(
  session
) {
  if (!process.env.DATABASE_URL) {
    return (
      memoryFallback.predictions.get(
        session
      ) || null
    );
  }

  const r = await pool.query(
    `
    SELECT *
    FROM tx_predictions
    WHERE session_id = $1
    LIMIT 1
    `,
    [session]
  );

  return r.rows[0] || null;
}


/* ========================================================
   WORKER
======================================================== */

async function worker() {
  if (workerRunning) {
    return;
  }

  workerRunning = true;
  lastWorkerAt =
    new Date().toISOString();

  try {
    const history =
      await fetchSource();

    if (!history.length) {
      workerRunning = false;
      return;
    }

    const newest =
      history[
        history.length - 1
      ];

    lastSourceSession =
      newest.session;

    /*
      1. Mọi phiên mới xuất hiện:
         - resolve prediction
         - lưu experience
    */

    for (const row of history) {
      const prediction =
        await getPrediction(
          row.session
        );

      if (
        prediction &&
        prediction.status ===
          "WAITING"
      ) {
        await resolvePrediction(
          row
        );
      }

      await learnFromResult(
        row,
        history
      );
    }

    /*
      2. Phiên kế tiếp.
    */

    const nextSession =
      newest.session + 1;

    const existing =
      await getPrediction(
        nextSession
      );

    /*
      Chỉ tạo prediction một lần.
      Không gọi lại AI mỗi request API.
    */

    if (!existing) {
      console.log(
        `[AI] Đang suy luận phiên ${nextSession}...`
      );

      const ai =
        await think(history);

      await savePrediction(
        nextSession,
        ai
      );

      console.log(
        `[AI] ${nextSession} => ${ai.prediction} | ${ai.confidence}%`
      );
    }

    lastError = null;
  } catch (error) {
    lastError =
      String(
        error.message ||
        error
      );

    console.error(
      "[WORKER ERROR]",
      lastError
    );
  } finally {
    workerRunning = false;
  }
}


/* ========================================================
   API
======================================================== */

app.get("/", (req, res) => {
  res.json({
    success: true,

    name:
      "DENIUS PERSISTENT EXPERIENCE AI",

    version:
      "3.0.0",

    status:
      "ONLINE",

    admin:
      ADMIN,

    endpoints: {
      prediction:
        "/api/tx",

      history:
        "/api/history",

      stats:
        "/api/stats",

      status:
        "/api/status",

      health:
        "/health"
    }
  });
});


app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "OK",
    worker:
      workerRunning
        ? "RUNNING"
        : "IDLE",

    lastSourceSession,
    lastWorkerAt,
    lastError
  });
});


app.get("/api/status", async (req, res) => {
  try {
    const experienceCount =
      await countExperiences();

    res.json({
      success: true,

      ai: {
        name:
          "DENIUS PERSISTENT EXPERIENCE AI",

        engine:
          "CASE_BASED_EXPERIENCE_REASONING",

        learning:
          "ONLINE",

        persistent:
          Boolean(
            process.env.DATABASE_URL
          ),

        experienceCount
      },

      worker: {
        running:
          workerRunning,

        lastSourceSession,
        lastWorkerAt,
        lastError
      },

      ADMIN
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error.message
    });
  }
});


app.get("/api/tx", async (req, res) => {
  try {
    const history =
      await fetchSource();

    if (!history.length) {
      return res.json({
        success: false,
        message:
          "Chưa có dữ liệu nguồn",
        ADMIN
      });
    }

    const newest =
      history[
        history.length - 1
      ];

    const currentSession =
      newest.session + 1;

    let current =
      await getPrediction(
        currentSession
      );

    /*
      Nếu worker chưa kịp tạo,
      API có thể tạo ngay một lần.
    */

    if (!current) {
      const ai =
        await think(history);

      await savePrediction(
        currentSession,
        ai
      );

      current =
        await getPrediction(
          currentSession
        );
    }

    const dbHistory =
      process.env.DATABASE_URL
        ? await pool.query(`
            SELECT *
            FROM tx_predictions
            ORDER BY session_id DESC
            LIMIT 100
          `)
        : {
            rows: [
              ...memoryFallback.predictions.values()
            ]
              .sort(
                (a, b) =>
                  Number(
                    b.session
                  ) -
                  Number(
                    a.session
                  )
              )
              .slice(0, 100)
          };

    const formattedCurrent = {
      Phien_hien_tai:
        currentSession,

      Du_doan:
        current.prediction,

      Do_tin_cay:
        `${Number(
          current.confidence
        ).toFixed(2)}%`,

      Trang_thai:
        current.status ===
          "WAITING"
          ? "⏳ Đang chờ"
          : current.status ===
            "CORRECT"
            ? "✅ Đúng"
            : "❌ Sai",

      ADMIN
    };

    const formattedHistory =
      dbHistory.rows
        .filter(
          x =>
            Number(
              x.session_id ||
              x.session
            ) <
            currentSession
        )
        .map(x => ({
          Phien:
            Number(
              x.session_id ||
              x.session
            ),

          Du_doan:
            x.prediction,

          Do_tin_cay:
            `${Number(
              x.confidence || 0
            ).toFixed(2)}%`,

          Trang_thai:
            x.status ===
              "CORRECT"
              ? "✅ Đúng"
              : x.status ===
                "WRONG"
                ? "❌ Sai"
                : "⏳ Đang chờ",

          Ket_qua:
            x.actual_result ||
            null,

          Xuc_xac:
            x.d1 != null
              ? [
                  x.d1,
                  x.d2,
                  x.d3
                ]
              : null,

          Tong:
            x.total ||
            null,

          ADMIN
        }));

    res.json({
      success: true,

      current:
        formattedCurrent,

      history:
        formattedHistory,

      AI: {
        engine:
          "DENIUS PERSISTENT EXPERIENCE AI",

        persistent:
          Boolean(
            process.env.DATABASE_URL
          )
      }
    });
  } catch (error) {
    console.error(
      "/api/tx ERROR",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error.message,
      ADMIN
    });
  }
});


/* ========================================================
   HISTORY API
======================================================== */

app.get(
  "/api/history",
  async (req, res) => {
    try {
      const limit =
        Math.min(
          Math.max(
            Number(
              req.query.limit
            ) || 100,
            1
          ),
          1000
        );

      let rows;

      if (
        process.env.DATABASE_URL
      ) {
        const result =
          await pool.query(
            `
            SELECT *
            FROM tx_predictions
            ORDER BY session_id DESC
            LIMIT $1
            `,
            [limit]
          );

        rows = result.rows;
      } else {
        rows =
          [
            ...memoryFallback.predictions.values()
          ]
            .sort(
              (a, b) =>
                b.session -
                a.session
            )
            .slice(
              0,
              limit
            );
      }

      res.json({
        success: true,
        count: rows.length,
        history: rows,
        ADMIN
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);


/* ========================================================
   STATS
======================================================== */

app.get(
  "/api/stats",
  async (req, res) => {
    try {
      let total = 0;
      let correct = 0;
      let wrong = 0;

      if (
        process.env.DATABASE_URL
      ) {
        const result =
          await pool.query(`
            SELECT
              COUNT(*)::INT AS total,
              COUNT(*) FILTER (
                WHERE status = 'CORRECT'
              )::INT AS correct,
              COUNT(*) FILTER (
                WHERE status = 'WRONG'
              )::INT AS wrong
            FROM tx_predictions
          `);

        total =
          result.rows[0].total;

        correct =
          result.rows[0].correct;

        wrong =
          result.rows[0].wrong;
      } else {
        const values =
          [
            ...memoryFallback.predictions.values()
          ];

        total =
          values.length;

        correct =
          values.filter(
            x =>
              x.status ===
              "CORRECT"
          ).length;

        wrong =
          values.filter(
            x =>
              x.status ===
              "WRONG"
          ).length;
      }

      const resolved =
        correct + wrong;

      const accuracy =
        resolved
          ? (
              correct /
              resolved *
              100
            ).toFixed(2)
          : "0.00";

      const experiences =
        await countExperiences();

      res.json({
        success: true,

        predictions: {
          total,
          correct,
          wrong,
          resolved,
          accuracy:
            `${accuracy}%`
        },

        brain: {
          experiences
        },

        ADMIN
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);


/* ========================================================
   START
======================================================== */

async function start() {
  try {
    await initDatabase();

    app.listen(
      PORT,
      () => {
        console.log("");
        console.log(
          "=============================================="
        );
        console.log(
          " DENIUS PERSISTENT EXPERIENCE AI"
        );
        console.log(
          " VERSION 3.0.0"
        );
        console.log(
          "=============================================="
        );
        console.log(
          ` PORT: ${PORT}`
        );
        console.log(
          ` ADMIN: ${ADMIN}`
        );
        console.log(
          " WORKER: ONLINE"
        );
        console.log(
          " PERSISTENT MEMORY: " +
            (
              process.env.DATABASE_URL
                ? "YES"
                : "NO - MEMORY FALLBACK"
            )
        );
        console.log(
          "=============================================="
        );
        console.log("");
      }
    );

    /*
      Chạy ngay khi server khởi động,
      không cần người truy cập API.
    */

    await worker();

    setInterval(
      worker,
      POLL_MS
    );
  } catch (error) {
    console.error(
      "[START FATAL]",
      error
    );

    process.exit(1);
  }
}


process.on(
  "SIGTERM",
  async () => {
    console.log(
      "[SYSTEM] SIGTERM"
    );

    try {
      await pool.end();
    } finally {
      process.exit(0);
    }
  }
);

process.on(
  "SIGINT",
  async () => {
    console.log(
      "[SYSTEM] SIGINT"
    );

    try {
      await pool.end();
    } finally {
      process.exit(0);
    }
  }
);


start();