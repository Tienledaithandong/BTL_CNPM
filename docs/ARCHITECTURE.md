# Kiến trúc & mô hình dữ liệu — Smart E-Mobility Hub MVP

Mô tả cách code được tổ chức: các module M1/M2/M3, mô hình trạng thái, giao dịch tương tác với thiết bị (ACK), lưu/phục hồi snapshot, bảng mã lỗi và cách thêm tính năng mới. Tương ứng với [PRD](PRD.md) (định hướng yêu cầu) và `README.md` (cách chạy).

## 1. Module

| Tệp | Vai trò |
|---|---|
| `src/api/types.ts` | Hợp đồng dữ liệu (`State`, các entity), `DomainError`/`fail` và helper kiểm tra đầu vào (`requiredString`, `number`, `instant`, `entity`, `checkVersion`, `owned`, `refreshAvailability`). |
| `src/api/store.ts` | `Store`: đọc và ghi snapshot, kiểm bất biến, ghi tuần tự, retry và Recovery. |
| `src/api/time-format.ts` | Chuyển timestamp giữa ISO UTC trên REST, WebSocket, snapshot và epoch mili giây dùng trong nghiệp vụ/UI. |
| `src/api/m1.ts` | **M1** (xe dùng chung): đặt xe, nhận xe (ACK mở khóa), trả xe (đổi đích, trả chỗ), giả lập thiết bị mở khóa. |
| `src/api/m2.ts` | **M2**: đỗ xe cá nhân (preview/đặt/nhận/rời), sạc (yêu cầu, kế hoạch ưu tiên), cảnh báo/cô lập tài nguyên, hồ sơ phương thức giả lập. |
| `src/api/m3.ts` | **M3**: điều phối (lệnh chuyển xe), kế hoạch sạc ưu tiên, kịch bản What-if (baseline/scenario/delta + khuyến nghị). |
| `src/api/app.ts` | Wiring Fastify, auth, WebSocket realtime, tick hệ thống (expiry, heartbeat, dispatch, simulation), demo events, recovery. |
| `src/api/seed.ts` + `src/api/seed.json` | Dữ liệu seed: 3 Hub (`H_METRO`, `H_KTX`, `H_BK`), 12 xe dùng chung, 45 chỗ đỗ, 6 cổng sạc (mỗi Hub limit 3 kW, 2 kW; hai phiên 2 kW). |
| `src/web/` | UI React: student (Hub và xe, chuyến đi, Đỗ xe cá nhân, Sạc xe, Lịch sử) và operator (Tổng quan, Cảnh báo, Sự cố, Điều phối xe, Lịch sạc, What-if, Điều khiển demo). |
| `tests/` | `tests/*.test.ts` (unit, node:test), `tests/browser/*.spec.ts` (Playwright). |

### API (route → vai trò)

**M1** — `GET /hubs`, `GET /hubs/:id`, `GET /vehicles`, `GET /vehicles/:id`; `GET /me/reservations`, `GET /me/trips`, `GET /me/invoices`, `GET /me/notifications`; `POST /reservations`, `POST /reservations/:id/pickup`, `POST /reservations/:id/cancel`, `POST /reservations/:id/change-destination`; `POST /trips/:id/change-destination`, `POST /trips/:id/return`.

**M2** — `GET /me/private-vehicles`, `GET /me/parking-bookings`; `POST /parking/preview`, `POST /parking/bookings`, `POST /parking/bookings/:id/arrive`, `POST /parking/bookings/:id/depart`; `POST /charging/preview`, `POST /charging/bookings`, `GET /me/charging-sessions`, `POST /charging/requests`, `POST /charging/sessions/:id/stop`; `GET /operator/overview`, `GET /operator/alerts`, `POST /operator/alerts/:id/acknowledge`, `POST /incidents`, `GET /operator/incidents`, `POST /operator/incidents/:id/isolate`, `POST /operator/incidents/:id/restore`.

**M3** — `GET/POST /operator/redistributions` + `/operator/redistributions/:id/confirm|start|arrivals|complete|cancel|resolve-item`; `GET/POST /operator/charging-plans` + `/operator/charging-plans/preview|:id/apply`; `GET/POST /operator/scenarios`, `PATCH /operator/scenarios/:id`, `POST /operator/scenarios/:id/runs`, `GET /operator/runs`, `GET /operator/runs/:id`.

**App** — `GET /api/health`, `GET /api/ready`; `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`; `GET /ws` (WebSocket); `GET/POST /api/operator/demo/events` (demo mode); SPA web static (`/`, catch-all HTML).

## 2. Mô hình trạng thái (quan trọng)

