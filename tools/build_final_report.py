"""Append real demo evidence to the existing BTL3 report using ReportLab and pypdf."""
from pathlib import Path
from xml.sax.saxutils import escape
import argparse
import json
import tempfile

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

MVP = Path(__file__).resolve().parents[1]
PROJECT = MVP.parent
OUTPUT = MVP / "deliverables"
EVIDENCE = OUTPUT / "evidence"
BASELINE = PROJECT / "btl3_se_final.pdf"
FINAL = OUTPUT / "BTL4_Smart_E_Mobility_Hub_Musketeers.pdf"
FONT_DIR = MVP / "src/web/fonts"

for face in ("Regular", "Bold"):
    pdfmetrics.registerFont(TTFont("BeVietnam" + face, str(FONT_DIR / f"BeVietnamPro-{face}.ttf")))

INK = colors.HexColor("#17312a")
MUTED = colors.HexColor("#4a6259")
GREEN = colors.HexColor("#0e6c50")
RULE = colors.HexColor("#d6e5dc")
styles = {
    "tag": ParagraphStyle("tag", fontName="BeVietnamBold", fontSize=10, leading=15, textColor=GREEN, spaceAfter=10),
    "title": ParagraphStyle("title", fontName="BeVietnamBold", fontSize=27, leading=34, textColor=INK, spaceAfter=12),
    "section": ParagraphStyle("section", fontName="BeVietnamBold", fontSize=14, leading=20, textColor=INK, spaceBefore=13, spaceAfter=7),
    "body": ParagraphStyle("body", fontName="BeVietnamRegular", fontSize=10.5, leading=16.5, textColor=INK, spaceAfter=8),
    "small": ParagraphStyle("small", fontName="BeVietnamRegular", fontSize=9, leading=13, textColor=MUTED, spaceAfter=6),
}

def p(text, kind="body"):
    return Paragraph(escape(text), styles[kind])

def evidence_image(path):
    width, height = ImageReader(str(path)).getSize()
    scale = min(492 / width, 260 / height)
    picture = Image(str(path), width * scale, height * scale)
    picture.hAlign = "CENTER"
    return picture

