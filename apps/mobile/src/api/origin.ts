function isLocalDevelopmentHost(host: string): boolean {
  if (host === 'localhost' || host === '[::1]') return true;
  const octets = host.split('.');
  if (octets.length !== 4 || !octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false;
  const [first, second] = octets.map(Number);
  return first === 127 || first === 10 || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function apiOrigin(address: string): string {
  let base: URL;
  try { base = new URL(address); } catch {
    throw new Error('서버 주소 설정을 확인해 주세요.');
  }
  const localHttp = __DEV__ && base.protocol === 'http:' && isLocalDevelopmentHost(base.hostname);
  if ((base.protocol !== 'https:' && !localHttp) || base.username || base.password
    || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('서버 주소 설정을 확인해 주세요.');
  }
  return base.origin;
}
