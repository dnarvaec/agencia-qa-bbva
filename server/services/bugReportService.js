'use strict';

const fs   = require('fs');
const path = require('path');

const HU_ID_PATTERN = /\bHU[-\s#]?(\d{4,6})\b/i;

/**
 * Recorre suites de Playwright buscando el primer ID de HU en los títulos.
 * Si no lo encuentra, usa fallback: carpeta única en archivos/Casos de Prueba/.
 */
function resolveHuId(suites, workspaceRoot) {
  let huId = null;

  const walk = (items) => {
    for (const s of items || []) {
      if (huId) return;
      const m = HU_ID_PATTERN.exec(s.title || '');
      if (m) { huId = m[1]; return; }
      for (const sp of s.specs || []) {
        const sm = HU_ID_PATTERN.exec(sp.title || '');
        if (sm) { huId = sm[1]; return; }
      }
      walk(s.suites);
    }
  };
  walk(suites);

  if (!huId) {
    const casosDir = path.join(workspaceRoot, 'archivos', 'Casos de Prueba');
    if (fs.existsSync(casosDir)) {
      const dirs = fs.readdirSync(casosDir).filter(d => /^\d+$/.test(d));
      if (dirs.length === 1) huId = dirs[0];
    }
  }

  return huId;
}

/** Extrae el título de la HU desde el archivo de casos de prueba. */
function getHuTitle(huId, workspaceRoot) {
  const dir = path.join(workspaceRoot, 'archivos', 'Casos de Prueba', huId);
  if (!fs.existsSync(dir)) return `HU ${huId}`;
  const file = fs.readdirSync(dir).find(f => f.endsWith('-test-cases.json'));
  if (!file) return `HU ${huId}`;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    return data.story_title || `HU ${huId}`;
  } catch (_) { return `HU ${huId}`; }
}