def footer(canvas, doc):
    canvas.setStrokeColor(RULE)
    canvas.line(51, 47, 544, 47)
    canvas.setFont("BeVietnamRegular", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(51, 33, "CO3001  /  Musketeers  /  Minh chứng bản MVP")
    canvas.drawRightString(544, 33, f"Phần bổ sung {doc.page}")

def summary_table(results, realtime):
    rows = [
        [p("Phép đo", "small"), p("Kết quả máy demo", "small")],
        [p("Q02 · Từ yêu cầu đến hiển thị"), p(f"5 mẫu Edge. Cao nhất {realtime['maxMs']} ms, gồm cả thời gian gửi lệnh trước commit.")],
        [p("Q03 · Đọc HTTP / 120 request"), p(f"p95 {results['Q03']['p95Ms']} ms. Mục tiêu ≤ 1.000 ms.")],
        [p("Q04 · What-if / 3 Hub / 6 giờ"), p(f"{results['Q04']['elapsedMs']} ms từ enqueue tới lúc đọc Completed. Mục tiêu ≤ 5.000 ms.")],
    ]
    table = Table(rows, colWidths=[207, 285], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#e8f0eb")),
        ("LINEBELOW", (0,0), (-1,0), 1, RULE),
        ("LINEBELOW", (0,1), (-1,-1), 0.5, RULE),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 2),
    ]))
    return table

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, default=BASELINE, help="Path to the group BTL3 PDF")
    baseline = parser.parse_args().baseline
    if not baseline.is_file():
        parser.error("BTL3 PDF not found. Supply it with --baseline.")
    measure = json.loads((OUTPUT / "measurements.json").read_text(encoding="utf-8"))
    realtime = json.loads((EVIDENCE / "realtime.json").read_text(encoding="utf-8"))
    state = json.loads((OUTPUT / "evidence.json").read_text(encoding="utf-8"))
    assert state["apiTests"] > 0 and state["browserTests"] > 0 and state["screens"]
    story = [
        p("SUBMISSION 4  /  CÔNG NGHỆ PHẦN MỀM", "tag"),
        p("Smart E-Mobility Hub", "title"),
        p("Bản chạy MVP, chuỗi màn hình kiểm chứng và khai báo AI", "section"),
        p("Phần phía trước là tài liệu thiết kế BTL1–BTL3 của nhóm. Phần này ghi các quyết định triển khai và kết quả chạy trên máy demo từ 18 đến 19/11/2026."),
        p("Kiến trúc bản chạy", "section"),
        p("React + TypeScript + Vite trên trình duyệt. Fastify + TypeScript chạy M1 (xe và chuyến đi), M2 (chỗ đỗ, sạc, vận hành), M3 (điều phối, lịch sạc và What-if) trong một tiến trình. REST truyền thao tác, WebSocket báo cập nhật để trình duyệt đọc lại dữ liệu đúng quyền. Giao dịch lưu snapshot trước khi công bố và phát lệnh."),
        p("Khác biệt với thiết kế trước", "section"),
        p("Đổi chỗ đích dùng cùng giao dịch. Kết quả mở khóa chưa xác định giữ nguyên chủ xe và chỗ đích. Chữ ký giữ chỗ điều phối dùng chủ item. Áp dụng lịch sạc trả danh sách ID phiên và trả lỗi riêng khi xung đột. Dữ liệu chưa có được biểu diễn nullable. App chạy với dữ liệu và phản hồi mô phỏng. Biểu giá chỉ minh họa."),
        p("Kết quả kiểm chứng", "section"),
        p(f"{state['apiTests']} ca kiểm thử nghiệp vụ/API và {state['browserTests']} ca kiểm thử trình duyệt đã đạt. Chi tiết phạm vi từng ca nằm trong bảng Verification.md của bản mã nguồn."),
        summary_table(measure, realtime),
        Spacer(1, 10),
        p(f"Môi trường đo: Node {measure['node']}, Windows {measure['os'].split()[-1]}, {measure['cpu'].strip()}, RAM {measure['memoryGiB']} GiB. Chỉ số phản ánh seed và luồng đã đo.", "small"),
        PageBreak(),
    ]
    for index, page in enumerate(state["screens"]):
        if index:
            story.append(PageBreak())
        story += [p(f"DEMO  /  {index+1:02d}", "tag"), p(page["title"], "title")]
        for entry in page["entries"]:
            path = EVIDENCE / entry["file"]
            assert path.is_file(), path
            story += [p(entry["caption"]), evidence_image(path), Spacer(1, 13)]
    story += [
        PageBreak(), p("PHẠM VI VÀ ĐÓNG GÓP", "tag"), p("Khai báo sử dụng AI", "title"),
        p("Công cụ và phần việc", "section"),
        p("OpenAI Codex được dùng để đối chiếu PRD, lập kế hoạch, tạo mã TypeScript/React, xây dựng fixture và ca kiểm thử, chạy các lệnh kiểm chứng, cùng soạn tài liệu và slide trình diễn."),
        p("Mức độ đóng góp", "section"),
        p("AI hỗ trợ trực tiếp việc sinh và sửa mã, lập nội dung minh chứng và kiểm thử tự động. Tài liệu yêu cầu, thiết kế BTL1–BTL3 và quyết định của nhóm dùng làm đầu vào. Kết quả trình diễn và số đo được lấy từ bản chạy. Nhóm cần tự rà lại nội dung và xác nhận phần đóng góp riêng của từng người trước khi nộp."),
        p("Giới hạn bản demo", "section"),
        p("Bản chạy dùng một máy và dữ liệu nhỏ. Điều khiển thiết bị, điện, phí, vị trí và ACK được giả lập. Luồng nhận xe dùng token đặt trước. Khi trả, hệ thống dùng hold hoặc chỗ thay thế hợp lệ cùng Hub. Lịch sạc ưu tiên yêu cầu đang chờ và giữ các lịch đã cam kết. What-if là mô hình tick năm phút với nhu cầu giả lập xác định, kết quả khuyến nghị cần được kiểm lại với mạng lưới hiện tại."),
        p("Hướng dẫn tái lập", "section"),
        p("Trong thư mục mvp chạy npm ci, npm run build, npm start. Mở http://127.0.0.1:4173. Dùng README để chạy thử các luồng với Student A, Student B và Operator."),
    ]
    with tempfile.TemporaryDirectory() as directory:
        supplement = Path(directory) / "supplement.pdf"
        SimpleDocTemplate(str(supplement), pagesize=A4, leftMargin=51, rightMargin=51,
                          topMargin=55, bottomMargin=58, title="Smart E-Mobility Hub - Submission 4").build(
                              story, onFirstPage=footer, onLaterPages=footer)
        writer = PdfWriter()
        writer.append(str(baseline))
        writer.append(str(supplement), outline_item="Submission 4 - Bản chạy và minh chứng")
        writer.add_metadata({"/Title": "Smart E-Mobility Hub - Submission 4", "/Subject": "CO3001 - Musketeers"})
        writer.write(str(FINAL))
    with FINAL.open("rb") as file:
        print(f"{len(PdfReader(file).pages)} pages: {FINAL}")

if __name__ == "__main__":
    main()
