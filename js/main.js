/*eslint strict: ["error", "global"]*/
/*global L, UESaveObject*/
/*global layerConfigs*/
/*global gameClasses,  defaultGameClass, decodeIconName, getClassIcon, getObjectIcon*/

// Terminology,
// Class - The type of object represented by marker. Based on UE4 classes/blueprints 
// Layer - a toggleable set of data on the map (base map, overlays, groups of markers)
//         Leaflet calls it a LayerGroup 
// Marker - An individual icon displayed on the map with a specific position

var map = null;         // Leaflet map object containing current game map and all its markers
var mapId = '';         // Current map selected (one of sl, slc or siu)

// Data we store in the HTML Window localStorage property 
// Current mapId, markedItems[{markerId}:true] (found), activeLayers[{layer}:true] and playerPosition
const localDataName = 'supgragamescommunity_maps';
let localData = JSON.parse(localStorage.getItem(localDataName)) || {};

let layers = {};        // Leaflet layerGroup array, one for each collection of markers
let icons = {};         // Dict of Leaflet icon obj, defSize, size  keyed by our icon file basename + size
let playerStart;        // Position of first player start instance found in map data
let playerMarker;       // Leaflet marker object for current player start (or dragged position)

let reloading;          // Flag used to prevent triggering reloading while already in progress

let settings;           // Reference to localData[mapId]
let mapCenter;
let mapParam = {};      // Parameters extracted from map URL
let searchControl = {}; // Leaflet control for searching

// Hard coded map data extracted from the games
var maps = {
  // data taken from the MapWorld* nodes
  'sl':  { 
      title: 'Supraland',
      "MapWorldCenter": { "X": 13000.0, "Y": -2000.0, "Z": 0.0 },
      "MapWorldSize": 175000.0,
      "MapWorldUpperLeft": { "X": -74500.0, "Y": -89500.0, "Z": 0.0 },
      "MapWorldLowerRight": { "X": 100500.0, "Y": 85500.0, "Z": 0.0 },
   },

  'slc': {
    title: 'Supraland Crash',
      "MapWorldCenter": { "X": 25991.0, "Y": -16.0, "Z": 0.0  },
      "MapWorldSize": 90112.0,
      "MapWorldUpperLeft": { "X": -19065.0, "Y": -45040.0, "Z": 0.0 },
      "MapWorldLowerRight": { "X": 71047.0, "Y": 45072.0, "Z": 0.0 },
   },

  'siu': {
      title: 'Supraland Six Inches Under',
      "MapWorldCenter": { "X": 0.0, "Y": -19000.0, "Z": 10000.0 },
      "MapWorldSize": 147456.0,
      "MapWorldUpperLeft": { "X": -73728.0, "Y": -92728.0, "Z": 10000.0 },
      "MapWorldLowerRight": { "X": 73728.0, "Y": 54728.0, "Z": 10000.0 },
   },
};

// Save the local state data we track to the window local storage
function saveSettings() {
  localStorage.setItem(localDataName, JSON.stringify(localData));
}

// Called when the search is cleared/cancelled to update searchText, save change
// and reflect changes in current marker draw state
function clearFilter() {
  settings.searchText = '';
  saveSettings();
  markItems();
}

