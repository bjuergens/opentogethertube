<template>
	<div class="direct">
		<video
			ref="videoElem"
			preload="auto"
			crossorigin="anonymous"
			@canplay="onCanPlay"
			@playing="onPlaying"
			@pause="onPaused"
			@play="onWaiting"
			@waiting="onWaiting"
			@stalled="onBuffering"
			@loadstart="onBuffering"
			@progress="onProgress"
			@ended="onEnd"
			@error="onError"
		>
			<track
				v-for="track in vttTracks"
				:key="track.url"
				kind="subtitles"
				:src="track.url"
				:srclang="track.srclang"
				:label="track.name"
				:default="track.default"
			/>
			<track
				v-if="subtitleUrl && videoMime !== 'application/json'"
				:src="subtitleUrl"
				kind="subtitles"
				default
			/>
		</video>
		<div ref="assContainer" class="ass-container"></div>
	</div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRefs, watch } from "vue";
import ASS from "assjs";
import type { CaptionTrack, VideoTrack } from "@/models/media-tracks";
import type { CustomMediaManifest } from "ott-common/models/zod-schemas.js";
import type {
	MediaPlayerWithAudioBoost,
	MediaPlayerWithCaptions,
	MediaPlayerWithPlaybackRate,
	MediaPlayerWithQuality,
} from "../composables";
import { useCaptions, useMediaAudioBoost, useQualities } from "../composables";

interface Props {
	service: string;
	videoUrl: string;
	videoMime: string;
	thumbnail?: string;
	subtitleUrl?: string;
	/**
	 * URL of the manifest text track to select by default for all viewers.
	 * `""` means no subtitles by default, `null`/`undefined` means use the manifest's default flag.
	 */
	defaultTrack?: string | null;
}

const props = defineProps<Props>();
const { videoUrl, videoMime, thumbnail, subtitleUrl, defaultTrack } = toRefs(props);
const videoElem = ref<HTMLVideoElement | undefined>();
const captions = useCaptions();
const audioBoost = useMediaAudioBoost(videoElem);
const qualities = useQualities();
const manifest = ref<CustomMediaManifest | null>(null);
const assContainer = ref<HTMLDivElement | undefined>();
const vttTracks = computed(() => {
	const tracks = manifest.value?.textTracks ?? [];
	const vtt: typeof tracks = [];
	for (const track of tracks) {
		if (track.contentType === "text/vtt") {
			vtt.push(track);
		}
	}
	return vtt;
});
let assInstance: ASS | null = null;
let assTrackIdx: number | null = null;
let assVisible = false;
let assLoadPromise: Promise<void> | null = null;
let assLoadingIdx: number | null = null;
let assGeneration = 0;
let assResizeObserver: ResizeObserver | null = null;
let assResizeRaf: number | null = null;
let loadGeneration = 0;

const emit = defineEmits<{
	"apiready": [];
	"ready": [];
	"playing": [];
	"paused": [];
	"waiting": [];
	"buffering": [];
	"error": [];
	"end": [];
	"buffer-progress": [progress: number];
	"buffer-spans": [spans: TimeRanges];
}>();

function play() {
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	return videoElem.value.play();
}

function pause() {
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	videoElem.value.pause();
}

function setVolume(volume: number) {
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	videoElem.value.volume = volume / 100;
}

function getPosition() {
	if (!videoElem.value) {
		console.error("player not ready");
		return 0;
	}
	return videoElem.value.currentTime;
}

function setPosition(position: number) {
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	videoElem.value.currentTime = position;
}

function isCaptionsSupported(): boolean {
	return true;
}

function manifestTrack(idx: number) {
	return manifest.value?.textTracks?.[idx];
}

/**
 * Maps a manifest text track index to its index in the native videoElem.textTracks list,
 * which only contains the VTT tracks. Returns -1 for non-VTT tracks.
 */
function nativeTrackIndex(manifestIdx: number): number {
	const tracks = manifest.value?.textTracks ?? [];
	if (tracks[manifestIdx]?.contentType !== "text/vtt") {
		return -1;
	}
	return tracks.slice(0, manifestIdx).filter(t => t.contentType === "text/vtt").length;
}

/**
 * Force assjs to recompute its subtitle box, which it otherwise only does from
 * its own ResizeObserver (which can miss layout/window resizes). assjs has no
 * public resize(), so toggle the `resampling` setter to another valid mode and
 * back; both writes are synchronous, so the layout ends up unchanged.
 */
function forceAssResize(): void {
	if (!assInstance) {
		return;
	}
	const current = assInstance.resampling;
	assInstance.resampling = current === "video_height" ? "video_width" : "video_height";
	assInstance.resampling = current;
}

