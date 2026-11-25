"""MCP server สำหรับเชื่อมต่อ Claude กับ AutoCAD

มี 2 โหมด (เลือกอัตโนมัติ หรือกำหนดด้วยตัวแปร AUTOCAD_MCP_BACKEND):
  - "com" : ควบคุม AutoCAD ที่เปิดอยู่บน Windows ผ่าน COM (ต้องมี pywin32)
  - "dxf" : เขียน/อ่านไฟล์ .dxf ด้วย ezdxf (ใช้ได้ทุกระบบ ไม่ต้องมี AutoCAD)

หน่วยพิกัดเป็นหน่วยของแบบ (drawing units) — ค่าเริ่มต้นของเครื่องมือแสงสว่างถือว่าเป็นเมตร
"""

from __future__ import annotations

import math
import os
import sys
import time
from typing import Any

import functools
from concurrent.futures import ThreadPoolExecutor

try:  # mcp >= 2
    from mcp.server.mcpserver import MCPServer as _Server
    from mcp.server.mcpserver.exceptions import ToolError
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP as _Server
    from mcp.server.fastmcp.exceptions import ToolError

Point = list[float]

# สีมาตรฐาน AutoCAD (ACI)
COLOR_NAMES = {
    "red": 1, "yellow": 2, "green": 3, "cyan": 4, "blue": 5,
    "magenta": 6, "white": 7, "black": 7, "gray": 8, "grey": 8,
    "bylayer": 256, "byblock": 0,
}


def _color(c: int | str | None) -> int | None:
    if c is None:
        return None
    if isinstance(c, int):
        return c
    s = str(c).strip().lower()
    if s.isdigit():
        return int(s)
    if s not in COLOR_NAMES:
        raise ValueError(f"ไม่รู้จักสี '{c}' ใช้เลข ACI 0-256 หรือ {', '.join(COLOR_NAMES)}")
    return COLOR_NAMES[s]


def _p3(p: Point) -> tuple[float, float, float]:
    if len(p) not in (2, 3):
        raise ValueError(f"พิกัดต้องเป็น [x, y] หรือ [x, y, z] ได้รับ {p}")
    return (float(p[0]), float(p[1]), float(p[2]) if len(p) == 3 else 0.0)


def _poly_area_perimeter(pts: list[tuple[float, float]], closed: bool) -> tuple[float, float]:
    n = len(pts)
    area = 0.0
    per = 0.0
    for i in range(n if closed else n - 1):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        area += x1 * y2 - x2 * y1
        per += math.hypot(x2 - x1, y2 - y1)
    return (abs(area) / 2 if closed else 0.0), per


