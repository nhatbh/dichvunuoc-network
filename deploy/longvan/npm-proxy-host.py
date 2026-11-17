# Creates or updates the nginx-proxy-manager proxy host of SYSTEM 3D (decision 0033).
# Run on the server by deploy/longvan/deploy.ps1 through `python3 -`, with ARGS (host, request,
# optionally an admin login) defined before this code. Without a login it uses the tokens in
# NPM_TOKENS: signed on the server with nginx-proxy-manager's own key (ssh + docker access is
# already full control of it), one per candidate user id; the first admin among them is used.
# nginx-proxy-manager's API listens on 127.0.0.1:81 of the server. Standard library only.
import json
import os
import urllib.error
import urllib.request

API = "http://127.0.0.1:81/api"
HOST = ARGS["host"]  # noqa: F821 - defined by the caller
WILDCARD = "*." + HOST.split(".", 1)[1] if HOST.count(".") >= 2 else None


def call(method, path, body=None, token=None):
    request = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            text = response.read().decode()
            return json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode()[:300]
        raise SystemExit(f"nginx-proxy-manager {method} {path}: {error.code} {detail}")
    except urllib.error.URLError as error:
        raise SystemExit(f"nginx-proxy-manager API not reachable on 127.0.0.1:81: {error.reason}")


def admin_token():
    for candidate in os.environ.get("NPM_TOKENS", "").split():
        try:
            request = urllib.request.Request(API + "/users/me", headers={"Authorization": "Bearer " + candidate})
            with urllib.request.urlopen(request, timeout=30) as response:
                me = json.loads(response.read().decode())
            if "admin" in (me.get("roles") or []):
                print(f"signed in to nginx-proxy-manager as {me.get('email', 'admin')} (server key)")
                return candidate
        except (urllib.error.URLError, ValueError):
            continue
    if ARGS.get("user"):  # noqa: F821
        return call("POST", "/tokens", {"identity": ARGS["user"], "secret": ARGS["password"]})["token"]  # noqa: F821
    raise SystemExit("auto sign-in unavailable")


token = admin_token()

certificates = call("GET", "/nginx/certificates", token=token) or []
certificate = next((c for c in certificates if HOST in c.get("domain_names", [])), None) or next(
    (c for c in certificates if WILDCARD and WILDCARD in c.get("domain_names", [])), None
)
if certificate is None and ARGS.get("request"):  # noqa: F821
    print(f"requesting a Let's Encrypt certificate for {HOST} ...")
    certificate = call(
        "POST",
        "/nginx/certificates",
        {
            "provider": "letsencrypt",
            "nice_name": HOST,
            "domain_names": [HOST],
            "meta": {"letsencrypt_email": ARGS["user"], "letsencrypt_agree": True, "dns_challenge": False},  # noqa: F821
        },
        token,
    )
if certificate:
    print(f"certificate: #{certificate['id']} {', '.join(certificate.get('domain_names', []))}")
else:
    print(f"no certificate for {HOST} yet: the proxy host is created on http only")

body = {
    "domain_names": [HOST],
    "forward_scheme": "http",
    "forward_host": "water-network-web",
    "forward_port": 8080,
    "access_list_id": 0,
    "certificate_id": certificate["id"] if certificate else 0,
    "ssl_forced": bool(certificate),
    "http2_support": bool(certificate),
    "hsts_enabled": False,
    "hsts_subdomains": False,
    "caching_enabled": False,
    "block_exploits": True,
    "allow_websocket_upgrade": True,
    "advanced_config": "client_max_body_size 100m;\nproxy_read_timeout 120s;",
    "locations": [],
    "meta": {"letsencrypt_agree": False, "dns_challenge": False},
}
hosts = call("GET", "/nginx/proxy-hosts", token=token) or []
existing = next((h for h in hosts if HOST in h.get("domain_names", [])), None)
if existing:
    call("PUT", f"/nginx/proxy-hosts/{existing['id']}", body, token)
    print(f"proxy host updated: #{existing['id']} {HOST} -> water-network-web:8080")
else:
    created = call("POST", "/nginx/proxy-hosts", body, token)
    print(f"proxy host created: #{created['id']} {HOST} -> water-network-web:8080")
