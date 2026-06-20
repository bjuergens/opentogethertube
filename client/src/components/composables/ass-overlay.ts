import { onBeforeUnmount, type Ref, ref } from "vue";
import ASS from "assjs";

/**
 * Manages an assjs subtitle overlay rendered on top of an HTML5 video element.
 *
 * assjs only recomputes its subtitle box when the video element's box size
 * changes (via its own internal ResizeObserver). It does NOT recompute when the
 * video's intrinsic resolution becomes known (metadata load) or changes (quality
 * switch). Since the video element here is always sized 100%x100%, constructing
 * the instance before metadata is available leaves the box positioned as if the
 * video filled the whole container (no letterboxing). We fix this by forcing a
 * recompute on the video element's "resize" event, which fires exactly when the
 * intrinsic dimensions first appear and whenever they change.
 */
export function useAssOverlay(
	videoElement: Ref<HTMLVideoElement | undefined>,
	container: Ref<HTMLElement | undefined>,
) {
	let instance: ASS | null = null;
	let currentUrl: string | null = null;
	let loadingUrl: string | null = null;
	let loadPromise: Promise<void> | null = null;
	// Bumped on every destroy/load so in-flight fetches can detect they're stale.
	let generation = 0;
	const visible = ref(false);

	/**
	 * Force assjs to recompute its subtitle box. assjs has no public resize() —
	 * the resize logic lives in a private `#resize` only invoked by its internal
	 * ResizeObserver and by the `resampling` setter. That setter early-returns
	 * when the value is unchanged (`if (r === this.#resampling) return;`), so we
	 * toggle to another valid mode and back: each write actually changes the
	 * value, triggering an internal recompute, and the final mode is unchanged.
	 */
	function recompute(): void {
		if (!instance) {
			return;
		}
		const mode = instance.resampling;
		instance.resampling = mode === "video_height" ? "video_width" : "video_height";
		instance.resampling = mode;
	}

	function attachResize(video: HTMLVideoElement): void {
		video.addEventListener("resize", recompute);
	}

	function detachResize(video: HTMLVideoElement): void {
		video.removeEventListener("resize", recompute);
	}

	function destroy(): void {
		generation++;
		if (videoElement.value) {
			detachResize(videoElement.value);
		}
		instance?.destroy();
		instance = null;
		currentUrl = null;
		loadingUrl = null;
		loadPromise = null;
		visible.value = false;
	}

	async function fetchAndCreate(url: string, gen: number): Promise<void> {
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const content = await response.text();
			if (gen !== generation || !videoElement.value || !container.value) {
				// a new video source or another track was selected while fetching
				return;
			}
			instance = new ASS(content, videoElement.value, {
				container: container.value,
			});
			currentUrl = url;
			visible.value = true;
			attachResize(videoElement.value);
			// If metadata is already available (e.g. cache-warm video) no "resize"
			// event will fire later, so align the box now.
			recompute();
		} catch (e) {
			console.error("useAssOverlay: failed to load ASS subtitles:", e);
			// Only tear down if this load is still the current one; a stale/failed
			// fetch must not destroy an overlay a newer load() has since created.
			if (gen === generation) {
				destroy();
			}
		}
	}

	/**
	 * Load and display the ASS track at `url`. If it's already the active track,
	 * just make sure it's visible. Concurrent calls for the same URL share one
	 * fetch.
	 */
	function load(url: string): Promise<void> {
		if (!videoElement.value || !container.value) {
			return Promise.resolve();
		}
		if (instance && currentUrl === url) {
			show();
			return Promise.resolve();
		}
		if (loadingUrl === url && loadPromise) {
			return loadPromise;
		}
		destroy();
		const gen = generation;
		loadingUrl = url;
		loadPromise = fetchAndCreate(url, gen).finally(() => {
			// Don't clobber de-dupe state if a newer load() has already taken over.
			if (gen === generation) {
				loadingUrl = null;
				loadPromise = null;
			}
		});
		return loadPromise;
	}

	function show(): void {
		instance?.show();
		visible.value = instance !== null;
	}

	function hide(): void {
		instance?.hide();
		visible.value = false;
	}

	onBeforeUnmount(destroy);

	return { load, show, hide, destroy, visible };
}
