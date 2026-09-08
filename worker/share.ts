import { getStory, getScenes } from "./store";
import { sceneAt } from "../shared/domain";
import { brand } from "../shared/brand";
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export async function sharePage(request: Request, env: Cloudflare.Env) {
  const source = await env.ASSETS.fetch(request);
  if (!source.headers.get("content-type")?.includes("text/html")) return source;
  const asset = new Response(source.body, source);
  asset.headers.set("Cache-Control", "no-cache, must-revalidate");
  const url = new URL(request.url),
    slug = decodeURIComponent(url.pathname.split("/")[2] ?? "");
  try {
    const story = await getStory(env, slug);
    if (story.status === "draft" || story.reviewStatus !== "approved")
      return new HTMLRewriter()
        .on("head", {
          element(el) {
            el.append('<meta name="robots" content="noindex,nofollow">', {
              html: true,
            });
          },
        })
        .transform(asset);
    const scenes = await getScenes(env, story.id);
    const scene = url.searchParams.get("scene")
      ? scenes.find((s) => s.id === url.searchParams.get("scene"))
      : sceneAt(
          scenes.filter((s) => s.episodeId === url.searchParams.get("episode")),
          Number(url.searchParams.get("t") ?? 0) * 1000,
        );
    const title =
      scene && !scene.hidden
        ? `${scene.title} · Produced by ${scene.author} — ${story.title}`
        : `${story.title} — ${brand.name}`;
    const description =
      scene && !scene.hidden
        ? `A scene produced by ${scene.author}. ${scene.englishPrompt}`
        : story.logline;
    const canonical = new URL(`/story/${story.slug}`, env.PUBLIC_ORIGIN);
    if (scene && !scene.hidden) canonical.searchParams.set("scene", scene.id);
    const metas = `<meta property="og:type" content="video.other"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description.slice(0, 280))}"><meta property="og:image" content="${escape(new URL(story.coverUrl, env.PUBLIC_ORIGIN).href)}"><meta property="og:url" content="${escape(canonical.href)}"><meta name="twitter:card" content="summary_large_image"><link rel="canonical" href="${escape(canonical.href)}">`;
    return new HTMLRewriter()
      .on("title", {
        element(el) {
          el.setInnerContent(title);
        },
      })
      .on('meta[name="description"]', {
        element(el) {
          el.setAttribute("content", description.slice(0, 280));
        },
      })
      .on("head", {
        element(el) {
          el.append(metas, { html: true });
        },
      })
      .transform(asset);
  } catch {
    return asset;
  }
}
