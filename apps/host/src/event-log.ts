import type { HostEvent } from "@pi-mobile/shared";

export class EventLog {
  private readonly events: HostEvent[] = [];
  private nextSeq = 1;

  record(build: (seq: number) => HostEvent): HostEvent {
    const event = build(this.nextSeq);
    this.nextSeq += 1;
    this.events.push(event);
    return event;
  }

  eventsSince(seq: number): HostEvent[] {
    return this.events.filter(event => eventSeq(event) > seq);
  }

  get nextSequence(): number {
    return this.nextSeq;
  }
}

export function eventSeq(event: HostEvent): number {
  if ("seq" in event && typeof event.seq === "number") {
    return event.seq;
  }
  return 0;
}
