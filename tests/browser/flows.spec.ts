import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

type DemoRole = 'student'|'operator';
const evidence = join('test-results','evidence');

async function capture(page: Page, name: string) {
  await mkdir(evidence,{recursive:true});
  await page.screenshot({ path:join(evidence,name+'.png'), fullPage:true, animations:'disabled' });
}
async function login(page: Page, role: DemoRole) {
  await page.goto('/');
  await page.getByRole('button',{name:role==='student' ? /Sinh viên A/ : /Điều phối viên/}).click();
  await page.getByRole('button',{name:'Vào hệ thống'}).click();
  await expect(page.getByRole('heading',{name:role==='student'?'Hub và xe':'Tổng quan',exact:true})).toBeVisible();
  await expect(page.getByText('Đang kết nối',{exact:true})).toBeVisible();
}
async function nav(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();
  await expect(page.getByRole('heading',{name,exact:true,level:1})).toBeVisible();
}
async function reset(page: Page) {
  const result = await page.request.post('/api/operator/demo/events',{data:{kind:'reset',confirm:true}});
  expect(result.ok()).toBeTruthy();
}

test('student uses device confirmation, changes destination, receives invoice, and charges returned vehicle', async ({ page, browser, baseURL }) => {
  const operator = await browser.newContext({baseURL});
  try {
    const console = await operator.newPage();
    await login(console,'operator');
    await reset(console);
    await nav(console,'Điều khiển demo');
    await console.getByRole('button',{name:'Tạm dừng ACK tự động'}).click();
    await expect(console.getByRole('button',{name:'Bật ACK tự động'})).toBeVisible();

    await login(page,'student');
    const table = page.getByRole('table',{name:'Các xe ở hub'});
    const vehicle = table.getByRole('row').filter({hasText:'EV-02'});
    await expect(vehicle).toBeVisible();
    await capture(page,'01-student-hubs');
    await vehicle.getByRole('button',{name:'Đặt xe'}).click();
    await page.getByLabel('Hub trả xe',{exact:true}).selectOption('H_KTX');
    await page.getByRole('button',{name:'Xác nhận đặt và giữ chỗ'}).click();
    await expect(page.getByRole('heading',{name:'Lượt đặt · EV-02'})).toBeVisible();
    await expect(page.getByText('Mã nhận xe',{exact:true})).toBeVisible();
    await capture(page,'02-student-reservation');

    await page.getByRole('button',{name:'Điền mã nhận xe'}).click();
    await page.getByRole('button',{name:'Nhận xe',exact:true}).click();
    await expect(page.getByText(/Lượt đặt và chỗ đỗ đích vẫn được giữ/)).toBeVisible();
    await capture(page,'03-student-awaiting-ack');
    const unlock = console.getByRole('table',{name:'Lệnh đợi thiết bị'}).getByRole('row').filter({hasText:'EV-02'});
    await expect(unlock.getByRole('button',{name:'ACK thành công'})).toBeEnabled();
    await unlock.getByRole('button',{name:'ACK thành công'}).click();
    const active = page.getByRole('heading',{name:'Chuyến đi · EV-02'});
    await expect(active).toBeVisible();
    await page.getByLabel('Đổi hub trả xe',{exact:true}).selectOption('H_BK');
    await page.getByRole('button',{name:'Đổi điểm trả'}).click();
    await expect(page.getByText('Đã đổi hub trả xe.')).toBeVisible();
    await expect(page.getByText(/Bách Khoa · H_BK-S/)).toBeVisible();
    await capture(page,'04-student-active-trip');

    await console.getByRole('button',{name:'Bật ACK tự động'}).click();
    await expect(console.getByRole('button',{name:'Tạm dừng ACK tự động'})).toBeVisible();
    await page.getByRole('button',{name:'Xác nhận trả xe'}).click();
    await expect(page.getByRole('heading',{name:'Hóa đơn gần nhất'})).toBeVisible();
    await expect(active).not.toBeVisible();
    await capture(page,'05-student-invoice');

    await nav(page,'Sạc xe');
    await page.getByLabel('Xe dùng chung đang đỗ').selectOption('EV-02');
    await page.getByRole('button',{name:'Gửi yêu cầu sạc'}).click();
    const session = page.getByRole('table',{name:'Phiên sạc của tôi'}).getByRole('row').filter({hasText:'EV-02'});
    await expect(session.getByText('Đang sạc',{exact:true})).toBeVisible();
    await capture(page,'06-student-shared-charging');
  } finally { await operator.close(); }
});

