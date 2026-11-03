# Claude Design source refs (project 85eed8ac "water platform")
Staged by main session (subagents lack DesignSync). Port these → SolidJS faithfully.
Files: ui, icons-gis, menu-icons, app(shell), dashboard, map, mapcanvas(SVG), tools(ServiceLinks/CommandPalette/QueryPanel),
assets, topology, trace, netmodel, connections, import, quality, field, scenarios, versions + gis-data.js (dataset/window.GIS shape).

## Biên tập mạng lưới (editor) — ported 2026-07-01
Entry "Biên tập mạng lưới.html". Source files (fetch via DesignSync, project 85eed8ac):
  gis/editor.jsx (canvas + geometry + ED_TOOLS/KIND_META/EAM_REG + genImportFeatures)
  gis/editor-cad.jsx (ED_TEMPLATES/ED_RULE_DEFS/edRules, ribbon, palette, command line, status bar, branch gate, COGO)
  gis/editor-screen.jsx (PropBody/BatchBody/ChangeSetPane/EamModal + EditorScreen/EditorWorkspace)
  gis/editor-app.jsx (standalone shell — NOT ported; integrated as the `editor` route inside the GIS shell instead)
SolidJS port lives in src/pages/gis/editor/{model.ts,canvas.tsx,chrome.tsx,panels.tsx} + screens/editor.tsx.
Not staged as raw .jsx here (re-fetchable via DesignSync).
