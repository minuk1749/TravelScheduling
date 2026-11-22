// Preloaded into the Next.js server (`node --import`) by playwright.config.ts. It answers the server-side
// calls that would otherwise reach Google (OAuth/OpenID, Places, Routes) with deterministic local data, so
// the real Auth.js, route handlers, services and PostgreSQL run unchanged. Test-only: nothing in src/ imports it.
import { createSign, generateKeyPairSync } from 'node:crypto';
import { shapeResponse } from '../../fixtures/route-shapes.ts';

const realFetch = globalThis.fetch;
const CLIENT_ID = process.env.AUTH_GOOGLE_ID ?? 'e2e-client';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e-key', alg: 'RS256', use: 'sig' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** Tokens issued by the fake authorization endpoint: `code` carries the nonce the browser double read from the URL. */
function idToken(nonce) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'e2e-key' })}.${b64({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'e2e-google-user', email: 'e2e-traveler@example.test',
    email_verified: true, iat: now, exp: now + 3600, ...(nonce ? { nonce } : {}),
  })}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(privateKey, 'base64url')}`;
}

async function oauth(url, init) {
  if (url.pathname === '/.well-known/openid-configuration') {
    return json({
      issuer: 'https://accounts.google.com', authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: 'https://oauth2.googleapis.com/token', jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
      userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo', response_types_supported: ['code'],
      subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
    });
  }
  if (url.pathname === '/oauth2/v3/certs') return json({ keys: [jwk] });
  if (url.pathname === '/token') {
    const code = new URLSearchParams(String(init?.body)).get('code') ?? '';
    const nonce = code.startsWith('e2e-code.') ? Buffer.from(code.slice(9), 'base64url').toString() : '';
    return json({ access_token: 'e2e-access', token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile', id_token: idToken(nonce) });
  }
  return json({ error: 'unexpected OAuth request' }, 404);
}

// Tokyo landmarks (same data as tests/fixtures/itinerary.ts) with weekly opening hours [open, close].
const place = (id, name, latitude, longitude, hours) => ({ id, name, latitude, longitude, hours });
const CATALOG = [
  place('sample-haneda-airport', 'Haneda Airport', 35.5494, 139.7798),
  place('sample-ginza-hotel', 'Ginza Hotel', 35.6717, 139.7650),
  place('sample-sensoji', 'Senso-ji Temple', 35.7148, 139.7967, ['06:00', '17:00']),
  place('sample-skytree', 'Tokyo Skytree', 35.7101, 139.8107, ['10:00', '21:00']),
  place('sample-meiji-jingu', 'Meiji Jingu', 35.6764, 139.6993, ['06:40', '16:20']),
  place('sample-shibuya-sky', 'Shibuya Sky', 35.6585, 139.7020, ['10:00', '22:30']),
  place('sample-tsukiji-market', 'Tsukiji Market', 35.6655, 139.7707, ['06:00', '14:00']),
  place('sample-tokyo-tower', 'Tokyo Tower', 35.6586, 139.7454, ['09:00', '22:30']),
  place('sample-ueno-museum', 'Ueno Museum', 35.7188, 139.7765, ['09:30', '17:00']),
  place('sample-teamlab', 'teamLab Planets', 35.6491, 139.7898, ['09:00', '22:00']),
];
const attributions = [{ provider: 'Test Provider', providerUri: 'https://example.test/source' }];
const point = (day, time) => ({ day, hour: Number(time.slice(0, 2)), minute: Number(time.slice(3)) });

function places(url, init) {
  if (url.pathname === '/v1/places:searchText') {
    const query = String(JSON.parse(init.body).textQuery).toLowerCase();
    return json({ places: CATALOG.filter(item => item.name.toLowerCase().includes(query))
      .map(item => ({ id: item.id, displayName: { text: item.name, languageCode: 'en' }, attributions })) });
  }
  const item = CATALOG.find(entry => url.pathname === `/v1/places/${entry.id}`);
  if (!item) return json({ error: { status: 'NOT_FOUND' } }, 404);
  return json({
    id: item.id, displayName: { text: item.name, languageCode: 'en' }, location: { latitude: item.latitude, longitude: item.longitude },
    types: [], attributions, businessStatus: 'OPERATIONAL',
    ...(item.hours ? { regularOpeningHours: { periods: [0, 1, 2, 3, 4, 5, 6].map(day => ({ open: point(day, item.hours[0]), close: point(day, item.hours[1]) })) } } : {}),
  });
}

const kilometres = (a, b) => {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
// Like tests/fixtures/itinerary.ts, but transit has a 30-minute wait so a taxi beats it and the PREFER policy is observable.
const MODE_SPEED = { WALK: [0, 4.8], TRANSIT: [30, 22], DRIVE: [4, 24] };
/** Evening transit departures run 3 minutes slower than the representative matrix. */
function estimate(from, to, mode, departure) {
  const km = kilometres(from, to), [base, speed] = MODE_SPEED[mode];
  const tokyoHour = departure ? (new Date(departure).getUTCHours() + 9) % 24 : 0;
  const seconds = Math.round((base + km / speed * 60) * 60) + (mode === 'TRANSIT' && departure && tokyoHour >= 17 ? 180 : 0);
  return {
    duration: `${seconds}s`, distanceMeters: Math.round(km * (mode === 'WALK' ? 1250 : 1300)),
    ...(mode === 'TRANSIT' ? { travelAdvisory: { transitFare: { currencyCode: 'JPY', units: String(180 + 30 * Math.ceil(km)), nanos: 0 } } } : {}),
  };
}
const latLng = waypoint => waypoint.location.latLng;

function routes(url, init) {
  const body = JSON.parse(init.body);
  if (url.pathname === '/distanceMatrix/v2:computeRouteMatrix') {
    return json(body.origins.flatMap((origin, originIndex) => body.destinations.map((destination, destinationIndex) => ({
      originIndex, destinationIndex, status: {}, condition: 'ROUTE_EXISTS',
      ...estimate(latLng(origin.waypoint), latLng(destination.waypoint), body.travelMode, body.departureTime),
    }))));
  }
  if (url.pathname === '/directions/v2:computeRoutes') {
    if (body.polylineEncoding === 'ENCODED_POLYLINE') return json(shapeResponse);
    return json({ routes: [estimate(latLng(body.origin), latLng(body.destination), body.travelMode, body.departureTime)] });
  }
  return json({ error: 'unexpected Routes request' }, 404);
}

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url ?? String(input));
  const options = init ?? (request ? { method: request.method, body: await request.clone().text() } : undefined);
  if (['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'].includes(url.hostname)) return oauth(url, options);
  if (url.hostname === 'places.googleapis.com') return places(url, options);
  if (url.hostname === 'routes.googleapis.com') return routes(url, options);
  return realFetch(input, init);
};
