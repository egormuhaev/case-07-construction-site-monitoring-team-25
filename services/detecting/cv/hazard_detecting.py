from ultralytics import YOLO
from ultralytics.engine.results import Results

from ..config import CV_MODEL_1, get_device
from ..model import ImageDataset
from .detector import ClassMapping, Detector, group_mapping

WEIGHTS_FILE = "models/yolo26/pt/yolo26s.pt"
CONF = 0.25
IOU = 0.45
IMGSZ = 640

RAW_TO_GROUP = {
    5: group_mapping("PERSON"),
    8: group_mapping("UNKNOWN_EQUIPMENT"),
}


class HazardDetector(Detector):
    model_id = CV_MODEL_1
    weights_file = WEIGHTS_FILE

    def load_model(self) -> None:
        if self.model is not None:
            return
        self.model = YOLO(str(self.weights_path()))

    def detect(self, dataset: ImageDataset) -> None:
        if self.model is None:
            self.load_model()
        model = self.model
        assert model is not None
        device = get_device()

        for image in dataset.images:
            result = next(
                iter(
                    model.predict(
                        image.filepath,
                        conf=CONF,
                        iou=IOU,
                        imgsz=IMGSZ,
                        device=device,
                        verbose=False,
                    )
                )
            )
            if isinstance(result, Results):
                self._append_boxes(image, result.boxes)

    def map_class(self, raw_class_id: int) -> ClassMapping | None:
        return RAW_TO_GROUP.get(raw_class_id)

    def _append_boxes(self, image, boxes) -> None:
        if boxes is None or len(boxes) == 0:
            return

        for xyxy, class_id, conf in zip(
            boxes.xyxy.tolist(),
            boxes.cls.tolist(),
            boxes.conf.tolist(),
        ):
            raw_class_id = int(class_id)
            mapped = self.map_class(raw_class_id)
            if mapped is None:
                continue
            x1, y1, x2, y2 = xyxy
            self.append_detection(
                image,
                float(x1),
                float(y1),
                float(x2),
                float(y2),
                mapped,
                float(conf),
                raw_class_id,
            )
