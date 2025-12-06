// --- PHẦN 1: CẤU HÌNH, UTILITIES, THUẬT TOÁN (FULL AI CHIP) VÀ LỚP LOGIC ---

import fastify from "fastify";
import cors from "@fastify/cors";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";

// --- CẤU HÌNH ---
const PORT = 3000;
// 🚨 URL API MỚI ĐÃ THAY THẾ (GIỮ NGUYÊN)
const API_URL = "https://taixiumd5.system32-cloudfare-356783752985678522.monster/api/md5luckydice/GetSoiCau";

// --- GLOBAL STATE ---
let txHistory = []; 
let currentSessionId = null; 
let fetchInterval = null; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- UTILITIES (Đã điều chỉnh để phù hợp với API mới) ---
function parseLines(data) {
    if (!data || !Array.isArray(data)) return [];
    
    // Đảm bảo dữ liệu được sắp xếp theo ID phiên giảm dần (mới nhất lên đầu)
    // API mới trả về một mảng trực tiếp, không có 'list'
    const sortedList = data.sort((a, b) => b.SessionId - a.SessionId);

    // Chuyển đổi định dạng dữ liệu, quy tắc Tài/Xỉu (>= 11 là T, < 11 là X)
    const arr = sortedList.map(item => {
        const total = item.DiceSum;
        const txLabel = total >= 11 ? 'T' : 'X'; // 'T' (Tài) hoặc 'X' (Xỉu)
        
        // BetSide: 0 là TÀI, 1 là XỈU (theo định dạng API gốc mới)
        let resultTruyenThong;
        if (item.BetSide === 0) {
            resultTruyenThong = "TAI";
        } else if (item.BetSide === 1) {
            resultTruyenThong = "XIU";
        } else {
            // Trường hợp BetSide không phải 0 hoặc 1, sử dụng quy tắc 11 điểm
            resultTruyenThong = txLabel === 'T' ? "TAI" : "XIU";
        }

        return {
            session: item.SessionId,
            // Kết hợp 3 viên xúc xắc thành một mảng
            dice: [item.FirstDice, item.SecondDice, item.ThirdDice], 
            total: total,
            result: resultTruyenThong, 
            tx: txLabel 
        };
    });

    // Sắp xếp lại theo ID phiên tăng dần (cũ nhất lên đầu) để AI phân tích
    return arr.sort((a, b) => a.session - b.session);
}

function lastN(arr, n) {
    return arr.slice(Math.max(0, arr.length - n));
}

function majority(obj) {
    let maxK = null,
        maxV = -Infinity;
    for (const k in obj)
        if (obj[k] > maxV) {
            maxV = obj[k];
            maxK = k;
        }
    return {
        key: maxK,
        val: maxV
    };
}

function sum(nums) {
    return nums.reduce((a, b) => a + b, 0);
}

function avg(nums) {
    return nums.length ? sum(nums) / nums.length : 0;
}

function entropy(arr) {
    if (!arr.length) return 0;
    const freq = arr.reduce((a, v) => {
        a[v] = (a[v] || 0) + 1;
        return a;
    }, {});
    const n = arr.length;
    let e = 0;
    for (const k in freq) {
        const p = freq[k] / n;
        e -= p * Math.log2(p);
    }
    return e;
}

function similarity(a, b) {
    if (a.length !== b.length) return 0;
    let m = 0;
    for (let i = 0; i < a.length; i++)
        if (a[i] === b[i]) m++;
    return m / a.length;
}

function extractFeatures(history) {
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const features = {
        tx,
        totals,
        freq: tx.reduce((a, v) => {
            a[v] = (a[v] || 0) + 1;
            return a;
        }, {})
    };

    let runs = [],
        cur = tx[0],
        len = 1;
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === cur) len++;
        else {
            runs.push({
                val: cur,
                len
            });
            cur = tx[i];
            len = 1;
        }
    }
    if (tx.length) runs.push({
        val: cur,
        len
    });
    features.runs = runs;
    features.maxRun = runs.reduce((m, r) => Math.max(m, r.len), 0) || 0;

    features.meanTotal = avg(totals);
    features.stdTotal = Math.sqrt(avg(totals.map(t => Math.pow(t - features.meanTotal, 2))));
    features.entropy = entropy(tx);

    return features;
}

// --- CORE ALGORITHMS (FULL AI CHIP DỰ ĐOÁN) ---

