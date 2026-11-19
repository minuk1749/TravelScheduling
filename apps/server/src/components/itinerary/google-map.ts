/// <reference types="google.maps" />
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { MARKER_LABELS, type MapMarker } from '../../results/presentation';

/** The only browser Maps adapter. No server Places/Routes credentials are used here. */
export class GoogleResultMap {
  private static configured = false;
  private map?: google.maps.Map;
  private markers: google.maps.marker.AdvancedMarkerElement[] = [];
  private listeners: google.maps.MapsEventListener[] = [];
  async mount(element: HTMLElement, points: readonly MapMarker[], select: (id: string) => void, signal: AbortSignal) {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
    if (!key || !mapId) throw new Error('지도를 설정하지 않았습니다. 아래 장소 목록에서 날짜를 지정할 수 있습니다.');
    if (!GoogleResultMap.configured) {
      setOptions({ key, v: 'weekly', language: 'ko' });
      GoogleResultMap.configured = true;
    }
    const [{ Map }, { AdvancedMarkerElement }, { LatLngBounds }] = await Promise.all([importLibrary('maps'), importLibrary('marker'), importLibrary('core')]);
    if (signal.aborted) return;
    this.map = new Map(element, { mapId, center: { lat: 0, lng: 0 }, zoom: 12, streetViewControl: false, mapTypeControl: false });
    const bounds = new LatLngBounds();
    for (const point of points) {
      const position = { lat: point.coordinates.latitude, lng: point.coordinates.longitude };
      const content = document.createElement('span');
      content.className = `result-marker marker-${point.state.toLowerCase()}`;
      content.textContent = `${MARKER_LABELS[point.state]} ${point.name}`;
      const marker = new AdvancedMarkerElement({ map: this.map, position, content, title: `${MARKER_LABELS[point.state]} ${point.name}` });
      this.listeners.push(marker.addListener('click', () => select(point.id)));
      this.markers.push(marker); bounds.extend(position);
    }
    if (points.length) this.map.fitBounds(bounds, 50);
  }
  dispose() {
    this.listeners.forEach(listener => listener.remove());
    this.markers.forEach(marker => { marker.map = null; });
    this.markers = []; this.listeners = []; this.map = undefined;
  }
}