# ---------------------------------------------------------------------------
# Backend: AutoCAD ผ่าน COM (Windows)
# ---------------------------------------------------------------------------
class ComBackend:
    name = "com"

    def __init__(self) -> None:
        import pythoncom  # noqa: F401
        import win32com.client  # noqa: F401

        self._app = None

    # --- helpers ---------------------------------------------------------
    def _retry(self, fn, *args, tries: int = 20):
        """AutoCAD มักตอบ 'Call was rejected by callee' ขณะไม่ว่าง — ลองซ้ำ"""
        import pywintypes

        for i in range(tries):
            try:
                return fn(*args)
            except pywintypes.com_error as e:  # type: ignore[attr-defined]
                if e.hresult in (-2147418111, -2147417846) and i < tries - 1:
                    time.sleep(0.25)
                    continue
                raise

    def _connect(self):
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        if self._app is not None:
            try:
                _ = self._app.Name
                return self._app
            except Exception:
                self._app = None
        progid = os.environ.get("AUTOCAD_PROGID", "AutoCAD.Application")
        try:
            self._app = win32com.client.GetActiveObject(progid)
        except Exception:
            self._app = win32com.client.Dispatch(progid)
            self._app.Visible = True
        return self._app

    @property
    def doc(self):
        app = self._connect()
        if app.Documents.Count == 0:
            app.Documents.Add()
        return app.ActiveDocument

    @property
    def ms(self):
        return self.doc.ModelSpace

    @staticmethod
    def _v(seq) -> Any:
        import pythoncom
        import win32com.client

        return win32com.client.VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, [float(x) for x in seq])

    def _finish(self, ent, layer: str | None, color: int | None) -> str:
        if layer:
            self.ensure_layer(layer)
            ent.Layer = layer
        if color is not None:
            ent.color = color
        ent.Update()
        return ent.Handle

    # --- API -------------------------------------------------------------
    def info(self) -> dict:
        app = self._connect()
        d = self.doc
        return {
            "backend": "com",
            "application": app.Name,
            "version": app.Version,
            "document": d.Name,
            "path": d.FullName,
            "entities_in_modelspace": d.ModelSpace.Count,
            "active_layer": d.ActiveLayer.Name,
            "insunits": d.GetVariable("INSUNITS"),
        }

    def ensure_layer(self, name: str, color: int | None = None) -> None:
        layers = self.doc.Layers
        try:
            lay = layers.Item(name)
        except Exception:
            lay = self._retry(layers.Add, name)
        if color is not None:
            lay.color = color

    def layers(self) -> list[dict]:
        out = []
        for lay in self.doc.Layers:
            out.append({"name": lay.Name, "color": lay.color, "on": bool(lay.LayerOn),
                        "frozen": bool(lay.Freeze), "locked": bool(lay.Lock)})
        return out

    def line(self, a, b, layer, color):
        e = self._retry(self.ms.AddLine, self._v(_p3(a)), self._v(_p3(b)))
        return self._finish(e, layer, color)

    def circle(self, c, r, layer, color):
        e = self._retry(self.ms.AddCircle, self._v(_p3(c)), float(r))
        return self._finish(e, layer, color)

    def arc(self, c, r, a0, a1, layer, color):
        e = self._retry(self.ms.AddArc, self._v(_p3(c)), float(r), math.radians(a0), math.radians(a1))
        return self._finish(e, layer, color)

    def polyline(self, pts, closed, layer, color):
        flat = [v for p in pts for v in (float(p[0]), float(p[1]))]
        e = self._retry(self.ms.AddLightWeightPolyline, self._v(flat))
        e.Closed = bool(closed)
        return self._finish(e, layer, color)

    def text(self, s, p, h, rot, layer, color):
        e = self._retry(self.ms.AddText, s, self._v(_p3(p)), float(h))
        e.Rotation = math.radians(rot)
        return self._finish(e, layer, color)

    def mtext(self, s, p, width, h, layer, color):
        e = self._retry(self.ms.AddMText, self._v(_p3(p)), float(width), s)
        e.Height = float(h)
        return self._finish(e, layer, color)

    def dim_aligned(self, a, b, loc, layer, color):
        e = self._retry(self.ms.AddDimAligned, self._v(_p3(a)), self._v(_p3(b)), self._v(_p3(loc)))
        return self._finish(e, layer, color)

    def insert_block(self, name, p, scale, rot, layer, color):
        e = self._retry(self.ms.InsertBlock, self._v(_p3(p)), name, scale, scale, scale, math.radians(rot))
        return self._finish(e, layer, color)

    def define_rect_block(self, name, w, h, with_cross):
        blocks = self.doc.Blocks
        try:
            blocks.Item(name)
            return
        except Exception:
            pass
        b = blocks.Add(self._v((0, 0, 0)), name)
        hw, hh = w / 2, h / 2
        pl = b.AddLightWeightPolyline(self._v([-hw, -hh, hw, -hh, hw, hh, -hw, hh]))
        pl.Closed = True
        if with_cross:
            b.AddLine(self._v((-hw, -hh, 0)), self._v((hw, hh, 0)))
            b.AddLine(self._v((-hw, hh, 0)), self._v((hw, -hh, 0)))

    def define_circle_block(self, name, d):
        blocks = self.doc.Blocks
        try:
            blocks.Item(name)
            return
        except Exception:
            pass
        b = blocks.Add(self._v((0, 0, 0)), name)
        r = d / 2
        b.AddCircle(self._v((0, 0, 0)), r)
        b.AddLine(self._v((-r, 0, 0)), self._v((r, 0, 0)))
        b.AddLine(self._v((0, -r, 0)), self._v((0, r, 0)))

    def entities(self, layer, type_filter, limit):
        out = []
        for e in self.ms:
            t = e.ObjectName
            if layer and e.Layer.lower() != layer.lower():
                continue
            if type_filter and type_filter.lower() not in t.lower():
                continue
            item = {"handle": e.Handle, "type": t, "layer": e.Layer}
            try:
                mn, mx = e.GetBoundingBox()
                item["bbox"] = [list(mn)[:2], list(mx)[:2]]
            except Exception:
                pass
            out.append(item)
            if len(out) >= limit:
                break
        return out

    def _by_handle(self, handle):
        return self.doc.HandleToObject(handle)

    def entity(self, handle) -> dict:
        e = self._by_handle(handle)
        t = e.ObjectName
        d: dict[str, Any] = {"handle": handle, "type": t, "layer": e.Layer, "color": e.color}
        if t == "AcDbPolyline":
            c = list(e.Coordinates)
            pts = [(c[i], c[i + 1]) for i in range(0, len(c), 2)]
            d.update(points=pts, closed=bool(e.Closed), area=e.Area, length=e.Length)
        elif t == "AcDbLine":
            d.update(start=list(e.StartPoint), end=list(e.EndPoint), length=e.Length)
        elif t == "AcDbCircle":
            d.update(center=list(e.Center), radius=e.Radius, area=e.Area)
        elif t in ("AcDbText", "AcDbMText"):
            d.update(text=e.TextString, position=list(e.InsertionPoint))
        elif t == "AcDbBlockReference":
            d.update(block=e.EffectiveName, position=list(e.InsertionPoint))
        return d

    def delete(self, handle):
        self._by_handle(handle).Delete()

    def move(self, handle, dx, dy):
        e = self._by_handle(handle)
        e.Move(self._v((0, 0, 0)), self._v((dx, dy, 0)))

    def command(self, cmd):
        if not cmd.endswith((" ", "\n")):
            cmd += "\n"
        self._retry(self.doc.SendCommand, cmd)

    def zoom_extents(self):
        self._connect().ZoomExtents()

    def save(self, path):
        d = self.doc
        if path:
            d.SaveAs(os.path.abspath(path))
        else:
            d.Save()
        return d.FullName

    def new(self, path):
        app = self._connect()
        app.Documents.Add()
        return app.ActiveDocument.Name

    def open(self, path):
        d = self._connect().Documents.Open(os.path.abspath(path))
        return d.FullName