// 1. Thuật toán Cân bằng Tần suất (Cơ sở AI)
function algo5_freqRebalance(history) {
    const tx = history.map(h => h.tx);
    const freq = tx.reduce((a, v) => { a[v] = (a[v] || 0) + 1; return a; }, {});
    if ((freq['T'] || 0) > (freq['X'] || 0) + 2) return 'X';
    if ((freq['X'] || 0) > (freq['T'] || 0) + 2) return 'T';
    return null;
}

// 2. Thuật toán Markov Cổ điển (Phân tích Chuỗi)
function algoA_markov(history) {
    const tx = history.map(h => h.tx);
    const order = 3;
    if (tx.length < order + 1) return null;
    const transitions = {};
    for (let i = 0; i <= tx.length - order - 1; i++) {
        const key = tx.slice(i, i + order).join('');
        const next = tx[i + order];
        transitions[key] = transitions[key] || { T: 0, X: 0 };
        transitions[key][next]++;
    }
    const lastKey = tx.slice(-order).join('');
    const counts = transitions[lastKey];
    if (!counts) return null;
    return (counts['T'] > counts['X']) ? 'T' : 'X';
}

// 3. Thuật toán N-gram (So khớp Mẫu Ngắn)
function algoB_ngram(history) {
    const tx = history.map(h => h.tx);
    const k = 4;
    if (tx.length < k + 1) return null;
    const lastGram = tx.slice(-k).join('');
    let counts = { T: 0, X: 0 };
    for (let i = 0; i <= tx.length - k - 1; i++) {
        const gram = tx.slice(i, i + k).join('');
        if (gram === lastGram) counts[tx[i + k]]++;
    }
    return counts.T > counts.X ? 'T' : 'X';
}

// 4. Thuật toán Độc Quyền Neo-Pattern Recognition (Phát Hiện Chu Kỳ Đảo Cầu, Cầu Bệt và Cầu Xen Kẽ)
function algoS_NeoPattern(history) {
    const tx = history.map(h => h.tx);
    const len = tx.length;
    if (len < 20) return null;

    const patternLengths = [4, 6];
    let bestPred = null;
    let maxMatches = -1;

    for (const patLen of patternLengths) {
        if (len < patLen * 2 + 1) continue;
        const targetPattern = tx.slice(-patLen).join('');
        let counts = { T: 0, X: 0 };

        for (let i = 0; i <= len - patLen - 1; i++) {
            const historyPattern = tx.slice(i, i + patLen).join('');
            const score = similarity(historyPattern, targetPattern); 

            if (score >= 0.75) { 
                counts[tx[i + patLen]]++;
            }
        }

        if (counts.T !== counts.X) {
            const currentMatches = counts.T + counts.X;
            if (currentMatches > maxMatches) {
                maxMatches = currentMatches;
                bestPred = counts.T > counts.X ? 'T' : 'X';
            }
        }
    }

    return bestPred;
}

// 5. Thuật toán Deep Deep AI Analysis & AI Analytics (Phân Tích Sâu và Hồi Quy Trung Bình)
function algoF_SuperDeepAnalysis(history) {
    if (history.length < 70) return null;
    const features = extractFeatures(history);
    const tx = features.tx;

    // Phân tích sự cân bằng tổng thể (Mean Reversion)
    const recentTotals = history.slice(-20).map(h => h.total);
    const recentAvg = avg(recentTotals);
    
    // Dự đoán ngược lại để cân bằng
    if (recentAvg > 12.5 && features.meanTotal > 11.5) return 'X'; 
    if (recentAvg < 8.5 && features.meanTotal < 9.5) return 'T'; 

    // Phân tích Entropy: cầu lộn xộn (Entropy cao) -> Dự đoán hồi quy về 1-1
    if (features.entropy > 0.98) {
        return tx.at(-1) === 'T' ? 'X' : 'T'; 
    }

    return null;
}

