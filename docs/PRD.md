# PRD — Smart E-Mobility Hub MVP

Phiên bản 1.0 · Ngày 17/11/2026 · Submission 4, CNPM CO3001 · Nhóm Musketeers

**Mô hình thực hiện:** một người làm đầu mối lập trình, tích hợp và nghiệm thu, với AI agent hỗ trợ từng hạng mục.

## 1. Mục tiêu và cách dùng tài liệu

Xây dựng ứng dụng web chạy trên một máy, cho phép sinh viên sử dụng xe điện dùng chung, đặt chỗ và sạc xe cá nhân; Operator giám sát, xử lý sự cố, điều phối và chạy What-if. Sản phẩm phải thể hiện được các luồng xuyên module bằng thao tác thực tế, dữ liệu thay đổi nhất quán và có khả năng chạy lại demo.

PRD này là đầu vào triển khai MVP và kiểm chứng kết quả. Người thực hiện giao từng giai đoạn cho AI agent, đọc thay đổi, chạy ứng dụng, kiểm thử và giải thích được các quy tắc quan trọng trước khi chuyển giai đoạn.

### 1.1. Nguồn và mức độ quyết định

| Ký hiệu | Nguồn | Vai trò |
|---|---|---|
| S1 | BTL_SoftwareEngineering_HK261_v1.pdf, Project guidelines và Submission #final | Yêu cầu của môn học |
| S2 | BTL3_CNPM_MUSKETEERS.pdf, chương 3–8 | Use case, UI, kiến trúc, class/method và test case hiện có |
| S3 | phan_cong_BTL3_chi_tiet(2).md, bản sửa 01/11, D1–D6 | Quyết định thiết kế Accepted của nhóm |
| S4 | huong_dan_module2_BTL3(3).md, bản 1.1 | Hướng dẫn M2 và định hướng công nghệ |
| S5 | Phan_cong_Submission4_Musketeers.md | Kế hoạch trước khi gộp đầu mối triển khai |

Công nghệ và bất biến dữ liệu ghi là “đã chốt” lấy từ S3/S4/S5. API, cấu trúc repo, fixture, công thức mặc định bổ sung và thứ tự triển khai trong PRD là đề xuất thực thi mới. Bản phan_cong.md ngày 31/10 được S3 dẫn chiếu nhưng chưa được cung cấp trực tiếp. Các chữ ký khác nhau giữa S2/S3 cần hợp nhất trong code, giữ hành vi và quyền sở hữu đã chốt.

S2 mô tả frontend HTML/CSS/JavaScript, S3 chốt React + TypeScript + Vite. PRD dùng S3 và yêu cầu đồng bộ hai view trong báo cáo Final.

### 1.2. Đánh giá phương án một người + AI

Phương án phù hợp khi có một người hiểu thiết kế, kiểm soát hợp đồng, đọc code và trực tiếp kiểm thử. Tập trung tích hợp giúp giảm thời gian phối hợp giữa ba người viết code. Phần tốn công nhất vẫn là giao dịch tài nguyên, ACK, sự cố và mô phỏng.

S1 yêu cầu các thành viên tham gia công việc, hiểu sản phẩm và đánh giá đóng góp cuối kỳ. Đề có cho sử dụng AI với khai báo minh bạch. Việc gộp đầu mối code là tổ chức triển khai của nhóm; từng thành viên vẫn cần đóng góp thực tế như rà yêu cầu, thử ứng dụng, kiểm báo cáo và trình diễn. Ghi đúng người thực hiện từng phần và mức AI tham gia.

Hạn nộp, repo hiện tại và số giờ rảnh chưa được xác nhận. Lịch triển khai dùng các mốc nghiệm thu G0–G7, chưa gán cam kết ngày hoàn thành.

## 2. Người dùng và kết quả mong đợi

| Vai trò | Mục đích | Quyền chính |
|---|---|---|
| Student | Tìm xe, đi lại, đặt đỗ/sạc xe riêng | Truy vấn mạng lưới; thao tác tài nguyên thuộc mình; xem lịch và thông báo của mình |
| Operator | Duy trì khả dụng của mạng lưới | Dashboard, cảnh báo, sự cố, điều phối, lập lịch sạc, What-if |
| Device Simulator | Cung cấp trạng thái thiết bị và ACK | Đi qua entry point nội bộ, cùng quy tắc giao dịch |

Tiêu chí thành công gồm có đủ luồng chính của 16 UC, hai vai trò dùng chung trạng thái backend, thao tác làm thay đổi dữ liệu có thể kiểm chứng, restart giữ được giao dịch đã lưu và mô phỏng tái lập được với cùng đầu vào.

## 3. Phạm vi MVP

### 3.1. Phạm vi hoàn thành

- UC01–07 cho xe dùng chung và chỗ đỗ đích.
- UC08–09 cho đặt chỗ xe cá nhân, đặt lặp có giới hạn và đăng ký sạc.
- UC10–11 cho giám sát, telemetry và cảnh báo.
- UC12–14 cho điều phối, sự cố và lịch sạc ưu tiên.
- UC15–16 cho cấu hình và chạy Baseline/What-if có khuyến nghị.
- Tài khoản mẫu Student/Operator, phân quyền API, dữ liệu seed, snapshot, cơ chế giả lập có kiểm soát.
- Hướng dẫn chạy, kiểm thử các bất biến quan trọng, chuỗi ảnh demo và dữ liệu phục vụ khai báo AI.

### 3.2. Giả lập và giới hạn sản phẩm

| Thành phần | Mức triển khai MVP |
|---|---|
| IoT, mở khóa, cắm/rút và ACK | Bộ giả lập trong backend, trạng thái và sự kiện đi qua nghiệp vụ thật |
| QR nhận xe | Hiển thị token/QR và cho nhập token để mô phỏng quét; camera là mở rộng |
| Thanh toán | Tính và lưu hóa đơn nội bộ, hiển thị rõ giao dịch mô phỏng |
| Bản đồ | Sơ đồ Hub 2D hoặc danh sách có vị trí, khoảng cách tính từ tọa độ seed |
| Thông báo | Trong ứng dụng và WebSocket |
| What-if | Mô hình tài nguyên rời rạc có giả định công khai, kết quả tính được |
| Quy mô | Một process, một máy, bộ dữ liệu nhỏ cho bài học |

Tích hợp ngân hàng, thiết bị vật lý, SSO trường, email/SMS, triển khai cloud và bản đồ 3D thuộc hướng phát triển sau MVP. Nhánh cứu hộ được thể hiện bằng ghi nhận sự cố và tác vụ Operator xử lý; báo cáo phải nêu mức giả lập. Phạm vi này là đề xuất MVP, cần đồng bộ với phần thiết kế rộng hơn của nhóm.

## 4. Công nghệ và tổ chức hệ thống

| Tầng | Công nghệ đã chốt |
|---|---|
| Web | React + TypeScript + Vite |
| API | Node.js + TypeScript + Fastify |
| Kiến trúc | Modular monolith với M1, M2, M3 |
| Giao tiếp | HTTP/REST và WebSocket |
| Lưu trữ | InMemoryRepository, seed.json, snapshot.json, snapshot.prev.json |
| Giao dịch | TransactionManager.run(ctx, fn), một khóa ghi chung |
| Giả lập | Jobs và Device Simulator cùng backend process |
| Môi trường | Windows, VS Code, trình duyệt, localhost |