# ---------------------------------------------------------------------------
# Backend: ไฟล์ DXF (ezdxf) — ใช้ได้ทุกระบบ
# ---------------------------------------------------------------------------
class DxfBackend:
    name = "dxf"

    def __init__(self) -> None:
        import ezdxf

        self._ezdxf = ezdxf
        self.path = os.path.abspath(os.environ.get("AUTOCAD_MCP_DXF", "drawing.dxf"))
        if os.path.exists(self.path):
            self.doc = ezdxf.readfile(self.path)
        else:
            self._new_doc()

    def _new_doc(self):
        self.doc = self._ezdxf.new("R2018", setup=True)
        self.doc.units = 6  # เมตร

    @property
    def ms(self):
        return self.doc.modelspace()

    def _attribs(self, layer, color) -> dict:
        a: dict[str, Any] = {}
        if layer:
            self.ensure_layer(layer)
            a["layer"] = layer
        if color is not None:
            a["color"] = color
        return a

    def _autosave(self):
        self.doc.saveas(self.path)

    def info(self):
        return {"backend": "dxf", "path": self.path, "dxfversion": self.doc.dxfversion,
                "entities_in_modelspace": len(self.ms), "insunits": self.doc.units}

    def ensure_layer(self, name, color=None):
        if name not in self.doc.layers:
            self.doc.layers.add(name)
        if color is not None:
            self.doc.layers.get(name).color = color

    def layers(self):
        return [{"name": l.dxf.name, "color": l.color, "on": l.is_on(), "frozen": l.is_frozen(),
                 "locked": l.is_locked()} for l in self.doc.layers]

    def line(self, a, b, layer, color):
        e = self.ms.add_line(_p3(a), _p3(b), dxfattribs=self._attribs(layer, color))
        self._autosave()
        return e.dxf.handle

    def circle(self, c, r, layer, color):
        e = self.ms.add_circle(_p3(c), r, dxfattribs=self._attribs(layer, color))
        self._autosave()
        return e.dxf.handle

    def arc(self, c, r, a0, a1, layer, color):
        e = self.ms.add_arc(_p3(c), r, a0, a1, dxfattribs=self._attribs(layer, color))
        self._autosave()
        return e.dxf.handle

    def polyline(self, pts, closed, layer, color):
        e = self.ms.add_lwpolyline([(p[0], p[1]) for p in pts], close=closed,
                                   dxfattribs=self._attribs(layer, color))
        self._autosave()
        return e.dxf.handle

    def text(self, s, p, h, rot, layer, color):
        a = self._attribs(layer, color) | {"height": h, "rotation": rot}
        e = self.ms.add_text(s, dxfattribs=a)
        e.set_placement(_p3(p))
        self._autosave()
        return e.dxf.handle

    def mtext(self, s, p, width, h, layer, color):
        a = self._attribs(layer, color) | {"char_height": h, "width": width, "insert": _p3(p)}
        e = self.ms.add_mtext(s, dxfattribs=a)
        self._autosave()
        return e.dxf.handle

    def dim_aligned(self, a, b, loc, layer, color):
        # ระยะห่างเส้นบอกขนาดจากเส้นวัด = ระยะจาก loc ถึงเส้น a-b
        ax, ay, _ = _p3(a)
        bx, by, _ = _p3(b)
        lx, ly, _ = _p3(loc)
        L = math.hypot(bx - ax, by - ay) or 1.0
        dist = ((bx - ax) * (ly - ay) - (by - ay) * (lx - ax)) / L
        d = self.ms.add_aligned_dim(p1=(ax, ay), p2=(bx, by), distance=dist,
                                    dxfattribs=self._attribs(layer, color))
        d.render()
        self._autosave()
        return d.dimension.dxf.handle

    def insert_block(self, name, p, scale, rot, layer, color):
        a = self._attribs(layer, color) | {"xscale": scale, "yscale": scale, "zscale": scale, "rotation": rot}
        e = self.ms.add_blockref(name, _p3(p), dxfattribs=a)
        self._autosave()
        return e.dxf.handle

    def define_rect_block(self, name, w, h, with_cross):
        if name in self.doc.blocks:
            return
        b = self.doc.blocks.new(name)
        hw, hh = w / 2, h / 2
        b.add_lwpolyline([(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)], close=True)
        if with_cross:
            b.add_line((-hw, -hh), (hw, hh))
            b.add_line((-hw, hh), (hw, -hh))

    def define_circle_block(self, name, d):
        if name in self.doc.blocks:
            return
        b = self.doc.blocks.new(name)
        r = d / 2
        b.add_circle((0, 0), r)
        b.add_line((-r, 0), (r, 0))
        b.add_line((0, -r), (0, r))

    def entities(self, layer, type_filter, limit):
        from ezdxf import bbox

        out = []
        for e in self.ms:
            t = e.dxftype()
            if layer and e.dxf.get("layer", "0").lower() != layer.lower():
                continue
            if type_filter and type_filter.lower() not in t.lower():
                continue
            item = {"handle": e.dxf.handle, "type": t, "layer": e.dxf.get("layer", "0")}
            try:
                bb = bbox.extents([e])
                if bb.has_data:
                    item["bbox"] = [list(bb.extmin)[:2], list(bb.extmax)[:2]]
            except Exception:
                pass
            out.append(item)
            if len(out) >= limit:
                break
        return out

    def _by_handle(self, handle):
        e = self.doc.entitydb.get(handle)
        if e is None:
            raise ValueError(f"ไม่พบวัตถุ handle {handle}")
        return e

    def entity(self, handle):
        e = self._by_handle(handle)
        t = e.dxftype()
        d: dict[str, Any] = {"handle": handle, "type": t, "layer": e.dxf.get("layer", "0"),
                             "color": e.dxf.get("color", 256)}
        if t == "LWPOLYLINE":
            pts = [(p[0], p[1]) for p in e.get_points("xy")]
            area, per = _poly_area_perimeter(pts, e.closed)
            d.update(points=pts, closed=e.closed, area=area, length=per)
        elif t == "LINE":
            d.update(start=list(e.dxf.start), end=list(e.dxf.end),
                     length=(e.dxf.end - e.dxf.start).magnitude)
        elif t == "CIRCLE":
            d.update(center=list(e.dxf.center), radius=e.dxf.radius, area=math.pi * e.dxf.radius ** 2)
        elif t in ("TEXT", "MTEXT"):
            d.update(text=e.dxf.text if t == "TEXT" else e.text, position=list(e.dxf.insert))
        elif t == "INSERT":
            d.update(block=e.dxf.name, position=list(e.dxf.insert))
        return d

    def delete(self, handle):
        self.ms.delete_entity(self._by_handle(handle))
        self._autosave()

    def move(self, handle, dx, dy):
        self._by_handle(handle).translate(dx, dy, 0)
        self._autosave()

    def command(self, cmd):
        raise RuntimeError("โหมด DXF ส่งคำสั่ง AutoCAD ไม่ได้ ต้องใช้โหมด com บน Windows ที่เปิด AutoCAD")

    def zoom_extents(self):
        from ezdxf import zoom

        zoom.extents(self.ms)
        self._autosave()

    def save(self, path):
        if path:
            self.path = os.path.abspath(path)
        self.doc.saveas(self.path)
        return self.path

    def new(self, path):
        self._new_doc()
        if path:
            self.path = os.path.abspath(path)
        self._autosave()
        return self.path

    def open(self, path):
        self.path = os.path.abspath(path)
        self.doc = self._ezdxf.readfile(self.path)
        return self.path


