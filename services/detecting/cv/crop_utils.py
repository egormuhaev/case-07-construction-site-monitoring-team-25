from PIL import Image as PILImage

from ..model.detected_object import DetectedObject

CROP_PADDING = 0.1
MIN_CROP_SIZE = 16


def crop(frame: PILImage.Image, obj: DetectedObject) -> PILImage.Image | None:
    width, height = frame.size
    box_w = max(0.0, obj.x2 - obj.x1)
    box_h = max(0.0, obj.y2 - obj.y1)
    pad_x = box_w * CROP_PADDING
    pad_y = box_h * CROP_PADDING
    x1 = max(0, int(obj.x1 - pad_x))
    y1 = max(0, int(obj.y1 - pad_y))
    x2 = min(width, int(obj.x2 + pad_x))
    y2 = min(height, int(obj.y2 + pad_y))
    if x2 - x1 < MIN_CROP_SIZE or y2 - y1 < MIN_CROP_SIZE:
        return None
    return frame.crop((x1, y1, x2, y2))
