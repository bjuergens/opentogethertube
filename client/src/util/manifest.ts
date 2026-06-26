import axios from "axios";
import type { Video } from "ott-common/models/video";
import type { CustomMediaManifest } from "ott-common/models/zod-schemas";

/** Fetch and parse a custom media manifest. */
export async function fetchManifest(url: string): Promise<CustomMediaManifest> {
	const resp = await axios.get<CustomMediaManifest>(url);
	return resp.data;
}

/** URL of the manifest's own default text track, or `null` if it has none. */
export function defaultTrackUrl(manifest: CustomMediaManifest): string | null {
	return manifest.textTracks?.find(t => t.default)?.url ?? null;
}

/**
 * For a custom media (manifest) item whose default subtitle track has never been set,
 * resolve the manifest's own default track and store it on the item so viewers get it by
 * default. `undefined` means "not set" and gets baked; an explicit `null` ("no subtitles")
 * or a URL is left untouched.
 */
export async function bakeDefaultSubtitleTrack(item: Video): Promise<void> {
	if (item.mime !== "application/json" || item.defaultSubtitleTrack !== undefined) {
		return;
	}
	try {
		item.defaultSubtitleTrack = defaultTrackUrl(await fetchManifest(item.src_url ?? item.id));
	} catch (e) {
		console.error("failed to resolve manifest default subtitle track:", e);
		item.defaultSubtitleTrack = null;
	}
}