def _make_backend():
    want = os.environ.get("AUTOCAD_MCP_BACKEND", "auto").lower()
    if want in ("com", "auto") and sys.platform == "win32":
        try:
            return ComBackend()
        except ImportError:
            if want == "com":
                raise RuntimeError("ต้องติดตั้ง pywin32: pip install pywin32")
    if want == "com":
        raise RuntimeError("โหมด com ใช้ได้เฉพาะ Windows ที่ติดตั้ง AutoCAD")
    return DxfBackend()


_backend = None


def cad():
    global _backend
    if _backend is None:
        _backend = _make_backend()
    return _backend


# ---------------------------------------------------------------------------
# MCP tools
# ---------------------------------------------------------------------------
mcp = _Server(
    "autocad",
    instructions=(
        "เครื่องมือวาดและอ่านแบบใน AutoCAD (หรือไฟล์ DXF) "
        "พิกัดเป็น [x, y] หรือ [x, y, z] ในหน่วยของแบบ (โดยทั่วไปคือเมตรสำหรับงานแสงสว่าง) "
        "ทุกคำสั่งวาดคืนค่า handle ของวัตถุ ใช้ handle กับ get_entity/move_entity/delete_entity ได้ "
        "เริ่มจาก get_drawing_info เพื่อดูว่าเชื่อมต่อแบบใดอยู่"
    ),
)

