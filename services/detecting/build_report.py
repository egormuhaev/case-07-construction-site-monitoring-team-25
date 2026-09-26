import html
import shutil
from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont

from .config import REPORT_DIR
from .model import DetectedObject, Image, ImageDataset
from .model.equipment_group import (
    GROUP_BY_CODE,
    PERSON_CODE,
    UNKNOWN_EQUIPMENT_CODE,
    EquipmentGroup,
)

PERSON_COLOR = (46, 204, 113)
EQUIPMENT_COLOR = (241, 196, 15)
SPECIFIC_COLOR = (52, 152, 219)


class BuildReport:
    def __init__(self, dataset: ImageDataset, output_dir: Path | None = None) -> None:
        self.dataset = dataset
        self.output_dir = Path(output_dir) if output_dir is not None else REPORT_DIR
        self.images_dir = self.output_dir / "images"

    def build(self) -> Path:
        if self.output_dir.exists():
            shutil.rmtree(self.output_dir)
        self.images_dir.mkdir(parents=True)

        cards: list[str] = []
        for index, image in enumerate(self.dataset.images):
            filename = _annotated_name(index, image.filepath)
            self._annotate(image, self.images_dir / filename)
            cards.append(self._card_html(image, filename))

        index_path = self.output_dir / "index.html"
        index_path.write_text(_page_html(cards), encoding="utf-8")
        return index_path

    def _annotate(self, image: Image, destination: Path) -> None:
        with PILImage.open(image.filepath) as src:
            canvas = src.convert("RGB")
        draw = ImageDraw.Draw(canvas)
        font = _font(max(14, min(canvas.size) // 50))
        stroke = max(2, min(canvas.size) // 250)

        for obj in image.objects:
            color = _box_color(obj)
            x1, y1, x2, y2 = obj.x1, obj.y1, obj.x2, obj.y2
            draw.rectangle((x1, y1, x2, y2), outline=color, width=stroke)
            font_size = getattr(font, "size", 14)
            draw.text(
                (x1 + stroke, max(0, y1 - stroke - font_size)),
                _box_label(obj),
                fill=color,
                font=font,
                stroke_width=1,
                stroke_fill=(0, 0, 0),
            )
        canvas.save(destination, quality=90)

    def _card_html(self, image: Image, filename: str) -> str:
        camera = "—" if image.camera is None else str(image.camera)
        captured = f"{image.captured_date.isoformat()} {image.captured_time.strftime('%H:%M')}"
        items = "\n".join(_object_html(obj) for obj in image.objects) or "<li>нет детекций</li>"
        return f"""
        <article class="card">
          <img src="images/{html.escape(filename)}" alt="{html.escape(Path(image.filepath).name)}">
          <header>
            <strong>{html.escape(Path(image.filepath).name)}</strong>
            <span>камера {html.escape(camera)} · {html.escape(captured)}</span>
          </header>
          <ul>{items}</ul>
        </article>
        """


def _annotated_name(index: int, filepath: str) -> str:
    path = Path(filepath)
    suffix = path.suffix.lower() if path.suffix else ".jpg"
    return f"{index:04d}_{path.stem}{suffix}"


def _box_color(obj: DetectedObject) -> tuple[int, int, int]:
    if obj.group == PERSON_CODE:
        return PERSON_COLOR
    if obj.group == UNKNOWN_EQUIPMENT_CODE:
        return EQUIPMENT_COLOR
    return SPECIFIC_COLOR


def _box_label(obj: DetectedObject) -> str:
    item = _group(obj.group)
    conf = f"{obj.conf:.2f}"
    if obj.needs_refinement:
        return f"? {item.code} {conf}"
    return f"{item.code} {conf}"


def _object_html(obj: DetectedObject) -> str:
    item = _group(obj.group)
    refinement = "да" if obj.needs_refinement else "нет"
    norms = ", ".join(item.normative_groups) or "—"
    return (
        "<li>"
        f"<b>{html.escape(item.code)}</b> — {html.escape(item.description)} · "
        f"conf {obj.conf:.2f} · нормы {html.escape(norms)} · "
        f"needs_refinement {refinement}"
        "</li>"
    )


def _group(code: str) -> EquipmentGroup:
    if code == PERSON_CODE:
        return EquipmentGroup(PERSON_CODE, "Рабочий", ())
    item = GROUP_BY_CODE.get(code)
    if item is not None:
        return item
    return EquipmentGroup(code, code, ())


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "arial.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _page_html(cards: list[str]) -> str:
    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Detection report</title>
  <style>
    body {{ font-family: sans-serif; margin: 24px; background: #111; color: #eee; }}
    h1 {{ font-size: 20px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 20px; }}
    .card {{ background: #1c1c1c; border-radius: 8px; overflow: hidden; }}
    .card img {{ width: 100%; display: block; }}
    .card header {{ padding: 10px 12px 0; display: flex; flex-direction: column; gap: 4px; }}
    .card header span {{ color: #aaa; font-size: 13px; }}
    .card ul {{ margin: 8px 12px 16px; padding-left: 18px; font-size: 13px; }}
  </style>
</head>
<body>
  <h1>Detection report · {len(cards)} кадров</h1>
  <section class="grid">
    {"".join(cards)}
  </section>
</body>
</html>
"""