function scheduleAssResize(): void {
	if (assResizeRaf !== null) {
		return;
	}
	assResizeRaf = requestAnimationFrame(() => {
		assResizeRaf = null;
		forceAssResize();
	});
}

function observeAssResize(): void {
	if (assResizeObserver || !videoElem.value) {
		return;
	}
	assResizeObserver = new ResizeObserver(scheduleAssResize);
	assResizeObserver.observe(videoElem.value);
}

function destroyAss(): void {
	assGeneration++;
	if (assResizeObserver) {
		assResizeObserver.disconnect();
		assResizeObserver = null;
	}
	if (assResizeRaf !== null) {
		cancelAnimationFrame(assResizeRaf);
		assResizeRaf = null;
	}
	assInstance?.destroy();
	assInstance = null;
	assTrackIdx = null;
	assVisible = false;
}

function parseAssTimestamp(timestamp: string): number {
	const parts = timestamp.split(":");
	if (parts.length !== 3) {
		return NaN;
	}
	return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
}

/**
 * Logs diagnostic info about a fetched ASS file, and warns when none of its
 * dialogue events overlap the video's duration (e.g. episode-timed subtitles
 * paired with a short clip), which would otherwise silently render nothing.
 */
function logAssDiagnostics(content: string): void {
	let eventCount = 0;
	let firstStart = Infinity;
	let lastEnd = -Infinity;
	for (const line of content.split("\n")) {
		if (!line.startsWith("Dialogue:")) {
			continue;
		}
		eventCount++;
		const fields = line.split(",");
		const start = parseAssTimestamp(fields[1] ?? "");
		const end = parseAssTimestamp(fields[2] ?? "");
		if (!isNaN(start)) {
			firstStart = Math.min(firstStart, start);
		}
		if (!isNaN(end)) {
			lastEnd = Math.max(lastEnd, end);
		}
	}
	if (eventCount === 0) {
		console.warn("DirectPlayer: ASS track contains no dialogue events");
		return;
	}
	console.log(
		`DirectPlayer: ASS track loaded: ${eventCount} dialogue events, ` +
			`spanning ${firstStart.toFixed(2)}s - ${lastEnd.toFixed(2)}s`
	);
	const duration = videoElem.value?.duration ?? manifest.value?.duration;
	if (duration && isFinite(duration) && (firstStart >= duration || lastEnd <= 0)) {
		console.warn(
			`DirectPlayer: no ASS dialogue events overlap the video ` +
				`(events: ${firstStart.toFixed(2)}s - ${lastEnd.toFixed(2)}s, ` +
				`video duration: ${duration.toFixed(2)}s) - subtitles will not be visible. ` +
				`Are the subtitle timestamps offset relative to this video?`
		);
	}
}

/**
 * Detects whether a font family is available to the browser by comparing
 * rendered text widths against generic fallback fonts. `document.fonts.check()`
 * is unreliable for system-installed fonts, so canvas measurement is used instead.
 */
function isFontAvailable(family: string): boolean {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return true;
	}
	const sample = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	return ["monospace", "serif", "sans-serif"].some(fallback => {
		ctx.font = `32px ${fallback}`;
		const fallbackWidth = ctx.measureText(sample).width;
		ctx.font = `32px "${family.replace(/"/g, "")}", ${fallback}`;
		return ctx.measureText(sample).width !== fallbackWidth;
	});
}

function collectAssFonts(content: string): Set<string> {
	const fonts = new Set<string>();
	for (const line of content.split("\n")) {
		if (line.startsWith("Style:")) {
			// Fontname is the second field of a style definition
			const fontname = line.slice("Style:".length).split(",")[1]?.trim();
			if (fontname) {
				fonts.add(fontname);
			}
		} else if (line.startsWith("Dialogue:")) {
			for (const match of line.matchAll(/\\fn([^\\}]+)/g)) {
				const fontname = match[1].trim();
				if (fontname) {
					fonts.add(fontname);
				}
			}
		}
	}
	return fonts;
}

function logAssFontDiagnostics(content: string): void {
	const fonts = collectAssFonts(content);
	if (fonts.size === 0) {
		return;
	}
	const missing = Array.from(fonts).filter(f => !isFontAvailable(f));
	console.log(
		`DirectPlayer: ASS track references ${fonts.size} fonts:`,
		Array.from(fonts).join(", ")
	);
	if (missing.length > 0) {
		console.warn(
			`DirectPlayer: ${missing.length} ASS fonts are not available in this browser ` +
				`and will fall back to default fonts: ${missing.join(", ")}`
		);
	}
}

