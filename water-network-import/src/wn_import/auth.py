from dataclasses import dataclass
import json
import os
import re
import jwt
from fastapi import HTTPException, Request


@dataclass(frozen=True)
class Principal:
    tenant: str
    actor: str
    token: str
    permissions: frozenset[str]

    def require(self, permission):
        if permission not in self.permissions:
            raise HTTPException(403, "Tài khoản thiếu quyền thực hiện thao tác.")


def tenant_from_claims(claims, allow_flat=False):
    org = claims.get("organization")
    flat = claims.get("tenant_id")
    if org is not None:
        if isinstance(org, str):
            org = json.loads(org)
        if not isinstance(org, dict) or len(org) != 1:
            raise ValueError("organization")
        alias, body = next(iter(org.items()))
        if not re.fullmatch("[a-z0-9_]{1,28}", alias) or not isinstance(body, dict):
            raise ValueError("alias")
        tenant = body.get("tenant_id")
        if isinstance(tenant, list) and len(tenant) == 1:
            tenant = tenant[0]
        scopes = [
            s
            for s in claims.get("scope", "").split()
            if s == "organization" or s.startswith("organization:")
        ]
        if (
            tenant != f"tnt_{alias}"
            or scopes != [f"organization:{alias}"]
            or (flat is not None and flat != tenant)
        ):
            raise ValueError("tenant")
        return tenant
    if (
        allow_flat
        and isinstance(flat, str)
        and re.fullmatch("[A-Za-z0-9_-]{1,32}", flat)
    ):
        return flat
    raise ValueError("A signed selected tenant is required")


class Authentication:
    def __init__(self):
        self.issuer = os.environ.get("IMPORT_JWT_ISSUER", "").rstrip("/")
        self.audience = os.environ.get("IMPORT_JWT_AUDIENCE", "water-platform")
        self.allow_flat = (
            os.environ.get("IMPORT_ALLOW_FLAT_TENANT", "false").lower() == "true"
        )
        self.clients = set(
            os.environ.get("IMPORT_ALLOWED_CLIENTS", "water-network-gis-fe").split(",")
        )
        self.jwks = (
            jwt.PyJWKClient(
                os.environ.get(
                    "IMPORT_JWKS_URL", self.issuer + "/protocol/openid-connect/certs"
                ),
                cache_jwk_set=True,
                lifespan=300,
                timeout=5,
            )
            if self.issuer
            else None
        )

    def __call__(self, request: Request):
        raw = request.headers.get("authorization", "")
        if not raw.startswith("Bearer ") or not self.jwks:
            raise HTTPException(401, "Cần đăng nhập với đơn vị được chọn.")
        token = raw[7:]
        try:
            key = self.jwks.get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                issuer=self.issuer,
                audience=self.audience,
                options={"require": ["exp", "iat", "sub"]},
            )
            if claims.get("azp") not in self.clients:
                raise ValueError("client")
            tenant = tenant_from_claims(claims, self.allow_flat)
            permissions = claims.get("permission", [])
            if isinstance(permissions, str):
                permissions = [permissions]
            if not isinstance(permissions, list) or not all(
                isinstance(v, str) for v in permissions
            ):
                raise ValueError("permission")
            return Principal(tenant, claims["sub"], token, frozenset(permissions))
        except (jwt.PyJWTError, ValueError, TypeError, KeyError):
            raise HTTPException(
                401, "Phiên đăng nhập hoặc ngữ cảnh đơn vị không hợp lệ."
            ) from None