### Entity
- **Hub**: `lastSeenAt` (heartbeat), `powerLimitKW`.
- **Vehicle** (dùng chung): `mobilityStatus`: `Available` → `Reserved` → `UnlockPending` → (trip) `InUse` → (charging) `Charging`/`NeedsCharge`/`Charging`; `allocationOwner`: `SHARED_RESERVATION | TRIP | REDISTRIBUTION_ITEM` (null = độc đoạn); `healthStatus`: `OK | Maintenance | Faulty`; `batteryPercent`, `observedAt` (telemetry: trong 60 s là Fresh).
- **Hold** (giữ chỗ đích): `status`: `Held | Occupied | Released`; `ownerType`: `SHARED_RESERVATION | TRIP | REDISTRIBUTION_ITEM | PRIVATE_VEHICLE`; `slotId/hubId/startAt/endAt`.
- **Slot**: `type`: `SHARED | PRIVATE`, `vehicleId` (bản vật lý), `blocked`.
- **Reservation**: `Reserved | UnlockPending | Used | Cancelled | Expired`; token nhận xe (10 hex).
- **Trip**: `startedAt/endedAt` (null = đang chạy).
- **Invoice**: tạo từ trip (vẫn dùng trong mô phỏng).
- **Session** (sạc): `Waiting | Scheduled | Starting | Charging | StopPending | Completed | Stopped | Cancelled | Failed`; `desiredStop`; điểm đến `requestedPointId/pointId`; cửa sổ `startAt/endAt`; `commandId`.
- **Booking** (đỗ xe cá nhân): `Scheduled | InUse | Completed | Cancelled`; `serviceStatus: Normal | Delayed`; `guarantee: Guaranteed | NotGuaranteed`.
- **Order/Item** (điều phối): item `Allocated | InTransit | Arrived | Completed | NeedsOperatorAction | Dropped | Cancelled`; `departedAt/arrivedAt`; order `Proposed | Confirmed | InTransit | Arrived | Completed | PartiallyCompleted | Failed | Cancelled`.
- **Command** (thiết bị): `UNLOCK | CHARGE_START | CHARGE_STOP`, `Pending | Confirmed | Failed`, `dispatchedAt`, `attempts`, `probeCount`, `nextProbeAt`.
- **Incident/Alert/Plan/ChargingPlan/Run/Scenario/Notification/Activity/Idempotency**.

`validateState` (trong store) bắt buộc các đối chiếu vật lý (slot ↔ vehicle, reservation/trip/item ↔ allocationOwner, non-overlapping holds...).

### Giao dịch (Store)
- `store.write(actor, fn, {requestId, operation, payload})` — tuần tự (serial promise), so tương tác với thiết bị trong `store.system` (`DEVICE_SIMULATOR`).
- Idempotency: `state.idempotency[actorId:requestId]` — trùng key+operation+hash(payload) → trả lại kết quả đã lưu; key dùng cho retry an toàn (client `mutate` gửi `Idempotency-Key`).
- `checkVersion` — client gửi `expectedVersion`/`version` — sai → `VERSION_CONFLICT` (409); thiếu → `VERSION_REQUIRED` (400).
- Ghi no-op không tăng `state.version`.
- `store.read` cho GET (đọc snapshot).

### Mã giao dịch với thiết bị
- Lệnh tạo bởi phiên/đặt điểm `dispatchedAt`, tick sẽ dispatch (`attempts++`, `nextProbeAt`).
- Trong chế độ bình thường, tick dispatch lệnh chưa gửi và dùng `autoAck` khi đã bật. Restart từ bản chính tiếp tục lệnh với cùng ID.
- ACK mở khóa âm xác nhận lệnh chưa thực hiện và đã bị vô hiệu. Lệnh dừng sạc chỉ nhả công suất sau xác nhận đã ngắt điện.
- Khi Recovery, tick tự động dừng. Operator gửi `kind: 'reconcile-command'` với `commandId`, `success` và `confirm: true` sau khi kiểm thiết bị. Có thể đối soát lệnh thiếu `dispatchedAt` trong backup. Snapshot lưu trạng thái Recovery qua các lần đối soát và khởi động lại.
- WebSocket phát `eventId`, `type: 'state.changed'`, `entityRef: null`, `stateVersion`, `occurredAt`. Client bỏ qua version cũ trên cùng kết nối và GET lại khi có version mới hoặc reconnect. Artifact nội bộ và dữ liệu riêng được truy cập qua route có quyền.
- Sự kiện pin demo nhận thêm `sequence` và `observedAt` tùy chọn. Gói trùng, sequence thấp hơn hoặc giờ quan sát cũ được ghi `TELEMETRY_IGNORED`.

## 3. Lưu & phục hồi snapshot (Store)

- Cấu trúc `snapshot.json` + `snapshot.prev.json` (bản trước) + `.initialized`.
- `checksum` là SHA-256 của JSON trạng thái đã tuần tự hóa. Schema 2 lưu timestamp ISO UTC. Bộ đọc kiểm checksum theo schema gốc và tiếp tục đọc schema 1 dùng epoch. Lần ghi thành công kế tiếp ghi schema 2.
- Giao thức save: ghi `snapshot.json.<uuid>.tmp` (O_EXCL) → decode-validate temp → ghi backup của main trước đó (`snapshot.prev.json`) → rename backup → rename temp → main. Các fault stage dùng test: `before-backup`, `before-replace`, `replace-reported-error`, `after-replace`.
- Ambiguous: rename sau successful replace lỗi → `COMMIT_UNCERTAIN` (retry cùng idempotency key); lỗi sau replace → `RESPONSE_INTERRUPTED` (đã lưu, gửi lại cùng key để nhận kết quả).
- Recovery: main hoặc backup lỗi checksum/schema → `Store.open` nạp backup, đặt `recoveryReason`, ghi bị chặn (`503 RECOVERY`), operator khôi phục qua `POST /api/operator/demo/events {kind:'recover', confirm:true}` sau khi đối soát (đợi `DEVICE_PENDING` tất cả lệnh đang chờ). Nếu cả hai bản hỏng → chặn toàn bộ.

