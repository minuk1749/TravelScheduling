import { expect, type Page } from '@playwright/test';

export type ProbeMarker = { title: string; state: 'placed' | 'wish' | 'unplaced'; name: string };

/**
 * Replaces `google.maps.importLibrary` (what `@googlemaps/js-api-loader` delegates to) with a recording stub.
 * GoogleResultMap and the real share page run unchanged; the stub only records the markers that the adapter actually creates.
 */
export async function installMapsDouble(page: Page) {
  await page.addInitScript(() => {
    type Handler = () => void;
    type Marker = { title: string; content: HTMLElement; handlers: Handler[] };
    const live = new Set<Marker>();
    const probe = { mounts: 0, markers: () => [...live].map(m => ({ title: m.title, className: m.content.className, text: m.content.textContent ?? '' })) };
    (window as unknown as { __mapsProbe: typeof probe }).__mapsProbe = probe;
    class FakeMap { constructor(public element: HTMLElement) { probe.mounts++; } fitBounds() {} }
    class FakeBounds { extend() {} }
    class FakeMarker {
      private record: Marker;
      constructor(options: { map: FakeMap; content: HTMLElement; title: string }) {
        this.record = { title: options.title, content: options.content, handlers: [] };
        options.map.element.append(options.content); live.add(this.record);
      }
      addListener(_event: string, handler: Handler) { this.record.handlers.push(handler); return { remove: () => { this.record.handlers = this.record.handlers.filter(item => item !== handler); } }; }
      set map(value: FakeMap | null) { if (value === null) { live.delete(this.record); this.record.content.remove(); } }
    }
    const libraries: Record<string, unknown> = { maps: { Map: FakeMap }, marker: { AdvancedMarkerElement: FakeMarker }, core: { LatLngBounds: FakeBounds } };
    (window as unknown as { google: unknown }).google = { maps: { importLibrary: async (name: string) => libraries[name] } };
  });
}

/** Markers currently on the (stub) map as the adapter rendered them: `{ name, state }` taken from the marker element itself. */
export async function mapMarkers(page: Page): Promise<ProbeMarker[]> {
  const raw = await page.evaluate(() => (window as unknown as { __mapsProbe: { markers(): { title: string; className: string; text: string }[] } }).__mapsProbe.markers());
  return raw.map(({ title, className, text }) => ({
    title, name: text.replace(/^\S+\s\S+\s/, ''),
    state: className.match(/marker-(placed|wish|unplaced)/)![1] as ProbeMarker['state'],
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function expectMarkers(page: Page, expected: Record<string, ProbeMarker['state']>) {
  await expect.poll(async () => Object.fromEntries((await mapMarkers(page)).map(m => [m.name, m.state])), { message: 'map markers' }).toEqual(expected);
}
