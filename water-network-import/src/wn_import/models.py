from __future__ import annotations

from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    FiniteFloat,
    field_validator,
    model_validator,
)

PIPE_MATERIALS = {
    "hdpe": "HDPE",
    "pvc": "PVC",
    "ductileiron": "DuctileIron",
    "steel": "Steel",
    "castiron": "CastIron",
    "concrete": "Concrete",
}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class LayerRule(StrictModel):
    fileId: str = Field(min_length=1, max_length=100)
    layer: str = Field(min_length=1, max_length=512)
    action: Literal["pipe", "reference", "exclude", "review"]
    diameterMm: int | None = Field(default=None, gt=0, le=5000)
    material: str | None = Field(default=None, max_length=80)

    @field_validator("material")
    @classmethod
    def supported_material(cls, value):
        if value is None or not value.strip():
            return None
        canonical = PIPE_MATERIALS.get(value.strip().casefold())
        if canonical is None:
            raise ValueError(
                "Vật liệu ống phải là HDPE, PVC, DuctileIron, Steel, CastIron hoặc Concrete."
            )
        return canonical


NodeType = Literal["Junction", "Reservoir", "Tank", "Hydrant", "Other"]
DeviceType = Literal["Valve", "FlowMeter", "PressureSensor", "Pump", "Hydrant"]


class BlockRule(StrictModel):
    fileId: str = Field(min_length=1, max_length=100)
    blockName: str = Field(min_length=1, max_length=512)
    action: Literal["node", "device", "reference", "exclude", "review"]
    nodeType: NodeType | None = None
    deviceType: DeviceType | None = None

    @model_validator(mode="after")
    def required_type(self):
        if self.action == "node" and self.nodeType is None:
            raise ValueError("Quy tắc block dạng node cần nodeType.")
        if self.action == "device" and self.deviceType is None:
            raise ValueError("Quy tắc block dạng device cần deviceType.")
        if self.action != "node" and self.nodeType is not None:
            raise ValueError("nodeType chỉ áp dụng cho block dạng node.")
        if self.action != "device" and self.deviceType is not None:
            raise ValueError("deviceType chỉ áp dụng cho block dạng device.")
        return self


class DeviceHost(StrictModel):
    featureId: str = Field(min_length=1, max_length=100)
    hostFeatureId: str = Field(min_length=1, max_length=100)


class ControlPoint(StrictModel):
    # Partial pairs are valid review drafts, never valid transformation inputs.
    source: tuple[FiniteFloat, FiniteFloat] | None = None
    target: tuple[FiniteFloat, FiniteFloat] | None = None
    checkOnly: bool = False


class FileCrs(StrictModel):
    fileId: str
    sourceCrs: str = Field(min_length=1, max_length=2000)


class LineEdit(LayerRule):
    """An explicit pipe candidate in original CAD coordinates; never modifies source bytes."""
    id: str = Field(min_length=1, max_length=100)
    sourceFeatureId: str | None = Field(default=None, max_length=100)
    action: Literal["pipe"] = "pipe"
    coordinates: list[tuple[FiniteFloat, FiniteFloat]] = Field(min_length=2, max_length=10000)


