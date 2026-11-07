// Skunk Watch: grid snapping.
//
// Geohash, implemented here rather than pulled in, because it is 60 lines and
// both the Worker and the browser need it.
//
// Why geohash and not random offsets: snapping is deterministic, so a person
// reporting three times from the same house produces the same cell every time.
// Random jitter would produce three offsets around their true position, and
// averaging those recovers it. See SPEC.md non-negotiable 10.
//
// Cell sizes at Hamilton's latitude:
//   precision 7  ~153 m x 153 m   stored for sightings and roadkill
//   precision 6  ~1.2 km x 0.6 km stored for smell, and used for all display
//   precision 4  ~39 km x 20 km   the unit a client asks the server for

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export const PRECISION = {
  point: 7,   // a sighting: you saw the animal, so you know where it was
  diffuse: 6, // a smell: spray carries, so the position is much vaguer
  display: 6, // what the map draws, coarser than what is stored
  region: 4,  // what a client requests, a city-sized box
};

export function encodeGeohash(lat, lon, precision = PRECISION.point) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError(`encodeGeohash: latitude ${lat} out of range`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new RangeError(`encodeGeohash: longitude ${lon} out of range`);
  }
  if (!Number.isInteger(precision) || precision < 1 || precision > 12) {
    throw new RangeError(`encodeGeohash: precision ${precision} out of range`);
  }

  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  let hash = '', bits = 0, bitCount = 0, evenBit = true;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) { bits = (bits << 1) | 1; lonMin = mid; } else { bits <<= 1; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { bits = (bits << 1) | 1; latMin = mid; } else { bits <<= 1; latMax = mid; }
    }
    evenBit = !evenBit;
    if (++bitCount === 5) {
      hash += BASE32[bits];
      bits = 0;
      bitCount = 0;
    }
  }
  return hash;
}

// The rectangle a cell covers, which is what the map draws. Drawing the
// rectangle rather than a point at its centre is deliberate: a dot would
// recreate the precision the snapping just removed.
export function geohashBounds(hash) {
  if (typeof hash !== 'string' || hash.length === 0) {
    throw new RangeError('geohashBounds: expected a non-empty geohash string');
  }
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180, evenBit = true;

  for (const ch of hash.toLowerCase()) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new RangeError(`geohashBounds: "${ch}" is not a geohash character`);
    for (let b = 4; b >= 0; b--) {
      const bit = (idx >> b) & 1;
      if (evenBit) {
        const mid = (lonMin + lonMax) / 2;
        if (bit) lonMin = mid; else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bit) latMin = mid; else latMax = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { minLat: latMin, maxLat: latMax, minLon: lonMin, maxLon: lonMax };
}

export function geohashCentre(hash) {
  const b = geohashBounds(hash);
  return { lat: (b.minLat + b.maxLat) / 2, lon: (b.minLon + b.maxLon) / 2 };
}

const EARTH_RADIUS_M = 6371000;
const rad = Math.PI / 180;

export function metresBetween(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Size of a cell in metres, for checking that a precision means what we think.
export function cellSizeMetres(hash) {
  const b = geohashBounds(hash);
  return {
    width: metresBetween(b.minLat, b.minLon, b.minLat, b.maxLon),
    height: metresBetween(b.minLat, b.minLon, b.maxLat, b.minLon),
  };
}

// The region cells a map viewport overlaps. A client asks for whole regions
// rather than sending its own position, so the server never learns where the
// viewer is beyond "somewhere in this city-sized box". See SPEC.md, Querying.
export function regionsForBounds({ minLat, maxLat, minLon, maxLon }, precision = PRECISION.region) {
  const probe = encodeGeohash(minLat, minLon, precision);
  const { width, height } = cellSizeMetres(probe);
  const latStep = (height / EARTH_RADIUS_M) / rad / 2;
  const lonStep = (width / (EARTH_RADIUS_M * Math.cos(((minLat + maxLat) / 2) * rad))) / rad / 2;

  const found = new Set();
  for (let lat = minLat; lat <= maxLat + latStep; lat += latStep) {
    for (let lon = minLon; lon <= maxLon + lonStep; lon += lonStep) {
      found.add(encodeGeohash(Math.min(lat, 90), Math.min(lon, 180), precision));
    }
  }
  found.add(encodeGeohash(maxLat, maxLon, precision));
  return [...found].sort();
}
