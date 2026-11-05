// Builds the single-file catalog viewer at demo/dist/component-models.html (not part of the package).
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const res = await build({ entryPoints: ['demo/main.ts'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, logLevel: 'warning' });
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
mkdirSync('demo/dist', { recursive: true });
writeFileSync('demo/dist/component-models.html', readFileSync('demo/page.html', 'utf8').split('/*BUNDLE*/').join(js));
console.log('demo/dist/component-models.html');
