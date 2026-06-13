<template>
	<DropdownMenu>
		<!--
			Works around an upstream reka-ui issue where a menu trigger nested
			directly as-child of a TooltipTrigger shares the tooltip's dismissable
			layer, which swallows the click so the menu never opens. The wrapper
			span decouples the layers and disable-closing-trigger keeps the tooltip
			from eating the click. See https://github.com/unovue/reka-ui/discussions/924
		-->
		<Tooltip :disable-closing-trigger="true">
			<TooltipTrigger as-child>
				<span class="tooltip-anchor">
					<DropdownMenuTrigger as-child>
						<Button
							variant="ghost"
							size="sm"
							class="media-control font-mono"
							:aria-label="$t('room.playback-speed')"
							:disabled="!supported"
						>
							{{ formatRate(playbackRate.playbackRate.value) }}
						</Button>
					</DropdownMenuTrigger>
				</span>
			</TooltipTrigger>
			<TooltipContent side="bottom">{{ $t("room.playback-speed") }}</TooltipContent>
		</Tooltip>
		<DropdownMenuContent align="center" side="top">
			<DropdownMenuItem
				v-for="(rate, index) in playbackRate.availablePlaybackRates.value"
				:key="index"
				class="font-mono justify-center"
				@click="setRate(rate)"
			>
				{{ formatRate(rate) }}
			</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>
</template>

<script lang="ts" setup>
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnection } from "@/plugins/connection";
import { useRoomApi } from "@/util/roomapi";
import { usePlaybackRate } from "../composables";

const connection = useConnection();
const roomApi = useRoomApi(connection);
const playbackRate = usePlaybackRate();

function formatRate(rate: number) {
	return `${rate.toLocaleString(undefined, {
		maximumFractionDigits: 2,
	})}x`;
}

function setRate(rate: number) {
	roomApi.setPlaybackRate(rate);
}

const supported = playbackRate.isPlaybackRateSupported;
</script>

<style scoped>
.media-control {
	color: var(--foreground);
}

.tooltip-anchor {
	display: inline-flex;
}
</style>
