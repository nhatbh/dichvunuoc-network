from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import uuid


def now():
    return datetime.now(timezone.utc).isoformat()


class Conflict(Exception):
    pass


class Missing(Exception):
    pass


class Store:
    """One service-owned SQLite database on a persistent volume; one process/replica.

    Every lookup includes the authenticated tenant. Versions protect review and publish
    against stale tabs; BEGIN IMMEDIATE protects submissions from concurrent requests.
    """

    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY, tenant TEXT NOT NULL, fingerprint TEXT NOT NULL,
              version INTEGER NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL,
              created TEXT NOT NULL, updated TEXT NOT NULL,
              UNIQUE(tenant,fingerprint)
            );
            CREATE INDEX IF NOT EXISTS ix_jobs_tenant_created ON jobs(tenant,created DESC);
            CREATE TABLE IF NOT EXISTS audit (
              sequence INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
              tenant TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
              version INTEGER NOT NULL, at TEXT NOT NULL
            );
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def create(self, tenant, actor, name, files, fingerprint, job_id=None):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT body FROM jobs WHERE tenant=? AND fingerprint=?",
                (tenant, fingerprint),
            ).fetchone()
            if row:
                return json.loads(row["body"]), False
            stamp = now()
            job_id = job_id or str(uuid.uuid4())
            job = {
                "id": job_id,
                "name": name,
                "state": "queued",
                "version": 1,
                "files": files,
                "createdAt": stamp,
                "updatedAt": stamp,
                "createdBy": actor,
            }
            db.execute(
                "INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)",
                (
                    job_id,
                    tenant,
                    fingerprint,
                    1,
                    "queued",
                    json.dumps(job),
                    stamp,
                    stamp,
                ),
            )
            self._audit(db, tenant, actor, job, "upload")
            return job, True

    def list(self, tenant):
        with self.connection() as db:
            return [
                json.loads(r["body"])
                for r in db.execute(
                    "SELECT body FROM jobs WHERE tenant=? ORDER BY created DESC LIMIT 100",
                    (tenant,),
                )
            ]

    def get(self, tenant, job_id):
        with self.connection() as db:
            row = db.execute(
                "SELECT body FROM jobs WHERE tenant=? AND id=?", (tenant, job_id)
            ).fetchone()
            if not row:
                raise Missing()
            return json.loads(row["body"])

    def mutate(self, tenant, actor, job_id, expected, action, fn):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT body FROM jobs WHERE tenant=? AND id=?", (tenant, job_id)
            ).fetchone()
            if not row:
                raise Missing()
            job = json.loads(row["body"])
            if expected is not None and job["version"] != expected:
                raise Conflict("Lô nhập đã thay đổi; tải lại trước khi thao tác.")
            fn(job)
            job["version"] += 1
            job["updatedAt"] = now()
            db.execute(
                "UPDATE jobs SET body=?,version=?,state=?,updated=? WHERE tenant=? AND id=?",
                (
                    json.dumps(job),
                    job["version"],
                    job["state"],
                    job["updatedAt"],
                    tenant,
                    job_id,
                ),
            )
            self._audit(db, tenant, actor, job, action)
            return job

    def work(self):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT tenant,body FROM jobs WHERE state='queued' ORDER BY created LIMIT 1"
            ).fetchone()
            if not row:
                return None
            job = json.loads(row["body"])
            job["state"] = "analyzing"
            job["updatedAt"] = now()
            db.execute(
                "UPDATE jobs SET body=?,state='analyzing',updated=? WHERE id=?",
                (json.dumps(job), job["updatedAt"], job["id"]),
            )
            return row["tenant"], job

    def recover(self):
        # Called once by the single worker at startup. Review jobs are deterministic.
        with self.connection() as db:
            for row in db.execute(
                "SELECT body FROM jobs WHERE state IN ('analyzing','submitting')"
            ).fetchall():
                job = json.loads(row["body"])
                if job["state"] == "analyzing":
                    job["state"] = "queued"
                else:
                    job["state"] = (
                        "ready"
                        if not job.get("submission", {}).get("revisionId")
                        else "submitted"
                    )
                    job["error"] = (
                        "Yêu cầu trước bị gián đoạn; thử lại để đối soát theo khóa import."
                    )
                db.execute(
                    "UPDATE jobs SET state=?,body=? WHERE id=?",
                    (job["state"], json.dumps(job), job["id"]),
                )

    def audit(self, tenant, job_id):
        self.get(tenant, job_id)
        with self.connection() as db:
            return [
                dict(r)
                for r in db.execute(
                    "SELECT actor,action,version,at FROM audit WHERE tenant=? AND job_id=? ORDER BY sequence",
                    (tenant, job_id),
                )
            ]

    def _audit(self, db, tenant, actor, job, action):
        db.execute(
            "INSERT INTO audit(job_id,tenant,actor,action,version,at) VALUES(?,?,?,?,?,?)",
            (job["id"], tenant, actor, action, job["version"], now()),
        )