test('student books private parking and schedules charging',async ({ page,browser,baseURL }) => {
  const operator = await browser.newContext({baseURL});
  try {
    const console = await operator.newPage();
    await login(console,'operator');
    await reset(console);
    await login(page,'student');
    await nav(page,'Đỗ xe cá nhân');
    await page.getByLabel('Xe cá nhân',{exact:true}).selectOption('PV_A');
    await page.getByLabel('Hub',{exact:true}).selectOption('H_METRO');
    await page.getByRole('button',{name:'Xem trước',exact:true}).click();
    await expect(page.getByRole('table',{name:'Lượt đỗ dự kiến'})).toBeVisible();
    await page.getByRole('button',{name:'Xác nhận đặt chỗ'}).click();
    await expect(page.getByRole('table',{name:'Lượt đỗ của tôi'})).toContainText('Ga Metro');
    await capture(page,'07-student-private-parking');

    await nav(page,'Sạc xe');
    const booking = page.getByLabel('Lượt đặt chỗ',{exact:true});
    await expect(booking.getByRole('option',{name:/PV_A/})).toHaveCount(1);
    await booking.selectOption({index:1});
    await page.getByRole('button',{name:'Kiểm tra khung sạc'}).click();
    await expect(page.getByText('Dự kiến 2 kWh trong 60 phút.')).toBeVisible();
    await page.getByRole('button',{name:'Xác nhận lịch sạc'}).click();
    const sessions = page.getByRole('table',{name:'Phiên sạc của tôi'});
    await expect(sessions.getByRole('row').filter({hasText:'PV_A'})).toContainText('Đã lên lịch');
    await capture(page,'08-student-private-charging');
    const firstSession = (await (await page.request.get('/api/me/charging-sessions')).json()).data[0];
    const [firstBooking] = (await (await page.request.get('/api/me/parking-bookings')).json()).data;
    const studentB = await browser.newContext({baseURL});
    try {
      const other = await studentB.newPage();
      await other.goto('/');
      await other.getByRole('button',{name:/Sinh viên B/}).click();
      await other.getByRole('button',{name:'Vào hệ thống'}).click();
      const booked = await other.request.post('/api/parking/bookings',{data:{
        privateVehicleId:'PV_B',hubId:'H_METRO',startAt:firstBooking.startAt,
        endAt:new Date(Date.parse(firstBooking.startAt) + 3 * 3_600_000).toISOString(),
      }});
      expect(booked.ok(),await booked.text()).toBeTruthy();
      await nav(other,'Sạc xe');
      const otherBooking = other.getByLabel('Lượt đặt chỗ',{exact:true});
      await expect(otherBooking.getByRole('option',{name:/PV_B/})).toHaveCount(1);
      await otherBooking.selectOption({ index:1 });
      await other.getByRole('button',{name:'Kiểm tra khung sạc'}).click();
      await expect(other.getByText('Khung này không có cổng và công suất phù hợp trong thời gian đỗ.')).toBeVisible();
      await expect(other.getByRole('button',{name:'Xác nhận lịch sạc'})).toBeDisabled();
      await capture(other,'08b-student-charging-conflict');
      await other.getByRole('button',{name:'Dùng khung này'}).first().click();
      await other.getByRole('button',{name:'Xác nhận lịch sạc'}).click();
      await expect(other.getByRole('table',{name:'Phiên sạc của tôi'}).getByRole('row').filter({hasText:'PV_B'})).toContainText('Đã lên lịch');
      await capture(other,'08c-student-charging-alternative');
      const [alternative] = (await (await other.request.get('/api/me/charging-sessions')).json()).data;
      const [retained] = (await (await page.request.get('/api/me/charging-sessions')).json()).data;
      expect(retained).toEqual(firstSession);
      expect(Date.parse(alternative.endAt)).toBeLessThanOrEqual(Date.parse(firstBooking.startAt)+3*3_600_000);
      if (Date.parse(alternative.startAt) < Date.parse(retained.endAt)) {
        expect(alternative.pointId).not.toBe(retained.pointId);
        expect(alternative.powerKW+retained.powerKW).toBeLessThanOrEqual(3);
      }
    } finally { await studentB.close(); }
  } finally { await operator.close(); }
});

