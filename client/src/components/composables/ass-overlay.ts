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
	// The in-flight load, if any: lets duplicate calls share one fetch and lets
	// a superseding load or teardown cancel it via its AbortController.
	let pending: { url: string; promise: Promise<void>; controller: AbortController } | null = null;
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

	function cancelPending(): void {
		pending?.controller.abort();
		pending = null;
	}

	function destroy(): void {
		cancelPending();
		if (videoElement.value) {
			detachResize(videoElement.value);
		}
		instance?.destroy();
		instance = null;
		currentUrl = null;
		visible.value = false;
	}

	async function fetchAndCreate(
		url: string,
		signal: AbortSignal,
		video: HTMLVideoElement,
		box: HTMLElement,
	): Promise<void> {
		try {
			const response = await fetch(url, { signal });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const content = await response.text();
			if (signal.aborted) {
				// a newer load() or teardown superseded us while fetching
				return;
			}
			instance = new ASS(content, video, { container: box });
			currentUrl = url;
			visible.value = true;
			attachResize(video);
			// If metadata is already available (e.g. cache-warm video) no "resize"
			// event will fire later, so align the box now.
			recompute();
		} catch (e) {
			if (signal.aborted) {
				// expected: the load was cancelled, not a real failure
				return;
			}
			console.error("useAssOverlay: failed to load ASS subtitles:", e);
		}
	}

	/**
	 * Load and display the ASS track at `url`. If it's already the active track,
	 * just make sure it's visible. Concurrent calls for the same URL share one
	 * fetch; a different URL cancels the in-flight one.
	 */
	function load(url: string): Promise<void> {
		const video = videoElement.value;
		const box = container.value;
		if (!video || !box) {
			// Called before the player mounted its elements; nothing to render onto.
			return Promise.resolve();
		}
		if (instance && currentUrl === url) {
			show();
			return Promise.resolve();
		}
		if (pending?.url === url) {
			return pending.promise;
		}
		destroy();
		const controller = new AbortController();
		const promise = fetchAndCreate(url, controller.signal, video, box).finally(() => {
			// Free the record once settled, unless a newer load already replaced it.
			// (Clearing on failure too is what lets the same track be retried.)
			if (pending?.controller === controller) {
				pending = null;
			}
		});
		pending = { url, promise, controller };
		return promise;
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
