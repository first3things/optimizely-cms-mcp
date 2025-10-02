/**
 * TypeScript helpers for Optimizely CMS API operations
 * Implements the two-step content creation pattern and proper GraphQL queries
 */

const BASE = "https://api.cms.optimizely.com/preview3";

type HeadersInitish = Record<string, string>;

function authHeaders(token: string, extra: HeadersInitish = {}): HeadersInitish {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function assertOk(r: Response, ctx: string): void {
  if (!r.ok) throw new Error(`${ctx} failed: HTTP ${r.status} ${r.statusText}`);
}

/** GraphQL: resolve parent key by displayName (uses _Content). */
export async function resolveParentKeyByName(token: string, name: string): Promise<string> {
  const query = `
    query ($name: String!) {
      _Content(limit: 5, where: { _metadata: { displayName: { match: $name }}}) {
        items { _metadata { displayName key } }
      }
    }`;
  const r = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ query, variables: { name } }),
  });
  assertOk(r, "GraphQL lookup");
  const data = await r.json() as any;
  const hit = data?.data?._Content?.items?.find((i: any) => i._metadata?.displayName === name);
  if (!hit?.[ "_metadata" ]?.key) throw new Error(`Parent "${name}" not found`);
  return hit._metadata.key as string;
}

/** Step A: create content shell (Content_Create). */
export async function createContentShell(opts: {
  token: string;
  displayName: string;
  contentType: string;     // e.g., "ArticlePage"
  container?: string;      // parent key (GUID) if creating under a container
  baseProps?: Record<string, any>;
}): Promise<any> {
  const { token, displayName, contentType, container, baseProps = {} } = opts;
  const body: any = {
    displayName,
    contentType,           // must be string like "ArticlePage"
  };
  
  // Only add container if provided
  if (container) {
    body.container = container;
  }
  
  // Add base properties if provided (like SeoSettings)
  if (Object.keys(baseProps).length > 0) {
    body.properties = baseProps;
  }
  
  // Step A: Create content shell WITHOUT locale
  const r = await fetch(`${BASE}/experimental/content`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  assertOk(r, "Create content shell");
  return r.json(); // returns ContentItem/metadata including key
}

/** Step B: create localized version (?locale=en) (Content_CreateVersion). */
export async function createLocalizedVersion(opts: {
  token: string;
  key: string;            // content key from Step A
  displayName: string;
  locale?: string;        // default "en"
  status?: "draft" | "ready";
  properties: Record<string, any>;
}): Promise<any> {
  const { token, key, displayName, locale = "en", status = "draft", properties } = opts;
  const r = await fetch(`${BASE}/experimental/content/${key}/versions?locale=${encodeURIComponent(locale)}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ displayName, status, properties }),
  });
  assertOk(r, "Create localized version");
  return r.json();
}

/** High-level: create content under a named parent (dynamic type). */
export async function createContentUnder(
  token: string,
  parentName: string,
  content: {
    displayName: string;
    contentType: string;
    properties: Record<string, any>;
  }
): Promise<{ containerKey: string; shell: any; version: any }> {
  // 1) resolve parent container key via GraphQL (_Content)
  const containerKey = await resolveParentKeyByName(token, parentName);

  // 2) create shell with dynamic content type
  const shell = await createContentShell({
    token,
    displayName: content.displayName,
    contentType: content.contentType, // Dynamic, not hardcoded
    container: containerKey,
    baseProps: {}, // No hardcoded properties
  });

  // 3) create first version in en
  const version = await createLocalizedVersion({
    token,
    key: shell.key ?? shell?.metadata?.key ?? shell?._metadata?.key,
    displayName: content.displayName,
    locale: "en",
    status: "draft",
    properties: content.properties,
  });

  return { containerKey, shell, version };
}

/** 
 * Updated GraphQL query patterns for _Content and _IContent 
 */
export const GRAPHQL_PATTERNS = {
  // Query for content using _Content (with underscore)
  searchContent: `
    query SearchContent($searchText: String!, $limit: Int) {
      _Content(
        where: { 
          _or: [
            { _metadata: { displayName: { contains: $searchText } } }
            { Name: { contains: $searchText } }
          ]
        }
        limit: $limit
        orderBy: { Name: ASC }
      ) {
        items {
          _metadata {
            key
            displayName
            contentType
            locale
            status
          }
          Name
          ContentType
          Language {
            Name
            DisplayName
          }
          Url
          RelativePath
          ParentLink {
            Id
            GuidValue
          }
          ... on _IContent {
            ParentLink {
              Id
              GuidValue
            }
            Ancestors {
              Name
              _metadata {
                key
              }
            }
          }
        }
        total
      }
    }
  `,
  
  // Get content by key
  getContentByKey: `
    query GetContentByKey($key: String!) {
      _Content(
        where: { _metadata: { key: { eq: $key } } }
        limit: 1
      ) {
        items {
          _metadata {
            key
            displayName
            contentType
            locale
            status
            url {
              base
              hierarchical
            }
          }
          ... on _IContent {
            Name
            ParentLink {
              Id
              GuidValue
            }
          }
        }
      }
    }
  `
};