// 6. Mô hình Biến áp Transformer (AI Deep Learning & Tối ưu hóa So khớp chuỗi dài)
function algoE_Transformer(history) {
    const tx = history.map(h => h.tx);
    const len = tx.length;
    if (len < 100) return null; // Cần lịch sử dài để mô hình Transformer hiệu quả

    const targetSeq = tx.slice(-10).join(''); // Dùng 10 phiên gần nhất làm mẫu
    let counts = { T: 0, X: 0 };
    let totalWeight = 0;

    for (let i = 0; i <= len - 11; i++) {
        const historySeq = tx.slice(i, i + 10).join('');
        const score = similarity(historySeq, targetSeq); 

        if (score > 0.6) {
            const nextResult = tx[i + 10];
            // Thêm trọng số thời gian (gần hơn quan trọng hơn)
            const weight = score * (1 / (len - i)); 
            counts[nextResult] = (counts[nextResult] || 0) + weight;
            totalWeight += weight;
        }
    }

    if (totalWeight > 0 && counts.T !== counts.X) {
        return counts.T > counts.X ? 'T' : 'X';
    }

    return null;
}

// 7. AI Bẻ Cầu và AI Theo Cầu Siêu Chuẩn
function algoG_SuperBridgePredictor(history) {
    const runs = extractFeatures(history).runs;
    if (runs.length < 2) return null;
    const lastRun = runs.at(-1);

    // AI Theo Cầu (Cầu dài từ 4 trở lên)
    if (lastRun.len >= 4) {
        // Tăng cường độ tin cậy khi cầu đang chạy
        return lastRun.val;
    }

    // AI Bẻ Cầu (Phát hiện bẻ cầu bệt 6+)
    if (runs.length >= 4) {
        const last4Runs = runs.slice(-4);
        const is11Pattern = last4Runs.length === 4 && last4Runs.every(r => r.len === 1);
        
        if (is11Pattern) {
             // Phát hiện mẫu 1-1 đang chạy, dự đoán tiếp tục
            return lastRun.val === 'T' ? 'X' : 'T';
        }
        
        // Phân tích bẻ cầu bệt 6+
        if (lastRun.len >= 6) {
            // Nếu bệt quá dài, dự đoán bẻ cầu
            return lastRun.val === 'T' ? 'X' : 'T'; 
        }
    }
    
    return null;
}

// 8. FULL Thuật toán Markov Thích ứng (AI Học Cầu)
function algoH_AdaptiveMarkov(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 20) return null;

    let bestPred = null;
    let maxConfidence = -1;

    // Kiểm tra các bậc từ 2 đến 4
    for (let order = 2; order <= 4; order++) {
        if (tx.length < order + 1) continue;
        const transitions = {};
        for (let i = 0; i <= tx.length - order - 1; i++) {
            const key = tx.slice(i, i + order).join('');
            const next = tx[i + order];
            transitions[key] = transitions[key] || { T: 0, X: 0 };
            transitions[key][next]++;
        }
        
        const lastKey = tx.slice(-order).join('');
        const counts = transitions[lastKey];
        
        if (counts && counts.T !== counts.X) {
            const total = counts.T + counts.X;
            const pred = counts.T > counts.X ? 'T' : 'X';
            const confidence = Math.abs(counts.T - counts.X) / total;
            
            if (confidence > maxConfidence) {
                maxConfidence = confidence;
                bestPred = pred;
            }
        }
    }

    return bestPred;
}


// --- DANH SÁCH THUẬT TOÁN KẾT HỢP (FULL THUẬT TOÁN TRỌNG SỐ) ---
const ALL_ALGS = [{
    id: 'algo5_freqrebalance',
    fn: algo5_freqRebalance
}, {
    id: 'a_markov',
    fn: algoA_markov
}, {
    id: 'b_ngram',
    fn: algoB_ngram
}, {
    id: 's_neo_pattern',
    fn: algoS_NeoPattern
}, {
    id: 'f_super_deep_analysis', 
    fn: algoF_SuperDeepAnalysis
}, {
    id: 'e_transformer', // Transformer Model (AI Deep Learning)
    fn: algoE_Transformer
}, {
    id: 'g_super_bridge_predictor', // AI Bẻ Cầu & Theo Cầu
    fn: algoG_SuperBridgePredictor
}, {
    id: 'h_adaptive_markov', // AI Học Cầu
    fn: algoH_AdaptiveMarkov
}];


// --- ENSEMBLE CLASSIFIER (AI HỌC CẦU VÀ TÍCH HỢP TRỌNG SỐ) ---
class SEIUEnsemble {
    constructor(algorithms, opts = {}) { 
        this.algs = algorithms;
        this.weights = {};
        this.emaAlpha = opts.emaAlpha ?? 0.1;
        this.minWeight = opts.minWeight ?? 0.001;
        this.historyWindow = opts.historyWindow ?? 500;
        for (const a of algorithms) this.weights[a.id] = 1;
    }
    
