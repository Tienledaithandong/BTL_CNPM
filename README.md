# Smart E-Mobility Hub

MVP Submission 4 của nhóm Musketeers, CO3001. Student Portal và Operator Dashboard dùng chung một backend Fastify, ba module M1/M2/M3 và bộ giả lập thiết bị. Trạng thái được lưu ở tệp snapshot trên máy demo.

## Chạy trên Windows

Yêu cầu Node.js 22.12 trở lên và npm. Bản bàn giao được kiểm với Node.js 24.18.0 và Microsoft Edge. Mở terminal ở thư mục gốc repo `BTL_CNPM`.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Mở **http://127.0.0.1:4173**. Dùng `npm.cmd run dev` để build web và chạy API từ TypeScript trong một lệnh sau khi cài dependency. Server nhận kết nối loopback.

| Tài khoản | Vai trò | Mật khẩu demo |
|---|---|---|
| STUDENT_A | Student, xe cá nhân PV_A | demo |
| STUDENT_B | Student, xe cá nhân PV_B | demo |
| OPERATOR_A | Operator | demo |

Seed chứa ba Hub, 12 xe dùng chung, 45 chỗ đỗ và sáu cổng sạc. Mỗi Hub có giới hạn 3 kW và hai cổng 2 kW. Thông tin pin và heartbeat do simulator cập nhật.

## Làm việc nhóm

Clone repo sau khi tài khoản GitHub của bạn được cấp quyền. Chạy lệnh trong mục trên để kiểm bản hiện tại.

    git clone https://github.com/Tienledaithandong/BTL_CNPM.git
    cd BTL_CNPM
    git switch -c feature/ten-thay-doi

Mỗi thay đổi đi qua một nhánh riêng và pull request vào main. Trong PR, ghi UC bị ảnh hưởng và lệnh kiểm thử đã chạy. API nằm trong src/api, giao diện trong src/web, dữ liệu khởi tạo trong src/api/seed.json và ca kiểm thử trong tests. Xem [PRD](docs/PRD.md) để đối chiếu yêu cầu.

## Trình diễn

1. **Student dùng xe chung.** Đăng nhập Student A, chọn EV-02 tại Ga Metro và giữ chỗ đích ở Ký túc xá. Lấy mã trong Chuyến đi, xác nhận nhận xe và chờ ACK. Đổi đích sang Bách Khoa, xác nhận trả tại chỗ đang giữ, mở hóa đơn. Với mức pin seed 65%, tiếp tục gửi yêu cầu sạc đến 80% và xem trạng thái. Nếu đã thay đổi seed trong một lượt demo khác, chọn xe đủ pin có mức dưới 80% khi cần trình diễn sạc.
2. **Đỗ và sạc xe cá nhân.** Chọn PV_A và một khung giờ còn trống. Xem trước rồi xác nhận. Khi đến giờ, xác nhận vào chỗ. Mở Sạc, chọn booking, công suất và mức pin. Hai phiên giao nhau 2 kW tại cùng Hub sẽ vượt 3 kW. UI hiển thị lỗi và các phương án có thể dùng nếu còn tài nguyên.
3. **Operator giám sát và cô lập.** Mở Dashboard để đọc KPI và trạng thái Hub. Tạm dừng heartbeat một Hub trong Điều khiển demo, chờ sau 10 giây và xem Stale. Báo sự cố một cổng, cô lập, đọc ticket/tác động rồi khôi phục khi đủ điều kiện.
4. **Điều phối và lập lịch.** Đề xuất một xe khả dụng từ Ga Metro đến Ký túc xá. Xác nhận, cho xuất phát, xác nhận đến và hoàn tất. Tạo phiên Waiting bằng cách để thiếu tài nguyên phù hợp, sau đó dùng Lịch sạc để xem ưu tiên, preview và áp dụng khi tài nguyên cho phép.
5. **What-if.** Tạo kịch bản 3 Hub, 2 giờ, tăng 20% nhu cầu thuê và chặn một slot. Chạy rồi đọc Baseline, What-if, chênh lệch và khuyến nghị. Việc chạy mô phỏng chỉ lưu đầu vào, trạng thái và kết quả.
6. **Lưu và phục hồi.** Dừng bằng Ctrl+C rồi chạy lại `npm.cmd start`. Đăng nhập lại để thấy chuyến đi, hóa đơn và kết quả What-if đã lưu. Mất WebSocket sẽ kích hoạt tải lại trạng thái khi kết nối trở lại.

