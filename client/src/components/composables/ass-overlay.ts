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
 *
 * Out-of-order loads are handled with a monotonic `loadSeq`: each load claims a
 * unique id before fetching and, after awaiting, only applies its result if its
 * id is still the latest. A value token (the url) can't do this on its own,
 * because two concurrent loads of the *same* url would be indistinguishable.
 */
export function useAssOverlay(
	videoElement: Ref<HTMLVideoElement | undefined>,
	container: Ref<HTMLElement | undefined>,
) {
	let instance: ASS | null = null;
	// The track we're currently showing or loading; drives the "already active"
	// fast path and dedupe. Null means nothing is active.
	let currentUrl: string | null = null;
	// Monotonic id bumped per load() and on teardown. An in-flight fetch compares
	// the id it claimed against this to know if it's still the latest load.
	let loadSeq = 0;
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
			throw new Error("useAssOverlay: recompute() called with no active overlay");
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
		// Bump the token so any in-flight load sees seq !== loadSeq and discards
		// itself when it resolves.
		loadSeq++;
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
		video: HTMLVideoElement,
		box: HTMLElement,
	): Promise<void> {
		// Claim a unique id before any await. Two concurrent loads of the same url
		// get different ids, so a slow earlier one can tell it was superseded even
		// though the url matches. Keeping this inside the function avoids the
		// temporal coupling of requiring callers to bump the token first.
		const seq = ++loadSeq;
		currentUrl = url;
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const content = await response.text();
			if (seq !== loadSeq) {
				// A newer load() or a teardown superseded us while we fetched.
				console.warn("useAssOverlay: discarding stale ASS load for", url);
				return;
			}
			instance = new ASS(content, video, { container: box });
			visible.value = true;
			attachResize(video);
			// If metadata is already available (e.g. cache-warm video) no "resize"
			// event will fire later, so align the box now.
			recompute();
		} catch (e) {
			if (seq !== loadSeq) {
				// Superseded while fetching; the failure is irrelevant.
				console.info("useAssOverlay: ignoring failure of superseded ASS load for", url);
				return;
			}
			console.error("useAssOverlay: failed to load ASS subtitles:", e);
			// Release the slot so the same track can be retried.
			currentUrl = null;
		}
	}

	/**
	 * Load and display the ASS track at `url`. If it's already the active (or
	 * in-flight) track this is a no-op beyond ensuring visibility; switching to a
	 * different url tears down the current overlay and supersedes any in-flight
	 * load via the `loadSeq` token.
	 */
	function load(url: string): Promise<void> {
		const video = videoElement.value;
		const box = container.value;
		if (!video || !box) {
			throw new Error("useAssOverlay.load() called before the video element was mounted");
		}
		if (currentUrl === url) {
			if (instance) {
				console.info("useAssOverlay: track already active, ensuring visible:", url);
				show();
			} else {
				console.info("useAssOverlay: track already loading:", url);
			}
			return Promise.resolve();
		}
		destroy();
		return fetchAndCreate(url, video, box);
	}

	function show(): void {
		if (!instance) {
			console.warn("useAssOverlay: show() called with no active overlay");
			return;
		}
		instance.show();
		visible.value = true;
	}

	function hide(): void {
		instance?.hide();
		visible.value = false;
	}

	onBeforeUnmount(destroy);

	return { load, show, hide, destroy, visible };
}
