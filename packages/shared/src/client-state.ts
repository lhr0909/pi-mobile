import type {
	HostEvent,
	HostStatus,
	SessionSnapshot,
	SessionState,
	TimelineItem,
} from "./protocol.js";

export interface MobileClientState {
	sessions: Record<string, SessionSnapshot>;
	activeSessionId?: string;
	connectionMessage?: string;
}

export function createMobileClientState(): MobileClientState {
	return { sessions: {} };
}

export function reduceHostEvent(
	state: MobileClientState,
	event: HostEvent,
): MobileClientState {
	switch (event.type) {
		case "host_status":
			return {
				...state,
				connectionMessage: formatHostConnectionMessage(event.status),
			};
		case "session_opened":
			return upsertSession(state, event.snapshot, event.snapshot.session.id);
		case "session_updated":
			return updateSessionState(state, event.session);
		case "timeline_item":
			return updateTimeline(state, event.sessionId, (timeline) =>
				upsertTimelineItem(timeline, event.item),
			);
		case "timeline_delta":
			return updateTimeline(state, event.sessionId, (timeline) =>
				appendTimelineDelta(timeline, event.itemId, event.delta),
			);
		case "command_error":
			return event.sessionId
				? updateTimeline(state, event.sessionId, (timeline) => [
						...timeline,
						{
							id: `error-${event.seq ?? Date.now()}`,
							kind: "status",
							text: event.message,
							tone: "error",
							createdAt: new Date().toISOString(),
						},
					])
				: state;
		default:
			return state;
	}
}

function formatHostConnectionMessage(status: HostStatus): string {
	return `${status.name} on ${status.platform} · Pi coding agent v${status.piCodingAgentVersion}`;
}

function upsertSession(
	state: MobileClientState,
	snapshot: SessionSnapshot,
	activeSessionId?: string,
): MobileClientState {
	const resolvedActiveSessionId = activeSessionId ?? state.activeSessionId;
	return {
		...state,
		...(resolvedActiveSessionId
			? { activeSessionId: resolvedActiveSessionId }
			: {}),
		sessions: {
			...state.sessions,
			[snapshot.session.id]: snapshot,
		},
	};
}

function updateSessionState(
	state: MobileClientState,
	session: SessionState,
): MobileClientState {
	const existing = state.sessions[session.id];
	if (!existing) {
		return state;
	}

	return upsertSession(state, { ...existing, session }, state.activeSessionId);
}

function updateTimeline(
	state: MobileClientState,
	sessionId: string,
	update: (timeline: TimelineItem[]) => TimelineItem[],
): MobileClientState {
	const existing = state.sessions[sessionId];
	if (!existing) {
		return state;
	}

	return upsertSession(
		state,
		{ ...existing, timeline: update(existing.timeline) },
		state.activeSessionId,
	);
}

function upsertTimelineItem(
	timeline: TimelineItem[],
	item: TimelineItem,
): TimelineItem[] {
	const existingIndex = timeline.findIndex(
		(existing) => existing.id === item.id,
	);
	if (existingIndex === -1) {
		return [...timeline, item];
	}

	return timeline.map((existing) =>
		existing.id === item.id ? item : existing,
	);
}

function appendTimelineDelta(
	timeline: TimelineItem[],
	itemId: string,
	delta: string,
): TimelineItem[] {
	return timeline.map((item) => {
		if (
			item.id !== itemId ||
			(item.kind !== "assistant" && item.kind !== "thinking")
		) {
			return item;
		}

		return { ...item, text: item.text + delta };
	});
}
