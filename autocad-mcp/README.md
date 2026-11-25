# AutoCAD MCP Server

MCP server ที่ให้ Claude (Claude Desktop / Claude Code) วาดและอ่านแบบใน **AutoCAD** ได้โดยตรง
พร้อมเครื่องมือเฉพาะงานแสงสว่าง (วัดห้อง → คำนวณจำนวนโคม → วางโคมลงแบบ)

## โหมดการทำงาน
| โหมด | ใช้เมื่อ | ทำงานอย่างไร |
|---|---|---|
| `com` | Windows + AutoCAD (ตัวเต็ม ไม่ใช่ LT) | ควบคุม AutoCAD ที่เปิดอยู่ผ่าน COM — เห็นผลทันทีบนจอ |
| `dxf` | ทุกระบบ / ไม่มี AutoCAD | เขียนไฟล์ `.dxf` (บันทึกอัตโนมัติทุกคำสั่ง) แล้วเปิดใน AutoCAD ภายหลัง |

ค่าเริ่มต้น `auto` = ใช้ `com` บน Windows ไม่เช่นนั้นใช้ `dxf`
> AutoCAD LT ไม่รองรับ COM/API ให้ใช้โหมด `dxf`

## ติดตั้ง (Windows)
```bash
cd autocad-mcp
pip install -r requirements.txt
```
เปิด AutoCAD ค้างไว้ก่อนใช้งาน (ถ้าไม่ได้เปิด เซิร์ฟเวอร์จะพยายามเปิดให้)

### Claude Desktop
แก้ไฟล์ `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "autocad": {
      "command": "python",
      "args": ["C:\\path\\to\\claude-rc\\autocad-mcp\\autocad_mcp.py"]
    }
  }
}
```
แล้วปิด-เปิด Claude Desktop ใหม่

### Claude Code
```bash
claude mcp add autocad -- python C:\path\to\claude-rc\autocad-mcp\autocad_mcp.py
```

### ตัวแปรสภาพแวดล้อม (ไม่บังคับ)
| ตัวแปร | ค่า |
|---|---|
| `AUTOCAD_MCP_BACKEND` | `auto` (ค่าเริ่มต้น) / `com` / `dxf` |
| `AUTOCAD_MCP_DXF` | path ไฟล์ .dxf ในโหมด dxf (ค่าเริ่มต้น `drawing.dxf`) |
| `AUTOCAD_PROGID` | ระบุเวอร์ชัน เช่น `AutoCAD.Application.25` ถ้ามีหลายเวอร์ชัน |

## เครื่องมือ (24 ตัว)
- **ข้อมูลแบบ:** `get_drawing_info`, `list_layers`, `list_entities`, `get_entity`
- **วาด:** `draw_line`, `draw_circle`, `draw_arc`, `draw_polyline`, `draw_rectangle`, `add_text`, `add_mtext`, `add_dimension`, `insert_block`
- **แก้ไข:** `create_layer`, `move_entity`, `delete_entity`
- **ไฟล์/มุมมอง:** `new_drawing`, `open_drawing`, `save_drawing`, `zoom_extents`
- **คำสั่งดิบ:** `send_command` (เฉพาะโหมด com เช่น `_REGEN `)
- **งานแสงสว่าง:**
  - `measure_room` — อ่านพื้นที่/เส้นรอบรูปจากโพลีไลน์ปิดที่เป็นขอบห้อง
  - `lumen_method` — คำนวณจำนวนโคม N = E×A / (Φ×UF×MF) (ประมาณ UF จาก RI ให้ถ้าไม่ระบุ)
  - `place_luminaire_grid` — วางบล็อกโคม (พาเนลสี่เหลี่ยม/ดาวน์ไลท์กลม) เป็นตาราง ลงเลเยอร์ `E-LIGHTING`

## ตัวอย่างคำสั่งที่พิมพ์ให้ Claude
- "วาดห้อง 10×6 ม. เลเยอร์ A-ROOM แล้วใส่เส้นบอกขนาด"
- "ห้องที่เป็นโพลีไลน์สีฟ้าในแบบนี้ ต้องใช้โคม 3600 lm กี่ดวงถึงจะได้ 500 lux ฝ้าสูง 3 ม. แล้ววางโคมให้เลย"
- "นับดาวน์ไลท์ในเลเยอร์ E-LIGHTING ทั้งหมด"

## หมายเหตุ
- หน่วยพิกัด = หน่วยของแบบ ดู `insunits` จาก `get_drawing_info` (4 = มม., 6 = ม.) ถ้าแบบเป็น มม. ให้บอก Claude ด้วย
- `lumen_method` เป็นค่าประมาณเบื้องต้นแบบเดียวกับเว็บแอปในโปรเจกต์ — ถ้าต้องการผลละเอียด (IES/LDT, เงา, แสงธรรมชาติ) ให้ใช้ `index.html`
