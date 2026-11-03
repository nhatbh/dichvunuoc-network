import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';

let registered = false;

/**
 * VN-2000 / UTM zone 48N (EPSG:3405 & EPSG:9210). Ported from the proven
 * gis-fe adapter so real Vietnamese data projects correctly in a later slice.
 */
export function registerVietnamCrs(): void {
  if (registered) return;
  const utm48n =
    '+proj=utm +zone=48 +ellps=WGS84 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
  proj4.defs('EPSG:3405', utm48n);
  proj4.defs('EPSG:9210', utm48n);
  register(proj4);
  registered = true;
}