Giữ phiên bản đang hoạt động trong repo nếu có. Khi khởi tạo mới, chọn các phiên bản tương thích, ghi cụ thể vào README và khóa dependency bằng lockfile. PRD chưa chốt số phiên bản. Đề xuất dùng npm workspaces nếu repo mới; dùng CSS có tổ chức theo component và UI hiện có làm chuẩn. Bộ kiểm thử phải hỗ trợ TypeScript, API và trình duyệt; chọn công cụ khi kiểm tra repo, tái sử dụng bộ đang có.

| Vị trí đề xuất | Nội dung |
|---|---|
| apps/web/src/features/student | Hub, xe, đặt xe, chuyến đi, đặt đỗ/sạc, lịch cá nhân |
| apps/web/src/features/operator | Dashboard, sự cố, điều phối, lịch sạc, What-if |
| apps/web/src/shared | Layout, UI, API client, session, WebSocket |
| apps/api/src/modules/m1 | User, xe, lượt đặt, chuyến đi, hóa đơn, yêu cầu sạc |
| apps/api/src/modules/m2 | Hub, slot, đặt đỗ, phiên sạc, telemetry, cảnh báo, sự cố |
| apps/api/src/modules/m3 | Điều phối, kế hoạch sạc, mô phỏng |
| apps/api/src/shared | Auth, AccessPolicy, ActorContext và hợp đồng |
| apps/api/src/infrastructure | Transaction, snapshot, clock, simulator và realtime |
| packages/contracts | DTO, enum, định dạng lỗi và sự kiện dùng chung |
| data | Seed và snapshot theo môi trường |
| tests | Kiểm thử unit, tích hợp và E2E cần thiết |

Tên thư mục là đề xuất. Ranh giới module và chủ ghi vẫn được giữ khi một người viết toàn bộ.

## 5. Quy ước dữ liệu và giao dịch

### 5.1. Kiểu dữ liệu

- ID là chuỗi duy nhất, bất biến. Bản ghi có version phục vụ phát hiện cập nhật cũ.
- Thời gian truyền API và lưu file theo ISO 8601 UTC, giao diện hiển thị Asia/Ho_Chi_Minh.
- Khoảng đặt trước dùng [startAt,endAt). Hai khoảng xung đột khi start1 < end2 và start2 < end1. endAt=null của hold đích được coi là vô hạn.
- batteryPercent trong [0,100], dung lượng kWh và công suất kW dương, tiền VND dùng số nguyên.
- Trạng thái thiếu telemetry thể hiện Unknown. Gói cũ hoặc trùng được xác định bằng sequence/source timestamp và bỏ qua có ghi lý do.
- ActorContext lấy từ phiên đăng nhập, gồm actorId, role, requestId. Quyền sở hữu kiểm ở service/API.

### 5.2. Thực thể tối thiểu

| Nhóm | Thực thể và trường quan trọng |
|---|---|
| M1 | User(id,role); SharedVehicle(id,hubId,slotId,mobilityStatus,healthStatus,allocationOwner,version); SharedReservation(id,userId,vehicleId,holdId,status,expiresAt); Trip(id,userId,vehicleId,holdId,status,startedAt,endedAt); Invoice(tripId,amountVnd); ChargingRequest(vehicleId,ownerId,targetPercent,status) |
| M2 đỗ | Hub(id,name,location,powerLimitKW); ParkingSpace(id,hubId,type,physicalStatus,operationalStatus,vehicleId); ParkingReservation(id,slotId,ownerType,ownerId,startAt,endAt,status,serviceStatus,guarantee); RecurrenceRule(id,weekdays,localTime,startDate,endDate) |
| M2 sạc | PrivateVehicle(id,userId,plate,connectorType,capacityKWh); ChargingPoint(id,hubId,connectorType,ratedKW,operationalStatus,occupancy); ChargingSession(id,vehicleRef,pointId,parkingReservationId,startAt,endAt,powerKW,targetPercent,status,commandId) |
| M2 vận hành | VehicleTelemetry(vehicleRef,batteryPercent,observedAt,sequence); Alert(id,type,hubId,status,acknowledgedAt); Incident(id,resourceRef,status); IncidentImpact(incidentId,targetRef,outcome); MaintenanceTicket(incidentId,status); Notification(userId,eventId,readAt) |
| M3 | RedistributionOrder(id,sourceHubId,destinationHubId,status); RedistributionItem(id,orderId,vehicleId,holdId,status,departedAt,arrivedAt); ChargingPlan(id,hubId,baseVersion,allocations,status); SimulationScenario(id,config); SimulationRun(id,configSnapshot,networkSnapshot,seed,status,resultId); SimulationResult(runId,baseline,scenario,delta,recommendations) |
| Hạ tầng | PendingCommand(commandId,type,resourceId,status,expiresAt,attempts); IdempotencyRecord(actorId,operation,requestId,payloadHash,result); OperationalEvent(id,type,actorId,occurredAt,payload) |

### 5.3. Bất biến phải được kiểm thử

1. Một xe chỉ có một allocationOwner hợp lệ tại một thời điểm.
2. Một slot không cấp cho các lượt giữ chỗ giao nhau. Tình trạng vật lý, vận hành và lịch được kiểm cùng nhau.
3. Lượt đặt xe đang hiệu lực, Trip có đích và item điều phối Allocated/InTransit/NeedsOperatorAction có đúng một hold đích đúng chủ.
4. Khi đặt xe, giữ xe và giữ slot thành công hoặc thất bại cùng nhau. Đổi đích thực hiện nguyên tử, thất bại giữ hold cũ.
5. Hết 15 phút chưa nhận xe thì giải phóng reservation hợp lệ. UnlockPending có lệnh chưa xác định được giữ để đối soát, tránh cấp xe cho người khác.
6. Khi nhận xe, chuyển chủ hold từ SHARED_RESERVATION sang TRIP trong cùng giao dịch tạo Trip.
7. Tới đích hợp lệ thì chuyển slot sang Occupied và kết thúc hold trong cùng tx. Trả xe nhầm Hub/slot hoặc thiếu xác nhận phải trả lý do, giữ Trip còn hiệu lực.
8. Mỗi cổng có tối đa một phiên chiếm dụng vật lý. Các lịch tương lai của cùng cổng không chồng lấn. Tổng công suất đồng thời không vượt powerLimitKW.
9. Cổng còn Occupied/NeedsClear vẫn bị chặn cấp vật lý, kể cả phiên đã ngừng tiêu thụ điện.
10. Thao tác retry không tạo thêm Trip, hold, phiên sạc, notification hoặc lệnh điều phối.
11. Snapshot lỗi trước commit không làm thay đổi trạng thái đã công bố hoặc gửi tác động ra ngoài.
12. What-if không sửa xe, slot, phiên sạc và hold của mạng lưới live. Việc lưu metadata/kết quả run vẫn được phép.

### 5.4. Commit, crash và phục hồi

Entry point mở tx một lần, dùng khóa ghi chung và bản nháp sâu. Port liên module nhận tx này. Snapshot ghi qua file tạm cùng thư mục, kiểm tính hợp lệ, giữ bản chính cũ đã xác minh làm bản dự phòng rồi thay bản chính bằng thao tác phù hợp hệ điều hành. Chỉ công bố RAM sau khi snapshot mới lưu thành công. Phải thử lỗi ở các bước ghi và thay file trên máy demo.

Sau nhả khóa mới gửi WebSocket và command. PendingCommand được lưu cùng giao dịch tạo yêu cầu. Nếu process dừng sau commit trước khi gửi, khởi động lại tìm command chưa giải quyết và gửi/đối soát bằng cùng commandId. ACK xử lý trong tx mới và chống trùng. WebSocket bị mất được phục hồi bằng tải lại read model.

