// ============================================================
// app.js  –  Logic chính của AI Phân Tích Doanh Thu
// ============================================================

/* ===== STATE ===== */
let currentUser   = null;
let userData      = null;   // Firestore document
let parsedRows    = [];     // Rows từ file Excel/CSV
let summaryMetrics = {};
let systemApiKey  = '';     // Gemini API key của hệ thống

// Xử lý kết quả redirect login (chạy ngay khi load trang)
auth.getRedirectResult().then(async (result) => {
  if (result && result.user) {
    // onAuthStateChanged sẽ xử lý tiếp
  }
}).catch((e) => {
  if (e.code !== 'auth/no-auth-event') {
    showToast('Đăng nhập thất bại: ' + e.message, 'error');
  }
});

const FREE_SLOTS = 3;
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

/* ===== UTILS ===== */
function $(id) { return document.getElementById(id); }

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $(id).classList.add('active');
}

function showToast(msg, type = 'info') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

function formatVND(n) {
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(n);
}

function formatPct(n) {
  if (isNaN(n) || n === Infinity) return '—';
  return n.toFixed(1) + '%';
}

function getApiKey() {
  return localStorage.getItem('gemini_api_key') || '';
}

async function fetchSystemConfig() {
  try {
    const snap = await db.collection('system_config').doc('gemini').get();
    if (snap.exists) {
      systemApiKey = snap.data().apiKey || '';
    }
  } catch (e) {
    console.warn('System Config:', e.message);
  }
}

auth.onAuthStateChanged(async (user) => {
  // Ẩn loader ngay lập tức
  $('auth-loading').classList.add('hidden');

  if (user) {
    currentUser = user;
    renderUserInfo(user);
    showPage('page-workspace');       // Vào workspace NGAY, không chờ Firestore

    // Khôi phục API key đã lưu
    const saved = getApiKey();
    if (saved) $('input-apikey').value = saved;

    // Load Firestore data trong background (không block UI)
    await ensureUserDoc(user);
    renderSlotBadge();
  } else {
    currentUser = null;
    userData    = null;
    showPage('page-landing');
  }
});

async function ensureUserDoc(user) {
  try {
    const ref = db.collection('users').doc(user.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      userData = { uid: user.uid, email: user.email, free_slots: FREE_SLOTS, is_premium: false };
      await ref.set(userData);
    } else {
      userData = snap.data();
    }
  } catch (e) {
    // Firestore chưa setup xong — dùng userData mặc định, không được logout user
    console.warn('Firestore:', e.message);
    userData = { uid: user.uid, email: user.email, free_slots: FREE_SLOTS, is_premium: false };
  }
}

