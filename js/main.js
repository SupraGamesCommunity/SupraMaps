let map = null;
let mapId = '';
let localDataName = 'joricsSupraland1';
let localData = JSON.parse(localStorage.getItem(localDataName)) || {};
let layers = {};
let classes = {};
let icons = {};
let playerStart;
let playerMarker;
let reloading;
let settings;
let mapCenter;
let mapParam = {};

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

function saveSettings() {
  localStorage.setItem(localDataName, JSON.stringify(localData));
}

function clearFilter() {
  settings.searchText = '';
  saveSettings();
  markItems();
}

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
  console.log(text + ' copied to clipboard');
}

function openLoadFileDialog() {
  document.querySelector('#file').value = null;
  document.querySelector('#file').accept = '.sav';
  document.querySelector('#file').click();
}

function loadMap() {
  for (id in maps) {
    var title = maps[id].title;
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
      localData[id].activeLayers = {'closedChest':true, 'shop':true, 'collectable':true};
      if (id=='sl') {
        localData[id].activeLayers['pads']=true;
        localData[id].activeLayers['pipes']=true;
      }
    }
  }

  localData.mapId = mapId;
  saveSettings();

  settings = localData[mapId];

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

  mapBounds = [
    [ p.MapWorldUpperLeft.Y, p.MapWorldUpperLeft.X ],
    [ p.MapWorldLowerRight.Y, p.MapWorldLowerRight.X ]
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

  let gap = p.MapWorldSize/2;

  //Create the map
  map = new L.Map('map', {
    crs: crs,
    fadeAnimation: false,
    maxBounds: [
      [ p.MapWorldUpperLeft.Y - gap, p.MapWorldUpperLeft.X - gap ],
      [ p.MapWorldLowerRight.Y + gap, p.MapWorldLowerRight.X + gap ]
    ],
    zoomControl: false,
  });

  L.control.zoom({ position: 'bottomright'}).addTo(map);
  L.control.fullscreen({ position: 'bottomright', forceSeparateButton: true}).addTo(map);

  layerOptions = {
      tileSize: L.point(tileSize.x, tileSize.y),
      noWrap: true,
      tms: false,
      updateInterval: -1,
      keepBuffer: 16,
      maxNativeZoom: 4,
      nativeZooms: [0, 1, 2, 3, 4],
      bounds: mapBounds,
      attribution: '<a href="https://github.com/joric/supraland" target="_blank">Joric\'s Supraland</a>',
  };

  let layerControl = L.control.layers({}, {}, {
    collapsed: true,
    position: 'topright',
  });

  map.on('moveend zoomend', function(e) {
    settings.center = [map.getCenter().lat, map.getCenter().lng]; // avoid circular refs here
    settings.zoom = map.getZoom();
    saveSettings();
  });

  map.on('baselayerchange', function(e) {
    id = e.layer.mapId;
    //localStorage.setItem(mapId, location.hash);
    location.hash = '';
    map.off();
    map.remove();
    map = null;
    playerMarker = null;
    mapId = id
    loadMap(id);
  });

  function updatePolylines(layerId) {
    // set alt for polylines (attributes are not populated to paths)
    if (layers[layerId]) {
      for (const m of Object.values(layers[layerId]._layers)) {
        if (p = m._path) {
          p.setAttribute('alt', m.options.alt);
        }
      }
    }
  }

  map.on('overlayadd', function(e) {
    settings.activeLayers[e.layer.id] = true;
    updatePolylines(e.layer.id);
    markItems();
    saveSettings();
  });

  map.on('overlayremove', function(e) {
    delete settings.activeLayers[e.layer.id];
    markItems();
    saveSettings();
  });

  tilesDir = 'tiles/'+mapId;

  // L.tileLayer.canvas() is much faster than L.tileLayer() but requires a L.TileLayer.Canvas plugin
  let baseLayer = L.tileLayer.canvas(tilesDir+'/base/{z}/{x}/{y}.jpg', layerOptions).addTo(map);

  for (id in maps) {
    var title = maps[id].title;
    var layer = id==mapId ? baseLayer : L.layerGroup();
    layer.mapId = id;
    layerControl.addBaseLayer(layer, title);
  }

  if (mapId == 'sl') {
    for (const [id, title] of Object.entries({'pipes':'Pipes', 'pads':'Pads'})) {
      var layer =  L.tileLayer.canvas(tilesDir+'/'+id+'/{z}/{x}/{y}.png', layerOptions);
      layer.id = id;
      if (settings.activeLayers[id]) {
        layer.addTo(map);
      }
      layerControl.addOverlay(layer, title);
    }
  }

  L.control.mousePosition().addTo(map);

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
    markItemFound(markerId, !found);
    e.target.closePopup();
  }

  function onPopupOpen(e) {
    let x = e.popup._source._latlng.lng;
    let y = e.popup._source._latlng.lat;
    let markerId = e.popup._source.options.alt;

    let dist = Infinity;
    let res = null;
    let o = e.popup._source.options.o;

    let text = JSON.stringify(o, null, 2).replaceAll('\n','<br>').replaceAll(' ','&nbsp;');
    let found = settings.markedItems[markerId]==true
    let value = found ? 'checked' : '';

    let base = window.location.href.replace(/#.*$/,'');
    let vars = {mapId:mapId, lat:Math.round(map.getCenter().lat), lng:Math.round(map.getCenter().lng), zoom:map.getZoom()};
    let url = base +'#' + Object.entries(vars).map(e=>e[0]+'='+encodeURIComponent(e[1])).join('&');
    let a = '<a href="'+url+'" onclick="return false">Map URL</a>';

    // it's not "found" but rather "removed" (e.g. BuySword2_2 in the beginning of Crash DLC)
    text += '<br><br><input type="checkbox" id="'+markerId+'" '+value+' onclick=markItemFound("'+markerId+'",this.checked)><label for="'+markerId+'">Found</label>';
    e.popup.setContent(text);

    for (const lookup of ['chests.csv', 'collectables.csv', 'shops.csv']) {
      filename = 'data/legacy/' + mapId + '/'+lookup;
      var loadedCsv = Papa.parse(filename, { download: true, header: true, complete: function(results, filename) {
        var chests = 0;
        for (o of results.data) {
          if (!o.x) {
            continue;
          }
          let d = Math.pow(  Math.pow(o.x-x, 2) + Math.pow(o.y-y, 2), 0.5);
          if (d<dist) {
            dist = d;
            res = o;
          }
        }
        if (dist<1000 && res.ytVideo) {
          let url = 'https://youtu.be/'+res.ytVideo+'&?t='+res.ytStart;
          e.popup.setContent(text + '<br><br><a href="'+url+'" target=_blank>'+url+'</a>');
        }
      }});
    }
  }

  function getMarkerColor(o) {
    if (o.type == 'Jumppad_C') {
      return (o.allow_stomp || o.disable_movement_in_air==false) ? 'dodgerblue' : 'red';
    } else if (o.type.startsWith('Pipe')) {
      return 'yellowgreen';
    }
    return '#888';
  }

  function loadMarkers() {
    fetch('data/markers.'+mapId+'.json')
      .then((response) => response.json())
      .then((j) => {
        let objects = {};
        let names = {};

        // collect objects for cross-references
        for (o of j) {
          let id = o.area + ':' + o.name;
          objects[id] = o;
        }

        for (const[id,o] of Object.entries(objects)) {

          // skip markers out of bounds (e.g. "PipesystemNew_AboveSewer" in DLC2_Area0)
          let [[top,left],[bottom,right]] = mapBounds;
          if (! (o.lng>left && o.lng<right && o.lat>top && o.lat<bottom )) {
            continue;
          }

          function hidden(type) {
            return ['Jumppillow_C','EnemySpawner_C','PipeCap_C','GoldBlock_C'].includes(type);
          }

          // check if class is in the types list
          if (!hidden(o.type)) {
            let c = classes[o.type];
            let text = ''; // set it later in onPopupOpen
            let alt = id;
            let name = o.name;
            let defaultIcon = 'question_mark';
            let defaultLayer = 'misc';
            let icon = c && c.icon || defaultIcon;
            let layer = c && c.layer || defaultLayer;
            let color = getMarkerColor(o);
            if (!layers[layer]) {
              layer = defaultLayer;
            }

            // can't have duplicate titles in search, will lose items
            if (names[name]) {
              name = o.area + ':' + o.name;
            }
            names[name] = name;

            let title = name;

            if (o.spawns) {
              title = title + ' ('+o.spawns+')';
            } else if (o.coins) {
              title = title + ' ('+o.coins+' coin'+(o.coins>1?'s':'')+')';
            }
            title = title + ' of ' + o.type;

            if ( o.type == 'Jumppad_C' || o.type.startsWith('Pipesystem') ) {

              let a = o; // start object

              // pad line
              if (o.type == 'Jumppad_C' && o.target) {
                let layer = 'jumppads';
                if (r = o.direction) {
                  L.polyline([[o.lat, o.lng],[o.target.y,o.target.x]], {title:' ', alt:alt, color: color, interactive:false}).addTo(layers[layer]);
                }
              }

              // pipe line
              if (o.type.startsWith('Pipesystem')) {
                let layer = 'pipecaps';

                if (o.nearest_cap) {
                  a = objects[o.nearest_cap];
                  alt = a.area + ':' + a.name;
                } else {
                  alt = ''; // only mark pipes with caps
                }

                if (b = objects[o.other_pipe]) {

                  if (b.nearest_cap) {
                    b = objects[b.nearest_cap];
                    alt = b.area + ':' + b.name;
                  } else {
                    alt = '';
                  }

                  L.polyline([[a.lat, a.lng],[b.lat, b.lng]], {title:' ', alt:alt, color: color, interactive:false}).addTo(layers[layer]);
                }
              }

              // marker
              L.circleMarker([a.lat, a.lng], {radius: 5, fillOpacity: 1, weight: 0, color: 'black', fillColor: color, title: title, o:a, alt: alt})
                .addTo(layers[layer]).bindPopup(text).on('popupopen', onPopupOpen).on('contextmenu',onContextMenu);

            } else {

              if (o.type.endsWith('Chest_C')) { icon = 'chest'; layer = 'closedChest'};

              if (o.type.endsWith('Flower_C') || o.type.endsWith('Seed_C') || o.type.endsWith('KeycardColor_C')) {
                let colors = {1:'yellow',2:'red',3:'blue',4:'purple',5:'green',6:'orange'};
                if (c = colors[o.color]) {
                  icon = icon +'_' + c;
                }
              }

              // shops: all items you can purchase are marked as shops. note they may overlap "upgrades" and spawns.
              if (o.type.startsWith('Buy') || o.type.startsWith('BP_Buy') || o.type.startsWith('Purchase') || o.type.startsWith('BP_Purchase')) {
                let icon = 'shop';
                let layer = 'shop';
                L.marker([o.lat, o.lng], {icon: getIcon(icon), title: title, zIndexOffset: 10, alt: alt, o:o, layerId:layer })
                  .addTo(layers[layer]).bindPopup(text).on('popupopen', onPopupOpen).on('contextmenu',onContextMenu);
              }

              // finally, add marker (base marker goes in the middle)
              L.marker([o.lat, o.lng], {icon: getIcon(icon), title: title, zIndexOffset: 100, alt: alt, o:o, layerId:layer })
                .addTo(layers[layer]).bindPopup(text).on('popupopen', onPopupOpen).on('contextmenu',onContextMenu);

              // we also have to put all spawns up there as separate markers, they may overlap already listed items (legacy thing)
              // note the title is ' ' to prevent leaflet-search from collecting items from a fake item layer
              if (s = classes[o.spawns]) {
                let icon = s.icon || defaultIcon;
                let layer = layers[s.layer] ? s.layer : defaultLayer;
                L.marker([o.lat, o.lng], {icon: getIcon(icon), title: ' ', zIndexOffset: 1000, alt: alt, o:o, layerId:layer })
                  .addTo(layers[layer]).bindPopup(text).on('popupopen', onPopupOpen).on('contextmenu',onContextMenu);
              }
            }
          } // end of all items that have types entry

          // add dynamic player marker on top of PlayerStart icon
          if (o.type == 'PlayerStart' && !playerMarker) {
            icon = mapId=='siu' ? 'player_blue' : 'player_red';
            playerStart = [o.lat, o.lng, o.alt];
            let t = new L.LatLng(o.lat, o.lng);
            if (p = settings.playerPosition) {
              t = new L.LatLng(p[0], p[1]);
            }
            playerMarker = L.marker([t.lat, t.lng], {icon: getIcon(icon), zIndexOffset: 10000, draggable: false, title: Math.round(t.lat)+', '+Math.round(t.lng), alt:'playerMarker'})
            .bindPopup()
            .on('moveend', function(e) {
              let marker = e.target;
              let t = marker.getLatLng();
              settings.playerPosition = [t.lat, t.lng, 0];
              saveSettings();
              e.target._icon.title = Math.round(t.lat)+', '+Math.round(t.lng)
            })
            .on('popupopen', function(e) {
                let marker = e.target;
                let t = marker.getLatLng();
                t = {name:'playerPosition', lat:Math.round(t.lat), lng:Math.round(t.lng)};
                marker.setPopupContent(JSON.stringify(t, null, 2).replaceAll('\n','<br>').replaceAll(' ','&nbsp;'));
                marker.openPopup();
            }).addTo(map)
          }
        } // end of main loop

        updatePolylines('jumppads');
        updatePolylines('pipecaps');
        markItems();
    });
  }

  function loadLayers() {
      playerMarker = null;
      filename = 'data/layers.csv';

      let activeLayers = [];
      let inactiveLayers = [];
      let searchLayers = [];

      var loadedCsv = Papa.parse(filename, { download: true, header: true, complete: function(results, filename) {
        for (o of results.data) {
          if (!o.id) {
            continue;
          }
          if (o.id=='pipes' || o.id=='pads') {
            continue;
          }
          if (o.id=='graves' && mapId!='sl') {
            continue;
          }

          let layerObj = L.layerGroup();
          layerObj.id = o.id;

          if (settings.activeLayers[o.id]) {
            layerObj.addTo(map);
            activeLayers.push(layerObj);
          } else {
            inactiveLayers.push(layerObj);
          }

          layers[o.id] = layerObj;
          layerControl.addOverlay(layerObj, o.name);
          searchLayers.push(layerObj);
        }

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
        for (layerObj of inactiveLayers) {
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
          if (loc = searchControl._getLocation(text)) {
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

        // parse types
        filename = 'data/types.csv';
        Papa.parse(filename, { download: true, header: true, complete: function(results, filename) {
          for (o of results.data) {
            if (!o.type) {
              continue;
            }
            classes[o.type] = o;
          }

          //loadMarkersLegacy();
          loadMarkers();

          layerControl.addTo(map); // triggers baselayerchange, so called in the end

        }});
      }});
  }

  loadLayers();
} // end of loadmap

function reloadMap(id) {
  if (!reloading) {
    reloading = true;
    map.fireEvent('baselayerchange',{layer:{mapId:id}});
    setTimeout(function(){ reloading = false; }, 250);
  }
}

function getIconSize(zoom) {
  let s = [32];
  return s[Math.round(Math.min(zoom,s.length-1))];
}

function getIcon(icon) {
  let iconObj = icons[icon];
  if (!iconObj) {
    let s = getIconSize(map.getZoom());
    let c = s >> 1;
    iconObj = L.icon({iconUrl: 'img/'+icon+'.png', iconSize: [s,s], iconAnchor: [c,c]});
    icons[icon] = iconObj;
  }
  return iconObj;
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
  for (const[id,value] of Object.entries(settings.markedItems)) {
    var divs = document.querySelectorAll('*[alt="' + id + '"]');
    [].forEach.call(divs, function(div) {
      div.classList.add('found');
    });
  }

  // filter by settings.searchText. caching is unreliable, just perform a full search here
  let lookup = {}
  if (settings.searchText) {
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
      console.log(e);
      alert('Could not load file, incompatible format.');
      return;
    }

    //console.log(loadedSave);

    for (let section of ["ThingsToRemove", "ThingsToActivate", "ThingsToOpenForever"]) {
      for (o of loadedSave.Properties) {
        if (o.name != section) {
          continue;
        }
        for(x of o.value.value) {
          // map '/Game/FirstPersonBP/Maps/DLC2_Complete.DLC2_Complete:PersistentLevel.Coin442_41' to 'DLC2_Complete:Coin442_41'
          let name = x.split(".").pop();
          let area = x.split("/").pop().split('.')[0];
          if (name != "None") {
            markItemFound(area + ':' + name, true, false);
          }
        }
      }
    }

    for (o of loadedSave.Properties) {
      if (o.name == 'Player Position' && playerMarker) {
        let c = [0,0,0]
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
    console.log('Marked ' + Object.keys(settings.markedItems).length + ' items');

    saveSettings();

    ready = true;
  };

  if (file instanceof Blob) {
    reader.readAsArrayBuffer(file);
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

  loadMap();

  let bindings = {
    KeyA:['x',+1],KeyD:['x',-1],
    KeyW:['y',+1],KeyS:['y',-1],
    KeyT:['z',+1],KeyG:['z',-1],
  };

  let pressed = {};

  function update(timestep) {
    let step = 100;
    let v = {};
    for (key of Object.keys(bindings)) {
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
      case 'KeyF':
        if (e.ctrlKey) {
          searchControl.expand();
          e.preventDefault();
        } else {
          map.toggleFullscreen();
        }
        break;
      case 'Slash':
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
    loadSaveFile();
  }

  window.requestAnimationFrame(update);
  window.addEventListener('contextmenu', function(e) { e.stopPropagation()}, true); // enable default context menu
}