Khởi động xác minh schemaVersion/checksum của snapshot chính. Nếu hỏng, thử snapshot.prev.json và vào Recovery, đối soát tài nguyên/lệnh chờ trước khi nhận thao tác mới. Nếu cả hai hỏng thì báo lỗi phục hồi. Seed chỉ nạp khi khởi tạo mới rõ ràng. Chọn bản dự phòng có thể lùi trạng thái, phải hiển thị việc phục hồi và số phiên bản đã nạp.

## 6. Yêu cầu chức năng và acceptance criteria

### FR-00 — Đăng nhập và phân quyền

Có hai tài khoản Student và một Operator dùng cho demo. Student A chỉ xem/sửa booking của A, Student B dùng kiểm tra tranh chấp. Operator có các trang vận hành. API trả 401 khi thiếu phiên, 403 khi không có quyền. WebSocket chỉ gửi thông tin phù hợp vai trò/chủ thể. Cơ chế session theo thư viện đang dùng trong repo; agent phải hiện thực và kiểm quyền phía server.

### FR-01/02 — UC01–02, tìm Hub và xem xe

Hiển thị Hub, chỗ khả dụng, cổng sạc, xe, pin, thời gian cập nhật, trạng thái thiết bị. Lọc theo Hub và loại xe. Xe bị cấp phát/bảo trì hoặc telemetry quá 60 giây không được đặt mới. Giữ riêng canReserve và canPickup. Ngưỡng pin đặt/nhận tối thiểu 20%, ngưỡng sau trả 60%, mục tiêu sạc mặc định 80% lấy từ thiết kế.

**Nghiệm thu:** thay đổi pin/trạng thái qua simulator được phản ánh khi tải lại hoặc nhận realtime; xe không đủ điều kiện có lý do cụ thể và backend từ chối khi gọi API trực tiếp.

### FR-03/04 — UC03–04, đặt xe và giữ/đổi chỗ đích

Student chọn xe, Hub đích, xác nhận; backend kiểm lại điều kiện ở thời điểm commit. Tạo reservation hạn 15 phút, token nhận xe và hold slot SHARED tại đích. Đổi đích trong reservation/trip dùng cùng quy tắc nguyên tử. Hết chỗ trả lỗi và danh sách Hub thay thế có khả dụng.

**Nghiệm thu:** hai Student tranh xe/slot cuối chỉ một thành công; thất bại giữ đích không để xe bị giữ; đổi sang Hub đầy không mất hold cũ; retry trả cùng kết quả.

### FR-05 — UC05, nhận xe

Nhập/quét token, xác minh chủ, hạn và điều kiện xe. Chuyển UnlockPending, lưu commandId/expiresAt, commit rồi gửi simulator. ACK xác nhận mở thành công tạo Trip đúng một lần và chuyển chủ hold. Đối soát sau 5 giây, tối đa hai lần cách nhau 5 giây theo quyết định đã chốt. UI hiển thị đang xác nhận, thành công, thất bại hoặc cần Operator xử lý.

**Nghiệm thu:** ACK lặp không sinh Trip mới. Mất ACK giữ trạng thái chưa xác định, không tính phí và không cấp lại xe. Job hết hạn không tự nhả xe đang UnlockPending.

### FR-06 — UC06, trả xe

Student chọn hoàn tất trả tại Hub đích; simulator xác nhận slot, khóa và sự hiện diện. Cùng tx cập nhật Occupied, kết thúc hold/Trip, giải phóng quyền cấp xe, tạo hóa đơn. Xe health OK và pin ≥60% về khả dụng, pin thấp chuyển trạng thái cần sạc theo enum hiện có.

**Nghiệm thu:** trả hai lần chỉ có một hóa đơn; sai Hub hoặc chưa có xác nhận giữ Trip đang mở. Nếu slot đích bị chiếm bất thường, thử slot hợp lệ khác trong cùng Hub bằng tx; nếu thiếu, tạo yêu cầu Operator xử lý. Overflow được thể hiện bằng vùng/slot giả lập có sức chứa riêng nếu giữ nhánh này từ S2, không tăng chỗ đỗ thường ngầm.

### FR-07 — UC07, yêu cầu sạc xe dùng chung

Tạo ChargingRequest từ xe đã đỗ và có nhu cầu sạc. M2 cấp cổng phù hợp hoặc đưa Waiting. Khi cấp được, lưu command và bắt đầu theo ACK. Mục tiêu mặc định 80%, cấu hình được.

**Nghiệm thu:** yêu cầu lặp không tạo phiên song song; cùng hàm cấp phát và kiểm công suất được dùng cho UC09/14.

### FR-08 — UC08, đỗ xe cá nhân

Student chọn xe cá nhân, Hub, start/end; xem chi phí và xác nhận. Backend kiểm interval, slot phù hợp và quyền sở hữu. Hỗ trợ lịch lặp theo thứ/ngày kết thúc với tối đa 12 tuần/84 buổi. Preview trả từng buổi khả dụng/xung đột. Confirm kiểm lại toàn bộ; skipConflicts=false thì thất bại nguyên tử khi có xung đột, true thì lưu các buổi hợp lệ và trả danh sách bỏ qua.

**Nghiệm thu:** [08:00,09:00) và [09:00,10:00) dùng chung slot được; preview không giữ tài nguyên; người khác lấy slot trước confirm phải được phát hiện. Xe cũ chưa rời thì tìm slot thay thế, nếu thiếu cập nhật Delayed/NotGuaranteed và thông báo.

### FR-09 — UC09, sạc xe cá nhân

Yêu cầu có booking đỗ hoặc đang đỗ được xác nhận, cổng tương thích và lịch sạc nằm trong thời gian được phép đỗ. Nhập pin hiện tại, pin mục tiêu, dung lượng pin; server tính năng lượng và thời lượng. Chọn giờ/công suất rồi xác nhận. Khi cổng/công suất thiếu, gợi ý giờ khác hoặc công suất thấp hơn đáp ứng toàn bộ thời lượng.

**Nghiệm thu:** pin 4 kWh từ 20% lên 70%, công suất 2 kW, hiệu suất 1 cần 2 kWh và 60 phút. Không cấp lịch vượt thời gian đỗ hoặc giới hạn công suất; xác nhận dùng dữ liệu mới nhất.

### FR-10/11 — UC10–11, Dashboard và cảnh báo

Operator xem KPI xe, chỗ đỗ, cổng, công suất, chi tiết từng Hub. Simulator phát dữ liệu mỗi 2 giây ở cấu hình demo đề xuất. Hub mất heartbeat >10 giây chuyển Unknown/Stale. Cảnh báo đỗ dựa trên occupied vật lý; khả năng cấp chỗ tính hợp các tập occupied, blocked và hold/lịch xung đột, tránh đếm trùng.

Cảnh báo đỗ mở ≥90%, đóng <85%. Acknowledge chỉ ghi người/thời điểm và tắt âm thanh. Hết cổng khả dụng tạo cảnh báo riêng. Quyết định MVP giữ chính sách S2 tạm ngưng đặt đỗ mới khi cảnh báo đỗ đang mở; cảnh báo hết cổng chỉ chặn cấp sạc. Cần ghi rõ hiệu chỉnh nếu nhóm chọn chính sách khác.

**Nghiệm thu:** 89→90→85→84% lần lượt bình thường, mở, còn mở, giải quyết; Hub không có slot hiển thị Unknown. Mất heartbeat không tự biến xe/slot thành khả dụng. Client reconnect tải lại snapshot hiển thị.

