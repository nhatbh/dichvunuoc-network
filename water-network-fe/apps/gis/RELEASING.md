# Releasing the `frontend-sample` template

This repo is intended to be **tagged** when you cut a template release so downstream UI services can pin or diff upgrades.

1. Move items from **Unreleased** in [`CHANGELOG-template.md`](CHANGELOG-template.md) into a dated section (for example `## template/v1.1.0 — 2026-05-12`).
2. Commit the changelog (and any code) on `main`.
3. Create an annotated tag, for example:  
   `git tag -a template/v1.1.0 -m "Template v1.1.0"`
4. Push the tag:  
   `git push origin template/v1.1.0`

Downstream forks should merge `main` or a specific tag and follow the changelog’s **Migrate** notes.
