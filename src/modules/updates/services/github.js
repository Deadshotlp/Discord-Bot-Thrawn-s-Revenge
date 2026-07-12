const GITHUB_API_BASE = "https://api.github.com";

export function parseRepoSlug(raw) {
  const text = String(raw || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
  const match = text.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!match) {
    return null;
  }

  return { owner: match[1], repo: match[2] };
}

function buildHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "thrawns-revenge-discord-bot"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export async function fetchRepoInfo(owner, repo, token) {
  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
    headers: buildHeaders(token)
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub API Fehler (${response.status})`);
  }

  return response.json();
}

async function fetchLatestRelease(owner, repo, token) {
  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`, {
    headers: buildHeaders(token)
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub API Fehler (${response.status})`);
  }

  return response.json();
}

async function fetchLatestCommit(owner, repo, token) {
  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?per_page=1`, {
    headers: buildHeaders(token)
  });

  if (!response.ok) {
    throw new Error(`GitHub API Fehler (${response.status})`);
  }

  const commits = await response.json();
  return commits?.[0] || null;
}

export async function fetchLatestUpdate(owner, repo, token) {
  const release = await fetchLatestRelease(owner, repo, token);
  if (release) {
    return {
      type: "release",
      id: String(release.id),
      title: release.name || release.tag_name,
      version: release.tag_name || "",
      url: release.html_url,
      body: release.body || "",
      author: release.author?.login || "",
      publishedAt: release.published_at || release.created_at || null
    };
  }

  const commit = await fetchLatestCommit(owner, repo, token);
  if (!commit) {
    return null;
  }

  return {
    type: "commit",
    id: commit.sha,
    title: (commit.commit?.message || "").split("\n")[0] || commit.sha.slice(0, 7),
    version: commit.sha.slice(0, 7),
    url: commit.html_url,
    body: commit.commit?.message || "",
    author: commit.commit?.author?.name || commit.author?.login || "",
    publishedAt: commit.commit?.author?.date || null
  };
}