### FR-12 — UC12, điều phối

Operator chọn Hub nguồn/đích và số xe, xem đề xuất, xác nhận. Xác nhận cấp xe và hold cho từng item trong cùng tx, thiếu tài nguyên thì thất bại toàn lần xác nhận. Cho xuất phát từng item và ghi departedAt; arrival xác minh xe/Hub, cập nhật slot, nhả hold và quyền điều phối. Có hủy trước khi bất kỳ item nào xuất phát.

Order dùng Proposed/Confirmed/InTransit/Arrived/Completed/PartiallyCompleted/Failed/Cancelled. Item dùng Proposed/Allocated/InTransit/NeedsOperatorAction/Arrived/Completed/Dropped/Cancelled. Tình trạng order được suy từ item và lịch sử xuất phát. Lệnh có item unresolved còn mở; terminal có tất cả Completed thì Completed, có cả thành công và thất bại thì PartiallyCompleted, không có thành công và có lỗi thì Failed; Cancelled chỉ cho hủy hợp lệ trước xuất phát.

**Nghiệm thu:** item gặp sự cố sau xuất phát vẫn được nhận diện bằng departedAt; hủy toàn lệnh bị từ chối; xử lý một item không làm mất hold các item khác.

### FR-13 — UC13, sự cố và khôi phục

Operator chọn xe/cổng, lý do và xác nhận cô lập. Student có thể báo sự cố từ chuyến đi, Operator tiếp nhận. Tạo Incident, ảnh hưởng và ticket. Đánh giá các booking/session/item đang gắn tài nguyên. M2 gọi port M1/M3 để cập nhật đúng chủ.

| Tình huống MVP | Xử lý bắt buộc |
|---|---|
| Xe rảnh hỏng | Maintenance, chặn cấp xe mới |
| Xe đã đặt hỏng, chưa nhận | Thử thay xe cùng Hub đủ điều kiện; cập nhật reservation nguyên tử; nếu thiếu thì hủy và nhả tài nguyên đúng chủ, thông báo |
| Xe đang In-Use hoặc UnlockPending | Giữ quyền cấp phát, ghi yêu cầu Operator hỗ trợ/đối soát, tránh tự chuyển xe đang chạy sang Available |
| Cổng có lịch tương lai bị hỏng | Thử chuyển cổng tương thích cùng Hub, kiểm công suất; nếu thiếu thì hủy/đánh dấu bị ảnh hưởng và thông báo |
| Cổng đang sạc hỏng | Gửi dừng, giữ phần công suất chưa được xác nhận ngắt và occupancy, chờ ACK/đối soát |
| Item điều phối bị ảnh hưởng | Gọi H6, item NeedsOperatorAction, giữ hold cho item đã cấp/đang đi đến khi được xử lý hợp lệ |
| Hoàn tất sửa chữa | Operator xác nhận; kiểm health, occupancy, owner, pin và lệnh chờ trước khi mở lại khả dụng |

Bảng này là lựa chọn phạm vi MVP, cần đối chiếu bảng INC 9 tình huống trong tài liệu chuẩn nếu cung cấp thêm.

**Nghiệm thu:** gửi lại incident action cùng ID không nhân đôi ticket hay đổi tài nguyên hai lần. Khôi phục cổng vẫn đang occupied không cho cấp vật lý mới.

### FR-14 — UC14, lịch sạc ưu tiên

Thu thập ứng viên đủ điều kiện, pin, thời điểm cần sẵn sàng, thời gian chờ, cổng và powerLimit. Tính P = w1*(100-X) + w2/deltaHours theo S2. Đề xuất mới cho giá trị còn thiếu gồm w1=1, w2=10, deltaHours=max(1/60,(neededAt-now)/1 giờ); thiếu neededAt thì thành phần thời gian bằng 0. Tie-break theo waitedAt sớm hơn, rồi ID. Hiển thị trọng số và lý do thứ hạng.

Theo thứ tự ưu tiên, tìm cổng tương thích và khung sớm nhất đủ thời gian/công suất; giữ các phiên đang chạy và lịch đã cam kết. Dời lịch chưa chạy chỉ khi kế hoạch thay thế xác nhận nguyên tử, còn chỗ đỗ và thông báo người bị ảnh hưởng. Override thứ hạng vẫn kiểm các ràng buộc. Preview có baseVersion, confirm kiểm lại khả dụng.

**Nghiệm thu:** kế hoạch quá hạn hoặc tài nguyên bị thay đổi phải tính lại/từ chối với lỗi rõ ràng; áp dụng thất bại giữ lịch cũ. Hai xe cùng P ưu tiên xe chờ lâu hơn.

### FR-15/16 — UC15–16, What-if

Tạo kịch bản với tên, Hub, thời gian, tăng/giảm nhu cầu thuê và sạc, tỷ lệ cổng hỏng và số slot bị chặn. Chạy trên bản sao cố định của mạng lưới, cùng cấu hình gốc và seed. Lưu Running/Completed/Failed, lỗi và kết quả. So sánh mỗi metric bằng scenario minus baseline. Khuyến nghị chỉ là đề xuất; Operator dùng luồng điều phối/lịch sạc riêng để thực hiện.

**Nghiệm thu:** tham số không đổi cho kết quả bằng baseline; cùng snapshot/config/seed cho kết quả bằng nhau; đóng/mở trang đọc lại được kết quả đã lưu; trạng thái live không đổi bởi engine.

## 7. Mô hình tính toán MVP

### 7.1. Công suất và sạc

EnergyNeededKWh = capacityKWh*(targetPercent-currentPercent)/100.
DurationMinutes = ceil(60*EnergyNeededKWh/(powerKW*efficiency)).

Đề xuất efficiency=1 để khớp fixture S2, cấu hình và hiển thị rõ là mô hình giả lập. Kiểm công suất tại tất cả mốc start/end giao nhau, cộng phiên đang dùng và phần công suất chưa xác nhận dừng. Lịch chạm đầu/cuối không giao nhau. Giả lập tăng pin theo năng lượng tích lũy, giới hạn 100% và mục tiêu; sau đạt mục tiêu thực hiện dừng/ACK theo cùng state machine.

Session dùng Scheduled/Waiting/Starting/Charging/StopPending/Completed/Stopped/Cancelled/Failed. ACK bắt đầu hợp lệ chuyển Starting→Charging. Yêu cầu dừng chuyển Charging→StopPending; ACK dừng chuyển Completed nếu đạt mục tiêu, Stopped nếu dừng sớm. Cancelled cho lịch chưa bắt đầu; Failed cho lỗi xác định đã xử lý trạng thái vật lý. Thiếu ACK giữ trạng thái cần đối soát.

### 7.2. Phí demo

Nếu repo/tài liệu nguồn có công thức phí, dùng lại. Khi chưa có, đề xuất cấu hình demo 1.000 VND/phút đi xe và 2.000 VND/giờ đỗ, làm tròn lên đơn vị tính và hiển thị trước xác nhận. Đây là giả định mới để demo, cần ghi vào phần phạm vi báo cáo. Tổng tiền lưu lúc chốt giao dịch để kết quả cũ không thay đổi khi sửa cấu hình.

### 7.3. Thuật toán What-if đề xuất để có thể hiện thực

Đây là mô hình bổ sung cho MVP, chưa phải thuật toán đã được xác nhận trong S2. Mô hình chạy bước thời gian 5 phút, tối đa 6 giờ, trên 3 Hub seed. Giới hạn này cấu hình được và dùng để giữ thời gian chạy kiểm soát được.

