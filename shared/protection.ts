export function creationAction(path: string, method: string): string | null {
  if (method !== "POST") return null;
  if (/^\/stories\/[^/]+\/proposals$/.test(path)) return "submit_proposal";
  if (/^\/stories\/[^/]+\/uploads$/.test(path)) return "upload_scene";
  if (path === "/stories") return "create_story";
  if (/^\/stories\/[^/]+\/tasks$/.test(path)) return "submit_idea";
  if (/^\/tasks\/[^/]+\/preview$/.test(path)) return "preview_scene";
  if (/^\/tasks\/[^/]+\/accept$/.test(path)) return "queue_scene";
  return null;
}
