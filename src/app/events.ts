import type { DomainEvent } from '../core/types';

/** Typed pub/sub bus: core domain events → presentation/diagnostics. One-way. */
export type EventHandler = (e: DomainEvent) => void;

export class EventBus {
  private handlers: EventHandler[] = [];

  subscribe(fn: EventHandler): () => void {
    this.handlers.push(fn);
    return () => {
      const i = this.handlers.indexOf(fn);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  publish(e: DomainEvent): void {
    for (const fn of this.handlers) fn(e);
  }
}