1. Capture mạng lưới và các lịch đang hiệu lực với stateVersion. Sao chép độc lập thành baseline và scenario. Tạo một luồng nhu cầu xác định từ seed, gồm lượt thuê (Hub nguồn/đích/thời điểm/thời lượng) và yêu cầu sạc (Hub/kWh/giờ đến). Cùng các demand ID cơ sở ở cả hai nhánh.
2. Scenario áp dụng tỷ lệ nhu cầu bằng phép lấy mẫu theo hash(seed,demandId) và thêm demand có ID xác định khi tỷ lệ tăng. Chọn cổng/slot bị vô hiệu hóa theo ID đã sắp xếp, áp dụng và ghi cách làm tròn. Dữ liệu phát sinh ổn định khi chạy lại.
3. Mỗi tick xử lý theo thứ tự cố định gồm hoàn tất chuyến đi, xác nhận sạc hoàn tất và giải phóng theo mô hình, lượt đến/nhu cầu mới, cấp phát và thu thập chỉ số. Cùng thời điểm sắp theo ID.
4. Lượt thuê được nhận khi có xe đủ pin và slot đích hợp lệ. Cấp xe, giải phóng vị trí nguồn khi xuất phát và giữ slot đích. Khi đến, đưa xe vào slot, cập nhật pin theo tiêu hao giả lập được cấu hình, kết thúc hold.
5. Nếu thiếu xe hoặc slot, ghi từ chối theo nguyên nhân, lượt thuê đó kết thúc. Nhu cầu sạc phải có chỗ đỗ và cổng tương thích; yêu cầu chờ nằm trong hàng đợi và được xếp theo công thức FR-14.
6. Với nguồn lực đang bị hỏng/chiếm hoặc có lịch cam kết từ snapshot, giữ ràng buộc. Khi không thể giải quyết xung đột do scenario gây ra, ghi affectedCount và nguyên nhân.
7. Không cho bộ engine truy cập repository live. Khi engine kết thúc, mở tx ngắn lưu SimulationResult và cập nhật run; metadata lưu kết quả được tách khỏi phần trạng thái vận hành dùng để so sánh cô lập.

Các tham số đề xuất gồm thời lượng chuyến đi 15 phút, tiêu hao 5 điểm phần trăm pin/chuyến và demand schedule seed. UI kết quả hiển thị các giả định. Giữ engine tái sử dụng hàm kiểm chỗ/công suất thuần để tránh khác quy tắc live.

| Chỉ số | Định nghĩa |
|---|---|
| servedTrips/rejectedTrips | Số lượt thuê được nhận/từ chối trong horizon, kèm lý do |
| peakParkingOccupancy | Max số occupied vật lý chia số slot vận hành dùng được theo tick; mẫu số 0 là null |
| waitingChargingMinutes | Tổng thời gian đợi sạc, gồm thời gian bị kiểm duyệt đến cuối horizon cho yêu cầu còn chờ |
| meanChargingWait | Tổng waitingChargingMinutes / số yêu cầu sạc đến trong horizon; không có yêu cầu thì null; hiển thị số còn chờ |
| energyDeliveredKWh | Tổng năng lượng thực cấp theo thời gian mô phỏng |
| affectedCount | Booking/phiên đang cam kết bị ảnh hưởng bởi kịch bản |

Khuyến nghị dùng quy tắc có thể giải thích. Thiếu xe tại Hub A và có xe dư ở B thì gợi ý chuyển số xe bị chặn bởi cả lượng dư và chỗ nhận ở A. Thiếu công suất thì gợi ý lịch khác được checkWindow chấp nhận. Bãi đầy thì gợi ý Hub khác có khả dụng. Nếu không có phương án khả thi, trả lý do. Kết quả ghi snapshotVersion và thời điểm để người dùng biết dữ liệu gốc của đề xuất.

Fixture số đơn giản gồm 2 xe tại A, 2 slot đích trống tại B và 3 yêu cầu A→B cùng lúc. Baseline nhận 2, từ chối 1. Scenario chặn 1 slot đích nhận 1, từ chối 2. Delta servedTrips=-1, rejectedTrips=+1. Đưa fixture này vào test thuần của engine.

## 8. Màn hình và hành vi UI

Dùng UI đã có trong S2/Figma làm nguồn bố cục. Khi không có file Figma trực tiếp, đối chiếu ảnh trong báo cáo và ghi lại những chỗ điều chỉnh. Mức ưu tiên hiển thị gồm trạng thái, lý do không khả dụng, hành động tiếp theo và kết quả vừa thực hiện.

| Màn hình | Nội dung/hành động | FR |
|---|---|---|
| Đăng nhập | Tài khoản mẫu, lỗi đăng nhập, chuyển trang theo vai trò | 00 |
| Student — Hub và xe | Tìm/lọc Hub, pin và freshness, xem chi tiết, đặt xe | 01–03 |
| Student — Xác nhận đặt xe | Hub đi/đích, slot khả dụng, thời hạn, kết quả/token nhận xe | 03–04 |
| Student — Chuyến đi | Nhận xe và trạng thái ACK, đổi đích, trả xe, báo sự cố | 04–06,13 |
| Student — Lịch của tôi | Reservation, Trip, booking đỗ/sạc, hóa đơn, thông báo | 03–09 |
| Student — Đỗ xe cá nhân | Xe, Hub, khoảng giờ, lịch lặp, preview xung đột và confirm | 08 |
| Student — Sạc | Pin, mục tiêu, giờ, năng lượng/thời lượng, lịch và trạng thái | 07,09 |
| Operator — Dashboard | KPI và Hub, xe/slot/cổng, freshness và công suất | 10 |
| Operator — Cảnh báo | Danh sách, lọc còn mở, chi tiết, acknowledge | 11 |
| Operator — Sự cố | Ghi nhận, tài nguyên ảnh hưởng, phương án xử lý, ticket, khôi phục | 13 |
| Operator — Điều phối | Tạo đề xuất, xác nhận, xuất phát/đến theo item, hủy hợp lệ | 12 |
| Operator — Lịch sạc | Thứ tự, điểm ưu tiên, preview công suất, override và confirm | 14 |
| Operator — What-if | Kịch bản, chạy, trạng thái, baseline/scenario/delta, khuyến nghị | 15–16 |
| Operator — Điều khiển demo | Sinh ACK, lỗi, thay pin, heartbeat, cắm/rút theo nghiệp vụ | Hạ tầng |

Mọi trang dữ liệu có loading, empty, error và success. Nút đang gửi khóa tạm để giảm bấm lặp; backend vẫn xử lý idempotency. Khi lỗi mạng, hiển thị khả năng thử lại với cùng requestId cho cùng thao tác. Form giữ dữ liệu khi thất bại. Thao tác tài nguyên chưa xác nhận không hiển thị thành công sớm.

WebSocket payload gồm eventId, type, entityRef, stateVersion, occurredAt và dữ liệu phù hợp quyền. Client bỏ qua sự kiện cũ; phát hiện mất đoạn hoặc reconnect thì GET lại read model. Server gửi sau commit. Tiền, giờ và đơn vị hiển thị nhất quán. UI cho phép thao tác bàn phím và gắn label với input; trạng thái dùng cả chữ và màu.

## 9. Hợp đồng API đề xuất

