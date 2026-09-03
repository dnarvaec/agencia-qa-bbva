'use strict';

/**
 * Cliente HTTP genérico para la API REST v2 de Jira Data Center (NO Jira Cloud — por eso
 * se usa /rest/api/2/, no /rest/api/3/). Autenticación Basic con usuario + Personal Access
 * Token (el mismo token, generado igual, que usa jira_uploader.py para QMetry).
 */

function baseUrl() {
  const url = process.env.JIRA_URL;
  if (!url) throw new Error('Falta JIRA_URL en el .env');
  return url.replace(/\/$/, '');
}

function authHeader() {
  const user = process.env.JIRA_USERNAME;
  const token = process.env.JIRA_API_TOKEN;
  if (!user || !token) throw new Error('Faltan JIRA_USERNAME / JIRA_API_TOKEN en el .env');
  return 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64');
}

async function jiraRequest(method, resourcePath, { query, body } = {}) {
  const url = new URL(`${baseUrl()}${resourcePath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!res.ok) {
    const detail = typeof data === 'string' ? data.slice(0, 500) : JSON.stringify(data).slice(0, 500);
    throw new Error(`Jira API ${method} ${resourcePath} -> HTTP ${res.status}: ${detail}`);
  }
  return data;
}

async function searchIssues({ jql, maxResults, fields }) {
  return jiraRequest('POST', '/rest/api/2/search', {
    body: {
      jql,
      maxResults: maxResults || 50,
      fields: fields && fields.length ? fields : undefined,
    },
  });
}

async function getIssue(issueKey, fields) {
  return jiraRequest('GET', `/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
    query: fields ? { fields: Array.isArray(fields) ? fields.join(',') : fields } : undefined,
  });
}

async function createIssue({ projectKey, issueType, summary, description, additionalFields }) {
  const fields = {
    project: { key: projectKey },
    issuetype: { name: issueType },
    summary,
    ...(description !== undefined ? { description } : {}),
    ...(additionalFields || {}),
  };
  return jiraRequest('POST', '/rest/api/2/issue', { body: { fields } });
}

async function updateIssue(issueKey, fields) {
  await jiraRequest('PUT', `/rest/api/2/issue/${encodeURIComponent(issueKey)}`, { body: { fields } });
  return { updated: true, issueKey };
}

// El endpoint clásico GET /rest/api/2/issue/createmeta?expand=projects.issuetypes.fields
// está deprecado en esta instancia de Jira DC y responde 404 "Issue Does Not Exist"
// (interpreta "createmeta" como un issue key). Se usa el endpoint granular vigente:
//   GET /rest/api/2/issue/createmeta/{projectIdOrKey}/issuetypes
//   GET /rest/api/2/issue/createmeta/{projectIdOrKey}/issuetypes/{issueTypeId}
async function getCreateMeta({ projectKey, issueType }) {
  const issueTypesPath = `/rest/api/2/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`;
  const list = await jiraRequest('GET', issueTypesPath);

  if (!issueType) return list;

  const match = (list.values || []).find(
    (t) => t.name.toLowerCase() === issueType.toLowerCase()
  );
  if (!match) {
    return { errorMessages: [`Issue type "${issueType}" no existe en el proyecto ${projectKey}`], availableTypes: (list.values || []).map((t) => t.name) };
  }

  return jiraRequest('GET', `${issueTypesPath}/${match.id}`);
}

async function getLinkTypes() {
  return jiraRequest('GET', '/rest/api/2/issueLinkType');
}

async function createIssueLink({ type, inwardIssueKey, outwardIssueKey, comment }) {
  await jiraRequest('POST', '/rest/api/2/issueLink', {
    body: {
      type: { name: type },
      inwardIssue: { key: inwardIssueKey },
      outwardIssue: { key: outwardIssueKey },
      ...(comment ? { comment: { body: comment } } : {}),
    },
  });
  return { linked: true, type, inwardIssueKey, outwardIssueKey };
}

async function searchFields(query) {
  const all = await jiraRequest('GET', '/rest/api/2/field');
  const q = (query || '').toLowerCase().trim();
  if (!q) return all;
  return all.filter((f) => f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q));
}

async function addComment(issueKey, body) {
  return jiraRequest('POST', `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`, {
    body: { body },
  });
}

module.exports = {
  jiraRequest,
  searchIssues,
  getIssue,
  createIssue,
  updateIssue,
  getCreateMeta,
  getLinkTypes,
  createIssueLink,
  searchFields,
  addComment,
};