function renderUserInfo(user) {
  const img = $('user-avatar');
  img.src = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.email)}&background=7c3aed&color=fff`;
  $('user-name').textContent = user.displayName || user.email;
}

function renderSlotBadge() {
  const badge = $('slot-badge');
  if (!userData) return;
  if (userData.is_premium) {
    badge.textContent = '⭐ Premium – Unlimited';
    badge.classList.add('premium');
  } else {
    badge.textContent = `🎁 ${userData.free_slots} free runs remaining`;
    badge.classList.remove('premium');
  }
}

/* ===== GOOGLE LOGIN / LOGOUT ===== */
$('btn-google-login').addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    await auth.signInWithPopup(provider);
  } catch (e) {
    // Nếu popup bị block thì fallback sang redirect
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user') {
      try {
        await auth.signInWithRedirect(provider);
      } catch (e2) {
        showToast('Sign-in failed: ' + e2.message, 'error');
      }
    } else {
      showToast('Sign-in failed: ' + e.message, 'error');
    }
  }
});

$('btn-logout').addEventListener('click', async () => {
  await auth.signOut();
  parsedRows = [];
  summaryMetrics = {};
  $('step-summary').style.display = 'none';
  $('section-result').classList.add('hidden');
});

/* ===== API KEY ===== */
$('btn-save-key').addEventListener('click', () => {
  const key = $('input-apikey').value.trim();
  if (key === '') {
    localStorage.removeItem('gemini_api_key');
    showToast('✅ Personal API Key removed. Using system key.', 'success');
    return;
  }
  if (key.length < 20) {
    showToast('Invalid API Key (too short).', 'error');
    return;
  }
  localStorage.setItem('gemini_api_key', key);
  showToast('✅ Personal API Key saved!', 'success');
});

/* ===== FILE UPLOAD ===== */
const dropZone  = $('drop-zone');
const fileInput = $('file-input');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

/* ===== DEMO DATA ===== */
const DEMO_DATA = [
  { "Order ID": "DH001", "Revenue": 150000, "Platform Fee": 15000, "Voucher Discount": 10000, "Shipping Fee": 15000, "Net Received": 110000, "Return/Refund": 0 },
  { "Order ID": "DH002", "Revenue": 120000, "Platform Fee": 12000, "Voucher Discount": 0, "Shipping Fee": 35000, "Net Received": 73000, "Return/Refund": 0 },
  { "Order ID": "DH003", "Revenue": 200000, "Platform Fee": 20000, "Voucher Discount": 30000, "Shipping Fee": 0, "Net Received": 150000, "Return/Refund": 0 },
  { "Order ID": "DH004", "Revenue": 0, "Platform Fee": 0, "Voucher Discount": 0, "Shipping Fee": 25000, "Net Received": -25000, "Return/Refund": 180000 },
  { "Order ID": "DH005", "Revenue": 180000, "Platform Fee": 18000, "Voucher Discount": 15000, "Shipping Fee": 18000, "Net Received": 129000, "Return/Refund": 0 },
  { "Order ID": "DH006", "Revenue": 150000, "Platform Fee": 15000, "Voucher Discount": 50000, "Shipping Fee": 20000, "Net Received": 65000, "Return/Refund": 0 },
  { "Order ID": "DH007", "Revenue": 220000, "Platform Fee": 22000, "Voucher Discount": 0, "Shipping Fee": 12000, "Net Received": 186000, "Return/Refund": 0 },
  { "Order ID": "DH008", "Revenue": 130000, "Platform Fee": 13000, "Voucher Discount": 10000, "Shipping Fee": 15000, "Net Received": 92000, "Return/Refund": 0 },
  { "Order ID": "DH009", "Revenue": 0, "Platform Fee": 0, "Voucher Discount": 0, "Shipping Fee": 30000, "Net Received": -30000, "Return/Refund": 120000 },
  { "Order ID": "DH010", "Revenue": 300000, "Platform Fee": 45000, "Voucher Discount": 20000, "Shipping Fee": 15000, "Net Received": 220000, "Return/Refund": 0 }
];

$('btn-use-demo').addEventListener('click', () => {
  $('file-info').innerHTML = `📊 <strong>Using demo data</strong> &nbsp; (10 sample orders)`;
  $('file-info').classList.remove('hidden');
  processRows(DEMO_DATA);
});

function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['csv','xlsx','xls'].includes(ext)) {
    showToast('Only .csv, .xlsx, .xls files are supported', 'error');
    return;
  }

  $('file-info').innerHTML = `📄 <strong>${file.name}</strong> &nbsp; ${(file.size / 1024).toFixed(1)} KB`;
  $('file-info').classList.remove('hidden');

  if (ext === 'csv') {
    Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => processRows(res.data) });
  } else {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      processRows(rows);
    };
    reader.readAsArrayBuffer(file);
  }
}

/* ===== PROCESS ROWS & METRICS ===== */
function processRows(rows) {
  if (!rows || rows.length === 0) {
    showToast('Empty file or data cannot be read.', 'error');
    return;
  }
  parsedRows = rows;

  // Nhận dạng cột linh hoạt (dùng regex match)
  const colMap = detectColumns(Object.keys(rows[0]));
  summaryMetrics = computeMetrics(rows, colMap);

  renderMetrics(summaryMetrics);
  $('step-summary').style.display = 'flex';
  $('step-summary').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function detectColumns(cols) {
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g,'');
  const find = (...keys) => cols.find(c => keys.some(k => norm(c).includes(norm(k)))) || null;

  return {
    revenue:      find('doanh thu', 'revenue', 'gia ban', 'don gia', 'tong tien', 'amount'),
    platformFee:  find('phi san', 'phi nen tang', 'platform fee', 'phi co dinh', 'commission'),
    voucherFee:   find('voucher', 'giam gia', 'discount'),
    shippingFee:  find('phi van chuyen', 'phi ship', 'shipping', 'giao hang'),
    netReceived:  find('thuc nhan', 'so tien nhan', 'net', 'tong thanh toan', 'actual'),
    returnFee:    find('hoan hang', 'return', 'refund', 'hoan tra'),
  };
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  return parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0;
}

function computeMetrics(rows, colMap) {
  let totalRevenue = 0, totalPlatformFee = 0, totalVoucherFee = 0;
  let totalShipping = 0, totalNetReceived = 0, totalReturn = 0;
  let orderCount = rows.length;

  rows.forEach(r => {
    totalRevenue     += colMap.revenue     ? toNum(r[colMap.revenue])     : 0;
    totalPlatformFee += colMap.platformFee ? toNum(r[colMap.platformFee]) : 0;
    totalVoucherFee  += colMap.voucherFee  ? toNum(r[colMap.voucherFee])  : 0;
    totalShipping    += colMap.shippingFee ? toNum(r[colMap.shippingFee]) : 0;
    totalNetReceived += colMap.netReceived ? toNum(r[colMap.netReceived]) : 0;
    totalReturn      += colMap.returnFee   ? toNum(r[colMap.returnFee])   : 0;
  });

  const totalFee = totalPlatformFee + totalVoucherFee + totalShipping + totalReturn;
  const estProfit = totalRevenue - totalFee;
  const feeRatio  = totalRevenue ? (totalFee / totalRevenue) * 100 : 0;

  return {
    orderCount, totalRevenue, totalPlatformFee, totalVoucherFee,
    totalShipping, totalNetReceived, totalReturn,
    totalFee, estProfit, feeRatio,
    columns: Object.fromEntries(Object.entries(colMap).filter(([,v]) => v))
  };
}

function renderMetrics(m) {
  const g = $('metrics-grid');
  g.innerHTML = '';

  const items = [
    { label: 'Total Orders',      value: m.orderCount.toLocaleString('en-US'),  sub: 'orders',       cls: '' },
    { label: 'Gross Revenue',     value: formatVND(m.totalRevenue),             sub: 'Original price',cls: '' },
    { label: 'Platform Fee',      value: formatVND(m.totalPlatformFee),          sub: 'Platform fee',  cls: m.totalPlatformFee > 0 ? 'danger' : '' },
    { label: 'Voucher/Promo',     value: formatVND(m.totalVoucherFee),           sub: 'Discounts',     cls: m.totalVoucherFee > 0 ? 'danger' : '' },
    { label: 'Shipping Fee',      value: formatVND(m.totalShipping),             sub: 'Seller covered',cls: m.totalShipping > 0 ? 'danger' : '' },
    { label: 'Returns/Refunds',   value: formatVND(m.totalReturn),               sub: 'Refund/Return', cls: m.totalReturn > 0 ? 'danger' : '' },
    { label: 'Total Platform Costs', value: formatVND(m.totalFee),               sub: 'All fees combined', cls: 'danger' },
    { label: 'Est. Net Income',   value: formatVND(m.estProfit),                 sub: `Fee ratio: ${formatPct(m.feeRatio)}`, cls: m.estProfit >= 0 ? 'success' : 'danger' },
  ].filter(it => it.value !== '0 ₫' && it.value !== '—' && it.value !== formatVND(0));

  items.forEach(it => {
    const div = document.createElement('div');
    div.className = 'metric-card';
    div.innerHTML = `<div class="label">${it.label}</div>
                     <div class="value ${it.cls}">${it.value}</div>
                     <div class="sub">${it.sub}</div>`;
    g.appendChild(div);
  });

  if (items.length === 0) {
    g.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No matching financial columns found in the file. The tool will still attempt to analyze.</p>';
  }
}

/* ===== PHÂN TÍCH GEMINI ===== */
$('btn-analyze').addEventListener('click', async () => {
  if (!currentUser || !userData) {
    showToast('Please sign in first.', 'error');
    return;
  }
  if (parsedRows.length === 0) {
    showToast('Please upload a report file first.', 'error');
    return;
  }

  const customApiKey = getApiKey();
  const usingCustomKey = !!customApiKey;

  // Nếu dùng Key hệ thống và chưa tải, hãy tải từ Firestore ngay lúc này
  if (!usingCustomKey && !systemApiKey) {
    setAnalyzeLoading(true);
    await fetchSystemConfig();
    setAnalyzeLoading(false);
  }

  const activeKey = customApiKey || systemApiKey;

  if (!activeKey) {
    showToast('API Key not found. Please enter your personal API Key in Step 1.', 'error');
    return;
  }

  // Nếu sử dụng Key của hệ thống: kiểm tra giới hạn lượt dùng thử
  if (!usingCustomKey) {
    if (!userData.is_premium && userData.free_slots <= 0) {
      $('popup-paywall').classList.remove('hidden');
      return;
    }
  }

  setAnalyzeLoading(true);

  try {
    const result = await callGemini(activeKey, summaryMetrics);
    renderResult(result);

    // Nếu dùng Key hệ thống và chưa kích hoạt Premium: Trừ lượt dùng
    if (!usingCustomKey && !userData.is_premium) {
      userData.free_slots -= 1;
      await db.collection('users').doc(currentUser.uid).update({ free_slots: userData.free_slots });
      renderSlotBadge();
    }
  } catch (e) {
    showToast('Gemini API Error: ' + e.message, 'error');
  } finally {
    setAnalyzeLoading(false);
  }
});

function setAnalyzeLoading(loading) {
  const btn = $('btn-analyze');
  const txt = $('btn-analyze-text');
  const spin = $('btn-analyze-spinner');
  btn.disabled = loading;
  txt.textContent = loading ? 'Analyzing...' : '🤖 Analyze Hidden Losses with AI';
  if (loading) spin.classList.remove('hidden');
  else spin.classList.add('hidden');
}

async function callGemini(apiKey, metrics) {
  const systemPrompt = `You are an e-commerce platform operations cost optimization expert (TikTok Shop, Shopee, Lazada).