// Generate our URL format based on current state
// {base url}#map={sl|slc|siu}&lat={lat}&lng={lng}
function getViewURL() {
  let base = window.location.href.replace(/#.*$/,'');
  let p = map.getCenter();
  let vars = {mapId:mapId, lat:Math.round(p.lat), lng:Math.round(p.lng), zoom:map.getZoom()};
  return base +'#' + Object.entries(vars).map(e=>e[0]+'='+encodeURIComponent(e[1])).join('&');
}

function copyToClipboard(text) {
  let input = document.body.appendChild(document.createElement("input"));
  input.value = text;
  input.focus();
  input.select();
  document.execCommand('copy');
  input.parentNode.removeChild(input);
  //console.log(text + ' copied to clipboard');
}

function openLoadFileDialog() {
  document.querySelector('#file').value = null;
  document.querySelector('#file').accept = '.sav';
  document.querySelector('#file').click();
}

// Called when Window loads and when base map changes, loads currently select mapId
function loadMap(id) {

  mapId = id;

  // Make sure localStorage contains a good set of defaults
  for (let id in maps) {
    //var title = maps[id].title;
    if (!localData[id]) {
      localData[id] = {};
    }
    if (!localData[id].markedItems) {
      localData[id].markedItems = {};
    }
    if (!localData[id].searchText) {
      localData[id].searchText = '';
    }
    if (!localData[id].activeLayers) {
      localData[id].activeLayers = layerConfigs.getDefaultActive(mapId);
    }
  }

  localData.mapId = mapId;
  saveSettings();

  settings = localData[mapId];

  icons = {}
  //console.log(localData);

  var mapSize = {width: 8192, height: 8192}
  var tileSize   = {x: 512, y: 512};
  var tileMaxSet = 4;
  var mapMinResolution = Math.pow(2, tileMaxSet);

  document.querySelector('#map').style.backgroundColor = mapId=='siu' ? '#141414' : '#000';

  var p = maps[mapId];

  // fixes 404 errors
  p.MapWorldUpperLeft.X  += 1;
  p.MapWorldUpperLeft.Y += 1;
  p.MapWorldLowerRight.X -= 1;
  p.MapWorldLowerRight.Y -= 1;

  let mapBounds = [
    [ p.MapWorldUpperLeft.Y, p.MapWorldUpperLeft.X ],
    [ p.MapWorldLowerRight.Y, p.MapWorldLowerRight.X ]
  ];

  let gap = p.MapWorldSize/2;
  let mapBoundsWithGap = [
    [ p.MapWorldUpperLeft.Y - gap, p.MapWorldUpperLeft.X - gap ],
    [ p.MapWorldLowerRight.Y + gap, p.MapWorldLowerRight.X + gap ]
  ];

  var m = p.MapWorldSize / mapSize.width;
  var mapScale   = {x: 1.0/m, y: 1.0/m};
  var mapOrigin  = {x: -p.MapWorldUpperLeft.X * mapScale.x, y: -p.MapWorldUpperLeft.Y * mapScale.y};

  // Create a coordinate system for the map
  var crs = L.CRS.Simple;
  crs.transformation = new L.Transformation(mapScale.x, mapOrigin.x, mapScale.y, mapOrigin.y);
  crs.scale = function (zoom) { return Math.pow(2, zoom) / mapMinResolution; };
  crs.zoom = function (scale) { return Math.log(scale * mapMinResolution) / Math.LN2; };

  mapCenter = [p.MapWorldCenter.Y, p.MapWorldCenter.X];

  // Create the base map
  map = new L.Map('map', {
    crs: crs,
    fadeAnimation: false,
	minZoom: 1,
    maxZoom: 8,
    maxBounds: mapBoundsWithGap, // elastic-y bounds
    zoomControl: false,
    doubleClickZoom: false,
  });

  L.control.zoom({ position: 'bottomright'}).addTo(map);
  L.control.fullscreen({ position: 'bottomright', forceSeparateButton: true}).addTo(map);

  let layerOptions = {
      tileSize: L.point(tileSize.x, tileSize.y),
      noWrap: true,
      tms: false,
      updateInterval: -1,
      keepBuffer: 16,
      maxNativeZoom: 4,
      nativeZooms: [0, 1, 2, 3, 4],
      bounds: mapBounds,
      attribution: '<a href="https://github.com/SupraGamesCommunity/maps" target="_blank">SupraGames Community</a>',
  };

  let layerControl = L.control.layers({}, {}, {
    collapsed: true,
    position: 'topright',
  });

  // eslint-disable-next-line no-unused-vars
  map.on('moveend zoomend', function(e) {
    settings.center = [map.getCenter().lat, map.getCenter().lng]; // avoid circular refs here
    settings.zoom = map.getZoom();
    saveSettings();
    if(e.type == 'zoomend'){
      resizeIcons();
    updatePolylines();
    markItems();
    }
});

  map.on('baselayerchange', function(e) {
    location.hash = '';
    map.off();
    map.remove();
    map = null;
    playerMarker = null;
    loadMap(e.layer.mapId);
  });

  function updatePolylines() {
    // set alt for polylines (attributes are not populated to paths)
    for (const m of Object.values(map._layers)) {
      if ((p = m._path)) {
        p.setAttribute('alt', m.options.alt);
      }
    }
  }

  map.on('overlayadd', function(e) {
    settings.activeLayers[e.layer.id] = true;
    updatePolylines();
    markItems();
    saveSettings();
    resizeIcons(true);

    // let's maybe clear search on layer change just to avoid confusion
    clearFilter();
  });

  map.on('overlayremove', function(e) {
    delete settings.activeLayers[e.layer.id];
    markItems();
    saveSettings();
  });

  let tilesDir = 'tiles/'+mapId;

  // L.tileLayer.canvas() is much faster than L.tileLayer() but requires a L.TileLayer.Canvas plugin
  // canvas also fixes a visible line between tiles
  // However on Firefox it makes the lines much worsel, so we choose based on which browser
  const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

  let baseLayer;
  if(isFirefox)
    baseLayer = L.tileLayer(tilesDir+'/base/{z}/{x}/{y}.jpg', layerOptions).addTo(map);
  else
    baseLayer = L.tileLayer.canvas(tilesDir+'/base/{z}/{x}/{y}.jpg', layerOptions).addTo(map);

  for (let id in maps) {
    var title = maps[id].title;
    var layer = id==mapId ? baseLayer : L.layerGroup();
    layer.mapId = id;
    layerControl.addBaseLayer(layer, title);
  }

  // Add overlay image map layers 
  layerConfigs.forEachOfType(mapId, "tiles", (layerId, layerConfig) => {
    let layer;
    if(isFirefox)
      layer = L.tileLayer(tilesDir+'/'+layerId+'/{z}/{x}/{y}.png', layerOptions);
    else
      layer = L.tileLayer.canvas(tilesDir+'/'+layerId+'/{z}/{x}/{y}.png', layerOptions);
    layer.id = layerId;
    if (settings.activeLayers[layerId]) {
      layer.addTo(map);
    }
    layerControl.addOverlay(layer, layerConfig.name);
  });

  L.control.mousePosition({numDigits:0, lngFirst:true}).addTo(map);

  if (mapParam.lat && mapParam.lng && mapParam.zoom) {
    map.setView([mapParam.lat, mapParam.lng], mapParam.zoom);
    mapParam = {};
  } else if (settings.center && settings.zoom) {
    map.setView(settings.center, settings.zoom);
  } else {
    map.fitBounds(mapBounds);
  }

  let subAction = L.Toolbar2.Action.extend({
    initialize:function(map,myAction){this.map=map;this.myAction=myAction;L.Toolbar2.Action.prototype.initialize.call(this);},
    addHooks:function(){ this.myAction.disable(); }
  });

  new L.Toolbar2.Control({
      position: 'bottomleft',
      actions: [
        // share button
        L.Toolbar2.Action.extend({
          options: {
            toolbarIcon:{html: '&#x1F517;', tooltip: 'Share'},
            subToolbar: new L.Toolbar2({ 
              actions: [
                subAction.extend({
                  options:{toolbarIcon:{html:'Copy Map View URL', tooltip: 'Copies View URL to Clipboard'}},
                  addHooks:function() {
                    copyToClipboard(getViewURL());
                    subAction.prototype.addHooks.call(this); // closes sub-action
                  }
                }),
                subAction.extend({
                  options:{toolbarIcon:{html:'&times;', tooltip: 'Close'}}
                }),
              ],
            })
          }
        }),
        // load game button
        L.Toolbar2.Action.extend({
          options: {
            toolbarIcon:{html: '&#x1F4C1;', tooltip: 'Load Game'},
            subToolbar: new L.Toolbar2({ 
              actions: [
                subAction.extend({
                  options:{toolbarIcon:{html:'Load Game', tooltip: 'Load game save (*.sav) to mark collected items (Alt+R)'}},
                  addHooks: function () {
                    openLoadFileDialog();
                    subAction.prototype.addHooks.call(this);
                  }
                }),
                subAction.extend({
                  options:{toolbarIcon:{html:'Copy Path', tooltip: 'Copy default Windows game save file path to clipboard'}},
                  addHooks:function() {
                    copyToClipboard('%LocalAppData%\\Supraland'+(mapId=='siu' ? 'SIU':'')+'\\Saved\\SaveGames');
                    subAction.prototype.addHooks.call(this);
                  }
                }),
                subAction.extend({
                  options:{toolbarIcon:{html:'Unmark All', tooltip: 'Unmark all items'}},
                  addHooks: function () { 
                    if (confirm('Are you sure to unmark all items?')) {
                      unmarkItems();
                      saveSettings();
                    }
                    subAction.prototype.addHooks.call(this);
                  }
                }),
                subAction.extend({
                  options:{toolbarIcon:{html:'&times;', tooltip: 'Close'}}
                }),
              ],
            })
          }
        }),
      ],
  }).addTo(map);

  function onContextMenu(e) {
    let markerId = e.target.options.alt;
    let found = settings.markedItems[markerId]==true;
    window.markItemFound(markerId, !found);
    e.target.closePopup();
  }

  function onPopupOpen(e) {
    // We don't need to use _source as target and sourceTarget both point at the marker object

    let x = e.popup._source._latlng.lng;
    let y = e.popup._source._latlng.lat;
    let markerId = e.popup._source.options.alt;

    let res = null;
    let o = e.popup._source.options.o;
    
    let text = JSON.stringify(o, null, 2).replaceAll('\n','<br>').replaceAll(' ','&nbsp;');
    let found = settings.markedItems[markerId]==true
    let value = found ? 'checked' : '';

    //let base = window.location.href.replace(/#.*$/,'');
    //let vars = {mapId:mapId, lat:Math.round(map.getCenter().lat), lng:Math.round(map.getCenter().lng), zoom:map.getZoom()};
    //let url = base +'#' + Object.entries(vars).map(e=>e[0]+'='+encodeURIComponent(e[1])).join('&');
    //let a = '<a href="'+url+'" onclick="return false">Map URL</a>';

    // it's not "found" but rather "removed" (e.g. BuySword2_2 in the beginning of Crash DLC)
    text += '<br><br><input type="checkbox" id="'+markerId+'" '+value+' onclick=window.markItemFound("'+markerId+'",this.checked)><label for="'+markerId+'">Found</label>';

    if(o.yt_video) {
      let ytSrc = 'https://www.youtube.com/embed/' + o.yt_video + '?controls=0';
      if (o.yt_start) ytSrc += '&start=' + o.yt_start;
      if (o.yt_end) ytSrc += '&end=' + o.yt_end;

      text = text + '<iframe width="250" height="140.625" src="' + ytSrc
        + '" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>'

      //let yt_start = o.yt_start || 0
      //let url = 'https://youtu.be/'+o.yt_video+'&?t='+yt_start;
      // text = text + '<br><br><a href="'+url+'" target=_blank>'+url+'</a>');
    }
//    e.target.setIcon(e.target.options.icon);
    e.popup.setContent(text);
  }

  const price_types = {
    0: 'coin',
    5: 'scrap',
    6: 'bone',
    7: 'red moon',
  }

  function loadMarkers() {
    fetch('data/markers.'+mapId+'.json')
      .then((response) => response.json())
      .then((j) => {
        let titles = {};

        let enabledLayers = layerConfigs.getEnabledLayers(mapId) 
        for(let o of j) {

          // skip markers out of bounds (e.g. the whole start area of the red town in SIU is not painted on the map)
          let [[top,left],[bottom,right]] = mapBounds;
          if (! (o.lng>left && o.lng<right && o.lat>top && o.lat<bottom )) {
            continue;
          }

          let c = gameClasses[o.type] || defaultGameClass;
          let text = ''; // Set it on demand in onPopupOpen (as it's potentially slow for now)
          let alt = o.area + ':' + o.name
          let title = o.name;
          let radius = 6; // polyline dots

          // can't have duplicate titles in search (loses items) clarify duplicate titles
          title = titles[title] ? alt : title;
          titles[title] = title;

          // Add price, coins or spawns to title
          if(o.cost) {
            let price_type = (o.price_type in price_types ? o.price_type : 0);
            title += ` (${o.cost} ${price_types[price_type]}${o.cost != 1 && price_type != 5 ? 's':''})`  // No s on plural of scrap
          }
          else if(o.coins) {
            title += ` [${o.coins} coin${o.coins > 1 ? "s":""}]`;
          } else if(o.spawns) {
            //title += ` (${o.spawns.slice(o.spawns.startsWith("_") ? 1 : 0)})`;    // Remove leading _
            //title += ` (${o.spawns.split(':').reverse()[0]})`;                    // Remove subclass
            title += ` (${o.spawns})`
          }

          // add class name to title
          title += ' of ' + o.type;

          const defaultIcon = 'question_mark';

          if(c.nospoiler && enabledLayers[c.nospoiler])
          {
            const layer = c.nospoiler
            const layerConfig = layerConfigs.get(layer);
            const [icon, size] = decodeIconName(layerConfig.defaultIcon || defaultIcon);
            const zIndexOffset = 10 * layerConfig.index;

            L.marker([o.lat, o.lng], {icon: getIcon(icon, size), title: title, zIndexOffset: zIndexOffset, alt: alt, o:o, layerId:layer })
              .addTo(layers[layer]).bindPopup(text).on('popupopen', onPopupOpen).on('contextmenu', onContextMenu);
          }

          // For the spoiler version the marker config is based on the spawned data if it spawns and otherwise normal
          // Thus coinchest goes on coinchest config, but chest containing upgrade goes on upgrade layer
          let sc = o.spawns ? (gameClasses[o.spawns] || defaultGameClass) : c
          if(sc.layer && enabledLayers[sc.layer])
          {
            const layer = sc.layer
            const layerConfig = layerConfigs.get(layer);
            const [icon, size] = decodeIconName((o.icon || sc.icon || layerConfig.defaultIcon || defaultIcon), o.variant);
            const zIndexOffset = 10 * layerConfig.index;

            L.marker([o.lat, o.lng], {icon: getIcon(icon, size), title: title, zIndexOffset: zIndexOffset, alt: alt, o:o, layerId:layer })
              .addTo(layers[layer]).bindPopup(text).on('popupopen', onPopupOpen).on('contextmenu', onContextMenu);
          }

          // Add a polyline to the appropriate layer
          if(c.lines && enabledLayers[c.lines] && o.linetype) {
            let start = 'startpos' in o ? [o.startpos.y, o.startpos.x] : [o.lat, o.lng]; 
            let endxys = o.linetype != 'trigger' ? [o.target] : o.targets;

            let [addMarker, color, opacity, weight, offset, dist] = {
                pipe:         [true,  '#4DFF00', 1,   3, radius, 1000],
                jumppad_red:  [true,  '#FF0000', 1,   3, '0%',   100],
                jumppad_blue: [true,  '#1E90FF', 1,   3, '0%',   100],
                trigger:      [false, '#FFFFFF', 0.5, 2, '50%',  0],
            } [o.linetype]

            if(addMarker) {
              L.circleMarker(start, {radius: radius, fillOpacity: opacity, weight: 0, fillColor: color, title: title, o:o, alt: alt})
                .addTo(layers[c.lines]).bindPopup('').on('popupopen', onPopupOpen).on('contextmenu',onContextMenu);
            }

            for(let endxy of endxys) {
              // need to add title as a single space (leaflet search issue), but not the full title so it doesn't appear in search
              // note draw the line backwards
              let line = L.polyline([[endxy.y, endxy.x], start], {weight: weight, title:' ', alt:alt, opacity: opacity, color: color, interactive: false})
                .addTo(layers[c.lines]);
              
              if ((Math.sqrt(Math.pow(start[0] - endxy.y, 2) + Math.pow(start[1] - endxy.x, 2))) > dist) {  
                // polylineDecorator doesn't support end arrow offset so we use start offset, reverse the line and reverse the arrow using headAngle
                L.polylineDecorator(line,{patterns:[{offset:offset, repeat:0, symbol:
                  L.Symbol.arrowHead({pixelSize:radius*2, headAngle: -290, pathOptions:
                    {opacity: opacity, fillOpacity: opacity, weight: 0, color: color, interactive: false, title:' ', alt:alt}})}],})
                      .addTo(layers[c.lines]);
              }
            }
          }

          // add dynamic player marker on top of PlayerStart icon (moves with load save game) 
          if (o.type == 'PlayerStart' && !playerMarker) {
            const pc = gameClasses['_PlayerPosition'];
            const [icon, size] = getClassIcon(pc, o['variant']);
            const addto = pc.layer ? layers[pc.layer] : map
            playerStart = [o.lat, o.lng, o.alt];
            let title = 'PlayerPosition';
            let t = new L.LatLng(o.lat, o.lng);
            let p = settings.playerPosition
            if (p) {
              t = new L.LatLng(p[0], p[1]);
            }
            else {
              settings.playerPosition = playerStart;
            }
            playerMarker = L.marker([t.lat, t.lng], {icon: getIcon(icon,size), zIndexOffset: 0, draggable: false, title: title, alt:'playerMarker'})
            .bindPopup()
            .on('popupopen', function(e) {
                let marker = e.target;
                let p = settings.playerPosition;
                let t = {name: marker.options.title, lat:p[0], lng:p[1], alt:p[2]};
                marker.setPopupContent(JSON.stringify(t, null, 2).replaceAll('\n','<br>').replaceAll(' ','&nbsp;'));
                marker.openPopup();
            }).addTo(addto)

          } // end of player marker
        } // end of loop

        if(enabledLayers['coordinate']){
          playerMarker = L.marker(mapCenter, {zIndexOffset: 10000, draggable: true, title: Math.round(mapCenter[1])+', '+Math.round(mapCenter[0]), alt:'XYMarker'})
            .bindPopup()
            .on('moveend', function(e) {
              let marker = e.target;
              let t = marker.getLatLng();
              e.target._icon.title = Math.round(t.lng)+', '+Math.round(t.lat)
            })
            .on('popupopen', function(e) {
                let marker = e.target;
                let t = marker.getLatLng();
                marker.setPopupContent(`(${Math.round(t.lng)}, ${Math.round(t.lat)})`);
                marker.openPopup();
            }).addTo(layers['coordinate'])
        }

        resizeIcons();
        updatePolylines();
        markItems();
    });
  }

  function loadLayers() {
    playerMarker = null;

    let activeLayers = [];
    let inactiveLayers = [];
    let searchLayers = [];

    layerConfigs.forEachOfType(mapId, 'markers', (id, lc) => {
      let layerObj = L.layerGroup();
      layerObj.id = id;

      if (settings.activeLayers[id]) {
        layerObj.addTo(map);
        activeLayers.push(layerObj);
      } else {
        inactiveLayers.push(layerObj);
      }

      layers[id] = layerObj;
      layerControl.addOverlay(layerObj, lc.name);
      searchLayers.push(layerObj);
    })

    // search
    searchControl = new L.Control.Search({
        layer: L.featureGroup(searchLayers),
        marker: false, // no red circle
        initial: false, // search any substring
        firstTipSubmit: false, // use first autosuggest
        autoCollapse: false,
        tipAutoSubmit: false, //auto map panTo when click on tooltip
        tooltipLimit: -1,
        textPlaceholder: 'Search (Enter to save search phrase)',
    }).addTo(map);

    // workaround: search reveals all layers, hide all inactive layers
    for (let layerObj of inactiveLayers) {
      map.removeLayer(layerObj);
    }

    // filter items by saved query value
    markItems();

    searchControl._handleSubmit = function(){
      settings.searchText = this._input.value;
      map.closePopup();
      saveSettings();
      markItems();
      this._input.select();
    }

    document.querySelector('.search-cancel').addEventListener('click', clearFilter);
    searchControl._input.addEventListener('focus', function(e) { setTimeout(function(e){ e.target.select(); },50,e); } );
    searchControl._input.addEventListener('input', addSearchCallbacks);

    // item clicked in a dropdown list
    function clickItem(text, collapse=false) {
      let loc;
      if ((loc = searchControl._getLocation(text))) {
        searchControl.showLocation(loc, text);
        searchControl.fire('search:locationfound', { latlng: loc, text: text, layer:loc.layer });
        collapse && searchControl.collapse();
      }
    }

    // add click callbacks to dropdown list after input events, wait 1500 ms so it could reload items
    function addSearchCallbacks(){
      setTimeout(function() {
        let divs = document.querySelectorAll('.search-tip');
        [].forEach.call(divs, function(div) {
          div.addEventListener('click', function (e) { clickItem(e.target.innerText); e.preventDefault(); })
          div.addEventListener('dblclick', function (e) { clickItem(e.target.innerText, true); e.preventDefault(); })
        })
      }, 1500)
    }

    // fired after search control focused on the item
    searchControl.on('search:locationfound', function (e) {
        if (e.layer._popup) {
          // reveal layer on click
          layers[e.layer.options.layerId].addTo(map);
          e.layer.openPopup();
        }
    });

    // fired when input control is expanded (not the dropdown list)
    searchControl.on('search:expanded', function (e) {
      searchControl._input.value = settings.searchText;
      searchControl.searchText(settings.searchText);
      addSearchCallbacks();
    });
    // end of search

    loadMarkers();

    layerControl.addTo(map); // triggers baselayerchange, so called in the end
  }
  loadLayers();

  // redraw paths on dragging (sets % of padding around viewport, may be performance issue)
  map.getRenderer(map).options.padding = 1;

} // end of loadmap

// Change current map loaded (if not currently reloading)
function reloadMap(id) {
  if (!reloading && mapId != id) {
    reloading = true;
    map.fireEvent('baselayerchange',{layer:{mapId:id}});
    setTimeout(function(){ reloading = false; }, 250);
  }
}

// Equation: pow(2, zoom * (log2(y0) / z1)) * y0
// z1 is the zoom level where we want scale to be 1:1
// s0 is the scale factor when zoom is 0
const z1 = 3, s0 = 0.5;   // p = 0.33 for z1=3/s0=0.5; p=0.25 for z1=4/s0=0.5
const p = -Math.log2(s0) / z1;
function getIconSize(size, zoom) {
  return Math.round(size * Math.pow(2, zoom * p) * s0);;
}
  //Original solution
  //let scaleForZoom = [0.5,0.5,0.75,1,1,1,1.5,1.5,2];
  //let scaleForZoom = [0.5,0.63,0.79,1,1.26,1.59,2,2.52,3.17]
  //zoom = zoom < 0 ? 0 : zoom < scaleForZoom.length ? zoom : scaleForZoom.length-1;
  //return Math.round(size * scaleForZoom[zoom]);

// Returns leaflet object corresponding to icon base name + default size
function getIcon(icon, size=32) {
  const iconCls = icon + size.toString();
  let iconObj = icons[iconCls] && icons[iconCls].obj;
  if (!iconObj) {
    // We set the iconSize and iconAnchor via CSS in resizeIcons, when we also set the popupAnchor
    iconObj = L.icon({iconUrl: 'img/markers/'+icon+'.png', className:iconCls});

    // We will also set size entry to the zoom based size of the icon in resizeIcons
    icons[iconCls] = {obj: iconObj, baseSize: size};
}
  return iconObj;
}

function resizeIcons(force) {
  zoom = map.getZoom();
  for([iconCls, iconData] of Object.entries(icons)){
    size = getIconSize(iconData.baseSize, zoom);
    if(force || !iconData.size || iconData.size != size) {
      iconData.size = size;
      iconData.obj.options.popupAnchor = [0, -(size >> 1)];   // Top center relative to the marker icon center
      s = size.toString() + 'px';
      c = '-' + (size >> 1).toString() + 'px';
      $('#map .'+iconCls).css({'width':s, 'height':s, 'margin-left':c, 'margin-top':c});
    }
  }
}
  
window.markItemFound = function (id, found=true, save=true) {
  var divs = document.querySelectorAll('*[alt="' + id + '"]');

  [].forEach.call(divs, function(div) {
    if (found) {
      div.classList.add('found');
    } else {
      div.classList.remove('found');
    }
  });

  if (found) {
    settings.markedItems[id] = true;
  } else {
    delete settings.markedItems[id];
  }

  if (save) {
    saveSettings();
  }
}

function markItems() {
  for (let id of Object.keys(settings.markedItems)) {
    let divs = document.querySelectorAll('*[alt="' + id + '"]');
    [].forEach.call(divs, function(div) {
      div.classList.add('found');
    });
  }

  // filter by settings.searchText. caching is unreliable, just perform a full search here
  let lookup = {}
  if (settings.searchText && searchControl) {
    for (const o of Object.values(searchControl._filterData(settings.searchText, searchControl._recordsFromLayer()))) {
      lookup[o.layer.options.alt] = true;
      // reveal layers on filter
      layers[o.layer.options.layerId].addTo(map);
    }
  }

  [].forEach.call(document.querySelectorAll('img.leaflet-marker-icon, path'), function(div) {
    if (div.alt!='playerMarker') {
      let alt = div.getAttribute('alt');
      if (!settings.searchText || lookup[alt]) {
        div.classList.remove('hidden');
      } else {
        div.classList.add('hidden');
      }
    }
  });
}

function unmarkItems() {
  for (const[id,value] of Object.entries(settings.markedItems)) {
    var divs = document.querySelectorAll('*[alt="' + id + '"]');
    [].forEach.call(divs, function(div) {
      div.classList.remove('found');
    });
  }
  settings.markedItems={};
  settings.playerPosition = playerStart;
  if (playerMarker) {
    playerMarker.setLatLng(new L.LatLng(playerStart[0], playerStart[1]));
  }
}

window.loadSaveFile = function () {
  let file = document.querySelector('#file').files[0];

  let self = this;
  let ready = false;
  let result = '';

  const sleep = function (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  self.readAsArrayBuffer = async function() {
      while (ready === false) {
        await sleep(100);
      }
      return result;
  }

  const reader = new FileReader();

  reader.onloadend = function(evt) {

    let loadedSave;
    try {
      loadedSave = new UESaveObject(evt.target.result);
      evt.target.value = null;
    } catch(e) {
      //console.log(e);
      alert('Could not load file, incompatible format.');
      return;
    }

    //console.log(loadedSave);

    for (let section of ["ThingsToRemove", "ThingsToActivate", "ThingsToOpenForever"]) {
      for (let o of loadedSave.Properties) {
        if (o.name != section) {
          continue;
        }
        for(let x of o.value.value) {
          // map '/Game/FirstPersonBP/Maps/DLC2_Complete.DLC2_Complete:PersistentLevel.Coin442_41' to 'DLC2_Complete:Coin442_41'
          let name = x.split(".").pop();
          let area = x.split("/").pop().split('.')[0];
          if (name != "None") {
            let id = area + ':' + name;
            settings.markedItems[id] = true;
          }
        }
      }
    }

    for (let o of loadedSave.Properties) {
      if (o.name == 'Player Position' && playerMarker) {
        //let c = [0,0,0]
        let p = o.value;

        if (o.value.type=='Transform' && o.value['Translation']) {
          p = o.value['Translation'].value;
        }

        if (p && p.x && p.y) {
          var latlng = new L.LatLng(p.y, p.x);
          //console.log('setting player position from file', mapId, latlng);
          playerMarker.setLatLng(latlng);
          settings.playerPosition = [p.y, p.x, p.z];
        } else {
          console.log('cannot load player position from', JSON.stringify(o));
        }

      }
    }

    //setTimeout(function(){alert('Loaded successfully. Marked ' + Object.keys(settings.markedItems).length + ' items')},250);
    //console.log('Marked ' + Object.keys(settings.markedItems).length + ' items');

    markItems();
    saveSettings();

    ready = true;
  };

  if (file instanceof Blob) {
    reader.readAsArrayBuffer(file);
  }
}

window.onhashchange = function(e) { 
  //console.log(location.hash)
  if (location.hash.length > 1 && map) {
    let p = map.getCenter();
    mapParam = {mapId:mapId, lat:Math.round(p.lat), lng:Math.round(p.lng), zoom:map.getZoom()};
    for (const s of location.hash.slice(1).split('&')) {
      let [k,v] = s.split('=');
      mapParam[k] = v;
    }
    if(mapId != mapParam.mapId) {
      reloadMap(mapParam.mapId)
    }
    else {
      map.setView([mapParam.lat, mapParam.lng], mapParam.zoom);
    }
    mapParam = {}
    location.hash = '';
  }
}

window.onload = function(event) {
  if (location.hash.length>1) {
    for (const s of location.hash.slice(1).split('&')) {
      let [k,v] = s.split('=');
      mapParam[k] = v;
    }
  }

  // clear location hash
  history.pushState('', document.title, window.location.pathname + window.location.search);

  mapId = mapParam.mapId || localData.mapId || 'sl';

  loadMap(mapId);

  // Keys mappings for pan and zoom map controls
  let bindings = {
    KeyA:['x',+1],KeyD:['x',-1],
    KeyW:['y',+1],KeyS:['y',-1],
    KeyT:['z',+1],KeyG:['z',-1],
  };

  // Keys currently pressed [code]=true
  let pressed = {};

  // Called every browser animation timestep following call to requestAnimationFrame
  function update(timestep) {
    let step = 100;
    let v = {};
    for (let key of Object.keys(bindings)) {
      if (pressed[key]) {
        let [dir, step] = bindings[key];
        v[dir] = (v[dir]||0) + step;
      }
    }
    (v.x || v.y) && map.panBy([(-v.x||0)*step, (-v.y||0)*step], {animation: false});
    //v.z && map.setZoom(map.getZoom()+v.z/16, {duration: 1});
    window.requestAnimationFrame(update);
  }

  document.querySelector('#map').addEventListener('blur', function(e) {
    pressed = {}; // prevent sticky keys
  });

  // When a key goes up remove it from the list 
  window.addEventListener('keyup', (e) => {
    delete pressed[e.code];
  });

  window.addEventListener("keydown",function (e) {
    //console.log(e, e.code);
    if (e.target.id.startsWith('searchtext')) {
      return;
    }
    pressed[e.code] = true;
    switch (e.code) {
      case 'KeyF':        // F (no ctrl) to toggle fullscreen
        if (e.ctrlKey) {
          searchControl.expand(true);
          e.preventDefault();
        } else {
          map.toggleFullscreen();
        }
        break;
      case 'Slash':     // Ctrl+F or / to search
        searchControl.expand(true);
        e.preventDefault();
        break;
      case 'KeyR':
        if (!e.ctrlKey && !e.altKey) {
          map.flyTo(playerMarker ? playerMarker._latlng : mapCenter);
        } else if (e.altKey) {
          openLoadFileDialog();
        }
        break;
    case 'Digit1': reloadMap('sl'); break;
      case 'Digit2': reloadMap('slc'); break;
      case 'Digit3': reloadMap('siu'); break;
      case 'KeyT': map.zoomIn(1); break;
      case 'KeyG': map.zoomOut(1); break;
    }
  });

  document.querySelector('#file').onchange = function(e) {
    window.loadSaveFile();
  }

  window.requestAnimationFrame(update);
  window.addEventListener('contextmenu', function(e) { e.stopPropagation()}, true); // enable default context menu
}