# COM ผูกกับเธรดที่สร้างอ็อบเจกต์ จึงรันทุกคำสั่งบนเธรดเดียว (และกันการเรียกซ้อนกัน)
_cad_thread = ThreadPoolExecutor(max_workers=1, thread_name_prefix="autocad")


def tool(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return _cad_thread.submit(fn, *args, **kwargs).result()
        except ToolError:
            raise
        except Exception as e:  # ส่งข้อความผิดพลาดจริงกลับไปให้ Claude
            raise ToolError(f"{type(e).__name__}: {e}") from e

    return mcp.tool()(wrapper)


@tool
def get_drawing_info() -> dict:
    """ข้อมูลการเชื่อมต่อ: โหมด (com/dxf), ชื่อไฟล์, จำนวนวัตถุ, หน่วย (INSUNITS: 4=mm, 5=cm, 6=m)"""
    return cad().info()


@tool
def list_layers() -> list[dict]:
    """รายชื่อเลเยอร์ทั้งหมดพร้อมสีและสถานะ"""
    return cad().layers()


@tool
def create_layer(name: str, color: int | str | None = None) -> str:
    """สร้างเลเยอร์ (ถ้ามีอยู่แล้วจะปรับสีให้) สีเป็นเลข ACI หรือชื่อ เช่น red, yellow, cyan"""
    cad().ensure_layer(name, _color(color))
    return f"เลเยอร์ {name} พร้อมใช้งาน"


@tool
def draw_line(start: Point, end: Point, layer: str | None = None, color: int | str | None = None) -> str:
    """วาดเส้นตรงจาก start ไป end คืนค่า handle"""
    return cad().line(start, end, layer, _color(color))


@tool
def draw_circle(center: Point, radius: float, layer: str | None = None, color: int | str | None = None) -> str:
    """วาดวงกลม คืนค่า handle"""
    return cad().circle(center, radius, layer, _color(color))


@tool
def draw_arc(center: Point, radius: float, start_angle: float, end_angle: float,
             layer: str | None = None, color: int | str | None = None) -> str:
    """วาดเส้นโค้ง มุมเป็นองศา ทวนเข็มนาฬิกาจาก start_angle ถึง end_angle"""
    return cad().arc(center, radius, start_angle, end_angle, layer, _color(color))


@tool
def draw_polyline(points: list[Point], closed: bool = False, layer: str | None = None,
                  color: int | str | None = None) -> str:
    """วาดโพลีไลน์ 2D ผ่านจุดหลายจุด closed=true เพื่อปิดรูป (เช่น ขอบห้อง)"""
    if len(points) < 2:
        raise ValueError("ต้องมีอย่างน้อย 2 จุด")
    return cad().polyline(points, closed, layer, _color(color))


@tool
def draw_rectangle(corner: Point, width: float, height: float, layer: str | None = None,
                   color: int | str | None = None) -> str:
    """วาดสี่เหลี่ยมจากมุมซ้ายล่าง กว้าง (แกน X) × สูง (แกน Y)"""
    x, y = corner[0], corner[1]
    pts = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
    return cad().polyline(pts, True, layer, _color(color))


@tool
def add_text(text: str, position: Point, height: float = 0.25, rotation: float = 0.0,
             layer: str | None = None, color: int | str | None = None) -> str:
    """เขียนข้อความบรรทัดเดียว rotation เป็นองศา"""
    return cad().text(text, position, height, rotation, layer, _color(color))


@tool
def add_mtext(text: str, position: Point, width: float = 5.0, height: float = 0.25,
              layer: str | None = None, color: int | str | None = None) -> str:
    """เขียนข้อความหลายบรรทัด (MText) position คือมุมซ้ายบน ขึ้นบรรทัดใหม่ด้วย \\P"""
    return cad().mtext(text, position, width, height, layer, _color(color))


@tool
def add_dimension(start: Point, end: Point, dim_line_point: Point, layer: str | None = None) -> str:
    """ใส่เส้นบอกขนาดแนวขนาน (aligned) ระหว่าง start-end โดยเส้นบอกขนาดผ่าน dim_line_point"""
    return cad().dim_aligned(start, end, dim_line_point, layer, None)


@tool
def insert_block(name: str, position: Point, scale: float = 1.0, rotation: float = 0.0,
                 layer: str | None = None) -> str:
    """แทรกบล็อกที่มีอยู่ในแบบ (หรือ path ไฟล์ .dwg ในโหมด com)"""
    return cad().insert_block(name, position, scale, rotation, layer, None)


@tool
def list_entities(layer: str | None = None, type_filter: str | None = None, limit: int = 200) -> list[dict]:
    """รายการวัตถุใน Model Space (กรองตามเลเยอร์/ชนิด เช่น 'polyline', 'circle') พร้อม bbox"""
    return cad().entities(layer, type_filter, limit)


@tool
def get_entity(handle: str) -> dict:
    """รายละเอียดวัตถุจาก handle เช่น จุดของโพลีไลน์ พื้นที่ ความยาว ข้อความ"""
    return cad().entity(handle)


@tool
def move_entity(handle: str, dx: float, dy: float) -> str:
    """ย้ายวัตถุไป dx, dy"""
    cad().move(handle, dx, dy)
    return "ย้ายแล้ว"


@tool
def delete_entity(handle: str) -> str:
    """ลบวัตถุตาม handle"""
    cad().delete(handle)
    return "ลบแล้ว"


@tool
def send_command(command: str) -> str:
    """ส่งคำสั่งดิบไปที่บรรทัดคำสั่ง AutoCAD (เฉพาะโหมด com) เช่น '_REGEN' หรือ '_-LAYER _S 0 '
    ใช้ช่องว่างหรือขึ้นบรรทัดแทนการกด Enter"""
    cad().command(command)
    return "ส่งคำสั่งแล้ว"


@tool
def zoom_extents() -> str:
    """ซูมให้เห็นแบบทั้งหมด"""
    cad().zoom_extents()
    return "ซูมแล้ว"


@tool
def new_drawing(path: str | None = None) -> str:
    """เปิดแบบใหม่ (โหมด dxf: path คือไฟล์ .dxf ที่จะบันทึก)"""
    return cad().new(path)


@tool
def open_drawing(path: str) -> str:
    """เปิดไฟล์ .dwg (โหมด com) หรือ .dxf"""
    return cad().open(path)


@tool
def save_drawing(path: str | None = None) -> str:
    """บันทึกแบบ (ใส่ path เพื่อ Save As)"""
    return cad().save(path)


# ---------------------------------------------------------------------------
# เครื่องมือเฉพาะงานแสงสว่าง (เชื่อมกับเว็บแอปคำนวณแสงในโปรเจกต์นี้)
# ---------------------------------------------------------------------------
@tool
def measure_room(handle: str) -> dict:
    """อ่านขอบห้องจากโพลีไลน์ปิด: จุดมุม พื้นที่ เส้นรอบรูป และ bbox (ใช้หา RI = 2A / (Hm × P))"""
    d = cad().entity(handle)
    if "points" not in d:
        raise ValueError("วัตถุนี้ไม่ใช่โพลีไลน์")
    pts = [(float(p[0]), float(p[1])) for p in d["points"]]
    area, per = _poly_area_perimeter(pts, True)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return {"points": pts, "area": area, "perimeter": per,
            "bbox": [[min(xs), min(ys)], [max(xs), max(ys)]],
            "length_x": max(xs) - min(xs), "width_y": max(ys) - min(ys)}


@tool
def lumen_method(area: float, perimeter: float, ceiling_height: float, target_lux: float,
                 lumens_per_luminaire: float, work_plane: float = 0.75,
                 utilization_factor: float | None = None, maintenance_factor: float = 0.8) -> dict:
    """คำนวณจำนวนโคมด้วย Lumen Method: N = E×A / (Φ×UF×MF)
    ถ้าไม่ระบุ UF จะประมาณจากดัชนีห้อง (RI) สำหรับผนังสีอ่อน"""
    hm = ceiling_height - work_plane
    if hm <= 0:
        raise ValueError("ความสูงฝ้าต้องมากกว่าระนาบใช้งาน")
    ri = 2 * area / (hm * perimeter)
    if utilization_factor is None:
        table = [(0.6, 0.35), (0.8, 0.42), (1.0, 0.47), (1.25, 0.52), (1.5, 0.56),
                 (2.0, 0.61), (2.5, 0.65), (3.0, 0.68), (4.0, 0.71), (5.0, 0.73)]
        uf = table[0][1] if ri <= table[0][0] else table[-1][1]
        for (r0, u0), (r1, u1) in zip(table, table[1:]):
            if r0 <= ri <= r1:
                uf = u0 + (u1 - u0) * (ri - r0) / (r1 - r0)
                break
    else:
        uf = utilization_factor
    n = target_lux * area / (lumens_per_luminaire * uf * maintenance_factor)
    n_round = max(1, math.ceil(n))
    achieved = n_round * lumens_per_luminaire * uf * maintenance_factor / area
    return {"room_index": round(ri, 2), "UF": round(uf, 3), "MF": maintenance_factor,
            "luminaires_exact": round(n, 2), "luminaires": n_round, "achieved_lux": round(achieved, 1)}


@tool
def place_luminaire_grid(x_min: float, y_min: float, x_max: float, y_max: float, rows: int, cols: int,
                         luminaire_width: float = 0.6, luminaire_length: float = 0.6,
                         shape: str = "rect", layer: str = "E-LIGHTING", label: str | None = None,
                         text_height: float = 0.15) -> dict:
    """วางโคมไฟเป็นตาราง rows × cols ในกรอบห้อง โดยระยะขอบ = ครึ่งหนึ่งของระยะห่างระหว่างโคม
    shape: 'rect' (โคมตะแกรง/พาเนล), 'circle' (ดาวน์ไลท์ ใช้ luminaire_width เป็นเส้นผ่านศูนย์กลาง)
    label: ข้อความกำกับใต้โคมแต่ละดวง เช่น 'L1'"""
    if rows < 1 or cols < 1:
        raise ValueError("rows และ cols ต้อง ≥ 1")
    c = cad()
    c.ensure_layer(layer, 2)
    if shape == "circle":
        bname = f"LUM_DL_{int(round(luminaire_width * 1000))}"
        c.define_circle_block(bname, luminaire_width)
    else:
        bname = f"LUM_{int(round(luminaire_length * 1000))}x{int(round(luminaire_width * 1000))}"
        c.define_rect_block(bname, luminaire_length, luminaire_width, True)
    sx = (x_max - x_min) / cols
    sy = (y_max - y_min) / rows
    handles = []
    positions = []
    for i in range(rows):
        for j in range(cols):
            x = x_min + sx * (j + 0.5)
            y = y_min + sy * (i + 0.5)
            handles.append(c.insert_block(bname, [x, y], 1.0, 0.0, layer, None))
            positions.append([round(x, 3), round(y, 3)])
            if label:
                off = luminaire_width / 2 + text_height * 1.5
                c.text(label, [x - text_height, y - off], text_height, 0, layer, None)
    return {"block": bname, "count": len(handles), "spacing_x": round(sx, 3), "spacing_y": round(sy, 3),
            "positions": positions, "handles": handles}


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