    fitInitial(history) {
        const window = lastN(history, this.historyWindow);
        if (window.length < 10) return;
        const algScores = {};
        for (const a of this.algs) algScores[a.id] = 0;

        for (let i = 3; i < window.length; i++) {
            const prefix = window.slice(0, i);
            const actual = window[i].tx;
            for (const a of this.algs) {
                const pred = a.fn(prefix);
                if (pred && pred === actual) algScores[a.id]++;
            }
        }

        let total = 0;
        for (const id in algScores) {
            const w = (algScores[id] || 0) + 1;
            this.weights[id] = w;
            total += w;
        }
        for (const id in this.weights) this.weights[id] = Math.max(this.minWeight, this.weights[id] / total);
        console.log(`⚖️ Đã khởi tạo ${Object.keys(this.weights).length} trọng số cho FULL AI CHIP.`);
    }

    // AI HỌC CẦU: Cập nhật trọng số sau mỗi phiên
    updateWithOutcome(historyPrefix, actualTx) {
        for (const a of this.algs) {
            const pred = a.fn(historyPrefix);
            const correct = pred === actualTx ? 1 : 0;
            const currentWeight = this.weights[a.id] || this.minWeight;

            // Cơ chế điều chỉnh trọng số (Exponential Moving Average)
            const reward = correct ? 1.05 : 0.95;
            const targetWeight = currentWeight * reward;

            const nw = this.emaAlpha * targetWeight + (1 - this.emaAlpha) * currentWeight;

            this.weights[a.id] = Math.max(this.minWeight, nw);
        }

        const s = Object.values(this.weights).reduce((a, b) => a + b, 0) || 1;
        for (const id in this.weights) this.weights[id] /= s; // Chuẩn hóa trọng số
    }

    predict(history) {
        const votes = {};
        for (const a of this.algs) {
            const pred = a.fn(history);
            if (!pred) continue;
            // Tích hợp tất cả thuật toán (votes dựa trên trọng số)
            votes[pred] = (votes[pred] || 0) + (this.weights[a.id] || 0);
        }

        if (!votes['T'] && !votes['X']) {
            const fallback = algo5_freqRebalance(history) || 'T';
            return {
                prediction: fallback === 'T' ? 'tài' : 'xỉu',
                confidence: 0.5,
                rawPrediction: fallback
            };
        }

        const {
            key: best,
            val: bestVal
        } = majority(votes);
        const total = Object.values(votes).reduce((a, b) => a + b, 0);
        const confidence = Math.min(0.99, Math.max(0.51, total > 0 ? bestVal / total : 0.51));

        return {
            prediction: best === 'T' ? 'tài' : 'xỉu',
            confidence,
            rawPrediction: best
        };
    }
}

// --- HÀM TẠO PATTERN PHỨC TẠP (15 PHIÊN VÀ PHÂN TÍCH CẦU RÕ RÀNG) ---
function getComplexPattern(history) {
    const minHistory = 15;
    if (history.length < minHistory) return {
        last_15_tx: 'n/a',
        latest_run_type: 'chưa có',
        latest_run_length: 0,
        is_1_1_pattern: false,
        is_bridge_of_5: false
    };
    
    const runs = extractFeatures(history).runs;
    const historyTx = history.map(h => h.tx);

    // Kiểm tra mẫu 1-1 trong 6 lần đổi cầu gần nhất
    const last6Runs = runs.slice(-6);
    const is11Pattern = last6Runs.length === 6 && last6Runs.every(r => r.len === 1);


    return {
        last_15_tx: historyTx.slice(-minHistory).join('').toLowerCase(),
        // Ghi rõ "tài" hoặc "xỉu"
        latest_run_type: runs.at(-1).val === 'T' ? 'tài' : 'xỉu', 
        latest_run_length: runs.at(-1).len,
        is_1_1_pattern: is11Pattern, // Có đang chạy cầu 1-1 không
        is_bridge_of_5: runs.at(-1).len >= 5 // Có đang chạy cầu bệt 5+ không
    };
}


// --- MANAGER CLASS (ỔN ĐỊNH TUYỆT ĐỐI) ---
class SEIUManager {
    constructor(opts = {}) {
        this.history = [];
        this.ensemble = new SEIUEnsemble(ALL_ALGS, {
            emaAlpha: opts.emaAlpha ?? 0.1,
            historyWindow: opts.historyWindow ?? 500
        });
        this.currentPrediction = null;
    }
    
