import { describe, it, expect } from "vitest";
import { inferSubtitleContentType, isSupportedSubtitleUrl } from "../../subtitle.js";

describe("isSupportedSubtitleUrl", () => {
	it("accepts .vtt, .ass and .ssa", () => {
		expect(isSupportedSubtitleUrl("https://example.com/a.vtt")).toBe(true);
		expect(isSupportedSubtitleUrl("https://example.com/a.ass")).toBe(true);
		expect(isSupportedSubtitleUrl("https://example.com/a.ssa")).toBe(true);
	});

	it("rejects unsupported subtitle and unrelated formats", () => {
		expect(isSupportedSubtitleUrl("https://example.com/a.srt")).toBe(false);
		expect(isSupportedSubtitleUrl("https://example.com/a.mp3")).toBe(false);
		expect(isSupportedSubtitleUrl("https://example.com/no-extension")).toBe(false);
	});

	it("ignores query strings and hash fragments and is case-insensitive", () => {
		expect(isSupportedSubtitleUrl("https://example.com/a.ASS?token=1")).toBe(true);
		expect(isSupportedSubtitleUrl("https://example.com/a.VTT#t=10")).toBe(true);
		expect(isSupportedSubtitleUrl("https://example.com/a.srt?x=.vtt")).toBe(false);
	});
});

describe("inferSubtitleContentType", () => {
	it("recognizes .ass and .ssa as ASS", () => {
		expect(inferSubtitleContentType("https://example.com/a.ass")).toEqual("text/x-ass");
		expect(inferSubtitleContentType("https://example.com/a.ssa")).toEqual("text/x-ass");
	});

	it("ignores query strings and hash fragments when reading the extension", () => {
		expect(inferSubtitleContentType("https://example.com/a.ass?token=1")).toEqual("text/x-ass");
		expect(inferSubtitleContentType("https://example.com/a.vtt#t=10")).toEqual("text/vtt");
	});

	it("is case-insensitive", () => {
		expect(inferSubtitleContentType("https://example.com/A.ASS")).toEqual("text/x-ass");
	});

	it("falls back to WebVTT for unknown extensions", () => {
		expect(inferSubtitleContentType("https://example.com/a.srt")).toEqual("text/vtt");
		expect(inferSubtitleContentType("https://example.com/no-extension")).toEqual("text/vtt");
	});
});
