// ============================================================
// app.js  –  Logic chính của AI Phân Tích Doanh Thu
// ============================================================

/* ===== STATE ===== */
let currentUser   = null;
let userData      = null;   // Firestore document
let parsedRows    = [];     // Rows từ file Excel/CSV
let summaryMetrics = {};

const FREE_SLOTS = 3;
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

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

/* ===== FIREBASE AUTH ===== */
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    await ensureUserDoc(user);
    renderUserInfo(user);
    showPage('page-workspace');
    renderSlotBadge();

    // Khôi phục API key đã lưu
    const saved = getApiKey();
    if (saved) $('input-apikey').value = saved;
  } else {
    currentUser = null;
    userData    = null;
    showPage('page-landing');
  }
});

async function ensureUserDoc(user) {
  const ref = db.collection('users').doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    userData = { uid: user.uid, email: user.email, free_slots: FREE_SLOTS, is_premium: false };
    await ref.set(userData);
  } else {
    userData = snap.data();
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
    badge.textContent = '⭐ Premium – Không giới hạn';
    badge.classList.add('premium');
  } else {
    badge.textContent = `🎁 Còn ${userData.free_slots} lượt miễn phí`;
    badge.classList.remove('premium');
  }
}

/* ===== GOOGLE LOGIN / LOGOUT ===== */
$('btn-google-login').addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
  } catch (e) {
    showToast('Đăng nhập thất bại: ' + e.message, 'error');
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
  if (!key.startsWith('AIza')) {
    showToast('API Key không hợp lệ (phải bắt đầu bằng AIza...)', 'error');
    return;
  }
  localStorage.setItem('gemini_api_key', key);
  showToast('✅ Đã lưu API Key!', 'success');
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

function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['csv','xlsx','xls'].includes(ext)) {
    showToast('Chỉ hỗ trợ file .csv, .xlsx, .xls', 'error');
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
    showToast('File trống hoặc không đọc được dữ liệu.', 'error');
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
    { label: 'Số đơn hàng',       value: m.orderCount.toLocaleString('vi'),     sub: 'đơn',          cls: '' },
    { label: 'Tổng Doanh thu',     value: formatVND(m.totalRevenue),             sub: 'Giá bán gốc',  cls: '' },
    { label: 'Phí Sàn',           value: formatVND(m.totalPlatformFee),          sub: 'Commission',   cls: m.totalPlatformFee > 0 ? 'danger' : '' },
    { label: 'Phí Voucher/KM',    value: formatVND(m.totalVoucherFee),           sub: 'Giảm giá',     cls: m.totalVoucherFee > 0 ? 'danger' : '' },
    { label: 'Phí Vận chuyển',    value: formatVND(m.totalShipping),             sub: 'Shop chịu',    cls: m.totalShipping > 0 ? 'danger' : '' },
    { label: 'Hoàn hàng',         value: formatVND(m.totalReturn),               sub: 'Refund/Return', cls: m.totalReturn > 0 ? 'danger' : '' },
    { label: 'Tổng chi phí sàn',  value: formatVND(m.totalFee),                  sub: 'Tất cả phí',   cls: 'danger' },
    { label: 'Lợi nhuận ước tính',value: formatVND(m.estProfit),                 sub: `Tỷ lệ phí: ${formatPct(m.feeRatio)}`, cls: m.estProfit >= 0 ? 'success' : 'danger' },
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
    g.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Không tìm thấy cột tài chính phù hợp trong file. Tool vẫn sẽ cố gắng phân tích.</p>';
  }
}

/* ===== PHÂN TÍCH GEMINI ===== */
$('btn-analyze').addEventListener('click', async () => {
  const apiKey = getApiKey();
  if (!apiKey) {
    showToast('Vui lòng nhập và lưu Gemini API Key trước.', 'error');
    return;
  }
  if (!currentUser || !userData) {
    showToast('Bạn chưa đăng nhập.', 'error');
    return;
  }
  if (parsedRows.length === 0) {
    showToast('Vui lòng tải lên file báo cáo trước.', 'error');
    return;
  }

  // Kiểm tra lượt dùng
  if (!userData.is_premium && userData.free_slots <= 0) {
    $('popup-paywall').classList.remove('hidden');
    return;
  }

  setAnalyzeLoading(true);

  try {
    const result = await callGemini(apiKey, summaryMetrics);
    renderResult(result);

    // Trừ lượt
    if (!userData.is_premium) {
      userData.free_slots -= 1;
      await db.collection('users').doc(currentUser.uid).update({ free_slots: userData.free_slots });
      renderSlotBadge();
    }
  } catch (e) {
    showToast('Lỗi Gemini API: ' + e.message, 'error');
  } finally {
    setAnalyzeLoading(false);
  }
});

