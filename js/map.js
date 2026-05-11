window.DateRouteMap = (() => {
  let mapInstance = null, markers = [], polyline = null, infoWindows = [], containerId = null;

  function isKakaoReady() { return typeof kakao !== 'undefined' && kakao.maps && kakao.maps.Map; }

  function waitForKakao(timeout) {
    return new Promise((resolve, reject) => {
      if (isKakaoReady()) { resolve(); return; }
      const deadline = Date.now() + timeout;
      const interval = setInterval(() => {
        if (isKakaoReady()) { clearInterval(interval); resolve(); }
        else if (Date.now() >= deadline) { clearInterval(interval); reject(new Error('timeout')); }
      }, 100);
    });
  }

  function buildMarkerContent(order) {
    return `<div style="width:32px;height:32px;border-radius:50%;background:#FF6B6B;color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.25);border:2px solid #fff">${order}</div>`;
  }

  function geocodeAddress(geocoder, address) {
    return new Promise((resolve) => {
      geocoder.addressSearch(address, (results, status) => {
        if (status === kakao.maps.services.Status.OK && results.length > 0) resolve({ lat: parseFloat(results[0].y), lng: parseFloat(results[0].x) });
        else resolve(null);
      });
    });
  }

  async function init(id) {
    containerId = id;
    try { await waitForKakao(8000); } catch (_) { return; }
    const container = document.getElementById(id);
    if (!container) return;
    if (mapInstance) { mapInstance.setCenter(new kakao.maps.LatLng(37.5665, 126.9780)); mapInstance.setLevel(5); return; }
    mapInstance = new kakao.maps.Map(container, { center: new kakao.maps.LatLng(37.5665, 126.9780), level: 5 });
  }

  async function renderCourse(places) {
    if (!isKakaoReady() || !mapInstance) return;
    clear();
    const geocoder = new kakao.maps.services.Geocoder();
    const bounds = new kakao.maps.LatLngBounds();
    const pathCoords = [];
    const geoResults = await Promise.all(places.map((p) => geocodeAddress(geocoder, p.address)));
    for (let i = 0; i < places.length; i++) {
      const place = places[i], coords = geoResults[i];
      if (!coords) continue;
      const position = new kakao.maps.LatLng(coords.lat, coords.lng);
      bounds.extend(position);
      pathCoords.push(position);
      const marker = new kakao.maps.Marker({ position, map: mapInstance, title: place.name, image: new kakao.maps.MarkerImage('data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'), new kakao.maps.Size(1, 1)) });
      const overlayDiv = document.createElement('div');
      overlayDiv.innerHTML = buildMarkerContent(place.order);
      overlayDiv.style.cursor = 'pointer';
      const customOverlay = new kakao.maps.CustomOverlay({ position, content: overlayDiv, map: mapInstance, zIndex: 3 });
      markers.push(customOverlay);
      const infoWindow = new kakao.maps.InfoWindow({ content: `<div style="padding:6px 10px;font-size:12px;font-weight:700;white-space:nowrap;border-radius:6px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.15);margin-bottom:4px">${place.name}</div>`, removable: true });
      infoWindows.push(infoWindow);
      kakao.maps.event.addListener(marker, 'click', () => { infoWindows.forEach((iw) => iw.close()); infoWindow.open(mapInstance, marker); });
      overlayDiv.addEventListener('click', () => { infoWindows.forEach((iw) => iw.close()); infoWindow.open(mapInstance, marker); });
    }
    if (pathCoords.length >= 2) polyline = new kakao.maps.Polyline({ path: pathCoords, strokeWeight: 3, strokeColor: '#4ECDC4', strokeOpacity: 0.85, strokeStyle: 'solid', map: mapInstance });
    if (pathCoords.length > 0) mapInstance.setBounds(bounds, 60, 60, 60, 60);
  }

  function clear() {
    markers.forEach((m) => { if (m.setMap) m.setMap(null); });
    markers = [];
    infoWindows.forEach((iw) => iw.close());
    infoWindows = [];
    if (polyline) { polyline.setMap(null); polyline = null; }
  }

  return { init, renderCourse, clear };
})();
