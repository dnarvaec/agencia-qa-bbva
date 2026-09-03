'use strict';

/**
 * Integración con QMetry Test Management for Jira (QTM4J), vía la API interna
 * `/rest/qtm4j/ui/latest/testcases` de la misma instancia Jira Data Center.
 * Reemplaza a jira_uploader.py: misma lógica de mapeo, expuesta como tools MCP.
 */

const fs = require('fs');
const path = require('path');
const { jiraRequest } = require('./jiraClient');

const FOLDER_ID_DEFAULT = -1; // Sin carpeta, raíz del proyecto QMetry
const PRIORITY_ID_DEFAULT = 1906; // "High"
const STATUS_ID_DEFAULT = 4290; // "To Do"

function formatPreconditions(preconditions) {
  if (Array.isArray(preconditions)) return preconditions.map((p) => `• ${p}`).join('\n');
  return preconditions ? String(preconditions) : '';
}

function formatDescription(tc) {
  const parts = [];
  if (tc.description) parts.push(tc.description);
  if (tc.objective) parts.push(`\nObjetivo: ${tc.objective}`);
  if (tc.automation_notes) parts.push(`\nNotas de Automatización: ${tc.automation_notes}`);
  return parts.join('\n');
}

function buildPayload(tc, projectId, overrides = {}) {
  const steps = [...(tc.steps || [])]
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((step) => ({
      stepDetails: step.action || '',
      testData: step.data || '',
      expectedResult: step.expected_result || '',
      isChecked: false,
      isExpanded: true,
    }));

  return {
    summary: tc.title || '',
    description: formatDescription(tc),
    precondition: formatPreconditions(tc.preconditions),
    folderId: overrides.folderId ?? FOLDER_ID_DEFAULT,
    projectId,
    priority: overrides.priority ?? PRIORITY_ID_DEFAULT,
    status: overrides.status ?? STATUS_ID_DEFAULT,
    steps,
  };
}

async function createTestCase(tc, { projectId, folderId, priority, status } = {}) {
  const pid = projectId || Number(process.env.QMETRY_PROJECT_ID);
  if (!pid) throw new Error('Falta QMETRY_PROJECT_ID en el .env (o el parámetro projectId)');
  const payload = buildPayload(tc, pid, { folderId, priority, status });
  const created = await jiraRequest('POST', '/rest/qtm4j/ui/latest/testcases', { body: payload });
  return { id: tc.id, title: tc.title, key: created.key };
}

async function bulkUpload({ filePath, testCases, startIndex = 1, workspaceRoot, ...overrides }) {
  let cases = testCases;
  if (!cases) {
    if (!filePath) throw new Error('Debes indicar filePath o testCases');
    const abs = path.resolve(workspaceRoot, filePath);
    if (abs !== workspaceRoot && !abs.startsWith(workspaceRoot + path.sep)) {
      throw new Error('Ruta fuera del workspace no permitida');
    }
    const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    cases = data.test_cases || [];
  }
  if (!cases.length) throw new Error("El JSON no contiene ningún caso de prueba en 'test_cases'");

  const creados = {};
  const fallidos = [];
  for (let idx = startIndex; idx <= cases.length; idx++) {
    const tc = cases[idx - 1];
    const label = `Caso ${idx} (${tc.id || `Caso-${idx}`})`;
    try {
      const { key } = await createTestCase(tc, overrides);
      creados[label] = key;
    } catch (err) {
      fallidos.push({ idx, id: tc.id || `Caso-${idx}`, title: tc.title || 'Sin título', error: err.message });
    }
  }
  return { creados, fallidos };
}

module.exports = { createTestCase, bulkUpload };
