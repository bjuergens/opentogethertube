import type { QueueItem } from "ott-common/models/video.js";

/**
 * The shape of a queue item as it was persisted before {@link
 * QueueItem.subtitleUrl} was merged into {@link QueueItem.defaultSubtitleTrack}.
 */
type LegacyQueueItem = QueueItem & { subtitleUrl?: string | null };

/**
 * Rooms persisted before the `subtitleUrl` field was merged into
 * `defaultSubtitleTrack` stored a direct video's external subtitle URL under
 * `subtitleUrl`. Newer code only reads `defaultSubtitleTrack`, so loading such a
 * room (from the database's `prevQueue` column or from Redis) would silently
 * drop the subtitle URL. This maps the legacy field onto the new one in-place so
 * those rooms keep their subtitles.
 *
 * The mutation is idempotent: it never overwrites an existing
 * `defaultSubtitleTrack`, and it always strips the stale `subtitleUrl` key.
 */
export function migrateLegacySubtitleUrl<T extends QueueItem | null | undefined>(item: T): T {
	if (!item) {
		return item;
	}
	const legacy = item as LegacyQueueItem;
	if (
		legacy.subtitleUrl != null &&
		legacy.subtitleUrl !== "" &&
		legacy.defaultSubtitleTrack == null
	) {
		legacy.defaultSubtitleTrack = legacy.subtitleUrl;
	}
	delete legacy.subtitleUrl;
	return item;
}

/**
 * Applies {@link migrateLegacySubtitleUrl} to every item in a queue, in-place.
 */
export function migrateLegacySubtitleUrlInItems<T extends QueueItem[] | null | undefined>(
	items: T,
): T {
	if (!items) {
		return items;
	}
	for (const item of items) {
		migrateLegacySubtitleUrl(item);
	}
	return items;
}