### What-if

Worker dùng snapshot và seed đã chụp rồi nhường event loop theo lô tick. Bộ tick theo dõi thiết bị chạy riêng trong lúc tính. Hai nhánh dùng cùng quy tắc kiểm công suất theo các mốc giao nhau với nghiệp vụ sạc. Khung thay thế cho yêu cầu ưu tiên còn chờ được kiểm với cổng, chỗ đỗ và công suất trong 6 giờ sau horizon. Điều phối kiểm chỗ đích theo slot bị chặn trong kịch bản.

## 4. Mã lỗi (glossary)

| Nhóm | Codes |
|---|---|
| Đầu vào / bản ghi | `INVALID_INPUT`, `INVALID_REQUEST_ID`, `VERSION_REQUIRED`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT` |
| Quyền/đối tượng | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `FORBIDDEN`, `NOT_FOUND`, `HOLD_OWNER_CONFLICT`, `INVALID_OWNER`, `SLOT_OCCUPANCY_CONFLICT`, `SLOT_EVIDENCE_REQUIRED`, `INVALID_TOKEN` |
| Tài nguyên | `VEHICLE_UNAVAILABLE`, `STALE_TELEMETRY`, `ACTIVE_BOOKING`, `NO_PARKING_CAPACITY`, `TIME_SLOT_CONFLICT`, `DESTINATION_BLOCKED`, `VEHICLE_ALREADY_PARKED`, `WRONG_SLOT`, `WRONG_DESTINATION`, `WRONG_HUB`, `POINT_INCOMPATIBLE`, `POINT_MISMATCH`, `POINT_UNAVAILABLE`, `POWER_CAPACITY_EXCEEDED`, `CHARGING_PLAN_CONFLICT`, `PLAN_STALE`, `PLAN_EXPIRED`, `PARKING_REQUIRED`, `PARKING_VEHICLE_MISMATCH` |
| Giao dịch thiết bị | `DEVICE_PENDING`, `PICKUP_UNAVAILABLE`, `INVALID_TRANSITION`, `VEHICLE_ALLOCATED`, `OCCUPANCY_FIXTURE_CONFLICT`, `INVALID_OCCUPANCY` |
| Lưu snapshot | `SNAPSHOT_WRITE_FAILED`, `COMMIT_UNCERTAIN`, `RESPONSE_INTERRUPTED`, `RECOVERY` |
| Demo/reset | `CONFIRM_RESET`, `CONFIRM_RECOVERY` |

## 5. Dữ liệu & môi trường

- Thư mục dữ liệu: `data/runtime/` (`HUB_DATA_DIR`): `snapshot.json`, `snapshot.prev.json`, `.initialized`.
- Môi trường: `HUB_PORT` (mặc định 4173), `HUB_ENABLE_DEMO=0` tắt API giả lập.
- Dữ liệu seed: 3 Hub, 12 xe, 45 chỗ đỗ, 6 cổng sạc (mỗi Hub 2 cổng).

## 6. Kiểm thử

- `npm run typecheck` — `tsc --noEmit -p tsconfig.json`.
- `npm test` — `tsx --test tests/*.test.ts` (unit; đồng thời là nơi xác minh giao thức snapshot: fault, ambiguous replace, recovery).
- `npm run build` — typecheck + `vite build` (`dist/web`) + `tsc -p tsconfig.api.json` (`dist/api`).
- `npm run test:e2e` — Playwright (build tự chạy qua `pretest:e2e`).
- `tsx tools/measure.ts` — phép đo p95 HTTP + thời gian hoàn tất What-if → `deliverables/measurements.json`.

## 7. Thêm tính năng mới

1. Route: thêm vào `registerM*` qua `add(method, path, role, handler, options?)` — handler `(tx, input) => ...` chạy trong `store.write`; dùng `store.read` nếu chỉ đọc.
2. Entity/invariant: mở rộng `State` (`src/api/types.ts`) + `validateState` + seed; ghi nếu cần.
3. UI: thêm trang/component trong `src/web/` (xem `main.tsx` để thêm link).
4. Kiểm: thêm ca vào `tests/m*.test.ts` (unit) hoặc `tests/browser/` (e2e).

Các invariant chính khi thêm tính năng: không ghi trực tiếp `state` (phải qua `store.write`/`system`); phiên bản thay đổi qua `++row.version`; hold chỉ thay đổi status thông qua các helper `m2.ts`; giao dịch thiết bị đi theo mô hình ACK (Pending → Confirmed/Failed) của `Command`.
