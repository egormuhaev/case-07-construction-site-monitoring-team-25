from itertools import combinations

from ..model import ImageDataset
from ..model.detected_object import DetectedObject
from ..model.equipment_group import PERSON_CODE, UNKNOWN_EQUIPMENT_CODE

IOU_THRESHOLD = 0.5
COVERAGE_THRESHOLD = 0.75


class DetectionResolver:
    def resolve(self, dataset: ImageDataset) -> None:
        for image in dataset.images:
            image.objects = self.resolve_objects(image.objects)

    def resolve_objects(self, objects: list[DetectedObject]) -> list[DetectedObject]:
        if len(objects) < 2:
            return objects

        people = [obj for obj in objects if obj.group == PERSON_CODE]
        equipment = [obj for obj in objects if obj.group != PERSON_CODE]
        return [
            *self._resolve_group(people),
            *self._resolve_group(equipment),
        ]

    def _resolve_group(self, objects: list[DetectedObject]) -> list[DetectedObject]:
        if len(objects) < 2:
            return objects

        by_model: dict[str, list[int]] = {}
        for index, obj in enumerate(objects):
            by_model.setdefault(obj.model_id, []).append(index)

        model_ids = list(by_model)
        if len(model_ids) < 2:
            return objects

        pairs: list[tuple[float, int, int]] = []
        for left_model, right_model in combinations(model_ids, 2):
            for left in by_model[left_model]:
                for right in by_model[right_model]:
                    score = _match_score(objects[left], objects[right])
                    if score is None:
                        continue
                    pairs.append((score, left, right))

        pairs.sort(key=lambda item: item[0], reverse=True)
        used: set[int] = set()
        merged: list[DetectedObject] = []
        for _, left, right in pairs:
            if left in used or right in used:
                continue
            used.add(left)
            used.add(right)
            merged.append(_merge_objects(objects[left], objects[right]))

        leftover = [obj for index, obj in enumerate(objects) if index not in used]
        return [*merged, *leftover]


def _match_score(left: DetectedObject, right: DetectedObject) -> float | None:
    iou, coverage = _overlap(left, right)
    if iou >= IOU_THRESHOLD or coverage >= COVERAGE_THRESHOLD:
        return max(iou, coverage)
    return None


def _overlap(left: DetectedObject, right: DetectedObject) -> tuple[float, float]:
    x1 = max(left.x1, right.x1)
    y1 = max(left.y1, right.y1)
    x2 = min(left.x2, right.x2)
    y2 = min(left.y2, right.y2)
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area_left = max(0.0, left.x2 - left.x1) * max(0.0, left.y2 - left.y1)
    area_right = max(0.0, right.x2 - right.x1) * max(0.0, right.y2 - right.y1)
    union = area_left + area_right - intersection
    iou = intersection / union if union > 0 else 0.0
    smaller = min(area_left, area_right)
    coverage = intersection / smaller if smaller > 0 else 0.0
    return iou, coverage


def _merge_objects(left: DetectedObject, right: DetectedObject) -> DetectedObject:
    group, needs_refinement = _resolve_groups(left, right)
    total_conf = left.conf + right.conf
    if total_conf <= 0:
        weight_left = 0.5
        weight_right = 0.5
    else:
        weight_left = left.conf / total_conf
        weight_right = right.conf / total_conf

    primary = left if left.conf >= right.conf else right
    source, class_conf = _merge_classification(left, right, group, needs_refinement)
    return DetectedObject(
        model_id=primary.model_id,
        x1=left.x1 * weight_left + right.x1 * weight_right,
        y1=left.y1 * weight_left + right.y1 * weight_right,
        x2=left.x2 * weight_left + right.x2 * weight_right,
        y2=left.y2 * weight_left + right.y2 * weight_right,
        group=group,
        conf=max(left.conf, right.conf),
        needs_refinement=needs_refinement,
        classification_source=source,
        classification_confidence=class_conf,
        evidence=[*left.evidence, *right.evidence],
    )


def _resolve_groups(left: DetectedObject, right: DetectedObject) -> tuple[str, bool]:
    if left.group == PERSON_CODE or right.group == PERSON_CODE:
        return PERSON_CODE, False

    left_known = left.group != UNKNOWN_EQUIPMENT_CODE
    right_known = right.group != UNKNOWN_EQUIPMENT_CODE
    if left_known and right_known:
        if left.group == right.group:
            return left.group, False
        return UNKNOWN_EQUIPMENT_CODE, True
    if left_known:
        return left.group, False
    if right_known:
        return right.group, False
    return UNKNOWN_EQUIPMENT_CODE, True


def _merge_classification(
    left: DetectedObject,
    right: DetectedObject,
    group: str,
    needs_refinement: bool,
) -> tuple[str | None, float | None]:
    if needs_refinement or group == UNKNOWN_EQUIPMENT_CODE:
        return None, None
    candidates = [
        obj
        for obj in (left, right)
        if obj.group == group and obj.classification_source is not None
    ]
    if not candidates:
        return None, None
    picked = max(candidates, key=lambda obj: obj.classification_confidence or 0.0)
    return picked.classification_source, picked.classification_confidence
