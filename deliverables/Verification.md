# Kiểm chứng MVP — Smart E-Mobility Hub

Bản chạy cục bộ trên Windows, Node.js 24.18.0, Microsoft Edge, dữ liệu seed ba Hub. Bảng này ghi hành vi được kiểm bằng ca tự động trong `tests/` và phép đo theo seed. Đề bài và các kết quả cần xác nhận khi nhóm diễn tập trên máy nộp bài.

Kết quả lần chạy bàn giao: build và typecheck đạt, 23 ca nghiệp vụ/API và 7 ca trình duyệt Edge đạt.

## Truy vết nghiệp vụ

| Mục PRD | Hành vi có bằng chứng | Nguồn kiểm |
|---|---|---|
| A01–A02 | Lỗi 401 và 403, Student B không đọc lượt đặt Student A và không thể hủy theo ID. Xe pin thấp bị từ chối. | `core.test.ts`, `realtime.spec.ts` |
| A03–A05 | Hub đích hết chỗ không giữ xe. Lỗi đổi đích giữ hold cũ. 20 request tranh một xe hoặc slot riêng cuối cùng chỉ có một thành công mỗi ca. | `core.test.ts`, `m2.test.ts` |
| A06–A08 | Hết hạn nhả tài nguyên. ACK chưa xác định giữ hold, ACK đến sau TTL vẫn tạo đúng một Trip. Chỗ nguồn nhả một lần. Sai Hub hay thiếu chứng cứ ở chế độ thủ công giữ Trip mở. Trả lặp một hóa đơn, chỗ hỏng được sửa trong cùng Hub hoặc ghi sự cố để Operator tiếp nhận. | `core.test.ts`, `flows.spec.ts` |
| A09–A11 | Yêu cầu sạc lặp giữ một phiên. Cổng không tương thích và sai chủ bị từ chối. Có ca interval chạm biên, xung đột và skipConflicts. Fixture 4 kWh, 20–70%, 2 kW cho năng lượng 2 kWh trong 60 phút. | `m2.test.ts`, `flows.spec.ts` |
| A12–A13 | Hai phiên 2 kW tranh giới hạn 3 kW. StopPending qua giờ kết thúc vẫn giữ điện, ACK dừng giữ đầu cắm cho tới khi rút. | `m2.test.ts`, `m3.test.ts` |
| A14 | Ngưỡng 89→90→85→84% chạy trên fixture 100 slot qua REST. Demo 15 slot chạy mở tại 14/15, acknowledge và đóng tại 12/15. Kiểm dữ liệu stale theo heartbeat. | `m2.test.ts`, `flows.spec.ts` |
| A15–A17 | Thiếu hold rollback cả lần confirm. Lệnh còn đang vận chuyển không hủy toàn bộ. Thay xe có reservation và giữ hold. Tác động lên item giữ nguyên departedAt và hold. Điểm sạc có luồng sự cố cô lập/khôi phục. | `m2.test.ts`, `m3.test.ts`, `flows.spec.ts` |
| A18 | Kế hoạch không ghi đè tài nguyên khi preview. Heartbeat không liên quan không chặn apply. Thay đổi tài nguyên thật chặn áp dụng và giữ phân bổ cũ. | `m3.test.ts` |
| A19–A21 | Kết quả tính xác định, kịch bản trung tính có delta 0. Fixture baseline 2 nhận/1 từ chối, kịch bản 1 nhận/2 từ chối. Run ghi kết quả, giữ nguyên tài nguyên live do engine và chuyển lượt gián đoạn thành Failed sau restart. | `m3.test.ts`, `flows.spec.ts` |
| A22–A25 | Lỗi ghi trước commit, kết quả replace bất định, backup Recovery, cả hai bản hỏng, lệnh giữ ID qua restart, retry và xung đột idempotency. | `core.test.ts` |
| A26 | WS thiếu phiên bị từ chối. Thay đổi chỉ gửi thông báo phiên bản chung. Kết nối lại nhận phiên bản hiện tại và GET hội tụ, vẫn kiểm quyền sở hữu. | `core.test.ts`, `realtime.spec.ts` |

## Yêu cầu chất lượng

| Mục | Minh chứng |
|---|---|
| Q01 | Hai bài tranh tài nguyên, 20 request một xe và 20 request một slot riêng. Mỗi bài chỉ có một thành công. |
| Q02 | Phép đo Edge từ lúc gửi thay đổi pin đến khi hiển thị cập nhật. Xem `evidence/realtime.json`. Khoảng đo bao gồm thời gian gửi yêu cầu trước commit. |
| Q03–Q04 | Đã đo p95 cho 120 lượt đọc HTTP localhost và thời gian hoàn tất What-if 3 Hub/6 giờ. Xem [measurements.json](measurements.json). |
| Q05 | Thử lỗi snapshot bằng fixture, kiểm trạng thái Recovery và chặn ghi. Phục hồi kỹ thuật được kiểm trong môi trường mô phỏng. |
| Q06–Q07 | Ca role/owner qua REST và WS đã chạy. Kiểm GET sau khi kết nối lại. |
| Q08 | Đường chạy từ lockfile, bản đã build và kiểm thử Playwright dùng server đã build. |

## Phạm vi và điều còn mở

- Bài kiểm tra trên giả lập và seed cục bộ. Không suy rộng p95 từ các route đọc sang tải thật hoặc mọi route. Chưa đo thời gian phục hồi sau lỗi thật theo mục tiêu cũ 5 phút.
- Luồng trình duyệt kiểm Student, sạc riêng, cảnh báo, điều phối, sự cố, áp dụng lịch sạc và What-if. Ca restart dừng hẳn tiến trình, mở lại bản build, đăng nhập trên Edge và xác minh cùng ID/số tiền hóa đơn. Recovery và WebSocket reconnect có ca kiểm API hoặc hạ tầng riêng.
- Phạm vi UI giữ nhận xe theo token đặt trước. Trả xe vào chỗ đang giữ hoặc chỗ thay thế hợp lệ cùng Hub, không dùng làn overflow. Sau khi trả xe, Student có thể yêu cầu sạc cho chính xe vừa trả trong cửa sổ demo 30 phút. Operator có thể tạo yêu cầu trong demo. Lịch sạc xếp phiên Waiting, bảo toàn phiên đã cam kết.
- Dữ liệu, lệnh và ACK được mô phỏng trong cùng backend. Kiểm npm audit của dependency runtime không báo lỗi. Audit toàn bộ dependency còn báo cảnh báo bắc cầu cho bộ công cụ Vite dùng khi build. Cần xác minh nếu nối thiết bị hay phần cứng thật.
- Nguồn báo cáo phần #1–#3 chọn `btl3_se_final.pdf` theo bản chung đã được nêu trước đó. Phần bổ sung trong PDF thể hiện hành vi bản chạy. Tài liệu cũ ở các chương thiết kế có thể chứa mô tả lịch sử khác với mã nguồn. Nhóm cần xác nhận phần đóng góp của từng thành viên và lịch trình diễn.

Các lệnh có thể chạy lại nằm trong [README](../README.md).