function logAssResolutionDiagnostics(content: string): void {
	const playResX = Number(/^PlayResX:\s*(\d+)/m.exec(content)?.[1]);
	const playResY = Number(/^PlayResY:\s*(\d+)/m.exec(content)?.[1]);
	if (!playResX || !playResY) {
		console.warn(
			"DirectPlayer: ASS track does not specify PlayResX/PlayResY - " +
				"subtitle positioning and scaling may be incorrect"
		);
		return;
	}
	const videoWidth = videoElem.value?.videoWidth ?? 0;
	const videoHeight = videoElem.value?.videoHeight ?? 0;
	console.log(
		`DirectPlayer: ASS script resolution: ${playResX}x${playResY}, ` +
			`video resolution: ${videoWidth && videoHeight ? `${videoWidth}x${videoHeight}` : "not loaded yet"}`
	);
	if (videoWidth && videoHeight) {
		const scriptAspect = playResX / playResY;
		const videoAspect = videoWidth / videoHeight;
		if (Math.abs(scriptAspect - videoAspect) > 0.01) {
			console.warn(
				`DirectPlayer: ASS script aspect ratio (${scriptAspect.toFixed(3)}) does not ` +
					`match video aspect ratio (${videoAspect.toFixed(3)}) - ` +
					`subtitle positioning may be off`
			);
		}
	}
}

async function activateAssTrack(manifestIdx: number): Promise<void> {
	const track = manifestTrack(manifestIdx);
	if (!track || !videoElem.value || !assContainer.value) {
		return;
	}
	if (assTrackIdx === manifestIdx && assInstance) {
		assInstance.show();
		assVisible = true;
		return;
	}
	if (assLoadingIdx === manifestIdx && assLoadPromise) {
		// this track is already being loaded, don't fetch it again
		return assLoadPromise;
	}
	destroyAss();
	assLoadingIdx = manifestIdx;
	assLoadPromise = loadAssTrack(manifestIdx, track.url).finally(() => {
		assLoadingIdx = null;
		assLoadPromise = null;
	});
	return assLoadPromise;
}

async function loadAssTrack(manifestIdx: number, url: string): Promise<void> {
	const generation = loadGeneration;
	const localAssGeneration = assGeneration;
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const content = await response.text();
		if (
			generation !== loadGeneration ||
			localAssGeneration !== assGeneration ||
			!videoElem.value ||
			!assContainer.value
		) {
			// a new video source or another ASS track was loaded while we were fetching
			return;
		}
		logAssDiagnostics(content);
		logAssResolutionDiagnostics(content);
		logAssFontDiagnostics(content);
		assInstance = new ASS(content, videoElem.value, {
			container: assContainer.value,
		});
		assTrackIdx = manifestIdx;
		assVisible = true;
		observeAssResize();
	} catch (e) {
		console.error("DirectPlayer: failed to load ASS subtitles:", e);
		destroyAss();
	}
}

function setCaptionsEnabled(enabled: boolean): void {
	if (!videoElem.value || captions.currentTrack.value === null) {
		return;
	}
	if (
		videoMime.value !== "application/json" &&
		!manifest.value?.textTracks &&
		!subtitleUrl.value
	) {
		return;
	}
	if (captions.currentTrack.value === -1) {
		if (enabled) {
			setCaptionsTrack(0);
		}
		return;
	}
	if (videoMime.value === "application/json" && manifest.value) {
		const track = manifestTrack(captions.currentTrack.value);
		if (!track) {
			console.warn(
				"DirectPlayer: invalid captions track index:",
				captions.currentTrack.value
			);
			return;
		}
		if (track.contentType === "text/x-ass") {
			if (enabled) {
				activateAssTrack(captions.currentTrack.value);
			} else {
				assInstance?.hide();
				assVisible = false;
			}
			return;
		}
		const nativeIdx = nativeTrackIndex(captions.currentTrack.value);
		videoElem.value.textTracks[nativeIdx].mode = enabled ? "showing" : "hidden";
		return;
	}
	if (captions.currentTrack.value >= videoElem.value.textTracks.length) {
		console.warn("DirectPlayer: invalid captions track index:", captions.currentTrack.value);
		return;
	}
	videoElem.value.textTracks[captions.currentTrack.value].mode = enabled ? "showing" : "hidden";
}

function isCaptionsEnabled(): boolean {
	if (!videoElem.value) {
		return false;
	}
	if (assVisible) {
		return true;
	}
	return Array.from(videoElem.value.textTracks).find(t => t.mode === "showing") !== undefined;
}

