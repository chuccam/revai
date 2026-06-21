# ⚡ RevAI – AI Phân Tích Lỗ Ẩn Doanh Thu TMĐT

> Ném file báo cáo TikTok Shop / Shopee vào — AI tìm ra lỗ ẩn trong vài giây.  
> Chạy **100% client-side**, không server, không phí vận hành.

---

## 🚀 Cách Deploy lên GitHub Pages (Giai đoạn 3)

```bash
git init
git add .
git commit -m "init: RevAI MVP"
git branch -M main
git remote add origin https://github.com/chuccam/revai.git
git push -u origin main
```

Sau đó vào **GitHub → Settings → Pages → Source: main / root** → Save.  
Link sẽ là: `https://chuccam.github.io/revai`

---

## 🔧 Cấu hình Firebase (BẮT BUỘC)

### 1. Tạo Firebase Project
- Vào [console.firebase.google.com](https://console.firebase.google.com)
- Tạo project mới → Chọn **Web app**
- Copy config vào `firebase-config.js`

### 2. Bật Authentication
- Firebase Console → Authentication → Sign-in method
- Bật **Google**

### 3. Tạo Firestore Database
- Firebase Console → Firestore Database → Create database → **Production mode**
- Sau đó vào **Rules** → Paste nội dung file `firestore.rules`

### 4. Thêm domain được phép (sau khi deploy)
- Firebase Console → Authentication → Settings → Authorized domains
- Thêm `chuccam.github.io`

---

## 🔑 Lấy Gemini API Key Miễn phí

1. Vào [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Bấm **Create API Key**
3. Chọn project → Copy key
4. Dán vào ô "Gemini API Key" trên web app

---

## 💡 Cách thêm mã Premium thật

Trong `app.js`, tìm dòng:
```js
const VALID_CODES = ['PREMIUM2024', 'VIP49K'];
```
Thay bằng mã của bạn, hoặc tích hợp với Firestore để lưu/check mã động.

---

## 📁 Cấu trúc file

```
MiniApp/
├── index.html          # Giao diện chính
├── style.css           # Dark theme UI
├── app.js              # Logic chính (Auth, Gemini, File parsing)
├── firebase-config.js  # ⚠️ Điền Firebase credentials của bạn
├── firestore.rules     # Dán lên Firebase Console
└── README.md
```

---

## 🛡️ Bảng rủi ro & giải pháp

| Rủi ro | Giải pháp |
|--------|-----------|
| Lộ Firebase config | OK! Đã set Firestore Rules – user chỉ đọc/ghi doc của chính họ |
| User sợ lộ dữ liệu | Banner "Không upload lên server" đã có trong UI |
| Gemini API Key bị lộ | Key lưu `localStorage` trên máy user, không gửi về server của bạn |
| User không có key | Nút "Hướng dẫn lấy Key" link thẳng đến AI Studio |
