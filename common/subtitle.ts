import type { CustomMediaTextTrack } from "./models/zod-schemas.js";

/**
 * Collapse the various "no subtitle" representations to a single canonical `null`.
 *
 * `defaultSubtitleTrack` may arrive as `undefined` (field omitted), `""` (cleared in the
 * edit dialog), or `null`. They all mean the same thing, so normalize them to `null` and
 * pass any real value through unchanged. This is the single source of truth for that rule;
 * both the Zod request schema and the client edit dialog use it.
 */
export function normalizeSubtitleTrack(value: string | null | undefined): string | null {
	return value || null;
}

/**
 * Guess a subtitle track's content type from its URL extension.
 *
 * Only `.ass`/`.ssa` are recognized as Advanced SubStation Alpha; everything else (including
 * unknown extensions) falls back to `text/vtt`. This is intentionally permissive: the server
 * does not validate external subtitle URLs, so an unsupported file simply fails to render in
 * the browser rather than being rejected.
 */
export function inferSubtitleContentType(url: string): CustomMediaTextTrack["contentType"] {
	const path = url.split("?")[0].split("#")[0];
	const ext = path.split(".").pop()?.toLowerCase();
	return ext === "ass" || ext === "ssa" ? "text/x-ass" : "text/vtt";
}

/**
 * Build the synthetic text track for an external (non-manifest) subtitle URL.
 *
 * Direct media items have no manifest, so their single subtitle is represented as one track
 * with an unknown language (`und`) that is shown by default.
 */
export function externalSubtitleAsTextTrack(url: string): CustomMediaTextTrack {
	return {
		url,
		contentType: inferSubtitleContentType(url),
		srclang: "und",
		default: true,
	};
}
