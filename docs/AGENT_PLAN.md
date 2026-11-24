# Kế hoạch hoàn thiện Smart E-Mobility Hub

**Cập nhật 23/11/2026.** Các gói triển khai 1–3 đã có mã và kiểm thử. Gói 4 đạt kiểm chứng tự động trên Windows và Edge. Số đo, ảnh và ma trận của lần chạy này nằm trong [hồ sơ kiểm chứng](../deliverables/Verification.md). Gói 5 còn phần nhóm xác nhận đóng góp, chạy thử tay trên máy trình diễn và chốt bản nộp. Nội dung phía dưới ghi lại baseline và tiêu chí giao việc ban đầu.

Rà soát ngày 23/11/2026 tại commit `dc1bb01` trên `main`. Dùng [PRD](PRD.md) làm chuẩn nghiệm thu, [kiến trúc](ARCHITECTURE.md) để tìm điểm sửa và [hồ sơ kiểm chứng](../deliverables/Verification.md) để truy vết lần bàn giao trước.

## Repo đang ở đâu

- **G0–G1 · Nền tảng đã chạy.** React/Vite, Fastify, đăng nhập hai vai trò, seed 3 Hub, 12 xe dùng chung, 45 chỗ và 6 cổng. Store tuần tự hóa ghi, kiểm version, lưu kết quả retry, duy trì snapshot chính/dự phòng có checksum. Có kiểm thử tranh tài nguyên, lỗi ghi, restart và ACK. Còn một nhánh đối soát Recovery cần xử lý ở gói 1. Nguồn chính là `src/api/store.ts`, `src/api/app.ts` và `tests/core.test.ts`.
- **G2 · UC01–06 đã có luồng xuyên suốt.** Student lọc xe, đặt xe cùng chỗ trả, nhận bằng token và ACK, đổi đích, trả và xem hóa đơn. Đã kiểm hai người tranh xe, đổi đích thất bại giữ chỗ cũ, ACK muộn và trả lặp. Nguồn chính là `src/api/m1.ts`, `src/web/student.tsx` và `tests/browser/flows.spec.ts`.
- **G3 · UC07–09 đã có nghiệp vụ và UI.** Sạc xe vừa trả, đặt đỗ lặp, bỏ qua buổi xung đột, vào/rời chỗ, ước lượng năng lượng, đặt lịch sạc và giữ công suất khi chờ ACK dừng. Test API kiểm hai phiên 2 kW tranh Hub giới hạn 3 kW. Bằng chứng trình duyệt cho nhánh chọn phương án thay thế còn thiếu. Xem `src/api/m2.ts` và `tests/m2.test.ts`.
- **G4 · UC10–13 đã có luồng Operator.** Dashboard theo Hub, heartbeat, mở/tiếp nhận/đóng cảnh báo, báo sự cố, cô lập/khôi phục và điều phối từng xe với chỗ đích. Có ca API cho ngưỡng 89→90→85→84%, thiếu chỗ khi xác nhận lệnh và sự cố item đang đi. Xem `src/web/operator.tsx`, `src/api/m2.ts`, `src/api/m3.ts`.
- **G5 · UC14–16 đã có lịch sạc và What-if.** Preview/apply lịch ưu tiên có kiểm lại tài nguyên. Operator tạo/sửa kịch bản, chạy trên snapshot và đọc Baseline, What-if, delta. Fixture 2 xe/2 chỗ/3 yêu cầu cho đúng kết quả 2 nhận/1 từ chối và 1 nhận/2 từ chối. Còn chênh lệch về khuyến nghị và cách thực thi mô phỏng ở gói 3. Xem `src/api/m3.ts`, `src/web/scenarios.tsx` và `tests/m3.test.ts`.
- **G6–G7 · Đã có bản bàn giao.** Repo có README, ma trận kiểm chứng, số đo, 14 ảnh demo, PDF Final và slide. `Verification.md` và `evidence.json` ghi 23 ca API/nghiệp vụ của lần bàn giao trước. Bộ hiện tại có thêm 8 ca. Việc xác nhận đóng góp, diễn tập và chốt bản nộp thuộc nhóm.

### Kết quả kiểm trên checkout này

Windows, Node 24.15.0, npm 11.12.1, Edge, CPU i5-1240P, RAM 15,7 GiB. Đã cài từ lockfile, chạy `npm.cmd run build` (gồm typecheck), `npm.cmd test` và `npm.cmd run test:e2e` với `E2E_CHANNEL=msedge`. Build đạt, 31/31 ca nghiệp vụ/API và 7/7 ca trình duyệt báo đạt. Bảy ca Playwright có cả kiểm bàn phím và realtime. Số ca chạy không biểu thị số yêu cầu PRD đã nghiệm thu.