Các thao tác dùng xe/điều phối/sạc tương tác với thiết bị giả lập. Khi tắt ACK tự động, dùng Operator → Điều khiển demo để xác nhận lệnh đã gửi hoặc ghi nhận xe hiện diện và đã khóa ở đúng chỗ. Một ACK âm tính khi mở khóa trong bộ giả lập xác nhận lệnh chưa thực thi và đã bị vô hiệu. Timeout sẽ giữ xe và chỗ đích để đối soát.

## Dữ liệu

- `data/runtime/snapshot.json` chứa bản đang dùng. `snapshot.prev.json` là bản dự phòng có checksum. Seed đọc từ [src/api/seed.json](src/api/seed.json) và gắn thời gian lúc khởi tạo.
- Với bản demo đang chạy, đăng nhập Operator và dùng **Đặt lại dữ liệu demo** sau khi xác nhận. Thao tác này lấy lại seed và xóa các giao dịch demo hiện có.
- Nếu cần một lượt demo độc lập, đặt `$env:HUB_DATA_DIR = 'data/demo-lan-2'` trước khi khởi động. Dùng `$env:HUB_PORT = '4180'` để đổi cổng. Dùng `$env:HUB_ENABLE_DEMO = '0'` để tắt API điều khiển demo.
- Khi tải bản dự phòng, hệ thống chuyển Recovery và chặn thao tác ghi thông thường. Operator kiểm tra dữ liệu phiên bản đã nạp, đối soát các lệnh còn chờ, sau đó xác nhận hoàn tất phục hồi. Khi cả hai tệp hỏng, giữ các tệp để phục hồi và xử lý lỗi trước khi khởi động lại.

## Kiểm chứng

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd exec -- tsx tools/measure.ts
```

Playwright khởi động bản đã build trên cổng riêng và thư mục dữ liệu test riêng. Các phép đo ở [measurements.json](deliverables/measurements.json) dùng seed trên máy demo này. Xem [kết quả kiểm chứng](deliverables/Verification.md) để biết các tình huống được chạy và các mục còn mở.

## Quyết định triển khai

- Hợp đồng chạy nằm trong `src/api/types.ts`, M1/M2/M3 và [Verification.md](deliverables/Verification.md). Đổi đích áp dụng cho cả reservation và Trip. Điều phối dùng ID item để bảo vệ quyền sở hữu hold. Áp dụng lịch sạc trả các ID phiên đã được xếp.
- Công suất bị giữ từ lúc bắt đầu gửi lệnh đến khi có xác nhận ngắt điện. Cổng vẫn chặn nếu đầu cắm còn kết nối. Khi có heartbeat định kỳ, version toàn hệ thống vẫn tăng; xác nhận preview kiểm lại dữ liệu tài nguyên liên quan.
- Mô hình chạy trên một máy, có tài khoản mẫu và mật khẩu demo. Hóa đơn chỉ dùng trong mô phỏng. Nhận xe dùng mã từ lượt đặt, chỗ trả theo hold cụ thể hoặc chỗ thay thế hợp lệ cùng Hub có xác nhận. Không có thiết bị thật, thanh toán, camera, SSO hay dịch vụ thông báo ngoài ứng dụng.
- Lịch sạc UC14 ưu tiên các yêu cầu Waiting và giữ lịch đã cam kết. Quy tắc điểm trong MVP dùng `w1=1` và `w2=10` theo mặc định đề xuất trong PRD. Khi tính điểm các ca test từ BTL3, dùng đúng cấu hình trọng số của ca đó.

## Hồ sơ trình diễn

- [PDF Final](deliverables/BTL4_Smart_E_Mobility_Hub_Musketeers.pdf)
- [Slide PowerPoint](deliverables/Smart_E_Mobility_Hub_Demo.pptx)
- [Kết quả kiểm chứng và phạm vi](deliverables/Verification.md)

Để tạo lại PDF Final, cài hai thư viện Python reportlab và pypdf, lấy bản BTL3 chung của nhóm, rồi chạy `python tools/build_final_report.py --baseline <duong-dan-PDF-BTL3>` tại gốc repo. PDF Final hiện có trong repo dùng bản BTL3 chung kèm minh chứng trong deliverables/evidence.