class ReviewConfig(StrictModel):
    expectedVersion: int = Field(ge=1)
    excludedFileIds: list[str] = Field(default_factory=list, max_length=10)
    lineEdits: list[LineEdit] = Field(default_factory=list, max_length=5000)
    sourceCrs: str | None = Field(default=None, max_length=2000)
    # Direct-source interpretation only; raw CAD and control-point inputs stay unchanged.
    sourceAxisOrder: Literal["xy", "yx"] = "xy"
    sourceUnits: Literal["m", "mm"] = "m"
    # Selection provenance, never a substitute for the explicit sourceCrs/evidence.
    sourceCrsPresetId: str | None = Field(default=None, max_length=120)
    fileCrs: list[FileCrs] = Field(default_factory=list, max_length=10)
    crsEvidence: str = Field(default="", max_length=4000)
    lifecycleEvidence: str = Field(default="", max_length=4000)
    layerRules: list[LayerRule] = Field(default_factory=list, max_length=5000)
    blockRules: list[BlockRule] = Field(default_factory=list, max_length=5000)
    deviceHosts: list[DeviceHost] = Field(default_factory=list, max_length=100000)
    hostToleranceM: FiniteFloat = Field(default=0.5, gt=0, le=2)
    excludeFeatureIds: list[str] = Field(default_factory=list, max_length=100000)
    acceptWarningCodes: list[str] = Field(default_factory=list, max_length=1000)
    snapToleranceM: FiniteFloat = Field(default=0, ge=0, le=2)
    simplifyToleranceM: FiniteFloat = Field(default=0, ge=0, le=0.5)
    minLengthM: FiniteFloat = Field(default=0, ge=0, le=10)
    # Affine target is in sourceCrs; evidence and independent check points are required.
    controlPoints: list[ControlPoint] = Field(default_factory=list, max_length=100)
    # Explicit GIS-click mode: raw CAD has no asserted CRS; target pairs are lon/lat.
    # None retains the original projected sourceCrs target-coordinate contract.
    controlPointTargetCrs: Literal["EPSG:4326"] | None = None
    controlPointMaxErrorM: FiniteFloat = Field(default=0.2, gt=0, le=10)
    # Only endpoints at confirmed tees are joined; generic crossings never auto-connect.
    connectEndpointFeatureIds: list[str] = Field(
        default_factory=list, max_length=100000
    )

    @model_validator(mode="after")
    def direct_source_options_only(self):
        if (self.controlPoints or self.controlPointTargetCrs) and (
            self.sourceAxisOrder != "xy" or self.sourceUnits != "m"
        ):
            raise ValueError(
                "Thứ tự trục và đơn vị nguồn chỉ áp dụng khi chuyển trực tiếp hệ tọa độ; "
                "ghép điểm CAD–GIS cần sourceAxisOrder=xy và sourceUnits=m."
            )
        return self

    @field_validator("lineEdits")
    @classmethod
    def unique_line_edits(cls, values):
        if len({v.id for v in values}) != len(values):
            raise ValueError("Mỗi tuyến chỉ có một bản chỉnh sửa.")
        if sum(len(v.coordinates) for v in values) > 100000:
            raise ValueError("Tổng số đỉnh chỉnh sửa vượt 100.000.")
        return values

    @field_validator("layerRules")
    @classmethod
    def unique_layers(cls, values):
        keys = [(v.fileId, v.layer) for v in values]
        if len(keys) != len(set(keys)):
            raise ValueError("Mỗi layer của một tệp chỉ có một quy tắc.")
        return values

    @field_validator("blockRules")
    @classmethod
    def unique_blocks(cls, values):
        keys = [(v.fileId, v.blockName) for v in values]
        if len(keys) != len(set(keys)):
            raise ValueError("Mỗi block của một tệp chỉ có một quy tắc.")
        return values

    @field_validator("deviceHosts")
    @classmethod
    def unique_device_hosts(cls, values):
        keys = [v.featureId for v in values]
        if len(keys) != len(set(keys)):
            raise ValueError("Mỗi device chỉ có một host được chọn.")
        return values


class SubmitRequest(StrictModel):
    expectedVersion: int = Field(ge=1)
    projectName: str | None = Field(default=None, min_length=1, max_length=160)


class PublishRequest(StrictModel):
    expectedVersion: int = Field(ge=1)
    reason: str | None = Field(default=None, max_length=4000)
    lifecycleEvidence: str | None = Field(default=None, max_length=4000)


def issue(code: str, severity: str, message: str, feature_id: str | None = None):
    result = {"code": code, "severity": severity, "message": message}
    if feature_id:
        result["featureId"] = feature_id
    return result
