const API = process.env.GITHUB_API_URL || 'https://api.github.com';

export const repo = process.env.GITHUB_REPOSITORY || '';

export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function ensureLabel(name, color, description) {
  try {
    await api(`/repos/${repo}/labels`, { method: 'POST', body: { name, color, description } });
  } catch (error) {
    if (!String(error.message).includes('422')) throw error;
  }
}
