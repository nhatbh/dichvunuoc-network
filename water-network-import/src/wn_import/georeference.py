"""Authoritative CAD point registration with independent metric validation."""
from dataclasses import dataclass

import numpy as np
from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError, ProjError

from .models import ReviewConfig

MAX_CONTROL_EXTENT_DEGREES = 1.0
MIN_NORMALIZED_SPREAD = 1e-8


@dataclass
class Registration:
    diagnostics: dict
    crs: CRS | None = None
    affine: np.ndarray | None = None
    error_code: str = "CONTROL_POINTS_INVALID"
    source_center: np.ndarray | None = None
    source_scale: float | None = None
    target_center: np.ndarray | None = None
    coefficients: np.ndarray | None = None

    @property
    def error(self):
        return self.diagnostics["error"]

    def transform(self, points):
        # Apply the same normalized fit used for residuals. Expanding to a raw
        # offset matrix would lose precision for CAD coordinates with large origins.
        normalized = (np.asarray(points, dtype=float) - self.source_center) / self.source_scale
        return (np.column_stack((normalized, np.ones(len(normalized))))
                @ self.coefficients + self.target_center)


def prepare_georeference(config: ReviewConfig) -> Registration:
    points = config.controlPoints
    fits = [i for i, point in enumerate(points) if not point.checkOnly]
    checks = [i for i, point in enumerate(points) if point.checkOnly]
    diagnostics = {
        "status": "incomplete",
        "targetCrs": config.controlPointTargetCrs or config.sourceCrs,
        "fitPointCount": len(fits),
        "checkPointCount": len(checks),
        "thresholdM": config.controlPointMaxErrorM,
        "maxErrorM": None,
        "rmseM": None,
        "residuals": [],
        "workingCrs": None,
        "error": None,
    }
    registration = Registration(diagnostics)

    def reject(message, status="invalid", code="CONTROL_POINTS_INVALID"):
        diagnostics.update(status=status, error=message)
        registration.error_code = code
        return registration

    if config.fileCrs or (config.controlPointTargetCrs and config.sourceCrs):
        return reject(
            "Ghép điểm CAD–GIS không kết hợp với hệ tọa độ riêng từng tệp hoặc hệ tọa độ CAD đã chọn.",
            code="AFFINE_SCOPE",
        )
    if any(point.source is None or point.target is None for point in points):
        return reject("Hoàn thành cả điểm CAD và điểm GIS của từng cặp đã lưu.", "incomplete")
    if len(fits) < 3 or not checks:
        return reject(
            "Cần ít nhất 3 điểm không thẳng hàng để tính và một điểm kiểm tra độc lập.",
            "incomplete",
        )
    if not config.controlPointTargetCrs and not config.sourceCrs:
        return reject("Chọn hệ tọa độ của điểm đích hoặc chế độ điểm GIS WGS84.", "incomplete")

    source = np.array([point.source for point in points], dtype=float)
    target = np.array([point.target for point in points], dtype=float)
    try:
        if config.controlPointTargetCrs:
            if not (np.all(np.abs(target[:, 0]) <= 180) and np.all(np.abs(target[:, 1]) <= 90)):
                return reject("Điểm GIS phải là kinh độ/vĩ độ WGS84 hợp lệ.")
            if np.any(np.ptp(target, axis=0) > MAX_CONTROL_EXTENT_DEGREES):
                return reject("Các điểm GIS trải quá 1 độ; chia bản vẽ thành từng khu vực hiệu chỉnh.")
            # Independent checks must not influence the fitting projection or coefficients.
            lon, lat = np.mean(target[fits], axis=0)
            crs = CRS.from_proj4(
                f"+proj=aeqd +lat_0={lat:.15g} +lon_0={lon:.15g} +datum=WGS84 +units=m +no_defs"
            )
            tx = Transformer.from_crs(4326, crs, always_xy=True, allow_ballpark=False)
            target = np.array([tx.transform(x, y, errcheck=True) for x, y in target])
        else:
            crs = CRS.from_user_input(config.sourceCrs)
            if not crs.is_projected:
                return reject("Điểm đích của hiệu chỉnh affine phải thuộc hệ tọa độ phẳng được chọn.")
        registration.crs = crs
        diagnostics["workingCrs"] = crs.to_string()
        units = [axis.unit_conversion_factor for axis in crs.axis_info[:2]]
        if len(units) != 2 or not np.isfinite(units).all() or min(units) <= 0:
            return reject("Đơn vị hệ tọa độ đích không hỗ trợ tính sai số theo mét.")
        with np.errstate(over="ignore", invalid="ignore"):
            center = np.mean(source[fits], axis=0)
            scale = np.max(np.abs(source[fits] - center))
            normalized = (source - center) / scale if scale > 0 else source * np.nan
        if not np.isfinite(normalized).all() or not np.isfinite(target).all():
            return reject("Tọa độ khống chế không đủ phân bố hoặc vượt miền tính toán.")
        # Reject duplicate fit/check locations; a copy of a fitting pair is not an independent check.
        for i in range(len(points)):
            for j in range(i):
                if np.linalg.norm(normalized[i] - normalized[j]) <= MIN_NORMALIZED_SPREAD:
                    return reject("Các điểm CAD phải khác nhau; điểm kiểm tra không được trùng điểm khống chế.")
                if np.linalg.norm((target[i] - target[j]) * units) <= 1e-6:
                    return reject("Các điểm GIS phải khác nhau; điểm kiểm tra phải độc lập.")
        matrix = np.column_stack((normalized[fits], np.ones(len(fits))))
        singular = np.linalg.svd(matrix, compute_uv=False)
        target_center = np.mean(target[fits], axis=0)
        target_delta = target[fits] - target_center
        target_singular = np.linalg.svd(target_delta, compute_uv=False)
        if (singular[-1] <= singular[0] * MIN_NORMALIZED_SPREAD
                or target_singular[0] == 0
                or target_singular[-1] <= target_singular[0] * MIN_NORMALIZED_SPREAD):
            return reject("Các điểm khống chế phải phân bố không thẳng hàng ở cả CAD và GIS.")
        coefficients, _, _, _ = np.linalg.lstsq(matrix, target_delta, rcond=None)
        predicted = np.column_stack((normalized, np.ones(len(points)))) @ coefficients + target_center
        errors = np.linalg.norm((predicted - target) * units, axis=1)
        if not np.isfinite(coefficients).all() or not np.isfinite(errors).all():
            return reject("Không tính được phép hiệu chỉnh hữu hạn từ các cặp điểm.")
        maximum_error = float(np.max(errors))
        rmse = maximum_error * float(np.sqrt(np.mean((errors / maximum_error) ** 2))) if maximum_error else 0.0
        diagnostics.update(
            maxErrorM=maximum_error,
            rmseM=rmse,
            residuals=[{"index": i, "checkOnly": point.checkOnly, "errorM": float(errors[i])}
                       for i, point in enumerate(points)],
        )
        if diagnostics["maxErrorM"] > config.controlPointMaxErrorM:
            return reject(
                f"Sai số điểm khống chế/kiểm tra lớn nhất {diagnostics['maxErrorM']:.3f} m vượt ngưỡng."
            )
        affine = np.empty((3, 2))
        affine[:2] = coefficients[:2] / scale
        affine[2] = coefficients[2] + target_center - center @ affine[:2]
        if not np.isfinite(affine).all():
            return reject("Phép hiệu chỉnh vượt miền tính toán.")
        registration.affine = affine
        registration.source_center = center
        registration.source_scale = float(scale)
        registration.target_center = target_center
        registration.coefficients = coefficients
        diagnostics["status"] = "valid"
        return registration
    except (CRSError, ProjError, ValueError, TypeError, np.linalg.LinAlgError):
        return reject("Không thể tính phép hiệu chỉnh; kiểm tra hệ tọa độ và các cặp điểm.")