- Q02 có 5 lần đổi pin. Lâu nhất **258,4 ms** từ gửi HTTP đến UI hiển thị, trong ngưỡng 2 giây.
- Q03 có 120 lượt đọc tuần tự trên bốn route sau warm-up. **p95 2,4 ms**, trong ngưỡng 1 giây cho mẫu này.
- Q04 chạy What-if 3 Hub, 6 giờ. Từ gửi yêu cầu đến quan sát trạng thái Completed là **489,9 ms**, trong ngưỡng 5 giây.

Q03–Q04 dùng `tools/measure.ts` trong thư mục tạm để giữ số đo gốc của máy bàn giao. Sau khi cả bảy ca Edge báo đạt, Playwright vẫn đợi web server test thoát trên Windows. Lần rà soát này đã dừng riêng tiến trình server test để runner kết thúc với mã 0. Gói 4 cần kiểm lại bước dọn tiến trình trên máy demo. Kết quả tự động và đo trên checkout này cần đi cùng buổi kiểm thử tay theo Definition of Done của PRD.

## Thứ tự giao việc cho một agent tích hợp

### 1. Chốt hành vi Recovery khi backup có lệnh chờ

**Ưu tiên cao nhất · G1, A23–A24, Q05.** Trong `runTick` ở `src/api/app.ts`, lệnh có `dispatchedAt === null` vẫn được đóng dấu đã gửi khi đang Recovery. Với `autoAck` bật, kiểm tra tiếp theo có thể xác nhận lệnh ngay trong tick đó. Do snapshot dự phòng có thể cũ hơn trạng thái thiết bị, Operator cần phân biệt trường hợp này với restart bình thường.

- Dùng thư mục tạm để tái hiện hai trường hợp riêng: restart từ snapshot chính hợp lệ và khởi động từ backup có lệnh Pending. Kiểm cả lệnh chưa gửi và lệnh đã gửi.
- Giữ khả năng tiếp tục lệnh với cùng ID sau restart bình thường. Trong Recovery, giữ nguyên tài nguyên cho đến khi có kết quả đối soát rõ ràng. Bảo đảm Operator xử lý được cả trường hợp lệnh chưa có `dispatchedAt` từ màn hình Điều khiển demo.
- **Nghiệm thu:** nạp backup hiển thị phiên bản và lý do, chặn ghi nghiệp vụ, tick không tự tạo Trip/cấp điện dựa riêng vào bản backup, đối soát hai lần chỉ tạo một tác động. Restart giữa lúc đối soát vẫn giữ được trạng thái cần xử lý. Thêm ca hồi quy vào `tests/core.test.ts` và một ca UI cho Q05.

### 2. Khép khoảng trống ở luồng Student và hợp đồng dữ liệu

**G2–G4, A02, A09–A14, A26.** Làm sau khi có baseline của gói 1. Chia thành các thay đổi nhỏ nếu cần.

- **Telemetry và nhận xe.** Sự kiện pin trong `src/api/app.ts` gắn thời gian hiện tại và tăng sequence ở server. PRD §5.1 yêu cầu bỏ qua gói cũ/trùng có ghi lý do. Bổ sung đường mô phỏng gói đến sai thứ tự. Dùng clock kiểm thử để xác minh quá 60 giây hoặc xe lỗi thì UI có lý do và API từ chối. Backend đang kiểm điều kiện lúc pickup trong M1, nhưng nút nhận trên UI chủ yếu dựa vào token. Hiển thị điều kiện nhận riêng cho người đang giữ xe.
- **Sạc riêng E2E-2.** Mở rộng ca hiện có trong `tests/browser/flows.spec.ts`. Dùng hai xe có booking giao nhau, đưa phiên đầu 2 kW vào lịch của Hub 3 kW. Với phiên thứ hai, thử 2 kW, thấy lý do và khung/công suất thay thế, chọn phương án và xác nhận. Kiểm phiên đầu giữ nguyên, phiên mới nằm trong giờ đỗ và tổng công suất hợp lệ. Chụp màn hình tại bước xung đột và kết quả.
- **Hợp đồng và realtime.** PRD §5.1 yêu cầu ISO UTC, còn nhiều trường API/snapshot hiện là epoch mili giây. PRD §8 mô tả sự kiện có metadata và lọc sự kiện cũ, còn `app.ts` phát `type/stateVersion` và `src/web/client.ts` gọi GET lại. Lập danh sách chênh lệch cho người tích hợp chốt. Khi đổi định dạng, kiểm đọc snapshot cũ, hiển thị giờ Việt Nam, bỏ qua bản tin cũ và GET lại sau mất đoạn. Giữ phạm vi dữ liệu theo quyền.
- **Nghiệm thu:** có bằng chứng UI và API cho A02, E2E-2 đủ chuỗi, có test thứ tự gói và có quyết định được ghi cho từng chênh lệch hợp đồng. Các thay đổi hành vi so với PRD cần chủ dự án xác nhận.

