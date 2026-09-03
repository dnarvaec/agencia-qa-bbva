#!/usr/bin/env node
'use strict';

/**
 * Servidor MCP unificado: Jira Data Center (issues, links, discovery de campos)
 * + QMetry QTM4J (test cases). Sustituye a jira_uploader.py y al enfoque basado
 * en mcp-atlassian: un único MCP propio, en Node, reutilizando la misma
 * autenticación (JIRA_URL / JIRA_USERNAME / JIRA_API_TOKEN) para ambas APIs.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const jira = require('./jiraClient');
const qmetry = require('./qmetryClient');

const WORKSPACE_ROOT = path.resolve(__dirname, '../../');

function asText(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({ name: 'jira-qmetry', version: '1.0.0' });

server.registerTool(
  'jira_search_issues',
  {
    title: 'Buscar issues en Jira (JQL)',
    description:
      'Busca issues en Jira Data Center usando JQL. Útil para localizar HUs (Story), Test, Test Plan o Test Execution existentes.',
    inputSchema: {
      jql: z.string().describe('Consulta JQL, ej. \'project = CORREOF AND issuetype = Story AND text ~ "login"\''),
      maxResults: z.number().int().positive().max(200).optional(),
      fields: z.array(z.string()).optional().describe('Campos a devolver, ej. ["summary","description","status"]'),
    },
  },
  async ({ jql, maxResults, fields }) => asText(await jira.searchIssues({ jql, maxResults, fields }))
);

server.registerTool(
  'jira_get_issue',
  {
    title: 'Obtener un issue de Jira por key',
    description: 'Devuelve los campos completos de un issue de Jira (ej. una HU tipo Story) dado su key (ej. CORREOF-123).',
    inputSchema: {
      issueKey: z.string(),
      fields: z.array(z.string()).optional(),
    },
  },
  async ({ issueKey, fields }) => asText(await jira.getIssue(issueKey, fields))
);

server.registerTool(
  'jira_create_issue',
  {
    title: 'Crear un issue en Jira',
    description:
      'Crea un issue nativo de Jira (Story, Test, Test Plan, Test Execution, etc.). Usa additionalFields para campos custom (ej. pasos de un Test) — descúbrelos antes con jira_get_create_fields.',
    inputSchema: {
      projectKey: z.string(),
      issueType: z.string().describe('Nombre exacto del tipo de issue, ej. "Story", "Test", "Test Plan", "Test Execution"'),
      summary: z.string(),
      description: z.string().optional(),
      additionalFields: z.record(z.any()).optional().describe('Campos custom, ej. { "customfield_10050": [...] }'),
    },
  },
  async ({ projectKey, issueType, summary, description, additionalFields }) =>
    asText(await jira.createIssue({ projectKey, issueType, summary, description, additionalFields }))
);

server.registerTool(
  'jira_update_issue',
  {
    title: 'Actualizar campos de un issue de Jira',
    description: 'Actualiza campos arbitrarios de un issue existente (ej. description, campos custom).',
    inputSchema: {
      issueKey: z.string(),
      fields: z.record(z.any()),
    },
  },
  async ({ issueKey, fields }) => asText(await jira.updateIssue(issueKey, fields))
);

server.registerTool(
  'jira_get_create_fields',
  {
    title: 'Descubrir campos disponibles para crear un issue',
    description:
      'Devuelve el esquema de campos (incluye custom fields) disponibles al crear un issue de un tipo dado en un proyecto. Si se omite issueType, devuelve TODOS los tipos de issue creables en el proyecto (útil para descubrir qué tipos existen realmente, ej. si "Test"/"Test Plan"/"Test Execution" no existen).',
    inputSchema: {
      projectKey: z.string(),
      issueType: z.string().optional().describe('Si se omite, lista todos los tipos de issue disponibles en el proyecto'),
    },
  },
  async ({ projectKey, issueType }) => asText(await jira.getCreateMeta({ projectKey, issueType }))
);

server.registerTool(
  'jira_search_fields',
  {
    title: 'Buscar campos (custom fields) por nombre',
    description: 'Lista todos los campos de Jira, opcionalmente filtrados por nombre/id (ej. "steps", "acceptance").',
    inputSchema: {
      query: z.string().optional(),
    },
  },
  async ({ query }) => asText(await jira.searchFields(query))
);

server.registerTool(
  'jira_get_link_types',
  {
    title: 'Listar tipos de vínculo entre issues',
    description: 'Devuelve los tipos de link disponibles (ej. "Tests" / "is tested by") para vincular un Test a su HU.',
    inputSchema: {},
  },
  async () => asText(await jira.getLinkTypes())
);

server.registerTool(
  'jira_create_issue_link',
  {
    title: 'Vincular dos issues de Jira',
    description:
      'Crea un vínculo entre dos issues (ej. vincular un Test a su HU mediante "Tested by"). Usa jira_get_link_types antes para conocer el nombre exacto del tipo y el sentido inward/outward.',
    inputSchema: {
      type: z.string().describe('Nombre del link type, ej. "Tests"'),
      inwardIssueKey: z.string(),
      outwardIssueKey: z.string(),
      comment: z.string().optional(),
    },
  },
  async ({ type, inwardIssueKey, outwardIssueKey, comment }) =>
    asText(await jira.createIssueLink({ type, inwardIssueKey, outwardIssueKey, comment }))
);

server.registerTool(
  'jira_add_comment',
  {
    title: 'Agregar un comentario a un issue de Jira',
    description:
      'Publica un comentario (formato wiki markup de Jira Server/DC, ej. "h3. Título", "* viñeta") en un issue existente. Úsalo, por ejemplo, para publicar una HU mejorada como comentario en el issue original.',
    inputSchema: {
      issueKey: z.string(),
      body: z.string().describe('Texto del comentario en wiki markup de Jira (no Markdown ni ADF)'),
    },
  },
  async ({ issueKey, body }) => asText(await jira.addComment(issueKey, body))
);

server.registerTool(
  'qmetry_create_test_case',
  {
    title: 'Crear un Test Case en QMetry (QTM4J)',
    description:
      'Crea un único Test Case de QMetry a partir de un objeto con el formato de {CP_ID}-test-cases.json (title, description, preconditions, steps).',
    inputSchema: {
      testCase: z.record(z.any()),
      projectId: z.number().optional(),
      folderId: z.number().optional(),
      priority: z.number().optional(),
      status: z.number().optional(),
    },
  },
  async ({ testCase, projectId, folderId, priority, status }) =>
    asText(await qmetry.createTestCase(testCase, { projectId, folderId, priority, status }))
);

server.registerTool(
  'qmetry_bulk_upload_test_cases',
  {
    title: 'Subir en bloque los casos de prueba a QMetry',
    description:
      'Lee un archivo {CP_ID}-test-cases.json (o un array de test_cases) y crea todos los Test Cases en QMetry. Reemplaza la invocación por CLI de jira_uploader.py.',
    inputSchema: {
      filePath: z.string().optional().describe("Ruta relativa al workspace, ej. 'archivos/Casos de Prueba/1037/1037-test-cases.json'"),
      testCases: z.array(z.record(z.any())).optional(),
      startIndex: z.number().int().positive().optional(),
      projectId: z.number().optional(),
      folderId: z.number().optional(),
      priority: z.number().optional(),
      status: z.number().optional(),
    },
  },
  async ({ filePath, testCases, startIndex, projectId, folderId, priority, status }) =>
    asText(
      await qmetry.bulkUpload({
        filePath,
        testCases,
        startIndex,
        workspaceRoot: WORKSPACE_ROOT,
        projectId,
        folderId,
        priority,
        status,
      })
    )
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[jira-mcp] Error fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