/** Recopila specs fallidos con su mensaje de error principal. */
function collectFailedSpecs(suites) {
  const failed = [];
  const walk = (items) => {
    for (const s of items || []) {
      for (const sp of s.specs || []) {
        if (!sp.ok) {
          const firstError = sp.tests
            ?.flatMap(t => t.results || [])
            .flatMap(r => r.errors || [])
            .map(e => (e.message || '').replace(/\u001b\[[0-9;]*m/g, '').trim()) // strip ANSI
            .find(Boolean) || 'Test falló — ver reporte HTML de Playwright para detalles.';
          failed.push({ title: sp.title, suite: s.title || '', error: firstError });
        }
      }
      walk(s.suites);
    }
  };
  walk(suites);
  return failed;
}

/**
 * Genera archivos de seguimiento de bugs para todas las suites de Playwright
 * que tengan fallos, si el reporte aún no existe o está desactualizado.
 * Se invoca automáticamente desde el servidor al finalizar una ejecución del agente.
 *
 * @param {string} workspaceRoot - ruta raíz del workspace
 * @returns {string[]} rutas relativas de los archivos generados
 */
function generateBugReports(workspaceRoot) {
  const resultsSources = [
    { file: path.join(workspaceRoot, 'automatizacion api', 'reports', 'results.json'), type: 'API' },
    { file: path.join(workspaceRoot, 'automatizacion web', 'reports', 'results.json'), type: 'Web' },
  ];

  const generated = [];

  for (const { file, type } of resultsSources) {
    if (!fs.existsSync(file)) continue;

    let results;
    try { results = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { continue; }

    const stats    = results.stats || {};
    const failed   = stats.unexpected || 0;
    if (failed === 0) continue; // Sin fallos, no hay nada que reportar

    const huId = resolveHuId(results.suites, workspaceRoot);
    if (!huId) {
      console.warn('[BugReport] No se pudo determinar el HU ID — omitiendo generación.');
      continue;
    }

    const seguimientoDir = path.join(workspaceRoot, 'archivos', 'Seguimiento', huId);
    const jsonPath = path.join(seguimientoDir, `${huId}-qa-results.json`);
    const mdPath   = path.join(seguimientoDir, `${huId}-qa-results.md`);

    // Saltar si el reporte ya es más reciente que la última ejecución de tests
    const runTime = results.stats?.startTime ? new Date(results.stats.startTime) : null;
    if (runTime && fs.existsSync(jsonPath) && fs.statSync(jsonPath).mtime > runTime) {
      console.log(`[BugReport] HU ${huId} — reporte vigente, sin cambios.`);
      continue;
    }

    const failedSpecs = collectFailedSpecs(results.suites);
    if (failedSpecs.length === 0) continue;

    const huTitle    = getHuTitle(huId, workspaceRoot);
    const runDate    = runTime ? runTime.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const totalTests = (stats.expected || 0) + failed + (stats.skipped || 0);

    // ── JSON ──────────────────────────────────────────────────────────────────
    const qaJson = {
      story_id:       huId,
      story_title:    huTitle,
      generated_at:   new Date().toISOString(),
      execution_date: runDate,
      environment:    'QAS',
      type,
      total_tests:    totalTests,
      passed:         stats.expected  || 0,
      failed,
      skipped:        stats.skipped   || 0,
      results: failedSpecs.map((sp, i) => ({
        id:         `BUG-${huId}-${String(i + 1).padStart(3, '0')}`,
        title:      sp.title,
        test_case:  sp.title.match(/^(TC-[\w\d]+)/)?.[1] || `TC-${String(i + 1).padStart(3, '0')}`,
        status:     'FAIL',
        error_type: 'system_bug',
        priority:   'Alta',
        subtype:    type,
        suite:      sp.suite,
        error:      sp.error.substring(0, 800),
      })),
    };

    // ── Markdown ──────────────────────────────────────────────────────────────
    const lines = [
      `# Reporte de Bugs — HU ${huId}`,
      `## ${huTitle}`,
      ``,
      `| Campo | Valor |`,
      `|---|---|`,
      `| **HU** | ${huId} |`,
      `| **Fecha ejecución** | ${runDate} |`,
      `| **Entorno** | QAS |`,
      `| **Tipo** | ${type} |`,
      `| **Total tests** | ${totalTests} |`,
      `| **Pasados** | ${stats.expected || 0} |`,
      `| **Fallidos** | ${failed} |`,
      `| **Saltados** | ${stats.skipped || 0} |`,
      ``,
      `---`,
      ``,
    ];

    qaJson.results.forEach(bug => {
      lines.push(`## ${bug.id} — ${bug.title}`, ``);
      lines.push(`| Campo | Valor |`, `|---|---|`);
      lines.push(`| **ID** | ${bug.id} |`);
      lines.push(`| **Test Case** | ${bug.test_case} |`);
      lines.push(`| **Suite** | ${bug.suite} |`);
      lines.push(`| **Prioridad** | ${bug.priority} |`);
      lines.push(`| **Tipo** | ${bug.error_type} |`, ``);
      lines.push(`**Error:**`, `\`\`\``, bug.error, `\`\`\``, ``, `---`, ``);
    });

    lines.push(`*Generado automáticamente por el servidor al finalizar la ejecución — ${new Date().toLocaleString('es-CO')}.*`);

    // ── Escribir archivos ─────────────────────────────────────────────────────
    fs.mkdirSync(seguimientoDir, { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(qaJson, null, 2), 'utf8');
    fs.writeFileSync(mdPath,   lines.join('\n') + '\n', 'utf8');

    const relJson = path.relative(workspaceRoot, jsonPath).replace(/\\/g, '/');
    const relMd   = path.relative(workspaceRoot, mdPath).replace(/\\/g, '/');
    generated.push(relJson, relMd);
    console.log(`[BugReport] Generado: ${relJson}`);
  }

  return generated;
}

module.exports = { generateBugReports };