### 3. Hoàn thiện khuyến nghị What-if và kiểm độ đáp ứng

**G5, FR-15/16, PRD §7.3 và §11.** Trong `src/api/m3.ts`, nhánh `ChargingReview` hiện hướng Operator sang màn hình lịch sạc. Hàm `simulate` chạy vòng lặp tick đồng bộ. Việc gọi `await computeSimulation(...)` ở bên ngoài chưa tạo điểm nhường giữa các tick.

- Từ snapshot của run, trả khung giờ/cổng/công suất thay thế đã kiểm trên toàn khoảng, hoặc lý do không tìm được phương án. Kiểm lại cả chỗ đích của gợi ý điều phối khi scenario đã chặn slot. Hiển thị căn cứ trong `src/web/scenarios.tsx`.
- Chia nhỏ phần tính toán để API và heartbeat tiếp tục được phục vụ trong lúc mô phỏng. Giữ cùng thứ tự tick, seed, trạng thái live và thời gian lưu kết quả như thiết kế.
- **Nghiệm thu:** test phương án khả thi và bất khả thi, kịch bản trung tính có delta 0, fixture A20 vẫn đúng, A21 giữ nguyên tài nguyên live. E2E-5 đọc được lý do và đọc lại được kết quả sau khi mở lại trang. Đo lại Q04 và kiểm tiến độ API/heartbeat khi run đang chạy.

### 4. Đóng G6 bằng ma trận kiểm chứng trên máy demo

**Phụ thuộc các gói 1–3.** Trong `deliverables/Verification.md`, ghi từng mục A01–A26, Q01–Q08 và E2E-1–6 với ca kiểm cụ thể, kết quả, commit, lệnh chạy và môi trường. Phân biệt API, Playwright và kiểm tay.

- E2E-3 kiểm tác động sự cố lên phiên hoặc lịch thật. E2E-4 kiểm Hub, xe và slot sau khi đến. E2E-6 đã có restart process và so ID/số tiền hóa đơn. Bổ sung phần Q07 bằng một trình duyệt ngắt WS, cho phiên khác thay đổi trạng thái rồi nối lại và kiểm UI hội tụ.
- Chạy cài từ lockfile, build, bộ test API, Edge và `tools/measure.ts` trên máy trình diễn. Ghi các ca lỗi hoặc chưa chạy. Chỉ công bố mục tiêu phục hồi 5 phút nếu đã đo.
- **Nghiệm thu:** người tích hợp tự chạy sáu chuỗi từ seed đã biết, đối chiếu các ảnh và số đo với từng mục tiêu, xác nhận lỗi nào còn ảnh hưởng đến demo.

### 5. Chốt G7 và hồ sơ nộp

**Sau G6.** Cập nhật `deliverables/evidence.json`, ảnh, README, tài liệu kiến trúc, PDF và slide theo cùng bản đã nghiệm thu. Dùng PDF BTL3 chung do nhóm xác nhận khi chạy lại `tools/build_final_report.py --baseline ...`. Kiểm lại số test, số đo, ảnh và các giả định in trong báo cáo.

**Nghiệm thu:** nhóm kiểm PDF/slide, ghi công cụ AI và đóng góp thực tế từng người, xác nhận máy/giờ trình diễn và diễn tập. Người tích hợp quyết định commit nộp cuối.

## Prompt giao việc đầu tiên

> Đọc docs/AGENT_PLAN.md mục 1, docs/PRD.md §5.4, src/api/app.ts, src/api/store.ts, src/web/demo.tsx và tests/core.test.ts. Dùng thư mục dữ liệu tạm để viết ca thể hiện khác biệt giữa restart bình thường và Recovery từ backup có lệnh Pending. Sửa đường startup/tick và màn hình đối soát để đạt tiêu chí ở mục 1. Giữ nguyên commandId, quyền sở hữu hold và idempotency. Chạy test liên quan, toàn bộ npm test, build và ca Recovery trên Edge. Bàn giao danh sách file đổi, lệnh thực chạy, kết quả và một kịch bản để người tích hợp thử bằng tay.