REST prefix /api. GET chỉ đọc. Lệnh ghi nhận requestId, expectedVersion nếu sửa bản ghi đang tồn tại, input theo schema. requestId dùng lại khi retry cùng thao tác, cấp ID mới khi người dùng đổi nội dung. Namespace idempotency theo actor + operation + requestId. HTTP status 400 cho input sai, 401/403 cho phiên/quyền, 404 cho tài nguyên không có, 409 cho xung đột nghiệp vụ/version, 503 cho lỗi lưu tạm thời và 500 cho lỗi hệ thống chưa dự kiến.

Envelope thành công dạng `{data, stateVersion, requestId}`; lỗi dạng `{error:{code,message,details}, requestId}`. Quyền của route được kiểm trước và kiểm lại owner/guard trong nghiệp vụ. Input server từ chối ID, enum hoặc giờ không hợp lệ. Các lỗi dự kiến gồm NO_PARKING_CAPACITY, VEHICLE_UNAVAILABLE, STALE_TELEMETRY, VERSION_CONFLICT, TIME_SLOT_CONFLICT, POWER_CAPACITY_EXCEEDED, DEVICE_PENDING, INVALID_TRANSITION và IDEMPOTENCY_CONFLICT.

| Method và path | Input chính | Output chính |
|---|---|---|
| POST /auth/login, POST /auth/logout, GET /auth/me | Thông tin đăng nhập | Phiên và vai trò |
| GET /hubs, GET /hubs/:id, GET /vehicles | Bộ lọc | Hub/xe và khả dụng/freshness |
| POST /reservations | vehicleId, destinationHubId | Reservation, hold, token, expiresAt |
| GET /me/reservations, GET /me/trips | Bộ lọc trạng thái | Dữ liệu thuộc Student |
| POST /reservations/:id/cancel | version, reason | Kết quả nhả tài nguyên |
| POST /reservations/:id/pickup | token, version | commandId và UnlockPending/Trip |
| POST /trips/:id/change-destination | newHubId, version | Hold mới hoặc lỗi giữ hold cũ |
| POST /trips/:id/return | hubId, slotId, version | Trạng thái xác nhận hoặc Trip/Invoice |
| GET /me/private-vehicles | — | Xe cá nhân |
| POST /parking/preview | privateVehicleId, hubId, khoảng giờ/lặp | Chi phí và khả dụng từng buổi |
| POST /parking/bookings | Input preview, skipConflicts | Booking được tạo và buổi bỏ qua |
| GET /me/parking-bookings | Khoảng thời gian | Booking cá nhân |
| POST /charging/preview | vehicleRef, parkingRef, target, time | Năng lượng, thời lượng, lựa chọn |
| POST /charging/bookings | Lựa chọn đã xem trước | Session hoặc lỗi xung đột |
| POST /charging/requests | Xe dùng chung, target | ChargingRequest và Waiting/Starting |
| POST /charging/sessions/:id/stop | version, reason | StopPending hoặc kết quả dừng |
| GET /me/charging-sessions, GET /me/notifications | Bộ lọc | Phiên/thông báo thuộc mình |
| GET /operator/overview, GET /operator/alerts | hubId/status | Read model/cảnh báo |
| POST /operator/alerts/:id/acknowledge | version | Cảnh báo đã ghi nhận |
| POST /incidents | resourceRef, description, tripId nếu có | Báo cáo sự cố; quyền theo actor |
| GET /operator/incidents | Bộ lọc | Incident/ticket/ảnh hưởng |
| POST /operator/incidents/:id/isolate | version | Tác động và kết quả cô lập |
| POST /operator/incidents/:id/restore | version, resolution | Trạng thái phục hồi |
| GET/POST /operator/redistributions | Query hoặc Hub nguồn/đích, quantity | Danh sách hoặc đề xuất |
| POST /operator/redistributions/:id/confirm | version | Order với item đã cấp |
| POST /operator/redistributions/:id/start | itemIds, version | departedAt và trạng thái |
| POST /operator/redistributions/:id/arrivals | itemId, hubId | Item và order sau khi đến |
| POST /operator/redistributions/:id/cancel | version, reason | Kết quả hủy hoặc từ chối |
| POST /operator/redistributions/:id/resolve-item | itemId, action, version | Kết quả xử lý item theo guard |
| POST /operator/charging-plans/preview | hubId, overrides | Kế hoạch và baseVersion |
| POST /operator/charging-plans/:id/apply | version | Kế hoạch áp dụng |
| GET/POST /operator/scenarios | Query hoặc config | Danh sách/kịch bản |
| PATCH /operator/scenarios/:id | version, config | Cấu hình cập nhật |
| POST /operator/scenarios/:id/runs | requestId | runId và trạng thái |
| GET /operator/runs/:id | — | Tiến độ, kết quả hoặc lỗi |
| POST /operator/demo/events | Loại sự kiện giả lập, tham số | Kết quả đi qua nghiệp vụ |
| GET /health, GET /ready | — | Process và trạng thái sẵn sàng/phục hồi |
| WS /ws | Phiên hợp lệ | Sự kiện theo vai trò |

Agent có thể điều chỉnh path theo repo nhưng phải giữ bảng hợp đồng và UI client đồng bộ. Bổ sung endpoint đọc chi tiết khi màn hình cần. Device ACK là entry point nội bộ của simulator. Demo events chỉ hoạt động trong cấu hình demo và quyền Operator, kiểm guard như thao tác bình thường.

### Port nội bộ

M2 cung cấp H1 cho giữ/đổi/chuyển chủ/nhả hold, H2 cho checkWindow, H3 cho cô lập/khôi phục, H5 cho phiên sạc và kế hoạch. M1 cung cấp H4 cho cấp xe, xuất phát, đến, giải phóng, health và trạng thái sạc. M3 cung cấp H6 cho tác động sự cố lên item điều phối. R1/R2 đọc xe/telemetry; P1/P2 ghi OperationalLog và Notification. Các port ghi nhận cùng tx do entry point mở.

## 10. Dữ liệu demo và kiểm soát giả lập

Bộ dữ liệu dưới đây là fixture mới đề xuất, liên kết ID nhất quán.

| Nhóm | Dữ liệu |
|---|---|
| Người dùng | STUDENT_A, STUDENT_B, OPERATOR_A |
| Hub | H_METRO, H_KTX, H_BK; mỗi Hub 10 slot SHARED, 5 slot PRIVATE |
| Xe dùng chung | 12 xe phân bố 6/4/2; pin rải 15%, 25%, 65%, 90%; health/trạng thái phù hợp |
| Xe cá nhân | PV_A thuộc STUDENT_A, PV_B thuộc STUDENT_B; dung lượng 4 kWh, connector phù hợp |
| Cổng sạc | Mỗi Hub 2 cổng 2 kW, powerLimitKW=3 để kiểm xung đột công suất |
| Slot/cổng hiện tại | Mọi xe đỗ có slot tương ứng, phiên đang chạy có cổng và power allocation |
| Clock | Thời gian demo khởi tạo từ hiện tại, lịch tương lai tính tương đối; có clock kiểm thử cố định |

Seed phải qua validator của ứng dụng, kiểm tham chiếu, occupied/vehicle, owner và lịch. Tình huống đầy bãi, mất ACK, lỗi snapshot, sự cố và mô phỏng là fixture riêng hoặc chuỗi thao tác đã xác định; không trộn trạng thái bất nhất vào seed mặc định.