function setAnalyzeLoading(loading) {
  const btn = $('btn-analyze');
  const txt = $('btn-analyze-text');
  const spin = $('btn-analyze-spinner');
  btn.disabled = loading;
  txt.textContent = loading ? 'AI đang phân tích...' : '🤖 Phân tích Lỗ Ẩn bằng AI';
  if (loading) spin.classList.remove('hidden');
  else spin.classList.add('hidden');
}

async function callGemini(apiKey, metrics) {
  const systemPrompt = `Bạn là chuyên gia tối ưu chi phí vận hành sàn TMĐT (TikTok Shop, Shopee, Lazada).
Tôi sẽ cung cấp số liệu tổng quan từ file báo cáo của shop.
Hãy phân tích và chỉ ra ĐÚNG 3 điểm bất thường khiến shop mất tiền (Lỗ Ẩn) và đưa ra giải pháp ngắn gọn, thực tế.
Trả lời bằng Tiếng Việt, ngắn gọn, đúng trọng tâm, không thừa.`;

  const userPrompt = `Số liệu shop:
- Số đơn: ${metrics.orderCount}
- Tổng doanh thu: ${formatVND(metrics.totalRevenue)}
- Phí sàn (commission): ${formatVND(metrics.totalPlatformFee)}
- Phí voucher/khuyến mãi: ${formatVND(metrics.totalVoucherFee)}
- Phí vận chuyển shop chịu: ${formatVND(metrics.totalShipping)}
- Hoàn hàng/refund: ${formatVND(metrics.totalReturn)}
- Tổng chi phí sàn: ${formatVND(metrics.totalFee)}
- Lợi nhuận ước tính: ${formatVND(metrics.estProfit)}
- Tỷ lệ phí/doanh thu: ${formatPct(metrics.feeRatio)}
- Cột dữ liệu đã phát hiện: ${JSON.stringify(Object.keys(metrics.columns))}

Phân tích 3 lỗ ẩn chính, mỗi lỗ gồm: tên, mô tả ngắn, mức độ nghiêm trọng (cao/trung bình/thấp), giải pháp cụ thể.`;

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
            severity: { type: "string", enum: ["cao", "trung bình", "thấp"] },
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
  if (!raw) throw new Error('Gemini không trả về nội dung.');
  return JSON.parse(raw);
}

/* ===== RENDER KẾT QUẢ ===== */
function renderResult(data) {
  const severityMap = { 'cao': 'high', 'trung bình': 'medium', 'thấp': 'low' };
  const severityLabel = { 'cao': '⚠ Cao', 'trung bình': '• Trung bình', 'thấp': '↓ Thấp' };

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
      <div class="anomaly-solution"><strong>💡 Giải pháp:</strong> ${a.solution}</div>
    `;
    listEl.appendChild(div);
  });

  $('result-summary-box').innerHTML = `<strong>📊 Tổng kết:</strong> ${data.overall_summary || ''}`;

  const now = new Date().toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  $('result-shop-meta').textContent = `Phân tích lúc ${now} · ${summaryMetrics.orderCount} đơn · Doanh thu ${formatVND(summaryMetrics.totalRevenue)}`;

  $('section-result').classList.remove('hidden');
  $('section-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ===== CHỤP ẢNH KẾT QUẢ ===== */
$('btn-screenshot').addEventListener('click', async () => {
  const el = $('result-snapshot');
  try {
    $('btn-screenshot').textContent = '⏳ Đang tạo ảnh...';
    const canvas = await html2canvas(el, {
      backgroundColor: '#13131e',
      scale: 2,
      useCORS: true
    });
    const link = document.createElement('a');
    link.download = `revai-phan-tich-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('✅ Đã tải ảnh về!', 'success');
  } catch (e) {
    showToast('Lỗi tạo ảnh: ' + e.message, 'error');
  } finally {
    $('btn-screenshot').textContent = '📸 Tải ảnh kết quả về (khoe Facebook)';
  }
});

/* ===== PAYWALL POPUP ===== */
$('btn-close-paywall').addEventListener('click', () => $('popup-paywall').classList.add('hidden'));

$('btn-activate').addEventListener('click', async () => {
  const code = $('input-promo').value.trim().toUpperCase();
  // Thay bằng logic kiểm tra code thật của bạn
  const VALID_CODES = ['PREMIUM2024', 'VIP49K'];
  if (VALID_CODES.includes(code)) {
    userData.is_premium = true;
    await db.collection('users').doc(currentUser.uid).update({ is_premium: true });
    renderSlotBadge();
    $('popup-paywall').classList.add('hidden');
    showToast('🎉 Kích hoạt Premium thành công!', 'success');
  } else {
    showToast('Mã không hợp lệ.', 'error');
  }
});