    calculateInitialStats() {
        // Chỉ chạy để huấn luyện trọng số cho AI khi khởi động
        const minStart = 10;
        if (this.history.length < minStart) return;
        
        for (let i = minStart; i < this.history.length; i++) {
            const historyPrefix = this.history.slice(0, i);
            const actualTx = this.history[i].tx;
            // Cập nhật trọng số của thuật toán (AI HỌC CẦU)
            this.ensemble.updateWithOutcome(historyPrefix, actualTx);
        }
        console.log(`📊 AI Chip đã hoàn tất huấn luyện trên lịch sử.`);
    }

    loadInitial(lines) {
        this.history = lines;
        this.ensemble.fitInitial(this.history);
        this.calculateInitialStats(); // Huấn luyện AI
        this.currentPrediction = this.getPrediction(); // Dự đoán cho phiên N+1
        console.log("📦 Đã tải lịch sử. Hệ thống sẵn sàng.");
        const nextSession = this.history.at(-1) ? this.history.at(-1).session + 1 : 'N/A';
        console.log(`🔮 Dự đoán phiên tiếp theo (${nextSession}): ${this.currentPrediction.prediction} (Tỷ lệ: ${(this.currentPrediction.confidence * 100).toFixed(0)}%)`);
    }

    pushRecord(record) {
        // Record mới được thêm vào cuối mảng history (phải là record mới nhất)
        this.history.push(record);

        // Cập nhật trọng số của thuật toán dựa trên kết quả thực tế (AI HỌC CẦU)
        const prefix = this.history.slice(0, -1); // Loại bỏ phiên mới nhất để làm prefix
        if (prefix.length >= 3) {
            this.ensemble.updateWithOutcome(prefix, record.tx);
        }
        
        // Tạo dự đoán mới cho phiên N+2
        this.currentPrediction = this.getPrediction();
        console.log(`📥 Phiên mới ${record.session} → ${record.result}. Dự đoán phiên ${record.session + 1} là: ${this.currentPrediction.prediction}.`);
    }

    getPrediction() {
        return this.ensemble.predict(this.history);
    }
}

const seiuManager = new SEIUManager();


// --- PHẦN 2: API SERVER VÀ LOGIC TẢI DỮ LIỆU ĐỊNH KỲ ---

const app = fastify({
    logger: true
});
await app.register(cors, {
    origin: "*"
});

/**
 * Hàm lấy dữ liệu lịch sử và cập nhật AI
 */
async function fetchAndProcessHistory() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json(); // API mới trả về mảng trực tiếp
        const newHistory = parseLines(data); // Đã sắp xếp theo ID tăng dần
        
        if (newHistory.length === 0) {
            console.log("⚠️ Không có dữ liệu lịch sử từ API.");
            return;
        }

        const lastSessionInHistory = newHistory.at(-1);

        if (!currentSessionId) {
            // Lần chạy đầu tiên, tải toàn bộ lịch sử
            seiuManager.loadInitial(newHistory);
            txHistory = newHistory;
            currentSessionId = lastSessionInHistory.session;
            console.log(`✅ Lần đầu tải ${newHistory.length} phiên.`);
        } else if (lastSessionInHistory.session > currentSessionId) {
            // Có phiên mới, chỉ cần lấy phiên mới nhất để cập nhật
            const newRecords = newHistory.filter(r => r.session > currentSessionId);
            
            for (const record of newRecords) {
                seiuManager.pushRecord(record);
                txHistory.push(record);
            }
            // Giữ cho txHistory không quá lớn
            if (txHistory.length > 200) {
                txHistory = txHistory.slice(txHistory.length - 200);
            }
            currentSessionId = lastSessionInHistory.session;
            console.log(`🆕 Đã cập nhật ${newRecords.length} phiên mới. Phiên cuối: ${currentSessionId}`);
        } else {
            // Không có phiên mới hoặc phiên hiện tại vẫn đang chạy
            console.log(`🔄 Không có phiên mới. Phiên cuối: ${currentSessionId}`);
        }

    } catch (e) {
        console.error("❌ Lỗi khi lấy hoặc xử lý lịch sử:", e.message);
    }
}

// Lấy dữ liệu lần đầu
fetchAndProcessHistory();