Operator demo panel cho dừng heartbeat một Hub, phát lại heartbeat, gửi ACK/mất ACK, thay đổi pin hợp lệ, ghi nhận cắm/rút và tạo sự cố. Thay đổi chiếm dụng dùng các xe giả lập có ID để số liệu vật lý nhất quán. Reset về seed có xác nhận rõ, chỉ hoạt động ở môi trường demo, yêu cầu xử lý sạch các job/command đang chờ. Script test dùng thư mục dữ liệu tạm riêng.

## 11. Yêu cầu chất lượng và vận hành

Các mục tiêu sau là tiêu chí kỹ thuật đề xuất cho bộ seed nhỏ, cần đo trên máy demo và ghi cấu hình. Số liệu là mục tiêu nghiệm thu, chưa phải kết quả thực tế.

| ID | Mục tiêu | Cách kiểm |
|---|---|---|
| Q01 | 20 yêu cầu đồng thời tranh tài nguyên cuối vẫn giữ bất biến | Test API concurrent và kiểm snapshot |
| Q02 | Sự kiện đã commit xuất hiện ở client đang kết nối trong ≤2 giây | Đo commit timestamp đến UI trên localhost |
| Q03 | Các API thông thường p95 ≤1 giây trên seed, mẫu tối thiểu 100 request | Ghi cấu hình máy và số mẫu, báo kết quả |
| Q04 | What-if 3 Hub, 6 giờ kết thúc ≤5 giây trên máy demo | Chạy fixture xác định; báo thời gian |
| Q05 | Snapshot phục hồi được và UI hiển thị chế độ phục hồi | Test restart, snapshot lỗi, backup lỗi |
| Q06 | Student không đọc/sửa tài nguyên riêng của Student khác và route Operator | Test quyền/owner cho REST và dữ liệu WS |
| Q07 | Trình duyệt reconnect tải lại trạng thái nhất quán | Ngắt WS, tạo giao dịch rồi nối lại |
| Q08 | Build và chạy được trên máy demo theo README | Chạy từ bộ seed với lệnh đã công bố |

Mục tiêu phục hồi ≤5 phút từ thiết kế cũ chỉ được ghi đạt khi có phép đo. Giữ việc tính simulation ngoài khóa ghi, chia theo tick có nhường event loop để API và heartbeat tiếp tục hoạt động. Kết quả run lưu bằng tx ngắn. Khi đóng process, dừng nhận công việc mới và xử lý việc ghi đang chạy theo vòng đời server.

## 12. Ma trận kiểm chứng bắt buộc của bản MVP này

| Test ID | FR | Given / When / Then |
|---|---|---|
| A01 | 00 | Student gọi route Operator → 403; đọc booking người khác bị từ chối |
| A02 | 01–02 | Telemetry >60 giây hoặc health lỗi → UI có lý do, API đặt xe từ chối |
| A03 | 03–04 | Xe còn nhưng Hub đích đầy → reservation/hold/owner không được tạo |
| A04 | 03,08 | 20 request tranh xe/slot cuối → đúng một yêu cầu được cấp |
| A05 | 04 | Đổi sang Hub đầy → hold cũ còn nguyên |
| A06 | 03–05 | Hết hạn reservation bình thường → nhả; UnlockPending → giữ chờ đối soát |
| A07 | 05 | ACK lặp hoặc retry pickup → chỉ một Trip, hold đúng chủ |
| A08 | 06 | Return sai Hub/slot → Trip còn mở; return hợp lệ hai lần → một Invoice |
| A09 | 07,09 | Request trùng → một session; cổng không tương thích → từ chối |
| A10 | 08 | Khoảng chạm biên được cấp; overlap bị từ chối; skipConflicts đúng kết quả từng buổi |
| A11 | 09 | Pin 4 kWh,20→70%,2 kW →2 kWh/60 phút; vượt lịch đỗ bị từ chối |
| A12 | 09,14 | Hai phiên 2 kW giao nhau ở Hub limit 3 kW → phiên/kế hoạch sau bị từ chối |
| A13 | 09,13 | StopPending chưa ACK vẫn giữ công suất; ACK dừng với cổng occupied vẫn chặn cấp vật lý |
| A14 | 10–11 | 89→90→85→84% → đúng vòng đời alert; mất heartbeat >10 giây → Stale |
| A15 | 12 | Confirm thiếu xe/hold → rollback; item xuất phát → hủy toàn lệnh bị từ chối |
| A16 | 13 | Sự cố xe đã đặt → thay hợp lệ hoặc hủy sạch; incident action lặp → một tác động |
| A17 | 13 | Sự cố item InTransit → NeedsOperatorAction, departedAt và hold còn đúng |
| A18 | 14 | Preview xong có thay đổi tài nguyên → apply kiểm lại; lỗi giữ lịch cũ |
| A19 | 15–16 | Cùng config/snapshot/seed → cùng kết quả; config trung tính → delta bằng 0 |
| A20 | 16 | Fixture 2 xe/2 slot/3 lượt → baseline 2/1; chặn 1 slot → scenario 1/2 |
| A21 | 16 | So sánh trạng thái vận hành trước/sau run → xe/slot/hold/session không đổi do engine |
| A22 | Hạ tầng | Inject lỗi lưu snapshot trước commit → RAM cũ, không command/event ngoài |
| A23 | Hạ tầng | Crash sau commit trước gửi command → restart đối soát cùng ID, không thao tác trùng |
| A24 | Hạ tầng | Hỏng main → Recovery từ backup; hỏng cả hai → lỗi có thể chẩn đoán |
| A25 | Hạ tầng | Retry cùng payload → cùng result; cùng ID khác payload → 409 |
| A26 | UI/WS | Ngắt/nối WS → số liệu hội tụ về read model mới, Student không nhận dữ liệu riêng của người khác |

Dùng unit test cho interval, priority, công suất, state guard và engine. Dùng integration test qua Fastify và lưu file tạm cho transaction/concurrency/recovery. Dùng E2E cho các kịch bản dưới đây. Chỉ tạo test gắn với hành vi hoặc hồi quy cụ thể, tránh test lặp lại cấu trúc code.

### Kịch bản demo và ảnh báo cáo

- E2E-1 — Student A tìm xe → đặt kèm chỗ đích → nhận qua ACK → đổi đích → trả → xem hóa đơn. Chụp trạng thái trước, reservation, Trip và kết quả trả.
- E2E-2 — Đặt chỗ xe cá nhân → đặt sạc → thử khung vượt công suất → chọn phương án hợp lệ. Chụp booking, lỗi và lịch cuối.
- E2E-3 — Operator mở Dashboard → tăng chiếm dụng tới ngưỡng → acknowledge → tạo sự cố cổng → quan sát ảnh hưởng → phục hồi hợp lệ.
- E2E-4 — Tạo điều phối → xác nhận → xuất phát → đến → kiểm Hub/xe/slot cập nhật. Tiếp tục preview/apply lịch sạc.
- E2E-5 — Tạo What-if → chạy → xem baseline/scenario/delta và lý do khuyến nghị; kiểm mạng lưới live.
- E2E-6 — Restart từ snapshot và chạy tiếp; kiểm mất WS và tải lại trạng thái.

## 13. Kế hoạch hiện thực cho một người và AI agent

Người thực hiện giữ quyền quyết định nghiệp vụ, review và nghiệm thu. Agent triển khai theo các gói nhỏ có đầu ra chạy được, dùng lại code trong repo. Ưu tiên một agent tích hợp chính để giữ cùng ngữ cảnh. Nếu dùng thêm agent review, giao phạm vi cụ thể và hợp nhất thay đổi bằng review của người thực hiện.

