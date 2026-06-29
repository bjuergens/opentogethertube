import { describe, it, expect } from "vitest";
import type { QueueItem } from "ott-common/models/video.js";
import {
	migrateLegacySubtitleUrl,
	migrateLegacySubtitleUrlInItems,
} from "../../../storage/legacy-subtitle.js";

type LegacyQueueItem = QueueItem & { subtitleUrl?: string | null };

describe("migrateLegacySubtitleUrl", () => {
	it("maps a legacy subtitleUrl onto defaultSubtitleTrack", () => {
		const item: LegacyQueueItem = {
			service: "direct",
			id: "video",
			subtitleUrl: "https://example.com/subs.vtt",
		};
		migrateLegacySubtitleUrl(item);
		expect(item.defaultSubtitleTrack).toEqual("https://example.com/subs.vtt");
		expect("subtitleUrl" in item).toBe(false);
	});

	it("does not overwrite an existing defaultSubtitleTrack", () => {
		const item: LegacyQueueItem = {
			service: "direct",
			id: "video",
			subtitleUrl: "https://example.com/old.vtt",
			defaultSubtitleTrack: "https://example.com/new.vtt",
		};
		migrateLegacySubtitleUrl(item);
		expect(item.defaultSubtitleTrack).toEqual("https://example.com/new.vtt");
		expect("subtitleUrl" in item).toBe(false);
	});

	it.each([null, ""])("treats subtitleUrl %p as no subtitle and strips it", value => {
		const item: LegacyQueueItem = {
			service: "direct",
			id: "video",
			subtitleUrl: value,
		};
		migrateLegacySubtitleUrl(item);
		expect(item.defaultSubtitleTrack).toBeUndefined();
		expect("subtitleUrl" in item).toBe(false);
	});

	it("leaves modern items without subtitleUrl untouched", () => {
		const item: QueueItem = {
			service: "direct",
			id: "video",
			defaultSubtitleTrack: "https://example.com/subs.vtt",
		};
		migrateLegacySubtitleUrl(item);
		expect(item.defaultSubtitleTrack).toEqual("https://example.com/subs.vtt");
	});

	it.each([null, undefined])("returns %p unchanged", value => {
		expect(migrateLegacySubtitleUrl(value)).toEqual(value);
	});
});

describe("migrateLegacySubtitleUrlInItems", () => {
	it("migrates every item in a queue", () => {
		const items: LegacyQueueItem[] = [
			{ service: "direct", id: "a", subtitleUrl: "https://example.com/a.vtt" },
			{ service: "direct", id: "b" },
			{ service: "direct", id: "c", subtitleUrl: "https://example.com/c.ass" },
		];
		migrateLegacySubtitleUrlInItems(items as QueueItem[]);
		expect(items[0].defaultSubtitleTrack).toEqual("https://example.com/a.vtt");
		expect(items[1].defaultSubtitleTrack).toBeUndefined();
		expect(items[2].defaultSubtitleTrack).toEqual("https://example.com/c.ass");
		expect(items.some(i => "subtitleUrl" in i)).toBe(false);
	});

	it.each([null, undefined])("returns %p unchanged", value => {
		expect(migrateLegacySubtitleUrlInItems(value)).toEqual(value);
	});
});