I will provide the overview metrics from a shop's report.
Analyze and pinpoint EXACTLY 3 anomalies causing the shop to lose money (Hidden Losses) and provide a concise, actionable solution for each.
Respond in English, short, focused, with no fluff.`;

  const userPrompt = `Shop metrics:
- Orders: ${metrics.orderCount}
- Gross Revenue: ${formatVND(metrics.totalRevenue)}
- Platform Fee (commission): ${formatVND(metrics.totalPlatformFee)}
- Voucher/Promo Fee: ${formatVND(metrics.totalVoucherFee)}
- Seller-covered Shipping Fee: ${formatVND(metrics.totalShipping)}
- Return/Refund: ${formatVND(metrics.totalReturn)}
- Total platform costs: ${formatVND(metrics.totalFee)}
- Estimated Net Profit: ${formatVND(metrics.estProfit)}
- Fee to revenue ratio: ${formatPct(metrics.feeRatio)}
- Detected columns: ${JSON.stringify(Object.keys(metrics.columns))}

Analyze the 3 main hidden losses. Each loss must include: title, short description, severity level (high/medium/low), and a specific solution.`;

  const responseSchema = {
    type: "object",
    properties: {
      anomalies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title:    { type: "string" },
            icon:     { type: "string" },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            description: { type: "string" },
            solution: { type: "string" }
          },
          required: ["title","icon","severity","description","solution"]
        }
      },
      overall_summary: { type: "string" }
    },
    required: ["anomalies","overall_summary"]
  };

  const body = {
    contents: [
      { role: "user", parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }
    ],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
      responseSchema
    }
  };

  const resp = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini did not return any content.');
  return JSON.parse(raw);
}

/* ===== RENDER KẾT QUẢ ===== */
function renderResult(data) {
  const severityMap = { 'high': 'high', 'medium': 'medium', 'low': 'low' };
  const severityLabel = { 'high': '⚠ High', 'medium': '• Medium', 'low': '↓ Low' };

  const listEl = $('result-anomalies');
  listEl.innerHTML = '';

  (data.anomalies || []).forEach(a => {
    const cls = severityMap[a.severity] || 'medium';
    const div = document.createElement('div');
    div.className = `anomaly-item severity-${cls}`;
    div.innerHTML = `
      <div class="anomaly-header">
        <span class="anomaly-icon">${a.icon || '🔍'}</span>
        <span class="anomaly-title">${a.title}</span>
        <span class="anomaly-severity">${severityLabel[a.severity] || a.severity}</span>
      </div>
      <div class="anomaly-desc">${a.description}</div>
      <div class="anomaly-solution"><strong>💡 Solution:</strong> ${a.solution}</div>
    `;
    listEl.appendChild(div);
  });

  $('result-summary-box').innerHTML = `<strong>📊 Summary:</strong> ${data.overall_summary || ''}`;

  const now = new Date().toLocaleDateString('en-US', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  $('result-shop-meta').textContent = `Analyzed at ${now} · ${summaryMetrics.orderCount} orders · Gross Revenue ${formatVND(summaryMetrics.totalRevenue)}`;

  $('section-result').classList.remove('hidden');
  $('section-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ===== CHỤP ẢNH KẾT QUẢ ===== */
$('btn-screenshot').addEventListener('click', async () => {
  const el = $('result-snapshot');
  try {
    $('btn-screenshot').textContent = '⏳ Generating image...';
    const canvas = await html2canvas(el, {
      backgroundColor: '#13131e',
      scale: 2,
      useCORS: true
    });
    const link = document.createElement('a');
    link.download = `revai-analysis-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('✅ Image downloaded!', 'success');
  } catch (e) {
    showToast('Error generating image: ' + e.message, 'error');
  } finally {
    $('btn-screenshot').textContent = '📸 Download report image';
  }
});

/* ===== PAYWALL POPUP ===== */
$('btn-close-paywall').addEventListener('click', () => $('popup-paywall').classList.add('hidden'));

$('btn-activate').addEventListener('click', async () => {
  const code = $('input-promo').value.trim().toUpperCase();
  if (!code) return;
  try {
    // Kiểm tra mã trong Firestore collection 'promo_codes'
    // Thêm mã vào Firestore Console: promo_codes/{MÃ} = { active: true }
    const snap = await db.collection('promo_codes').doc(code).get();
    if (snap.exists && snap.data().active === true) {
      userData.is_premium = true;
      await db.collection('users').doc(currentUser.uid).update({ is_premium: true });
      renderSlotBadge();
      $('popup-paywall').classList.add('hidden');
      showToast('🎉 Premium activated successfully!', 'success');
    } else {
      showToast('Invalid or expired code.', 'error');
    }
  } catch (e) {
    showToast('Error validating code: ' + e.message, 'error');
  }
});