// Thiết lập việc lấy dữ liệu định kỳ (ví dụ: mỗi 5 giây)
clearInterval(fetchInterval);
fetchInterval = setInterval(fetchAndProcessHistory, 5000); 
console.log(`🔄 Đang thiết lập Fetch API mỗi 5 giây tại URL: ${API_URL}`);

// GET /api/taixiumd5/xocdia88 (ENDPOINT MỚI THEO YÊU CẦU)
// ĐỊNH DẠNG JSON VIẾT THƯỜNG 100%
app.get("/api/taixiumd5/xocdia88", async () => {
    const lastResult = txHistory.at(-1) || null; // Lấy phiên mới nhất
    const currentPrediction = seiuManager.currentPrediction;
    const complexPattern = getComplexPattern(seiuManager.history);

    if (!lastResult || !currentPrediction) {
        return {
            id: "@bocobacmang01",
            phien_truoc: null,
            xuc_xac1: null,
            xuc_xac2: null,
            xuc_xac3: null,
            tong: null,
            ket_qua: "đang chờ dữ liệu...",
            pattern: complexPattern.last_15_tx,
            phien_hien_tai: currentSessionId ? currentSessionId + 1 : null,
            du_doan: "chưa có",
            do_tin_cay: "0%",
        };
    }

    return {
        id: "@bocobacmang01",
        phien_truoc: lastResult.session,
        xuc_xac1: lastResult.dice[0],
        xuc_xac2: lastResult.dice[1],
        xuc_xac3: lastResult.dice[2],
        tong: lastResult.total,
        ket_qua: lastResult.result.toLowerCase(),
        // 🚨 MẪU 15 PHIÊN VÀ PHÂN TÍCH CẦU RÕ RÀNG
        pattern: `tx: ${complexPattern.last_15_tx} | cau: ${complexPattern.latest_run_type}-${complexPattern.latest_run_length} | 1-1: ${complexPattern.is_1_1_pattern ? 'on' : 'off'} | bet_5+: ${complexPattern.is_bridge_of_5 ? 'on' : 'off'}`,
        phien_hien_tai: lastResult.session + 1,
        du_doan: currentPrediction.prediction,
        do_tin_cay: `${(currentPrediction.confidence * 100).toFixed(0)}%`,
    };
});

// GET /api/txmd5xd88/history (ENDPOINT MỚI THEO YÊU CẦU)
app.get("/api/txmd5xd88/history", async () => { 
    if (!txHistory.length) return {
        message: "không có dữ liệu lịch sử."
    };
    // Trả về lịch sử mới nhất (ID giảm dần)
    const reversedHistory = [...txHistory].sort((a, b) => b.session - a.session);
    
    return reversedHistory.map((i) => ({
        session: i.session,
        dice: i.dice,
        total: i.total,
        result: i.result.toLowerCase(),
        tx_label: i.tx.toLowerCase(),
    }));
});

// GET /
app.get("/", async () => { 
    return {
        status: "ok",
        msg: "server chạy thành công 🚀"
    };
});

// --- SERVER START ---
const start = async () => {
    try {
        await app.listen({
            port: PORT,
            host: "0.0.0.0"
        });
    } catch (err) {
        const fs = await import("node:fs");
        const logFile = path.join(__dirname, "server-error.log");
        const errorMsg = `
================= SERVER ERROR =================
Time: ${new Date().toISOString()}
Error: ${err.message}
Stack: ${err.stack}
=================================================
`;
        console.error(errorMsg);
        fs.writeFileSync(logFile, errorMsg, {
            encoding: "utf8",
            flag: "a+"
        });
        process.exit(1);
    }

    let publicIP = "0.0.0.0";
    try {
        const res = await fetch("https://ifconfig.me/ip");
        publicIP = (await res.text()).trim();
    } catch (e) {
        console.error("❌ Lỗi lấy public IP:", e.message);
    }

    console.log("\n🚀 Server đã chạy thành công!");
    console.log(`   ➜ Local:   http://localhost:${PORT}/`);
    console.log(`   ➜ Network: http://${publicIP}:${PORT}/\n`);

    console.log("📌 Các API endpoints:");
    console.log(`   ➜ GET /api/taixiumd5/xocdia88   → http://${publicIP}:${PORT}/api/taixiumd5/xocdia88`);
    console.log(`   ➜ GET /api/txmd5xd88/history   → http://${publicIP}:${PORT}/api/txmd5xd88/history`);
};

start();
