import { JSDOM } from 'jsdom';

const DOM_GLOBALS = ['self', 'window', 'document', 'navigator', 'HTMLElement', 'Element', 'MutationObserver'] as const;
/** React's Scheduler re-posts its work loop with setImmediate after each 5 ms slice; a few turns cover a slow CI host. */
const SCHEDULER_DRAIN_TURNS = 5;

export interface InstalledDom {
  readonly window: JSDOM['window'];
  /** Waits for already-queued scheduler work (e.g. passive-effect flushes that read `window.event`), then restores globals. */
  restore(): Promise<void>;
}

async function drainImmediateQueue() {
  for (let turn = 0; turn < SCHEDULER_DRAIN_TURNS; turn++) await new Promise<void>(resolve => setImmediate(resolve));
}

/** Installs a jsdom window as the test process globals for one React UI test. Call `cleanup()` before `restore()`. */
export function installDom(url: string): InstalledDom {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url });
  const previous = DOM_GLOBALS.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const name of DOM_GLOBALS) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  return {
    window: dom.window,
    async restore() {
      await drainImmediateQueue();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      dom.window.close();
    },
  };
}
