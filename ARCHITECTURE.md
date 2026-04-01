# Kiến Trúc và Quá Trình Deploy Lên Firebase (Giải thích theo phương pháp Feynman)

Chào bạn! Thay vì dùng những thuật ngữ phức tạp, chúng ta hãy tưởng tượng dự án web của bạn giống như một **"Nhà hàng"**, và chúng ta đang chuyển nhà hàng này từ cái bếp nhỏ ở nhà bạn (Localhost) lên một hệ thống chuỗi cửa hàng chuyên nghiệp (Firebase/Google Cloud) để 150 vị khách có thể tới ăn cùng lúc.

---

## 1. Bức tranh tổng thể: Nhà hàng của chúng ta có gì?

Dự án của bạn là một ứng dụng "Full-stack" (có cả giao diện lẫn xử lý ngầm), được chia làm 3 phần chính:

1. **Frontend (Giao diện / Khu vực tiếp khách):**
   - Được viết bằng **React + Vite**. Đây là menu, bàn ghế, nơi khách hàng (Users) bấm nút, xem dữ liệu, thao tác.
2. **Backend (Máy chủ / Khu vực nhà bếp):**
   - Ban đầu là file `server.ts` chạy bằng **Express.js**. Đây là các đầu bếp. Họ nhận order từ khách, chạy đi lấy dữ liệu từ kho (Firestore) hoặc nhờ dịch vụ ngoài (Google Sheets, Google OAuth), rồi trả món ăn (dữ liệu) ra cho khách.
3. **Database (Kho chứa nguyên liệu):**
   - **Firestore**. Nơi lưu trữ thông tin dự án, cấu hình.

---

## 2. Tại sao lại dùng cấu trúc mới (Firebase Hosting + Functions)?

Lúc code ở máy bạn (`localhost:3000`), cả khu vực tiếp khách (React) và nhà bếp (Express) đều nằm chung trong 1 tiến trình chạy duy nhất (`server.ts`).

Nhưng khi đưa lên internet, chúng ta không để 1 máy tính duy nhất ôm cả 2 việc đó nữa, vì nó vừa chậm vừa dễ sập. Firebase giúp ta tách chúng ra:

### A. Firebase Hosting (Cho Giao diện)
Hãy tưởng tượng đây là **các biển quảng cáo và Menu được in sẵn đặt ở khắp thế giới**.
Khi bạn chạy lệnh `npm run build`, Vite sẽ dịch toàn bộ code React phức tạp thành các file tĩnh đơn giản (HTML, CSS, JS) và nhét vào thư mục `dist`. 
Firebase Hosting sẽ lấy thư mục `dist` này và copy nó ra hàng ngàn máy chủ của Google trên toàn cầu (gọi là mạng CDN). Nhờ vậy, khách hàng ở Việt Nam hay ở Mỹ bấm vào trang web, giao diện sẽ tải lên "chớp nhoáng" gần như tức thì.

### B. Firebase Cloud Functions (Cho Nhà bếp/Backend)
Chúng ta đã chuyển toàn bộ logic của `server.ts` sang `functions/src/index.ts`. 
Đây là khái niệm **Serverless** (Không máy chủ). Bạn không cần thuê 1 cái máy chủ chạy 24/7 (vừa tốn tiền vừa lãng phí lúc không có khách). 
Thay vào đó, Cloud Functions giống như **"Đầu bếp tàng hình"**. 
- Khi không có khách gọi món (gọi API), không có đầu bếp nào đứng chờ, bạn không tốn 1 xu.
- Khi có 1 khách gọi API (vd: `/api/sheets/data`), Google ngay lập tức "biến ra" 1 đầu bếp xử lý, nấu xong trả món rồi biến mất.
- Nếu 150 người gọi cùng lúc, Google tự động tạo ra 150 đầu bếp. Chạy cực êm, không bao giờ lo sập!

---

## 3. Quá trình luồng dữ liệu (Routing) diễn ra thế nào?

Bạn có để ý file `firebase.json` không? Đó chính là **"Cô lễ tân điều phối"**.

Khách hàng gõ vào trình duyệt: `https://narutoismylife.online/...`

- **Trường hợp 1:** Khách gõ URL cần lấy giao diện (vd: trang chủ `/`, trang profile `/profile`).
  Cô lễ tân (`firebase.json`) nhìn thấy quy tắc: `"source": "**", "destination": "/index.html"`.
  Cô ấy lập tức lôi file `index.html` (từ Firebase Hosting) ra cho khách. React sau đó sẽ tự vẽ lên màn hình.

- **Trường hợp 2:** Giao diện bấm nút, cần gọi dữ liệu (vd: gọi `/api/sheets/data` hoặc `/auth/google/callback`).
  Cô lễ tân thấy quy tắc ưu tiên cao hơn: `"source": "/api/**", "function": "api"`.
  Thay vì đưa file tĩnh, cô ấy sẽ chuyển yêu cầu này vòng ra đằng sau cho **Cloud Functions** (đầu bếp tàng hình có tên là `api`) xử lý.

Đó là lý do tại sao Giao diện (Hosting) và Xử lý ngầm (Functions) có thể chạy chung trên 1 đường dẫn Domain mạch lạc!

---

## 4. Giải thích quy trình bạn vừa "Set up" (Deploy)

Khi bạn gõ lệnh `firebase deploy`, một phép màu tự động diễn ra qua 3 bước:

1. **Khâu chuẩn bị nguyên liệu:** 
   - Nó chạy lệnh build của React để nhét vào thư mục `dist`.
   - Nó vào thư mục `functions`, chạy lệnh dịch từ TypeScript sang JavaScript thuần.
2. **Khâu đóng gói và tải lên mây:**
   - Nó nhặt thư mục `dist` đẩy lên hệ thống CDN của Firebase Hosting.
   - Nó lấy thư mục `functions`, gửi cho Google Cloud Build. Tại đây, Google sẽ gói toàn bộ "nhà bếp" của bạn thành một chiếc hộp (gọi là Container / Docker image).
3. **Khâu sẵn sàng:**
   - Nó khởi động Cloud Functions dựa trên cái hộp vừa tạo. Từ giờ nó đã sẵn sàng đón khách.

*(Lỗi cấp quyền thiếu IAM bạn gặp lúc nãy nằm ở bước 2: Hệ thống của Google bị từ chối quyền tạo "chiếc hộp Container" để lưu trữ code của bạn. Sửa quyền xong là qua mượt mà!)*

---

## 5. Cập nhật Code sau này diễn ra thế nào?

Bạn chỉ cần nhớ chu trình 3 bước đơn giản:
1. Bạn sửa code (React hoặc Functions).
2. Bạn gõ: `npm run build` (để gói code mới).
3. Bạn gõ: `firebase deploy` (để tải phiên bản mới lên).

**Không bị gián đoạn (Zero Downtime):** Khách hàng cũ đang dùng web sẽ không bị sập. Khi nào code mới lên hoàn tất, khách hàng chỉ cần F5 lại là sẽ thấy giao diện mới.

---
*Tóm lại, cấu trúc này giúp bạn hưởng lợi 100% từ hạ tầng siêu khủng của Google, không bao giờ phải lo máy chủ bị sập, bị đầy ổ cứng, hay quá tải bộ nhớ, mà chi phí lại gần như bằng 0đ cho quy mô 150 người!*