function getCaptionsTracks(): CaptionTrack[] {
	if (!videoElem.value) {
		return [];
	}
	if (videoMime.value === "application/json") {
		if (!manifest.value) {
			return [];
		}
	} else {
		return subtitleUrl.value ? [{ kind: "subtitles", default: true }] : [];
	}

	const tracks: CaptionTrack[] = [];
	for (const track of manifest.value.textTracks ?? []) {
		tracks.push({
			kind: "subtitles",
			label: track.name ?? undefined,
			srclang: track.srclang,
			default: track.default,
		});
	}
	return tracks;
}

function setCaptionsTrack(track: number): void {
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	console.log("DirectPlayer: setCaptionsTrack:", track);
	if (videoMime.value === "application/json" && manifest.value) {
		const selected = manifestTrack(track);
		if (!selected) {
			console.warn("DirectPlayer: invalid captions track index:", track);
			return;
		}
		const nativeIdx = nativeTrackIndex(track);
		for (let i = 0; i < videoElem.value.textTracks.length; i++) {
			videoElem.value.textTracks[i].mode = i === nativeIdx ? "showing" : "hidden";
		}
		if (selected.contentType === "text/x-ass") {
			activateAssTrack(track);
		} else {
			assInstance?.hide();
			assVisible = false;
		}
		captions.currentTrack.value = track;
		return;
	}
	for (let i = 0; i < videoElem.value.textTracks.length; i++) {
		videoElem.value.textTracks[i].mode = i === track ? "showing" : "hidden";
	}
	captions.currentTrack.value = track;
}

function isQualitySupported(): boolean {
	return manifest.value !== null && manifest.value.sources.length > 1;
}

function getVideoTracks(): VideoTrack[] {
	if (!manifest.value) {
		return [];
	}
	return manifest.value.sources.map(s => ({
		label: s.quality,
		width: 0,
		height: s.quality,
	}));
}

function setVideoTrack(idx: number): void {
	if (!manifest.value || !videoElem.value) {
		return;
	}
	const source = manifest.value.sources[idx];
	if (!source) {
		return;
	}
	const currentTime = videoElem.value.currentTime;
	const wasPlaying = !videoElem.value.paused;
	videoElem.value.src = source.url;
	videoElem.value.load();
	videoElem.value.currentTime = currentTime;
	if (wasPlaying) {
		videoElem.value.play().catch(e => {
			console.error("DirectPlayer: error resuming after quality switch:", e);
		});
	}
	qualities.currentVideoTrack.value = idx;
}

function isAutoQualitySupported(): boolean {
	return false;
}

function getCurrentActiveQuality(): number | null {
	if (!videoElem.value || !manifest.value) {
		return null;
	}
	return manifest.value.sources.findIndex(s => s.url === videoElem.value?.src) ?? -1;
}

function getAvailablePlaybackRates(): number[] {
	return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
}

function getPlaybackRate(): number {
	if (!videoElem.value) {
		console.error("player not ready");
		return 1;
	}
	return videoElem.value.playbackRate;
}

async function setPlaybackRate(rate: number): Promise<void> {
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	videoElem.value.playbackRate = rate;
}

function setAudioBoost(boost: number): void {
	audioBoost.setBoost(boost);
}