| Mốc | Hạng mục | Điều kiện chuyển mốc |
|---|---|---|
| G0 | Kiểm repo/tài liệu, thống nhất enum/DTO, cấu hình tech, khung API/web, seed và tài khoản mẫu | Cài/build/typecheck được, login và đọc Hub từ backend |
| G1 | Transaction, repository, snapshot, idempotency, Clock, simulator/ACK và auth guards | A01,A22–A25 chạy đạt với dữ liệu tạm; có ví dụ command phục hồi |
| G2 | UC01–06 theo một luồng UI xuyên M1/M2, realtime cơ bản | E2E-1, A02–A08 đạt; nguyên tử và nhận/trả có bằng chứng |
| G3 | UC07–09, interval, công suất, lịch lặp và ACK sạc | E2E-2, A09–A13 đạt |
| G4 | UC10–13, Dashboard, cảnh báo, sự cố, điều phối | E2E-3/4 phần điều phối, A14–A17,A26 đạt |
| G5 | UC14–16, scheduler và mô phỏng | A18–A21 đạt, E2E-4 phần sạc và E2E-5 chạy được |
| G6 | Kiểm toàn bộ, xử lý lỗi tích hợp, kiểm build trên máy demo và đo Q01–Q08 | Có bảng kết quả thật, các bất biến quan trọng đạt |
| G7 | Chuỗi ảnh, README chạy demo, cập nhật báo cáo/AI/slide và tập trình bày | File nộp và bản chạy cùng phiên bản, mọi người giải thích được phần của mình |

Sau G0, ước lượng số giờ cho từng mốc theo code còn thiếu. Giữ khoảng 20–30% thời gian thực còn lại cho sửa lỗi/tích hợp/demo. Nếu thiếu thời gian, ưu tiên giảm trang trí và tích hợp ngoài; mọi thay đổi phạm vi chức năng phải được ghi lại trong PRD và báo cáo.

### Prompt khởi động cho AI agent

> Đọc PRD.md và các tài liệu CNPM có trong repo. Kiểm tra code hiện tại, xác định phần đã có và phần còn thiếu cho G0. Dùng React + TypeScript + Vite, Node.js + TypeScript + Fastify, modular monolith và cơ chế lưu snapshot đã mô tả. Hoàn thiện G0 qua đường chạy bình thường, giữ tương thích với code đang có. Chạy build/typecheck và kiểm login/đọc Hub. Báo các tệp đã đổi, lệnh kiểm tra thực sự chạy, kết quả, giả định và vấn đề còn lại. Ghi trạng thái vào bảng tiến độ hiện có, sau đó thực hiện mốc kế tiếp trong phạm vi được giao.

### Mẫu giao một task tiếp theo

> Thực hiện [mốc/FR] của PRD.md. Đọc các service, DTO, UI và test hiện có liên quan trước khi sửa. Bàn giao luồng UI → API → dữ liệu; dùng cùng TransactionManager và port liên module. Viết/chạy các test [Axx] cho các bất biến được yêu cầu. Kiểm build và thao tác bình thường. Ghi phần hoàn thành, phần chưa chạy, giả định đã thêm và những thay đổi cần cập nhật báo cáo.

### Review của người thực hiện sau mỗi mốc

1. Khởi động ứng dụng và tự thực hiện luồng mới bằng giao diện.
2. Kiểm một lỗi nghiệp vụ và một lần retry liên quan.
3. Đọc phần chuyển trạng thái, giao dịch và snapshot nếu task chạm vào chúng.
4. Đối chiếu API/DTO/UI với yêu cầu và kết quả test thực chạy.
5. Ghi lại đóng góp AI và chỉnh sửa của người thực hiện; commit phần đã nghiệm thu.

Agent được xử lý lựa chọn kỹ thuật thông thường trong phạm vi PRD. Khi nguồn thiết kế mâu thuẫn, agent ghi rõ hai mô tả, đề xuất cách thống nhất và tiếp tục các phần độc lập. Với giá trị mặc định đã ghi trong PRD, được dùng để hiện thực và đánh dấu là giả định mới trong báo cáo.

## 14. Đầu ra cuối cùng và Definition of Done

| Đầu ra | Điều kiện |
|---|---|
| Mã nguồn MVP | Một repo có web/API, seed, cấu hình mẫu, lockfile và lệnh chạy |
| README | Cài dependency, dev/build/start, test, reset demo, tài khoản mẫu, phục hồi và giới hạn |
| Kiểm chứng | Bảng A01–A26 ghi pass/fail/chưa chạy, lệnh và kết quả; Q01–Q08 có số đo khi công bố đạt |
| Demo | E2E-1–6 chạy trên máy trình diễn từ bộ dữ liệu đã biết |
| Ảnh báo cáo | Từ ứng dụng thực, theo chuỗi thao tác và có kết quả |
| PDF Final | Nội dung Submission 1–3, minh chứng demo, khai báo AI theo S1 |
| Slide | Bài toán, luồng chính, quyết định kỹ thuật, giới hạn, bài học và đóng góp |

Một mốc hoàn thành cần có hành vi qua UI/API, dữ liệu đúng, test liên quan chạy đạt và kiểm thử tay của người thực hiện. Một chức năng chỉ có form hoặc chỉ có endpoint được ghi đang làm. Phần giả lập được ghi rõ trong UI demo và báo cáo.

### Nội dung khai báo AI cần thu thập

Công cụ/model dùng, thời gian hoặc giai đoạn, task AI hỗ trợ, mức sinh nội dung/code, phần con người đọc/chỉnh sửa, các test đã chạy và giới hạn chưa giải quyết. Chỉ điền thông tin thật. Mỗi thành viên ghi đúng đóng góp của mình khi tham gia rà yêu cầu, test, báo cáo và demo.

## 15. Giả định mới, vấn đề còn mở và cập nhật báo cáo

| Mục | Mặc định/việc cần xử lý |
|---|---|
| Vai trò đầu mối | Một người chịu trách nhiệm tích hợp; người cụ thể do nhóm tự ghi |
| Công thức priority | Giữ dạng P trong S2; w1,w2, đơn vị và epsilon trong §6 là đề xuất MVP |
| What-if | Mô hình tick, demand, các giới hạn và tiêu hao pin ở §7 là đề xuất cần giải thích trong báo cáo |
| Phí | Dùng công thức hiện có nếu tìm thấy; mức mặc định §7 là dữ liệu demo |
| Chính sách quá tải | Giữ chặn đặt đỗ khi cảnh báo đỗ mở theo S2; đồng bộ với capacity và quy tắc ngưỡng |
| Sự cố | Bảng MVP §6 cần đối chiếu đầy đủ bảng INC chuẩn khi có nguồn |
| Giới hạn 6 giờ/3 Hub | Đề xuất cấu hình chạy demo, mở rộng sau khi đo |
| Backend và frontend | Sửa mô tả S2 để khớp stack đã chốt trong S3 |
| UC04 | Đồng bộ đặc tả cũ với đổi hold nguyên tử và giữ hold cũ khi lỗi |
| Deadline, repo và phiên bản thư viện | Chưa xác nhận; kiểm ở G0 |
| Thời gian hoàn thành | Ước lượng sau G0; ghi theo giờ còn lại và tiến độ đạt từng mốc |

Yêu cầu S1 là căn cứ nộp bài. Các tiêu chí cụ thể, giới hạn và giá trị mặc định trong PRD phục vụ triển khai MVP này; khi thay đổi phải giữ truy vết giữa yêu cầu, hành vi thực tế, test và báo cáo Final.
