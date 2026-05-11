window.KakaoLocal = (() => {
  const DISTRICT_COORDS = {
    '강남':       { lat: 37.4979, lng: 127.0276 },
    '홍대·합정':  { lat: 37.5563, lng: 126.9239 },
    '이태원·한남':{ lat: 37.5344, lng: 126.9997 },
    '성수':       { lat: 37.5447, lng: 127.0558 },
    '인사동·북촌':{ lat: 37.5758, lng: 126.9853 },
    '여의도·마포':{ lat: 37.5219, lng: 126.9245 },
    '건대·군자':  { lat: 37.5403, lng: 127.0694 },
    '신촌·연세로':{ lat: 37.5591, lng: 126.9369 },
  };

  function waitForSDK(timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    return new Promise(function(resolve, reject) {
      var deadline = Date.now() + timeoutMs;
      (function check() {
        if (window.kakao && window.kakao.maps && window.kakao.maps.LatLng &&
            window.kakao.maps.services && window.kakao.maps.services.Places) {
          resolve();
        } else if (Date.now() >= deadline) {
          reject(new Error('timeout'));
        } else {
          setTimeout(check, 200);
        }
      })();
    });
  }

  function sdkCategorySearch(code, lat, lng, radius, size) {
    return new Promise(function(resolve) {
      try {
        var ps = new kakao.maps.services.Places();
        ps.categorySearch(code, function(data, status) {
          if (status === kakao.maps.services.Status.OK && Array.isArray(data)) resolve(data);
          else resolve([]);
        }, { location: new kakao.maps.LatLng(lat, lng), radius: radius, size: size });
      } catch (e) { resolve([]); }
    });
  }

  function sdkKeywordSearch(query, lat, lng, radius, size) {
    return new Promise(function(resolve) {
      try {
        var ps = new kakao.maps.services.Places();
        ps.keywordSearch(query, function(data, status) {
          if (status === kakao.maps.services.Status.OK && Array.isArray(data)) resolve(data);
          else resolve([]);
        }, { location: new kakao.maps.LatLng(lat, lng), radius: radius, size: size });
      } catch (e) { resolve([]); }
    });
  }

  function toPlace(doc, category) {
    return { name: doc.place_name, address: doc.road_address_name || doc.address_name || '', category: category, x: doc.x, y: doc.y, place_url: doc.place_url || '' };
  }

  function dedup(places) {
    var seen = {};
    return places.filter(function(p) { if (seen[p.name]) return false; seen[p.name] = true; return true; });
  }

  async function getPlacesForArea(district) {
    var coords = DISTRICT_COORDS[district];
    if (!coords) return null;
    try { await waitForSDK(); } catch (_) { console.warn('[KakaoLocal] SDK 로드 실패'); return null; }
    var lat = coords.lat, lng = coords.lng, R = 1000;
    var results;
    try {
      results = await Promise.all([
        sdkCategorySearch('FD6', lat, lng, R, 15),
        sdkCategorySearch('CE7', lat, lng, R, 12),
        sdkCategorySearch('AT4', lat, lng, R, 10),
        sdkCategorySearch('CT1', lat, lng, R, 8),
        sdkKeywordSearch(district + ' 팝업스토어', lat, lng, R, 5),
      ]);
    } catch (_) { return null; }
    var result = {
      restaurants: dedup(results[0].map(function(d) { return toPlace(d, 'restaurant'); })),
      cafes:       dedup(results[1].map(function(d) { return toPlace(d, 'cafe'); })),
      attractions: dedup(results[2].map(function(d) { return toPlace(d, 'attraction'); }).concat(results[3].map(function(d) { return toPlace(d, 'attraction'); }))),
      events:      dedup(results[4].map(function(d) { return toPlace(d, 'event'); })),
    };
    var total = result.restaurants.length + result.cafes.length + result.attractions.length + result.events.length;
    console.log('[KakaoLocal] 결과 - 음식점:', result.restaurants.length, '카페:', result.cafes.length, '관광:', result.attractions.length, '이벤트:', result.events.length);
    return total > 0 ? result : null;
  }

  function buildIndexedData(realPlaces) {
    var refMap = {};
    var sections = [];
    function index(arr, prefix, category) {
      if (!arr.length) return;
      var labelMap = { R: '음식점·맛집', C: '카페·디저트', A: '관광명소·문화시설', E: '팝업스토어·행사' };
      var lines = arr.map(function(place, i) {
        var ref = prefix + (i + 1);
        refMap[ref] = Object.assign({}, place, { category: category });
        return '[' + ref + '] ' + place.name;
      });
      sections.push(labelMap[prefix] + ':\n' + lines.join('\n'));
    }
    index(realPlaces.restaurants, 'R', 'restaurant');
    index(realPlaces.cafes, 'C', 'cafe');
    index(realPlaces.attractions, 'A', 'attraction');
    index(realPlaces.events, 'E', 'event');
    return { text: '[카카오맵 실시간 검색 결과]\n\n' + sections.join('\n\n'), refMap: refMap };
  }

  return { getPlacesForArea, buildIndexedData, DISTRICT_COORDS };
})();