test('operator checks overview, redistributes one vehicle, handles incident, and runs a what-if scenario', async ({ page }) => {
  await login(page,'operator');
  await reset(page);
  await expect(page.getByRole('heading',{name:'Ga Metro',exact:true})).toBeVisible();
  await capture(page,'09-operator-overview');

  await nav(page,'Điều khiển demo');
  await page.getByLabel('Hub bãi đỗ',{exact:true}).selectOption('H_METRO');
  await page.getByLabel('Số chỗ đang chiếm',{exact:true}).fill('14');
  await page.getByRole('button',{name:'Cập nhật chiếm dụng'}).click();
  await expect(page.getByText('Đã ghi nhận chiếm dụng bãi đỗ.')).toBeVisible();
  await nav(page,'Cảnh báo');
  const alert = page.getByRole('table',{name:'Danh sách cảnh báo'}).getByRole('row').filter({hasText:'Ga Metro'});
  await expect(alert).toContainText('Chiếm dụng bãi đỗ');
  await alert.getByRole('button',{name:'Tiếp nhận',exact:true}).click();
  await expect(alert.getByText('Tiếp nhận',{exact:true})).toBeVisible();
  await capture(page,'09b-operator-parking-alert');
  await nav(page,'Điều khiển demo');
  await page.getByLabel('Hub bãi đỗ',{exact:true}).selectOption('H_METRO');
  await page.getByLabel('Số chỗ đang chiếm',{exact:true}).fill('12');
  await page.getByRole('button',{name:'Cập nhật chiếm dụng'}).click();
  await expect(page.getByText('Đã ghi nhận chiếm dụng bãi đỗ.')).toBeVisible();
  await nav(page,'Cảnh báo');
  await page.getByLabel('Lọc trạng thái',{exact:true}).selectOption('Resolved');
  await expect(alert).toContainText('Đã xử lý');
  await reset(page);

  await nav(page,'Điều phối xe');
  await page.getByLabel('Hub nguồn').selectOption('H_METRO');
  await page.getByLabel('Hub đích').selectOption('H_KTX');
  await page.getByRole('button',{name:'Tạo đề xuất'}).click();
  await page.getByRole('button',{name:'Xác nhận lệnh',exact:true}).click();
  await page.getByRole('button',{name:'Xuất phát tất cả xe đã cấp'}).click();
  await page.getByRole('button',{name:'Ghi nhận đến',exact:true}).click();
  await page.getByRole('button',{name:'Hoàn tất lệnh',exact:true}).click();
  await expect(page.getByText('Đã hoàn tất lệnh điều phối.')).toBeVisible();
  const [moved] = (await (await page.request.get('/api/operator/redistributions')).json()).data;
  const {vehicleId} = moved.items[0];
  const relocated = (await (await page.request.get('/api/vehicles/'+vehicleId)).json()).data;
  expect(relocated.hubId).toBe('H_KTX');
  const overview = (await (await page.request.get('/api/operator/overview')).json()).data;
  expect(overview.hubs.find((hub:{id:string}) => hub.id==='H_KTX').slots).toContainEqual(expect.objectContaining({id:relocated.slotId,vehicleId}));
  await capture(page,'10-operator-redistribution');

  await nav(page,'Sự cố');
  const planned = await page.request.post('/api/charging/requests',{data:{vehicleId,chargingPointId:'H_KTX-C1',target:100}});
  expect(planned.ok(),await planned.text()).toBeTruthy();
  const {session:interrupted} = (await planned.json()).data;
  await expect.poll(async () => {
    const state = (await (await page.request.get('/api/operator/overview?hubId=H_KTX')).json()).data;
    return state.hubs[0].points.find((point:{id:string}) => point.id==='H_KTX-C1')?.powered;
  }).toBe(true);
  await page.getByLabel('Loại tài nguyên').selectOption('point');
  await page.getByLabel('Mã tài nguyên').selectOption('H_KTX-C1');
  await page.getByLabel('Mô tả sự cố').fill('Cổng sạc cần kiểm tra trong buổi trình diễn.');
  await page.getByRole('button',{name:'Tạo báo cáo'}).click();
  await page.getByRole('button',{name:'Cô lập tài nguyên'}).click();
  await expect(page.getByText('Đã cô lập',{exact:true})).toBeVisible();
  await expect(page.getByText(interrupted.id+': chờ xác nhận ngắt điện.')).toBeVisible();
  await expect.poll(async () => {
    const state = (await (await page.request.get('/api/operator/overview?hubId=H_KTX')).json()).data;
    return state.hubs[0].points.find((point:{id:string}) => point.id==='H_KTX-C1');
  }).toEqual(expect.objectContaining({blocked:true,powered:false,occupancy:'NeedsClear'}));
  await capture(page,'11-operator-incident');
  await page.getByLabel('Kết quả sửa chữa').fill('Đã kiểm tra, cổng ở trạng thái không cấp điện.');
  await page.getByRole('button',{name:'Xác nhận phục hồi'}).click();
  await expect(page.getByText('Đã ghi nhận kết quả phục hồi.')).toBeVisible();

  await nav(page,'Mô phỏng What-if');
  await page.getByLabel('Tên kịch bản').fill('Tăng nhu cầu 25% từ Ga Metro');
  await page.getByRole('checkbox',{name:'Ga Metro',exact:true}).check();
  await page.getByRole('checkbox',{name:'Ký túc xá',exact:true}).check();
  await expect(page.getByLabel('Giờ bắt đầu')).toBeVisible();
  await expect(page.getByLabel('Giờ kết thúc')).toBeVisible();
  await page.getByLabel('Thay đổi nhu cầu sử dụng (%)',{exact:true}).fill('25');
  await page.getByLabel('Tỷ lệ cổng sạc khả dụng (%)').fill('80');
  await page.getByLabel('Số chỗ đỗ không khả dụng tại Ga Metro').fill('2');
  await page.getByLabel('Số chỗ đỗ không khả dụng tại Ký túc xá').fill('1');
  const saveScenario = page.getByRole('button',{name:'Lưu kịch bản'});
  const scenarioTable = page.getByRole('table',{name:'Kịch bản mô phỏng'});
  const firstScenario = scenarioTable.getByRole('row').filter({hasText:'SC-001'});
  await saveScenario.click();
  await expect(firstScenario).toContainText('Tăng nhu cầu 25% từ Ga Metro');
  await page.getByRole('button',{name:'Tạo kịch bản khác'}).click();
  await firstScenario.getByRole('button',{name:'Chỉnh sửa'}).click();
  await expect(page.getByLabel('Tỷ lệ cổng sạc khả dụng (%)')).toHaveValue('80');
  await expect(page.getByLabel('Số chỗ đỗ không khả dụng tại Ga Metro')).toHaveValue('2');
  await expect(page.getByLabel('Số chỗ đỗ không khả dụng tại Ký túc xá')).toHaveValue('1');
  await page.getByLabel('Tên kịch bản').fill('Tăng nhu cầu ở hai Hub');
  await saveScenario.click();
  await expect(firstScenario).toContainText('Tăng nhu cầu ở hai Hub');
  await page.getByRole('button',{name:'Tạo kịch bản khác'}).click();
  await page.getByLabel('Tên kịch bản').fill('Chỉ mô phỏng Ga Metro');
  await page.getByRole('checkbox',{name:'Ga Metro',exact:true}).check();
  await saveScenario.click();
  await expect(scenarioTable.getByRole('row').filter({hasText:'SC-002'})).toContainText('Chỉ mô phỏng Ga Metro');
  await firstScenario.getByRole('button',{name:'Chạy mô phỏng'}).click();
  const comparison = page.getByRole('table',{name:'So sánh What-if'});
  await expect(comparison).toBeVisible();
  await expect(comparison.getByRole('columnheader')).toHaveText(['Chỉ số','Cơ sở','Kịch bản','Chênh lệch']);
  await capture(page,'12-operator-what-if');
  await page.reload();
  await nav(page,'Mô phỏng What-if');
  await expect(comparison).toBeVisible();
});