async function loadVideoSource() {
	console.log("DirectPlayer: loading video source:", videoUrl.value, videoMime.value);
	if (!videoElem.value) {
		console.error("player not ready");
		return;
	}
	loadGeneration++;
	// Fix for captions from previous video still showing after source change
	for (let i = 0; i < videoElem.value.textTracks.length; i++) {
		videoElem.value.textTracks[i].mode = "hidden";
	}
	destroyAss();
	audioBoost.resetFailedSetup();
	manifest.value = null;

	if (videoMime.value === "application/json") {
		try {
			const response = await fetch(videoUrl.value);
			if (!response.ok) {
				console.error("DirectPlayer: failed to fetch manifest:", response.status);
				emit("error");
				return;
			}
			manifest.value = (await response.json()) as CustomMediaManifest;
		} catch (e) {
			console.error("DirectPlayer: failed to fetch manifest:", e);
			emit("error");
			return;
		}
		const firstSource = manifest.value.sources[0];
		if (!firstSource) {
			console.error("DirectPlayer: manifest has no sources");
			emit("error");
			return;
		}
		videoElem.value.src = firstSource.url;

		qualities.videoTracks.value = getVideoTracks();
		qualities.currentVideoTrack.value = 0;

		captions.captionsTracks.value = getCaptionsTracks();
		// The browser adds newly inserted <track> elements in "disabled" mode initially,
		// the default attribute causes them to become "showing" asynchronously.
		// To reflect this in the UI correctly, now the default track index is read directly
		// from the manifest data, and we explicitly set its mode to "showing"
		// A per-queue-item override (set via the Edit Video dialog) takes precedence over the
		// manifest's own default flag. `""` means "no subtitles", a URL selects that track,
		// `null`/`undefined` falls back to the manifest's default flag.
		let defaultTrackIdx: number;
		if (defaultTrack.value === "") {
			defaultTrackIdx = -1;
		} else if (defaultTrack.value) {
			defaultTrackIdx =
				manifest.value.textTracks?.findIndex(t => t.url === defaultTrack.value) ?? -1;
		} else {
			defaultTrackIdx = manifest.value.textTracks?.findIndex(t => t.default) ?? -1;
		}
		captions.currentTrack.value = defaultTrackIdx;
		captions.isCaptionsEnabled.value = defaultTrackIdx !== -1;
		if (defaultTrackIdx !== -1) {
			if (manifestTrack(defaultTrackIdx)?.contentType === "text/x-ass") {
				await activateAssTrack(defaultTrackIdx);
			} else {
				await nextTick();
				videoElem.value.textTracks[nativeTrackIndex(defaultTrackIdx)].mode = "showing";
			}
		}
	} else {
		videoElem.value.src = videoUrl.value;

		qualities.videoTracks.value = [];
		qualities.currentVideoTrack.value = -1;

		if (subtitleUrl.value) {
			captions.captionsTracks.value = [{ kind: "subtitles", default: true }];
			captions.currentTrack.value = 0;
			captions.isCaptionsEnabled.value = true;
		} else {
			captions.captionsTracks.value = [];
			captions.currentTrack.value = -1;
			captions.isCaptionsEnabled.value = false;
		}
	}

	videoElem.value.poster = thumbnail.value ?? "";
	videoElem.value.load();
	// this is needed to get the player to keep playing after the previous video has ended
	videoElem.value.play();

	console.log("DirectPlayer: current subtitle track:", captions.currentTrack.value);
	console.log("DirectPlayer: current video track:", qualities.currentVideoTrack.value);

	emit("apiready");
}

function onCanPlay() {
	emit("ready");
}

function onPlaying() {
	emit("playing");
}

function onPaused() {
	emit("paused");
}

function onWaiting() {
	emit("waiting");
}

function onBuffering() {
	emit("buffering");
}

function onProgress() {
	if (videoElem.value) {
		const buffered = videoElem.value.buffered;
		emit("buffer-spans", buffered);
		const duration = videoElem.value.duration;
		let bufferedTotal = 0;
		for (let i = 0; i < buffered.length; i++) {
			bufferedTotal += buffered.end(i) - buffered.start(i);
		}
		const bufferedPercentage = duration > 0 ? bufferedTotal / duration : 0;
		emit("buffer-progress", bufferedPercentage);
	}
}

function onEnd() {
	emit("end");
}

function onError(err: Event) {
	emit("error");
	console.error("DirectPlayer: error:", err);
}

onMounted(() => {
	loadVideoSource();
});

onBeforeUnmount(() => {
	destroyAss();
});

watch([videoUrl, subtitleUrl], () => {
	console.log("DirectPlayer: videoUrl or subtitleUrl changed");
	loadVideoSource();
});

defineExpose({
	play,
	pause,
	setVolume,
	getPosition,
	setPosition,
	isCaptionsSupported,
	setCaptionsEnabled,
	isCaptionsEnabled,
	getCaptionsTracks,
	setCaptionsTrack,
	isQualitySupported,
	getVideoTracks,
	setVideoTrack,
	isAutoQualitySupported,
	getCurrentActiveQuality,
	getAvailablePlaybackRates,
	getPlaybackRate,
	setPlaybackRate,
	setAudioBoost,
} satisfies MediaPlayerWithCaptions & MediaPlayerWithPlaybackRate & MediaPlayerWithAudioBoost & MediaPlayerWithQuality);
</script>

<!-- biome-ignore lint/nursery/useScopedStyles: biome migration -->
<style lang="scss">
.direct {
	display: flex;
	align-items: center;
	justify-content: center;
	max-width: 100%;
	max-height: 100%;
	width: 100%;
	height: 100%;
	position: relative;
}

.direct .ass-container {
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 1;
	overflow: hidden;
}

.direct video {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain;
	object-position: 50% 50%;
}
</style>
