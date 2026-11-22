# Kiểm chứng MVP Smart E-Mobility Hub

Lần chạy ngày 23/11/2026 trên checkout dựa trên `dc1bb01` kèm các thay đổi trong workspace. Môi trường Windows, Node.js 24.15.0, npm 11.12.1, Microsoft Edge, Intel i5-1240P, RAM 15,7 GiB và bộ seed 3 Hub.

Build và typecheck đạt. **35/35 ca nghiệp vụ/API và 9/9 ca Edge đạt.** Playwright dùng bản đã build và tự thu dọn tiến trình test trên Windows.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
$env:E2E_CHANNEL = 'msedge'
npm.cmd run test:e2e
npm.cmd exec -- tsx tools/measure.ts
```

## Nghiệm thu nghiệp vụ

| ID | Bằng chứng tự động đã chạy | Nguồn |
|---|---|---|
| A01 | Vai trò sai nhận 403, thiếu phiên nhận 401, Student B không đọc hoặc hủy lượt đặt của A. | `core.test.ts` |
| A02 | Gói telemetry cũ/trùng bị bỏ qua có lý do. Xe quá 60 giây hoặc bị lỗi có lý do trong read model. REST từ chối đặt và nhận khi telemetry stale. Browser hiển thị lý do và chặn xe pin thấp. | `core.test.ts`, `realtime.spec.ts` |
| A03 | Hub đích đầy, xe và hold không được cấp. | `core.test.ts` |
| A04 | Mỗi nhóm 20 yêu cầu tranh đúng một xe hoặc đúng một slot riêng có một yêu cầu thành công. | `core.test.ts`, `m2.test.ts` |
| A05 | Đổi sang Hub đầy giữ hold cũ. | `core.test.ts` |
| A06 | Hết hạn nhả xe và hold. Lệnh UnlockPending giữ tài nguyên đến khi có kết quả. | `core.test.ts` |
| A07 | ACK muộn và ACK lặp chỉ tạo một Trip. Hold chuyển đúng chủ. | `core.test.ts`, `flows.spec.ts` |
| A08 | Trả sai đích/thiếu chứng cứ giữ Trip mở. Trả hợp lệ lặp giữ một hóa đơn. | `core.test.ts`, `flows.spec.ts` |
| A09 | Yêu cầu sạc lặp giữ một phiên. Cổng không tương thích và sai chủ bị từ chối. | `m2.test.ts` |
| A10 | Chạm biên được cấp. Khoảng giao nhau bị chặn và skipConflicts bỏ đúng buổi. | `m2.test.ts` |
| A11 | 4 kWh từ 20% đến 70% ở 2 kW cần 2 kWh và 60 phút. Phiên vượt cửa sổ đỗ bị từ chối. | `m2.test.ts`, `flows.spec.ts` |
| A12 | Hai phiên 2 kW giao nhau bị chặn ở Hub 3 kW. Browser đặt được phương án thay thế. | `m2.test.ts`, `m3.test.ts`, `flows.spec.ts` |
| A13 | StopPending giữ công suất quá giờ kết thúc. Sau ACK dừng, cổng vẫn chặn cấp vật lý khi còn đầu cắm. | `m2.test.ts`, `flows.spec.ts` |
| A14 | Fixture REST kiểm 89→90→85→84% và mất heartbeat. Browser kiểm mở, tiếp nhận, đóng trên 15 slot. | `m2.test.ts`, `flows.spec.ts` |
| A15 | Thiếu hold rollback lần confirm. Xe đã xuất phát chặn hủy cả lệnh. | `m3.test.ts` |
| A16 | Sự cố xe đã đặt thay xe, giữ hold và tránh áp dụng tác động lần hai. | `m2.test.ts` |
| A17 | Sự cố item đang đi giữ departedAt và hold khi chuyển NeedsOperatorAction. | `m3.test.ts` |
| A18 | Preview không cấp tài nguyên. Apply kiểm lại và giữ lịch cũ khi có xung đột. | `m3.test.ts` |
| A19 | Cùng snapshot/config/seed trả cùng kết quả. Kịch bản trung tính có delta 0 với các chỉ số xác định. | `m3.test.ts` |
| A20 | Fixture 2 xe/2 chỗ/3 lượt cho Baseline 2 nhận/1 từ chối. Chặn một chỗ cho kịch bản 1 nhận/2 từ chối. | `m3.test.ts` |
| A21 | What-if giữ nguyên tài nguyên live, lưu kết quả và xử lý run bị gián đoạn. Kiểm khung sạc gợi ý theo cổng, chỗ đỗ và công suất. | `m3.test.ts`, `flows.spec.ts` |
| A22 | Lỗi ghi trước commit giữ dữ liệu cũ. Lỗi replace bất định được báo riêng và dừng ghi. | `core.test.ts` |
| A23 | Restart bình thường tiếp tục lệnh cùng ID. Recovery nạp backup giữ lệnh chờ đến lúc Operator đối soát. | `core.test.ts`, `restart.spec.ts` |
| A24 | Hỏng main nạp backup, hiển thị phiên bản và chặn ghi. Hỏng cả hai bản có lỗi chẩn đoán. Đọc được snapshot schema 1. | `core.test.ts`, `restart.spec.ts` |
| A25 | Retry cùng ID/payload trả lại kết quả. Cùng ID khác payload trả 409. | `core.test.ts` |
| A26 | WebSocket yêu cầu phiên và chỉ phát metadata cập nhật chung. Browser nối lại và tải trạng thái mới theo quyền. | `core.test.ts`, `realtime.spec.ts` |

## Chất lượng và trình diễn

| ID | Kết quả tự động trên bộ seed |
|---|---|
| Q01 | Đạt trong hai ca 20 request đồng thời ở A04. |
| Q02 | Đạt trên 5 mẫu Edge, tối đa 254 ms từ gửi HTTP đến hiển thị. [Mẫu đo](evidence/realtime.json) |
| Q03 | Đạt trên bốn route đọc, 120 request sau warm-up. p95 3,5 ms. [Số đo](measurements.json) |
| Q04 | Đạt với 3 Hub và horizon 6 giờ. Mất 445,2 ms từ enqueue tới khi đọc Completed. Có ca kiểm worker nhường event loop. [Số đo](measurements.json) |
| Q05 | Ca lỗi snapshot và Recovery UI đạt. Mục tiêu phục hồi 5 phút của thiết kế cũ chưa đo. |
| Q06 | Ca phân quyền REST, owner và payload WebSocket đạt. |
| Q07 | Ca Edge ngắt WebSocket, sửa pin từ phiên khác và hội tụ sau reconnect đạt. |
| Q08 | Cài từ lockfile, build và chạy bản build qua Playwright đạt trên máy kiểm chứng. |

- **E2E-1 đạt.** Tìm và đặt xe, nhận ACK, đổi đích, trả và đọc hóa đơn.
- **E2E-2 đạt.** Đặt đỗ và lịch sạc, thử vượt công suất, chọn rồi xác nhận phương án thay thế. Phiên đầu vẫn giữ nguyên.
- **E2E-3 đạt.** Kiểm ngưỡng và tiếp nhận cảnh báo. Cô lập cổng đang cấp điện, kiểm tác động và khôi phục sau ACK dừng.
- **E2E-4 đạt.** Điều phối đến Hub đích, đối chiếu cùng xe và slot trên backend. Preview và áp dụng lịch sạc.
- **E2E-5 đạt.** Lưu kịch bản, chạy, đọc so sánh và mở lại kết quả. Ca API kiểm trạng thái live và ca engine kiểm khuyến nghị.
- **E2E-6 đạt.** Dừng hẳn server, mở lại và kiểm ID/số tiền hóa đơn. Ca Edge riêng thực hiện phần reconnect.

Các ca trên dùng thiết bị giả lập. Nhóm cần chạy thử tay sáu chuỗi trên máy trình diễn, xác nhận đóng góp cá nhân, đối chiếu bản Final và slide trước khi nộp.

Phần BTL1–BTL3 trong PDF được lấy từ các trang trước bookmark Submission 4 của bản Final có sẵn trong repo.