test('operator previews and applies a feasible schedule from waiting requests', async ({ page }) => {
  await login(page,'operator');
  await reset(page);
  const active = await page.request.post('/api/charging/requests',{data:{vehicleId:'EV-03',target:80}});
  expect(active.ok()).toBeTruthy();
  await expect.poll(async () => {
    const response = await page.request.get('/api/operator/overview?hubId=H_METRO');
    const result = await response.json() as { data: { hubs: Array<{ points: Array<{ powered: boolean; pluggedVehicleId: string | null }> }> } };
    return result.data.hubs.some((hub) => hub.points.some((point) => point.powered && point.pluggedVehicleId==='EV-03'));
  }).toBe(true);
  const queued = await page.request.post('/api/charging/requests',{data:{vehicleId:'EV-04',target:80}});
  expect(queued.ok()).toBeTruthy();
  const staged = await queued.json() as { data: { session: { status: string } } };
  expect(staged.data.session.status).toBe('Waiting');
  await nav(page,'Lịch sạc');
  await page.getByLabel('Hub',{exact:true}).selectOption('H_METRO');
  await page.getByRole('button',{name:'Xem kế hoạch đề xuất'}).click();
  await expect(page.getByRole('table',{name:'Lịch đề xuất'})).toBeVisible();
  await page.getByRole('button',{name:'Áp dụng lịch',exact:true}).click();
  await expect(page.getByText('Đã áp dụng lịch sạc.')).toBeVisible();
  await expect(page.getByText('Đã áp dụng',{exact:true})).toBeVisible();
  await capture(page,'13-operator-charging-plan');
});

test('student navigation is keyboard accessible and reflows on a phone', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await login(page,'student');
  const link = page.getByRole('navigation',{name:'Điều hướng sinh viên'}).getByRole('button',{name:'Đỗ xe cá nhân',exact:true});
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Đỗ xe cá nhân',level:1})).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByLabel('Xe cá nhân',{exact:true})).toBeVisible();
});
