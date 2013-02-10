// ==UserScript==
// @id             ingress-intel-total-conversion@pironic
// @name           intel map total conversion
// @version        0.3-2013-02-08-030330
// @namespace      http://nasbox.writhem.com/ingress
// @updateURL      http://nasbox.writhem.com/ingress/total-conversion-build.user.js
// @downloadURL    http://nasbox.writhem.com/ingress/total-conversion-build.user.js
// @description    total conversion for the ingress intel map.
// @include        http://www.ingress.com/intel*
// @match          http://www.ingress.com/intel*
// ==/UserScript==


// REPLACE ORIG SITE ///////////////////////////////////////////////////
if(document.getElementsByTagName('html')[0].getAttribute('itemscope') != null)
  throw('Ingress Intel Website is down, not a userscript issue.');

// disable vanilla JS
window.onload = function() {};

// rescue user data from original page
var scr = document.getElementsByTagName('script');
for(var x in scr) {
  var s = scr[x];
  if(s.src) continue;
  if(s.type !== 'text/javascript') continue;
  var d = s.innerHTML.split('\n');
  break;
}

for(var i = 0; i < d.length; i++) {
  if(!d[i].match('var PLAYER = ')) continue;
  eval(d[i].match(/^var /, 'window.'));
  break;
}
// player information is now available in a hash like this:
// window.PLAYER = {"ap": "123", "energy": 123, "available_invites": 123, "nickname": "somenick", "team": "ALIENS||RESISTANCE"};


// remove complete page. We only wanted the user-data and the page’s
// security context so we can access the API easily. Setup as much as
// possible without requiring scripts.
document.getElementsByTagName('head')[0].innerHTML = ''
  //~ + '<link rel="stylesheet" type="text/css" href="http://0.0.0.0:8000/style.css"/>'
  + '<link rel="stylesheet" type="text/css" href="http://breunigs.github.com/ingress-intel-total-conversion/style.css"/>'
  + '<link rel="stylesheet" type="text/css" href="http://cdn.leafletjs.com/leaflet-0.5/leaflet.css"/>'
  + '<link rel="stylesheet" type="text/css" href="http://fonts.googleapis.com/css?family=Coda"/>';

document.getElementsByTagName('body')[0].innerHTML = ''
  + '<div id="map">Loading, please wait</div>'
  + '<div id="chatcontrols" style="display:none">'
  + '  <a>expand</a><a>automated</a><a>public</a><a class="active">faction</a>'
  + '</div>'
  + '<div id="chat" style="display:none">'
  + '  <div id="chatfaction"></div>'
  + '  <div id="chatpublic"></div>'
  + '  <div id="chatautomated"></div>'
  + '</div>'
  + '<form id="chatinput" style="display:none"><time></time><span>tell faction:</span><input type="text"/></form>'
  + '<div id="scrollwrapper">' // enable scrolling for small screens
  + '  <div id="sidebar" style="display: none">'
  + '    <div id="playerstat">t</div>'
  + '    <div id="gamestat">&nbsp;loading global control stats</div>'
  + '    <input id="geosearch" placeholder="Search location…" type="text"/>'
  + '    <div id="writhem_logs"></div>'
  + '    <div id="portaldetails"></div>'
  + '    <input id="redeem" placeholder="Redeem code…" type="text"/>'
  + '    <div id="updatestatus"></div>'
  + '  </div>';
  + '</div>';

// putting everything in a wrapper function that in turn is placed in a
// script tag on the website allows us to execute in the site’s context
// instead of in the Greasemonkey/Extension/etc. context.
function wrapper() {

// LEAFLET PREFER CANVAS ///////////////////////////////////////////////
// Set to true if Leaflet should draw things using Canvas instead of SVG
// Disabled for now because it has several bugs: flickering, constant
// CPU usage and it continuously fires the moveend event.
L_PREFER_CANVAS = false;

// CONFIG OPTIONS ////////////////////////////////////////////////////
var REFRESH = 30; // refresh view every 30s (base time)
var ZOOM_LEVEL_ADJ = 5; // add 5 seconds per zoom level
var REFRESH_GAME_SCORE = 5*60; // refresh game score every 5 minutes
var MAX_IDLE_TIME = 0; // stop updating map after 4min idling
var PRECACHE_PLAYER_NAMES_ZOOM = 17; // zoom level to start pre-resolving player names
var HIDDEN_SCROLLBAR_ASSUMED_WIDTH = 20;
var SIDEBAR_WIDTH = 300;
// chat messages are requested for the visible viewport. On high zoom
// levels this gets pretty pointless, so request messages in at least a
// X km radius.
var CHAT_MIN_RANGE = 6;
// this controls how far data is being drawn outside the viewport. Set
// it 0 to only draw entities that intersect the current view. A value
// of one will render an area twice the size of the viewport (or some-
// thing like that, Leaflet doc isn’t too specific). Setting it too low
// makes the missing data on move/zoom out more obvious. Setting it too
// high causes too many items to be drawn, making drag&drop sluggish.
var VIEWPORT_PAD_RATIO = 0.3;

// how many items to request each query
var CHAT_PUBLIC_ITEMS = 200
var CHAT_FACTION_ITEMS = 50

// Leaflet will get very slow for MANY items. It’s better to display
// only some instead of crashing the browser.
var MAX_DRAWN_PORTALS = 1000;
var MAX_DRAWN_LINKS = 400;
var MAX_DRAWN_FIELDS = 200;


var COLOR_SELECTED_PORTAL = '#f00';
var COLORS = ['#FFCE00', '#0088FF', '#03FE03']; // none, res, enl
var COLORS_LVL = ['#000', '#FECE5A', '#FFA630', '#FF7315', '#E40000', '#FD2992', '#EB26CD', '#C124E0', '#9627F4'];
// circles around a selected portal that show from where you can hack
// it and how far the portal reaches (i.e. how far links may be made
// from this portal)
var ACCESS_INDICATOR_COLOR = 'orange';
var RANGE_INDICATOR_COLOR = 'red';

// INGRESS CONSTANTS /////////////////////////////////////////////////
// http://decodeingress.me/2012/11/18/ingress-portal-levels-and-link-range/
var RESO_NRG = [0, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000];
var MAX_XM_PER_LEVEL = [0, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
var MIN_AP_FOR_LEVEL = [0, 10000, 30000, 70000, 150000, 300000, 600000, 1200000];
var HACK_RANGE = 35; // in meters, max. distance from portal to be able to access it
var SLOT_TO_CARDINAL = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
var DEFAULT_PORTAL_IMG = 'http://commondatastorage.googleapis.com/ingress/img/default-portal-image.png';

// OTHER MORE-OR-LESS CONSTANTS //////////////////////////////////////
var NOMINATIM = 'http://nominatim.openstreetmap.org/search?format=json&limit=1&q=';
var DEG2RAD = Math.PI / 180;
var TEAM_NONE = 0, TEAM_RES = 1, TEAM_ENL = 2;
var TEAM_TO_CSS = ['none', 'res', 'enl'];
// make PLAYER variable available in site context
var PLAYER = window.PLAYER;
var CHAT_SHRINKED = 60;


// STORAGE ///////////////////////////////////////////////////////////
// global variables used for storage. Most likely READ ONLY. Proper
// way would be to encapsulate them in an anonymous function and write
// getters/setters, but if you are careful enough, this works.
var refreshTimeout;
var urlPortal = null;
window.playersToResolve = [];
window.playersInResolving = [];
window.selectedPortal = null;
window.portalRangeIndicator = null;
window.portalAccessIndicator = null;
window.mapRunsUserAction = false;
var portalsLayer, linksLayer, fieldsLayer;

// contain references to all entities shown on the map. These are
// automatically kept in sync with the items on *sLayer, so never ever
// write to them.
window.portals = {};
window.links = {};
window.fields = {};


var WRITHEMAPIKEY = '9a0e27a9ecad833999939f8850827851';




// MAP DATA //////////////////////////////////////////////////////////
// these functions handle how and which entities are displayed on the
// map. They also keep them up to date, unless interrupted by user
// action.


// requests map data for current viewport. For details on how this
// works, refer to the description in “MAP DATA REQUEST CALCULATORS”
window.requestData = function() {
  console.log('refreshing data');
  requests.abort();
  cleanUp();

  var magic = convertCenterLat(map.getCenter().lat);
  var R = calculateR(magic);

  var bounds = map.getBounds();
  // convert to point values
  topRight = convertLatLngToPoint(bounds.getNorthEast(), magic, R);
  bottomLeft = convertLatLngToPoint(bounds.getSouthWest() , magic, R);
  // how many quadrants intersect the current view?
  quadsX = Math.abs(bottomLeft.x - topRight.x);
  quadsY = Math.abs(bottomLeft.y - topRight.y);

  // will group requests by second-last quad-key quadrant
  tiles = {};

  // walk in x-direction, starts right goes left
  for(var i = 0; i <= quadsX; i++) {
    var x = Math.abs(topRight.x - i);
    var qk = pointToQuadKey(x, topRight.y);
    var bnds = convertPointToLatLng(x, topRight.y, magic, R);
    if(!tiles[qk.slice(0, -1)]) tiles[qk.slice(0, -1)] = [];
    tiles[qk.slice(0, -1)].push(generateBoundsParams(qk, bnds));

    // walk in y-direction, starts top, goes down
    for(var j = 1; j <= quadsY; j++) {
      var qk = pointToQuadKey(x, topRight.y + j);
      var bnds = convertPointToLatLng(x, topRight.y + j, magic, R);
      if(!tiles[qk.slice(0, -1)]) tiles[qk.slice(0, -1)] = [];
      tiles[qk.slice(0, -1)].push(generateBoundsParams(qk, bnds));
    }
  }

  // finally send ajax requests
  $.each(tiles, function(ind, tls) {
    data = { minLevelOfDetail: -1 };
    data.boundsParamsList = tls;
    window.requests.add(window.postAjax('getThinnedEntitiesV2', data, window.handleDataResponse));
  });
}

// works on map data response and ensures entities are drawn/updated.
window.handleDataResponse = function(data, textStatus, jqXHR) {
  // remove from active ajax queries list
  if(!data || !data.result) {
    window.failedRequestCount++;
    console.warn(data);
    return;
  }

  var portalUpdateAvailable = false;
  var portalInUrlAvailable = false;
  var m = data.result.map;
  // defer rendering of portals because there is no z-index in SVG.
  // this means that what’s rendered last ends up on top. While the
  // portals can be brought to front, this costs extra time. They need
  // to be in the foreground, or they cannot be clicked. See
  // https://github.com/Leaflet/Leaflet/issues/185
  var ppp = [];
  $.each(m, function(qk, val) {
    $.each(val.deletedGameEntityGuids, function(ind, guid) {
      window.removeByGuid(guid);
    });

    $.each(val.gameEntities, function(ind, ent) {
      // ent = [GUID, id(?), details]
      // format for links: { controllingTeam, creator, edge }
      // format for portals: { controllingTeam, turret }

      if(ent[2].turret !== undefined) {
        if(selectedPortal == ent[0]) portalUpdateAvailable = true;
        if(urlPortal && ent[0] == urlPortal) portalInUrlAvailable = true;

        var latlng = [ent[2].locationE6.latE6/1E6, ent[2].locationE6.lngE6/1E6];
        if(!window.getPaddedBounds().contains(latlng)
              && selectedPortal != ent[0]
              && urlPortal != ent[0]
          ) return;



        ppp.push(ent); // delay portal render
      } else if(ent[2].edge !== undefined)
        renderLink(ent);
      else if(ent[2].capturedRegion !== undefined)
        renderField(ent);
      else
        throw('Unknown entity: ' + JSON.stringify(ent));
    });
  });

  $.each(ppp, function(ind, portal) { renderPortal(portal); });
  if(portals[selectedPortal]) portals[selectedPortal].bringToFront();

  if(portalInUrlAvailable) {
    renderPortalDetails(urlPortal);
    urlPortal = null; // select it only once
  }

  if(portalUpdateAvailable) renderPortalDetails(selectedPortal);
  resolvePlayerNames();
}

// removes entities that are still handled by Leaflet, although they
// do not intersect the current viewport.
window.cleanUp = function() {
  var cnt = [0,0,0];
  var b = getPaddedBounds();
  var minlvl = getMinPortalLevel();
  portalsLayer.eachLayer(function(portal) {
    // portal must be in bounds and have a high enough level. Also don’t
    // remove if it is selected.
    if(portal.options.guid == window.selectedPortal ||
      (b.contains(portal.getLatLng()) && portal.options.level >= minlvl)) return;
    cnt[0]++;
    portalsLayer.removeLayer(portal);
  });
  linksLayer.eachLayer(function(link) {
    if(b.intersects(link.getBounds())) return;
    cnt[1]++;
    linksLayer.removeLayer(link);
  });
  fieldsLayer.eachLayer(function(field) {
    if(b.intersects(field.getBounds())) return;
    cnt[2]++;
    fieldsLayer.removeLayer(field);
  });
  console.log('removed out-of-bounds: '+cnt[0]+' portals, '+cnt[1]+' links, '+cnt[2]+' fields');
}

// removes given entity from map
window.removeByGuid = function(guid) {
  // portals end in “.11” or “.12“, links in “.9", fields in “.b”
  // .11 == portals
  // .12 == portals
  // .9  == links
  // .b  == fields
  // .c  == player/creator
  // .d  == chat messages
  switch(guid.slice(33)) {
    case '11':
    case '12':
      if(!window.portals[guid]) return;
      portalsLayer.removeLayer(window.portals[guid]);
      break;
    case '9':
      if(!window.links[guid]) return;
      linksLayer.removeLayer(window.links[guid]);
      break;
    case 'b':
      if(!window.fields[guid]) return;
      fieldsLayer.removeLayer(window.fields[guid]);
      break;
    default:
      console.warn('unknown GUID type: ' + guid);
      //window.debug.printStackTrace();
  }
}



// renders a portal on the map from the given entity
window.renderPortal = function(ent) {
  removeByGuid(ent[0]);

  if(Object.keys(portals).length >= MAX_DRAWN_PORTALS && ent[0] != selectedPortal)
    return;

  var latlng = [ent[2].locationE6.latE6/1E6, ent[2].locationE6.lngE6/1E6];
  // needs to be checked before, so the portal isn’t added to the
  // details list and other places
  //if(!getPaddedBounds().contains(latlng)) return;

  // hide low level portals on low zooms
  var portalLevel = getPortalLevel(ent[2]);
  if(portalLevel < getMinPortalLevel()  && ent[0] != selectedPortal) return;

  // pre-load player names for high zoom levels
  if(map.getZoom() >= PRECACHE_PLAYER_NAMES_ZOOM) {
    if(ent[2].captured && ent[2].captured.capturingPlayerId)
      getPlayerName(ent[2].captured.capturingPlayerId);
    if(ent[2].resonatorArray && ent[2].resonatorArray.resonators)
      $.each(ent[2].resonatorArray.resonators, function(ind, reso) {
        if(reso) getPlayerName(reso.ownerGuid);
      });
  }

  var team = getTeam(ent[2]);

  var p = L.circleMarker(latlng, {
    radius: 7,
    color: ent[0] == selectedPortal ? COLOR_SELECTED_PORTAL : COLORS[team],
    opacity: 1,
    weight: 3,
    fillColor: COLORS[team],
    fillOpacity: 0.5,
    clickable: true,
    level: portalLevel,
    details: ent[2],
    guid: ent[0]});

  p.on('remove',   function() { delete window.portals[this.options.guid]; });
  p.on('add',      function() { window.portals[this.options.guid] = this; });
  p.on('click',    function() { window.renderPortalDetails(ent[0]); });
  p.on('dblclick', function() {
    window.renderPortalDetails(ent[0]);
    window.map.setView(latlng, 17);
  });
  p.addTo(portalsLayer);
}

// renders a link on the map from the given entity
window.renderLink = function(ent) {
  removeByGuid(ent[0]);
  if(Object.keys(links).length >= MAX_DRAWN_LINKS) return;

  var team = getTeam(ent[2]);
  var edge = ent[2].edge;
  var latlngs = [
    [edge.originPortalLocation.latE6/1E6, edge.originPortalLocation.lngE6/1E6],
    [edge.destinationPortalLocation.latE6/1E6, edge.destinationPortalLocation.lngE6/1E6]
  ];
  var poly = L.polyline(latlngs, {
    color: COLORS[team],
    opacity: 1,
    weight:2,
    clickable: false,
    guid: ent[0],
    smoothFactor: 10
  });

  if(!getPaddedBounds().intersects(poly.getBounds())) return;

  poly.on('remove', function() { delete window.links[this.options.guid]; });
  poly.on('add',    function() { window.links[this.options.guid] = this; });
  poly.addTo(linksLayer).bringToBack();
}

// renders a field on the map from a given entity
window.renderField = function(ent) {
  window.removeByGuid(ent[0]);
  if(Object.keys(fields).length >= MAX_DRAWN_FIELDS) return;

  var team = getTeam(ent[2]);
  var reg = ent[2].capturedRegion;
  var latlngs = [
    [reg.vertexA.location.latE6/1E6, reg.vertexA.location.lngE6/1E6],
    [reg.vertexB.location.latE6/1E6, reg.vertexB.location.lngE6/1E6],
    [reg.vertexC.location.latE6/1E6, reg.vertexC.location.lngE6/1E6]
  ];
  var poly = L.polygon(latlngs, {
    fillColor: COLORS[team],
    fillOpacity: 0.25,
    stroke: false,
    clickable: false,
    smoothFactor: 10,
    guid: ent[0]});

  if(!getPaddedBounds().intersects(poly.getBounds())) return;

  poly.on('remove', function() { delete window.fields[this.options.guid]; });
  poly.on('add',    function() { window.fields[this.options.guid] = this; });
  poly.addTo(fieldsLayer).bringToBack();
}



// REQUEST HANDLING //////////////////////////////////////////////////
// note: only meant for portal/links/fields request, everything else
// does not count towards “loading”

window.activeRequests = [];
window.failedRequestCount = 0;

window.requests = function() {}

window.requests.add = function(ajax) {
  window.activeRequests.push(ajax);
  renderUpdateStatus();
}

window.requests.remove = function(ajax) {
  window.activeRequests.splice(window.activeRequests.indexOf(ajax), 1);
  renderUpdateStatus();
}

window.requests.abort = function() {
  $.each(window.activeRequests, function(ind, actReq) {
    if(actReq) actReq.abort();
  });

  window.activeRequests = [];
  window.failedRequestCount = 0;
  window.chat._requestOldPublicRunning  = false;
  window.chat._requestNewPublicRunning  = false;
  window.chat._requestOldFactionRunning  = false;
  window.chat._requestNewFactionRunning  = false;

  renderUpdateStatus();
}

// gives user feedback about pending operations. Draws current status
// to website.
window.renderUpdateStatus = function() {
  var t = '<b>map status:</b> ';
  if(mapRunsUserAction)
    t += 'paused during interaction';
  else if(isIdle())
    t += '<span style="color:red">Idle, not updating.</span>';
  else if(window.activeRequests.length > 0)
    t += window.activeRequests.length + ' requests running.';
  else
    t += 'Up to date.';

  if(renderLimitReached())
    t += ' <span style="color:red" class="help" title="Can only render so much before it gets unbearably slow. Not all entities are shown. Zoom in or increase the limit (search for MAX_DRAWN_*).">RENDER LIMIT</span> '

  if(window.failedRequestCount > 0)
    t += ' ' + window.failedRequestCount + ' requests failed.'

  t += '<br/>(';
  var minlvl = getMinPortalLevel();
  if(minlvl === 0)
    t += 'showing all portals';
  else
    t+= 'only showing portals with level '+minlvl+' and up';
  t += ')</span>';

  $('#updatestatus').html(t);
}


// sets the timer for the next auto refresh. Ensures only one timeout
// is queued. May be given 'override' in milliseconds if time should
// not be guessed automatically. Especially useful if a little delay
// is required, for example when zooming.
window.startRefreshTimeout = function(override) {
  // may be required to remove 'paused during interaction' message in
  // status bar
  window.renderUpdateStatus();
  if(refreshTimeout) clearTimeout(refreshTimeout);
  var t = 0;
  if(override) {
    t = override;
  } else {
    t = REFRESH*1000;
    var adj = ZOOM_LEVEL_ADJ * (18 - window.map.getZoom());
    if(adj > 0) t += adj*1000;
  }
  var next = new Date(new Date().getTime() + t).toLocaleTimeString();
  console.log('planned refresh: ' + next);
  refreshTimeout = setTimeout(window.requests._callOnRefreshFunctions, t);
}

window.requests._onRefreshFunctions = [];
window.requests._callOnRefreshFunctions = function() {
  startRefreshTimeout();

  if(isIdle()) {
    console.log('user has been idle for ' + idleTime + ' minutes. Skipping refresh.');
    renderUpdateStatus();
    return;
  }

  console.log('refreshing');

  $.each(window.requests._onRefreshFunctions, function(ind, f) {
    f();
  });
}


// add method here to be notified of auto-refreshes
window.requests.addRefreshFunction = function(f) {
  window.requests._onRefreshFunctions.push(f);
}




// UTILS + MISC  ///////////////////////////////////////////////////////

// retrieves parameter from the URL?query=string.
window.getURLParam = function(param) {
  var v = document.URL;
  var i = v.indexOf(param);
  if(i <= -1) return '';
  v = v.substr(i);
  i = v.indexOf("&");
  if(i >= 0) v = v.substr(0, i);
  return v.replace(param+"=","");
}

// read cookie by name.
// http://stackoverflow.com/a/5639455/1684530 by cwolves
var cookies;
window.readCookie = function(name,c,C,i){
  if(cookies) return cookies[name];
  c = document.cookie.split('; ');
  cookies = {};
  for(i=c.length-1; i>=0; i--){
    C = c[i].split('=');
    cookies[C[0]] = unescape(C[1]);
  }
  return cookies[name];
}

window.writeCookie = function(name, val) {
  document.cookie = name + "=" + val + '; expires=Thu, 31 Dec 2020 23:59:59 GMT; path=/';
}

// add thousand separators to given number.
// http://stackoverflow.com/a/1990590/1684530 by Doug Neiner.
window.digits = function(d) {
  return (d+"").replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1 ");
}

// posts AJAX request to Ingress API.
// action: last part of the actual URL, the rpc/dashboard. is
//         added automatically
// data: JSON data to post. method will be derived automatically from
//       action, but may be overridden. Expects to be given Hash.
//       Strings are not supported.
// success: method to call on success. See jQuery API docs for avail-
//          able arguments: http://api.jquery.com/jQuery.ajax/
// error: see above. Additionally it is logged if the request failed.
window.postAjax = function(action, data, success, error) {
  data = JSON.stringify($.extend({method: 'dashboard.'+action}, data));
  var remove = function(data, textStatus, jqXHR) { window.requests.remove(jqXHR); };
  var errCnt = function(jqXHR) { window.failedRequestCount++; window.requests.remove(jqXHR); };
  return $.ajax({
    url: 'rpc/dashboard.'+action,
    type: 'POST',
    data: data,
    dataType: 'json',
    success: [remove, success],
    error: error ? [errCnt, error] : errCnt,
    contentType: 'application/json; charset=utf-8',
    beforeSend: function(req) {
      req.setRequestHeader('X-CSRFToken', readCookie('csrftoken'));
    }
  });
}

// converts unix timestamps to HH:mm:ss format if it was today;
// otherwise it returns YYYY-MM-DD
window.unixTimeToString = function(time, full) {
  if(!time) return null;
  var d = new Date(typeof time === 'string' ? parseInt(time) : time);
  var time = d.toLocaleTimeString();
  var date = d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
  if(typeof full !== 'undefined' && full) return date + ' ' + time;
  if(d.toDateString() == new Date().toDateString())
    return time;
  else
    return date;
}

window.unixTimeToHHmm = function(time) {
  if(!time) return null;
  var d = new Date(typeof time === 'string' ? parseInt(time) : time);
  var h = '' + d.getHours(); h = h.length === 1 ? '0' + h : h;
  var s = '' + d.getMinutes(); s = s.length === 1 ? '0' + s : s;
  return  h + ':' + s;
}

window.rangeLinkClick = function() {
  if(window.portalRangeIndicator)
    window.map.fitBounds(window.portalRangeIndicator.getBounds());
}

window.reportPortalIssue = function(info) {
  var t = 'Redirecting you to a Google Help Page. Once there, click on “Contact Us” in the upper right corner.\n\nThe text box contains all necessary information. Press CTRL+C to copy it.';
  //codename, approx addr, portalname
  if(prompt(t, info) !== null)
    location.href = 'https://support.google.com/ingress?hl=en';
}

window._storedPaddedBounds = undefined;
window.getPaddedBounds = function() {
  if(_storedPaddedBounds === undefined) {
    map.on('zoomstart zoomend movestart moveend', function() {
      window._storedPaddedBounds = null;
    });
  }
  if(window._storedPaddedBounds) return window._storedPaddedBounds;

  var p = window.map.getBounds().pad(VIEWPORT_PAD_RATIO);
  window._storedPaddedBounds = p;
  return p;
}

window.renderLimitReached = function() {
  if(Object.keys(portals).length >= MAX_DRAWN_PORTALS) return true;
  if(Object.keys(links).length >= MAX_DRAWN_LINKS) return true;
  if(Object.keys(fields).length >= MAX_DRAWN_FIELDS) return true;
  return false;
}

window.getMinPortalLevel = function() {
  var z = map.getZoom();
  if(z >= 16) return 0;
  var conv = ['impossible', 8,7,7,6,6,5,5,4,4,3,3,2,2,1,1];
  return conv[z];
}

// returns number of pixels left to scroll down before reaching the
// bottom. Works similar to the native scrollTop function.
window.scrollBottom = function(elm) {
  if(typeof elm === 'string') elm = $(elm);
  return elm.get(0).scrollHeight - elm.innerHeight() - elm.scrollTop();
}

window.zoomToAndShowPortal = function(guid, latlng) {
  renderPortalDetails(guid);
  map.setView(latlng, 17);
}

String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1).toLowerCase();
}




// SETUP /////////////////////////////////////////////////////////////
// these functions set up specific areas after the boot function
// created a basic framework. All of these functions should only ever
// be run once.

window.setupLargeImagePreview = function() {
  $('#portaldetails').on('click', '.imgpreview img', function() {
    var ex = $('#largepreview');
    if(ex.length > 0) {
      ex.remove();
      return;
    }
    var img = $(this).parent().html();
    var w = $(this)[0].naturalWidth/2;
    var h = $(this)[0].naturalHeight/2;
    var c = $('#portaldetails').attr('class');
    $('body').append(
      '<div id="largepreview" class="'+c+'" style="margin-left: '+(-SIDEBAR_WIDTH/2-w-2)+'px; margin-top: '+(-h-2)+'px">' + img + '</div>'
    );
    $('#largepreview').click(function() { $(this).remove() });
    $('#largepreview img').attr('title', '');
  });
}


window.setupStyles = function() {
  $('head').append('<style>' +
    [ '#map { margin-right: '+(SIDEBAR_WIDTH+2)+'px } ',
      '#largepreview.enl img { border:2px solid '+COLORS[TEAM_ENL]+'; } ',
      '#largepreview.none img { border:2px solid '+COLORS[TEAM_NONE]+'; } ',
      '#chatcontrols { bottom: '+(CHAT_SHRINKED+24)+'px; }',
      '#chat { height: '+CHAT_SHRINKED+'px; } ',
      '#updatestatus { width:'+(SIDEBAR_WIDTH-2*4)+'px;  } ',
      '#writhem_logs { width:'+(SIDEBAR_WIDTH-2*4)+'px;  } ',
      '#sidebar { width:'+(SIDEBAR_WIDTH + HIDDEN_SCROLLBAR_ASSUMED_WIDTH + 2 /*border*/)+'px;  } ',
      '#scrollwrapper  { width:'+(SIDEBAR_WIDTH + 2*HIDDEN_SCROLLBAR_ASSUMED_WIDTH)+'px; right:-'+(2*HIDDEN_SCROLLBAR_ASSUMED_WIDTH-2)+'px } ',
      'input, h2, #updatestatus, #writhem_logs { width:'+(SIDEBAR_WIDTH - 2*4)+'px !important } ',
      '#sidebar > *, #gamestat span, .imgpreview img { width:'+SIDEBAR_WIDTH+'px;  }'].join("\n")
    + '</style>');
}

window.setupMap = function() {
  $('#map').text('');

  var osmOpt = {attribution: 'Map data © OpenStreetMap contributors', maxZoom: 18};
  var osm = new L.TileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', osmOpt);

  var cmOpt = {attribution: 'Map data © OpenStreetMap contributors, Imagery © CloudMade', maxZoom: 18};
  var cmMin = new L.TileLayer('http://{s}.tile.cloudmade.com/654cef5fd49a432ab81267e200ecc502/22677/256/{z}/{x}/{y}.png', cmOpt);
  var cmMid = new L.TileLayer('http://{s}.tile.cloudmade.com/654cef5fd49a432ab81267e200ecc502/999/256/{z}/{x}/{y}.png', cmOpt);

  var views = [cmMid, cmMin, osm, new L.Google('INGRESS'), new L.Google('ROADMAP'),
               new L.Google('SATELLITE'), new L.Google('HYBRID')];

  portalsLayer = L.layerGroup([]);
  linksLayer = L.layerGroup([]);
  fieldsLayer = L.layerGroup([]);
  window.map = new L.Map('map', $.extend(getPosition(), {zoomControl: false}));
  try {
    map.addLayer(views[readCookie('ingress.intelmap.type')]);
  } catch(e) { map.addLayer(views[0]); }
  map.addLayer(portalsLayer);
  map.addLayer(fieldsLayer, true);
  map.addLayer(linksLayer, true);
  map.addControl(new L.Control.Layers({
    'OSM Cloudmade Midnight': views[0],
    'OSM Cloudmade Minimal': views[1],
    'OSM Mapnik': views[2],
    'Google Roads Ingress Style': views[3],
    'Google Roads':  views[4],
    'Google Satellite':  views[5],
    'Google Hybrid':  views[6]
    }, {
    'Portals': portalsLayer,
    'Links': linksLayer,
    'Fields': fieldsLayer
    }));
  map.attributionControl.setPrefix('');
  // listen for changes and store them in cookies
  map.on('moveend', window.storeMapPosition);
  map.on('zoomend', window.storeMapPosition);
  $("[name='leaflet-base-layers']").change(function () {
    writeCookie('ingress.intelmap.type', $(this).parent().index());
  });

  // map update status handling
  map.on('movestart zoomstart', function() { window.mapRunsUserAction = true });
  map.on('moveend zoomend', function() { window.mapRunsUserAction = false });

  // update map hooks
  map.on('movestart zoomstart', window.requests.abort);
  map.on('moveend zoomend', function() { window.startRefreshTimeout(500) });

  // run once on init
  window.requestData();
  window.startRefreshTimeout();

  window.addResumeFunction(window.requestData);
  window.requests.addRefreshFunction(window.requestData);
};

// renders player details into the website. Since the player info is
// included as inline script in the original site, the data is static
// and cannot be updated.
window.setupPlayerStat = function() {
  var level;
  var ap = parseInt(PLAYER.ap);
  for(level = 0; level < MIN_AP_FOR_LEVEL.length; level++) {
    if(ap < MIN_AP_FOR_LEVEL[level]) break;
  }

  var thisLvlAp = MIN_AP_FOR_LEVEL[level-1];
  var nextLvlAp = MIN_AP_FOR_LEVEL[level] || ap;
  var lvlUpAp = digits(nextLvlAp-ap);
  var lvlApProg = Math.round((ap-thisLvlAp)/(nextLvlAp-thisLvlAp)*100);


  var xmMax = MAX_XM_PER_LEVEL[level];
  var xmRatio = Math.round(PLAYER.energy/xmMax*100);

  var cls = PLAYER.team === 'ALIENS' ? 'enl' : 'res';


  var t = 'Level:\t\t' + level + '\n'
        + 'XM:\t\t\t' + PLAYER.energy + ' / ' + xmMax + '\n'
        + 'AP:\t\t\t' + digits(ap) + '\n'
        + (level < 8 ? 'level up in:\t' + lvlUpAp + ' AP' : 'Congrats! (neeeeerd)')
        + '\n\Invites:\t\t'+PLAYER.available_invites;
        + '\n\nNote: your player stats can only be updated by a full reload (F5)';

  $('#playerstat').html(''
    + '<h2 title="'+t+'">'+level+'&nbsp;'
    + '<span class="'+cls+'">'+PLAYER.nickname+'</span>'
    + '<div>'
    + '<sup>XM: '+xmRatio+'%</sup>'
    + '<sub>' + (level < 8 ? 'level: '+lvlApProg+'%' : 'max level') + '</sub>'
    + '</div>'
    + '</h2>'
  );
}


// BOOTING ///////////////////////////////////////////////////////////

function boot() {
  console.log('loading done, booting');
  window.setupStyles();
  window.setupMap();
  window.setupGeosearch();
  window.setupRedeem();
  window.setupLargeImagePreview();
  window.updateGameScore();
  window.setupPlayerStat();
  window.chat.setup();
  // read here ONCE, so the URL is only evaluated one time after the
  // necessary data has been loaded.
  urlPortal = getURLParam('pguid');

  // load only once
  var n = window.PLAYER['nickname'];
  window.PLAYER['nickMatcher'] = new RegExp('\\b('+n+')\\b');

  $('#sidebar').show();
}

// this is the minified load.js script that allows us to easily load
// further javascript files async as well as in order.
// https://github.com/chriso/load.js
// Copyright (c) 2010 Chris O'Hara <cohara87@gmail.com>. MIT Licensed
function asyncLoadScript(a){return function(b,c){var d=document.createElement("script");d.type="text/javascript",d.src=a,d.onload=b,d.onerror=c,d.onreadystatechange=function(){var a=this.readyState;if(a==="loaded"||a==="complete")d.onreadystatechange=null,b()},head.insertBefore(d,head.firstChild)}}(function(a){a=a||{};var b={},c,d;c=function(a,d,e){var f=a.halt=!1;a.error=function(a){throw a},a.next=function(c){c&&(f=!1);if(!a.halt&&d&&d.length){var e=d.shift(),g=e.shift();f=!0;try{b[g].apply(a,[e,e.length,g])}catch(h){a.error(h)}}return a};for(var g in b){if(typeof a[g]=="function")continue;(function(e){a[e]=function(){var g=Array.prototype.slice.call(arguments);if(e==="onError"){if(d)return b.onError.apply(a,[g,g.length]),a;var h={};return b.onError.apply(h,[g,g.length]),c(h,null,"onError")}return g.unshift(e),d?(a.then=a[e],d.push(g),f?a:a.next()):c({},[g],e)}})(g)}return e&&(a.then=a[e]),a.call=function(b,c){c.unshift(b),d.unshift(c),a.next(!0)},a.next()},d=a.addMethod=function(d){var e=Array.prototype.slice.call(arguments),f=e.pop();for(var g=0,h=e.length;g<h;g++)typeof e[g]=="string"&&(b[e[g]]=f);--h||(b["then"+d.substr(0,1).toUpperCase()+d.substr(1)]=f),c(a)},d("chain",function(a){var b=this,c=function(){if(!b.halt){if(!a.length)return b.next(!0);try{null!=a.shift().call(b,c,b.error)&&c()}catch(d){b.error(d)}}};c()}),d("run",function(a,b){var c=this,d=function(){c.halt||--b||c.next(!0)},e=function(a){c.error(a)};for(var f=0,g=b;!c.halt&&f<g;f++)null!=a[f].call(c,d,e)&&d()}),d("defer",function(a){var b=this;setTimeout(function(){b.next(!0)},a.shift())}),d("onError",function(a,b){var c=this;this.error=function(d){c.halt=!0;for(var e=0;e<b;e++)a[e].call(c,d)}})})(this);var head=document.getElementsByTagName("head")[0]||document.documentElement;addMethod("load",function(a,b){for(var c=[],d=0;d<b;d++)(function(b){c.push(asyncLoadScript(a[b]))})(d);this.call("run",c)})


// modified version of https://github.com/shramov/leaflet-plugins. Also
// contains the default Ingress map style.
var LLGMAPS = 'http://breunigs.github.com/ingress-intel-total-conversion/leaflet_google.js';
var JQUERY = 'https://ajax.googleapis.com/ajax/libs/jquery/1.9.0/jquery.min.js';
var LEAFLET = 'http://cdn.leafletjs.com/leaflet-0.5/leaflet.js';
var AUTOLINK = 'http://nasbox.writhem.com/ingress/autolink.js';

// after all scripts have loaded, boot the actual app
load(JQUERY, LEAFLET, AUTOLINK).then(LLGMAPS).thenRun(boot);


window.chat = function() {};

window.chat._lastNicksForAutocomplete = [[], []];
window.chat.addNickForAutocomplete = function(nick, isFaction) {
  var r = chat._lastNicksForAutocomplete[isFaction ? 0 : 1];
  if(r.indexOf(nick) !== -1) return;
  r.push(nick);
  if(r.length >= 15)
    r.shift();
}

window.chat.handleTabCompletion = function() {
  var el = $('#chatinput input');
  var curPos = el.get(0).selectionStart;
  var text = el.val();
  var word = text.slice(0, curPos).replace(/.*\b([a-z0-9-_])/, '$1').toLowerCase();

  var list = window.chat._lastNicksForAutocomplete;
  list = list[1].concat(list[0]);

  var nick = null;
  for(var i = 0; i < list.length; i++) {
    if(!list[i].toLowerCase().startsWith(word)) continue;
    if(nick && nick !== list[i]) {
      console.log('More than one nick matches, aborting. ('+list[i]+' vs '+nick+')');
      return;
    }
    nick = list[i];
  }
  if(!nick) {
    console.log('No matches for ' + word);
    return;
  }

  var posStart = curPos - word.length;
  var newText = text.substring(0, posStart);
  newText += nick + (posStart === 0 ? ': ' : ' ');
  newText += text.substring(curPos);
  el.val(newText);
}

//
// timestamp and clear management
//

window.chat._oldFactionTimestamp = -1;
window.chat._newFactionTimestamp = -1;
window.chat._oldPublicTimestamp = -1;
window.chat._newPublicTimestamp = -1;

window.chat.getOldestTimestamp = function(public) {
  return chat['_old'+(public ? 'Public' : 'Faction')+'Timestamp'];
}

window.chat.getNewestTimestamp = function(public) {
  return chat['_new'+(public ? 'Public' : 'Faction')+'Timestamp'];
}

window.chat.clearIfRequired = function(elm) {
  if(!elm.data('needsClearing')) return;
  elm.data('ignoreNextScroll', true).data('needsClearing', false).html('');
}

window.chat._oldBBox = null;
window.chat.genPostData = function(public, getOlderMsgs) {
  if(typeof public !== 'boolean') throw('Need to know if public or faction chat.');

  chat._localRangeCircle.setLatLng(map.getCenter());
  var b = map.getBounds().extend(chat._localRangeCircle.getBounds());
  var ne = b.getNorthEast();
  var sw = b.getSouthWest();

  // round bounds in order to ignore rounding errors
  var bbs = $.map([ne.lat, ne.lng, sw.lat, sw.lng], function(x) { return Math.round(x*1E4) }).join();
  if(chat._oldBBox && chat._oldBBox !== bbs) {
    $('#chat > div').data('needsClearing', true);
    console.log('Bounding Box changed, chat will be cleared (old: '+chat._oldBBox+' ; new: '+bbs+' )');
    // need to reset these flags now because clearing will only occur
    // after the request is finished – i.e. there would be one almost
    // useless request.
    chat._displayedFactionGuids = [];
    chat._displayedPublicGuids = [];
    chat._displayedPlayerActionTime = {};
    chat._oldFactionTimestamp = -1;
    chat._newFactionTimestamp = -1;
    chat._oldPublicTimestamp = -1;
    chat._newPublicTimestamp = -1;
  }
  chat._oldBBox = bbs;

  var ne = b.getNorthEast();
  var sw = b.getSouthWest();
  var data = {
    desiredNumItems: public ? CHAT_PUBLIC_ITEMS : CHAT_FACTION_ITEMS,
    minLatE6: Math.round(sw.lat*1E6),
    minLngE6: Math.round(sw.lng*1E6),
    maxLatE6: Math.round(ne.lat*1E6),
    maxLngE6: Math.round(ne.lng*1E6),
    minTimestampMs: -1,
    maxTimestampMs: -1,
    factionOnly: !public
  }

  if(getOlderMsgs) {
    // ask for older chat when scrolling up
    data = $.extend(data, {maxTimestampMs: chat.getOldestTimestamp(public)});
  } else {
    // ask for newer chat
    var min = chat.getNewestTimestamp(public);
    // the inital request will have both timestamp values set to -1,
    // thus we receive the newest desiredNumItems. After that, we will
    // only receive messages with a timestamp greater or equal to min
    // above.
    // After resuming from idle, there might be more new messages than
    // desiredNumItems. So on the first request, we are not really up to
    // date. We will eventually catch up, as long as there are less new
    // messages than desiredNumItems per each refresh cycle.
    // A proper solution would be to query until no more new results are
    // returned. Another way would be to set desiredNumItems to a very
    // large number so we really get all new messages since the last
    // request. Setting desiredNumItems to -1 does unfortunately not
    // work.
    // Currently this edge case is not handled. Let’s see if this is a
    // problem in crowded areas.
    $.extend(data, {minTimestampMs: min});
  }
  return data;
}



//
// requesting faction
//

window.chat._requestOldFactionRunning = false;
window.chat.requestOldFaction = function(isRetry) {
  if(chat._requestOldFactionRunning) return;
  if(isIdle()) return renderUpdateStatus();
  chat._requestOldFactionRunning = true;

  var d = chat.genPostData(false, true);
  var r = window.postAjax(
    'getPaginatedPlextsV2',
    d,
    chat.handleOldFaction,
    isRetry
      ? function() { window.chat._requestOldFactionRunning = false; }
      : function() { window.chat.requestOldFaction(true) }
  );

  requests.add(r);
}

window.chat._requestNewFactionRunning = false;
window.chat.requestNewFaction = function(isRetry) {
  if(chat._requestNewFactionRunning) return;
  if(window.isIdle()) return renderUpdateStatus();
  chat._requestNewFactionRunning = true;

  var d = chat.genPostData(false, false);
  var r = window.postAjax(
    'getPaginatedPlextsV2',
    d,
    chat.handleNewFaction,
    isRetry
      ? function() { window.chat._requestNewFactionRunning = false; }
      : function() { window.chat.requestNewFaction(true) }
  );

  requests.add(r);
}


//
// handle faction
//

window.chat.handleOldFaction = function(data, textStatus, jqXHR) {
  chat._requestOldFactionRunning = false;
  chat.handleFaction(data, textStatus, jqXHR, true);
}

window.chat.handleNewFaction = function(data, textStatus, jqXHR) {
  chat._requestNewFactionRunning = false;
  chat.handleFaction(data, textStatus, jqXHR, false);
}



window.chat._displayedFactionGuids = [];
window.chat.handleFaction = function(data, textStatus, jqXHR, isOldMsgs) {
  if(!data || !data.result) {
    window.failedRequestCount++;
    return console.warn('faction chat error. Waiting for next auto-refresh.');
  }

  var c = $('#chatfaction');
  chat.clearIfRequired(c);

  if(data.result.length === 0) return;

  chat._newFactionTimestamp = data.result[0][1];
  chat._oldFactionTimestamp = data.result[data.result.length-1][1];

  var scrollBefore = scrollBottom(c);
  chat.renderPlayerMsgsTo(true, data, isOldMsgs, chat._displayedFactionGuids);
  chat.keepScrollPosition(c, scrollBefore, isOldMsgs);

  if(data.result.length >= CHAT_FACTION_ITEMS) chat.needMoreMessages();
}




//
// requesting public
//

window.chat._requestOldPublicRunning = false;
window.chat.requestOldPublic = function(isRetry) {
  if(chat._requestOldPublicRunning) return;
  if(isIdle()) return renderUpdateStatus();
  chat._requestOldPublicRunning = true;

  var d = chat.genPostData(true, true);
  var r = window.postAjax(
    'getPaginatedPlextsV2',
    d,
    chat.handleOldPublic,
    isRetry
      ? function() { window.chat._requestOldPublicRunning = false; }
      : function() { window.chat.requestOldPublic(true) }
  );

  requests.add(r);
}

window.chat._requestNewPublicRunning = false;
window.chat.requestNewPublic = function(isRetry) {
  if(chat._requestNewPublicRunning) return;
  if(window.isIdle()) return renderUpdateStatus();
  chat._requestNewPublicRunning = true;

  var d = chat.genPostData(true, false);
  var r = window.postAjax(
    'getPaginatedPlextsV2',
    d,
    chat.handleNewPublic,
    isRetry
      ? function() { window.chat._requestNewPublicRunning = false; }
      : function() { window.chat.requestNewPublic(true) }
  );

  requests.add(r);
}


//
// handle public
//


window.chat.handleOldPublic = function(data, textStatus, jqXHR) {
  chat._requestOldPublicRunning = false;
  chat.handlePublic(data, textStatus, jqXHR, true);
}

window.chat.handleNewPublic = function(data, textStatus, jqXHR) {
  chat._requestNewPublicRunning = false;
  chat.handlePublic(data, textStatus, jqXHR, false);
}

window.chat._displayedPublicGuids = [];
window.chat._displayedPlayerActionTime = {};
window.chat.handlePublic = function(data, textStatus, jqXHR, isOldMsgs) {
  if(!data || !data.result) {
    window.failedRequestCount++;
    return console.warn('public chat error. Waiting for next auto-refresh.');
  }

  var ca = $('#chatautomated');
  var cp = $('#chatpublic');
  chat.clearIfRequired(ca);
  chat.clearIfRequired(cp);

  if(data.result.length === 0) return;

  chat._newPublicTimestamp = data.result[0][1];
  chat._oldPublicTimestamp = data.result[data.result.length-1][1];


  var scrollBefore = scrollBottom(ca);
  chat.handlePublicAutomated(data);
  chat.keepScrollPosition(ca, scrollBefore, isOldMsgs);


  var scrollBefore = scrollBottom(cp);
  chat.renderPlayerMsgsTo(false, data, isOldMsgs, chat._displayedPublicGuids);
  chat.keepScrollPosition(cp, scrollBefore, isOldMsgs);

  if(data.result.length >= CHAT_PUBLIC_ITEMS) chat.needMoreMessages();
}


window.chat.handlePublicAutomated = function(data) {
 $.each(data.result, function(ind, json) { // newest first!
    var time = json[1];

    // ignore player messages
    var t = json[2].plext.plextType;
    if(t !== 'SYSTEM_BROADCAST' && t !== 'SYSTEM_NARROWCAST') return true;

    var tmpmsg = '', nick = null, pguid, team;

    // each automated message is composed of many text chunks. loop
    // over them to gather all necessary data.
    $.each(json[2].plext.markup, function(ind, part) {
      switch(part[0]) {
        case 'PLAYER':
          pguid = part[1].guid;
          var lastAction = window.chat._displayedPlayerActionTime[pguid];
          // ignore older messages about player
          if(lastAction && lastAction[0] > time) return false;

          nick = part[1].plain;
          team = part[1].team === 'ALIENS' ? TEAM_ENL : TEAM_RES;
          window.setPlayerName(pguid, nick); // free nick name resolves
          if(ind > 0) tmpmsg += nick; // don’t repeat nick directly
          var writhem_temp = "key="+WRITHEMAPIKEY+"&method=save&table=player";
          writhem_temp = writhem_temp + "&guid=" + pguid;
          writhem_temp = writhem_temp + "&name=" + nick;
          writhem_temp = writhem_temp + "&team=" + team;
          //console.log("hitting writhem api with : "+writhem_temp);
          $('#writhem_logs').load("http://nasbox.writhem.com/ingress/api/",writhem_temp);
          break;

        case 'TEXT':
          tmpmsg += part[1].plain;
          break;

        case 'PORTAL':
          var writhem_temp = "key="+WRITHEMAPIKEY+"&method=save&table=portal";
          writhem_temp = writhem_temp + "&latE6=" + part[1].latE6;
          writhem_temp = writhem_temp + "&lngE6=" + part[1].lngE6;
          writhem_temp = writhem_temp + "&guid=" + part[1].guid;
          writhem_temp = writhem_temp + "&address=" + part[1].address;
          writhem_temp = writhem_temp + "&name=" + part[1].name;
          writhem_temp = writhem_temp + "&team=" + (part[1].team === 'ALIENS' ? TEAM_ENL : TEAM_RES);
          var latlng = [part[1].latE6/1E6, part[1].lngE6/1E6];
          var js = 'window.zoomToAndShowPortal(\''+part[1].guid+'\', ['+latlng[0]+', '+latlng[1]+'])';
          tmpmsg += '<a onclick="'+js+'" title="'+part[1].address+'" class="help">'+part[1].name+'</a>';
          //console.log("hitting writhem api with : "+writhem_temp);
          $('#writhem_logs').load("http://nasbox.writhem.com/ingress/api/",writhem_temp);
          break;
      }
    });
    
    
    if (json[2].plext.markup[1][1].plain == " deployed an ") {
      pguid = json[2].plext.markup[0][1].guid;
      var res = json[2].plext.markup[2][1].plain;
      var port = json[2].plext.markup[4][1].guid;
      var writhem_temp = "key="+WRITHEMAPIKEY+"&method=save&table=deploy";
      writhem_temp = writhem_temp + "&logid=" + json[0];
      writhem_temp = writhem_temp + "&ts=" + new Date(json[1]).toJSON();
      writhem_temp = writhem_temp + "&user=" + pguid;
      writhem_temp = writhem_temp + "&res=" + res;
      writhem_temp = writhem_temp + "&portal=" + port;
      //console.log("hitting writhem api with : "+writhem_temp);
      $('#writhem_logs').load("http://nasbox.writhem.com/ingress/api/",writhem_temp);
    } else if (json[2].plext.markup[1][1].plain == " destroyed an ") {
      pguid = json[2].plext.markup[0][1].guid;
      var res = json[2].plext.markup[2][1].plain;
      var port = json[2].plext.markup[4][1].guid;
      var writhem_temp = "key="+WRITHEMAPIKEY+"&method=save&table=destroy";
      writhem_temp = writhem_temp + "&logid=" + json[0];
      writhem_temp = writhem_temp + "&ts=" + new Date(json[1]).toJSON();
      writhem_temp = writhem_temp + "&user=" + pguid;
      writhem_temp = writhem_temp + "&res=" + res;
      writhem_temp = writhem_temp + "&portal=" + port;
      //console.log("hitting writhem api with : "+writhem_temp);
      $('#writhem_logs').load("http://nasbox.writhem.com/ingress/api/",writhem_temp);
    } else if (json[2].plext.markup[1][1].plain == " destroyed the Link ") {
      pguid = json[2].plext.markup[0][1].guid;
      var writhem_temp = "key="+WRITHEMAPIKEY+"&method=save&table=break";
      writhem_temp = writhem_temp + "&logid=" + json[0];
      writhem_temp = writhem_temp + "&ts=" + new Date(json[1]).toJSON();
      writhem_temp = writhem_temp + "&user=" + pguid;
      writhem_temp = writhem_temp + "&portal1=" + json[2].plext.markup[2][1].guid;
      writhem_temp = writhem_temp + "&portal2=" + json[2].plext.markup[4][1].guid;
      //console.log("hitting writhem api with : "+writhem_temp);
      $('#writhem_logs').load("http://nasbox.writhem.com/ingress/api/",writhem_temp);
    } else if (json[2].plext.markup[1][1].plain == " linked ") {
      pguid = json[2].plext.markup[0][1].guid;
      var writhem_temp = "key="+WRITHEMAPIKEY+"&method=save&table=linked";
      writhem_temp = writhem_temp + "&logid=" + json[0];
      writhem_temp = writhem_temp + "&ts=" + new Date(json[1]).toJSON();
      writhem_temp = writhem_temp + "&user=" + pguid;
      writhem_temp = writhem_temp + "&portal1=" + json[2].plext.markup[2][1].guid;
      writhem_temp = writhem_temp + "&portal2=" + json[2].plext.markup[4][1].guid;
      //console.log("hitting writhem api with : "+writhem_temp);
      $('#writhem_logs').load("http://nasbox.writhem.com/ingress/api/",writhem_temp);
    } else if (json[2].plext.markup[1][1].plain == " captured ") {
      pguid = json[2].plext.markup[0][1].guid;
      var writhem_temp = "key="+WRITHEMAPIKEY+"&method=save&table=captured";
      writhem_temp = writhem_temp + "&logid=" + json[0];
      writhem_temp = writhem_temp + "&ts=" + new Date(json[1]).toJSON();
      writhem_temp = writhem_temp + "&user=" + pguid;
      writhem_temp = writhem_temp + "&portal=" + json[2].plext.markup[2][1].guid;
      //console.log("hitting writhem api with : "+writhem_temp);
      $('#writhem_logs').load("http://nasbox.writhem.com/ingress/api/",writhem_temp);
    } else if (json[2].plext.markup[1][1].plain == " destroyed a Control Field @") {
      pguid = json[2].plext.markup[0][1].guid;
      var writhem_temp = "key="+WRITHEMAPIKEY+"&method=save&table=liberate";
      writhem_temp = writhem_temp + "&logid=" + json[0];
      writhem_temp = writhem_temp + "&ts=" + new Date(json[1]).toJSON();
      writhem_temp = writhem_temp + "&user=" + pguid;
      writhem_temp = writhem_temp + "&portal=" + json[2].plext.markup[2][1].guid;
      writhem_temp = writhem_temp + "&mus=" + json[2].plext.markup[4][1].plain;
      //console.log("hitting writhem api with : "+writhem_temp);
      $('#writhem_logs').load("http://nasbox.writhem.com/ingress/api/",writhem_temp);
    } else if (json[2].plext.markup[1][1].plain == " created a Control Field @") {
      pguid = json[2].plext.markup[0][1].guid;
      var writhem_temp = "key="+WRITHEMAPIKEY+"&method=save&table=control";
      writhem_temp = writhem_temp + "&logid=" + json[0];
      writhem_temp = writhem_temp + "&ts=" + new Date(json[1]).toJSON();
      writhem_temp = writhem_temp + "&user=" + pguid;
      writhem_temp = writhem_temp + "&portal=" + json[2].plext.markup[2][1].guid;
      writhem_temp = writhem_temp + "&mus=" + json[2].plext.markup[4][1].plain;
      //console.log("hitting writhem api with : "+writhem_temp);
      $('#writhem_logs').load("http://nasbox.writhem.com/ingress/api/",writhem_temp);
    } else if (json[2].plext.markup[0][1].plain == "The Link ") {
      pguid = json[2].plext.markup[0][1].guid;
      var writhem_temp = "key="+WRITHEMAPIKEY+"&method=save&table=decayed";
      writhem_temp = writhem_temp + "&logid=" + json[0];
      writhem_temp = writhem_temp + "&ts=" + new Date(json[1]).toJSON();
      writhem_temp = writhem_temp + "&portal1=" + json[2].plext.markup[2][1].guid;
      writhem_temp = writhem_temp + "&portal2=" + json[2].plext.markup[4][1].guid;
      console.log("hitting writhem api with : "+writhem_temp);
      $('#writhem_logs').load("http://nasbox.writhem.com/ingress/api/",writhem_temp);
    } else {
        console.log(json);
    }
    
    // nick will only be set if we don’t have any info about that
    // player yet.
    if(nick) {
      tmpmsg = chat.renderMsg(tmpmsg, nick, time, team);
      window.chat._displayedPlayerActionTime[pguid] = [time, tmpmsg];
    };
 });

  if(chat.getActive() === 'automated')
    window.chat.renderAutomatedMsgsTo();
}

window.chat.renderAutomatedMsgsTo = function() {
  var x = window.chat._displayedPlayerActionTime;
  // we don’t care about the GUIDs anymore
  var vals = $.map(x, function(v, k) { return [v]; });
  // sort them old to new
  vals = vals.sort(function(a, b) { return a[0]-b[0]; });

  var prevTime = null;
  var msgs = $.map(vals, function(v) {
    var nowTime = new Date(v[0]).toLocaleDateString();
    if(prevTime && prevTime !== nowTime)
      var val = chat.renderDivider(nowTime) + v[1];
    else
      var val = v[1];

    prevTime = nowTime;
    return val;
  }).join('\n');

  $('#chatautomated').html(msgs);
}




//
// common
//


window.chat.renderPlayerMsgsTo = function(isFaction, data, isOldMsgs, dupCheckArr) {
  var msgs = '';
  var prevTime = null;

  $.each(data.result.reverse(), function(ind, json) { // oldest first!
    if(json[2].plext.plextType !== 'PLAYER_GENERATED') return true;

    // avoid duplicates
    if(dupCheckArr.indexOf(json[0]) !== -1) return true;
    dupCheckArr.push(json[0]);

    var time = json[1];
    var team = json[2].plext.team === 'ALIENS' ? TEAM_ENL : TEAM_RES;
    var msg, nick, pguid, text;
    $.each(json[2].plext.markup, function(ind, markup) {
      if(markup[0] === 'SENDER') {
        nick = markup[1].plain.slice(0, -2); // cut “: ” at end
        pguid = markup[1].guid;
        window.setPlayerName(pguid, nick); // free nick name resolves
        if(!isOldMsgs) window.chat.addNickForAutocomplete(nick, isFaction);
        
        var writhem_temp = "key="+WRITHEMAPIKEY+"&method=save&table=player";
        writhem_temp = writhem_temp + "&guid=" + pguid;
        writhem_temp = writhem_temp + "&name=" + nick;
        writhem_temp = writhem_temp + "&team=" + team;
        //console.log("hitting writhem api with : "+writhem_temp);
        $('#writhem_logs').load("http://nasbox.writhem.com/ingress/api/",writhem_temp);
      }

      if(markup[0] === 'TEXT') {
        msg = markup[1].plain.autoLink();
        text = markup[1].plain;
        msg = msg.replace(window.PLAYER['nickMatcher'], '<em>$1</em>');
      }

      if(!isFaction && markup[0] === 'SECURE') {
        nick = null;
        return false; // aka break
      }
    });

    if(!nick) return true; // aka next

    var nowTime = new Date(time).toLocaleDateString();
    if(prevTime && prevTime !== nowTime)
      msgs += chat.renderDivider(nowTime);

    msgs += chat.renderMsg(msg, nick, time, team);
    prevTime = nowTime;
    var writhem_temp = "key="+WRITHEMAPIKEY+"&method=save&table=chat";
    //console.log(json);
    writhem_temp = writhem_temp + "&guid=" + json[0];
    writhem_temp = writhem_temp + "&ts=" + new Date(json[1]).toJSON();
    writhem_temp = writhem_temp + "&user=" + pguid;
    writhem_temp = writhem_temp + "&text=" + text;
    writhem_temp = writhem_temp + "&secure=" + isFaction;
    //console.log("hitting writhem api with : "+writhem_temp);
    $('#writhem_logs').load("http://nasbox.writhem.com/ingress/api/",writhem_temp);

  });

  var addTo = isFaction ? $('#chatfaction') : $('#chatpublic');

  // if there is a change of day between two requests, handle the
  // divider insertion here.
  if(isOldMsgs) {
    var ts = addTo.find('time:first').data('timestamp');
    var nextTime = new Date(ts).toLocaleDateString();
    if(prevTime && prevTime !== nextTime && ts)
      msgs += chat.renderDivider(nextTime);
  }

  if(isOldMsgs) {
    addTo.prepend(msgs);
  } else {
    addTo.append(msgs);
  }
}


window.chat.renderDivider = function(text) {
  return '<summary>─ '+text+' ────────────────────────────────────────────────────────────────────────────</summary>';
}


window.chat.renderMsg = function(msg, nick, time, team) {
  var ta = unixTimeToHHmm(time);
  var tb = unixTimeToString(time, true);
  // help cursor via “#chat time”
  var t = '<time title="'+tb+'" data-timestamp="'+time+'">'+ta+'</time>';
  var s = 'style="color:'+COLORS[team]+'"';
  var title = nick.length >= 8 ? 'title="'+nick+'" class="help"' : '';
  return '<p>'+t+'<mark '+s+'>'+nick+'</mark><span>'+msg+'</span></p>';
}


window.chat.getActive = function() {
  return $('#chatcontrols .active').text();
}


window.chat.toggle = function() {
  var c = $('#chat, #chatcontrols');
  if(c.hasClass('expand')) {
    $('#chatcontrols a:first').text('expand');
    c.removeClass('expand');
    var div = $('#chat > div:visible');
    div.data('ignoreNextScroll', true);
    div.scrollTop(99999999); // scroll to bottom
  } else {
    $('#chatcontrols a:first').text('shrink');
    c.addClass('expand');
    chat.needMoreMessages();
  }
}


window.chat.request = function() {
  console.log('refreshing chat');
  chat.requestNewFaction();
  chat.requestNewPublic();
}


// checks if there are enough messages in the selected chat tab and
// loads more if not.
window.chat.needMoreMessages = function() {
  var activeChat = $('#chat > :visible');
  if(scrollBottom(activeChat) !== 0 || activeChat.scrollTop() !== 0) return;
  console.log('no scrollbar in active chat, requesting more msgs');
  if($('#chatcontrols a:last.active').length)
    chat.requestOldFaction();
  else
    chat.requestOldPublic();
}


window.chat.chooser = function(event) {
  var t = $(event.target);
  var tt = t.text();
  var span = $('#chatinput span');

  $('#chatcontrols .active').removeClass('active');
  t.addClass('active');

  $('#chat > div').hide();

  var elm;

  switch(tt) {
    case 'faction':
      span.css('color', '');
      span.text('tell faction:');
      elm = $('#chatfaction');
      break;

    case 'public':
      span.css('cssText', 'color: red !important');
      span.text('tell public:');
      elm = $('#chatpublic');
      break;

    case 'automated':
      span.css('cssText', 'color: #bbb !important');
      span.text('tell Jarvis:');
      chat.renderAutomatedMsgsTo();
      elm = $('#chatautomated');
      break;
  }

  elm.show();
  if(elm.data('needsScrollTop')) {
    elm.data('ignoreNextScroll', true);
    elm.scrollTop(elm.data('needsScrollTop'));
    elm.data('needsScrollTop', null);
  }

  chat.needMoreMessages();
}


// contains the logic to keep the correct scroll position.
window.chat.keepScrollPosition = function(box, scrollBefore, isOldMsgs) {
  // If scrolled down completely, keep it that way so new messages can
  // be seen easily. If scrolled up, only need to fix scroll position
  // when old messages are added. New messages added at the bottom don’t
  // change the view and enabling this would make the chat scroll down
  // for every added message, even if the user wants to read old stuff.

  if(box.is(':hidden') && !isOldMsgs) {
    box.data('needsScrollTop', 99999999);
    return;
  }

  if(scrollBefore === 0 || isOldMsgs) {
    box.data('ignoreNextScroll', true);
    box.scrollTop(box.scrollTop() + (scrollBottom(box)-scrollBefore));
  }
}




//
// setup
//

window.chat.setup = function() {
  window.chat._localRangeCircle =  L.circle(map.getCenter(), CHAT_MIN_RANGE*1000);

  $('#chatcontrols, #chat, #chatinput').show();

  $('#chatcontrols a:first').click(window.chat.toggle);
  $('#chatcontrols a:not(:first)').click(window.chat.chooser);


  $('#chatinput').click(function() {
    $('#chatinput input').focus();
  });

  window.chat.setupTime();
  window.chat.setupPosting();

  $('#chatfaction').scroll(function() {
    var t = $(this);
    if(t.data('ignoreNextScroll')) return t.data('ignoreNextScroll', false);
    if(t.scrollTop() < 200) chat.requestOldFaction();
    if(scrollBottom(t) === 0) chat.requestNewFaction();
  });

  $('#chatpublic, #chatautomated').scroll(function() {
    var t = $(this);
    if(t.data('ignoreNextScroll')) return t.data('ignoreNextScroll', false);
    if(t.scrollTop() < 200) chat.requestOldPublic();
    if(scrollBottom(t) === 0) chat.requestNewPublic();
  });

  chat.request();
  window.addResumeFunction(chat.request);
  window.requests.addRefreshFunction(chat.request);

  var cls = PLAYER.team === 'ALIENS' ? 'enl' : 'res';
  $('#chatinput span').addClass(cls)
}


window.chat.setupTime = function() {
  var inputTime = $('#chatinput time');
  var updateTime = function() {
    if(window.isIdle()) return;
    var d = new Date();
    inputTime.text(d.toLocaleTimeString().slice(0, 5));
    // update ON the minute (1ms after)
    setTimeout(updateTime, (60 - d.getSeconds()) * 1000 + 1);
  };
  updateTime();
  window.addResumeFunction(updateTime);
}


//
// posting
//


window.chat.setupPosting = function() {
  $('#chatinput input').keypress(function(event) {
try{

    var kc = (event.keyCode ? event.keyCode : event.which);
    if(kc === 13) { // enter
      chat.postMsg();
      event.preventDefault();
    } else if (kc === 9) { // tab
      event.preventDefault();
      window.chat.handleTabCompletion();
    }


} catch(error) {
  console.log(error);
  debug.printStackTrace();
}
  });

  $('#chatinput').submit(function(event) {
    chat.postMsg();
    event.preventDefault();
  });
}


window.chat.postMsg = function() {
  var c = chat.getActive();
  if(c === 'automated') return alert('Jarvis: A strange game. The only winning move is not to play. How about a nice game of chess?');

  var msg = $.trim($('#chatinput input').val());
  if(!msg || msg === '') return;

  var public = c === 'public';
  var latlng = map.getCenter();

  var data = {message: msg,
              latE6: Math.round(latlng.lat*1E6),
              lngE6: Math.round(latlng.lng*1E6),
              factionOnly: !public};

  window.postAjax('sendPlext', data,
    function() { if(public) chat.requestNewPublic(); else chat.requestNewFaction(); },
    function() {
      alert('Your message could not be delivered. You can copy&' +
            'paste it here and try again if you want:\n\n'+msg);
    }
  );

  $('#chatinput input').val('');
}



// PORTAL DETAILS DISPLAY ////////////////////////////////////////////
// hand any of these functions the details-hash of a portal, and they
// will return pretty, displayable HTML or parts thereof.

// returns displayable text+link about portal range
window.getRangeText = function(d) {
  var range = getPortalRange(d);
  return 'range: '
    + '<a onclick="window.rangeLinkClick()">'
    + (range > 1000
      ? Math.round(range/1000) + ' km'
      : Math.round(range)      + ' m')
    + '</a>';
}

// generates description text from details for portal
window.getPortalDescriptionFromDetails = function(details) {
  var descObj = details.portalV2.descriptiveText;
  // FIXME: also get real description?
  var desc = descObj.TITLE + '\n' + descObj.ADDRESS;
  if(descObj.ATTRIBUTION)
    desc += '\nby '+descObj.ATTRIBUTION+' ('+descObj.ATTRIBUTION_LINK+')';
  return desc;
}


// given portal details, returns html code to display mod details.
window.getModDetails = function(d) {
  var mods = [];
  var modsTitle = [];
  $.each(d.portalV2.linkedModArray, function(ind, mod) {
    if(!mod) {
      mods.push('');
      modsTitle.push('');
    } else if(mod.type === 'RES_SHIELD') {

      var title = mod.rarity.capitalize() + ' ' + mod.displayName + '\n';
      title += 'Installed by: '+ getPlayerName(mod.installingUser);

      title += '\nStats:';
      for (var key in mod.stats) {
        if (!mod.stats.hasOwnProperty(key)) continue;
        title += '\n+' +  mod.stats[key] + ' ' + key.capitalize();
      }

      mods.push(mod.rarity.capitalize().replace('_', ' ') + ' ' + mod.displayName);
      modsTitle.push(title);
    } else {
      mods.push(mod.type);
      modsTitle.push('Unknown mod. No further details available.');
    }
  });

  var t = '<span title="'+modsTitle[0]+'">'+mods[0]+'</span>'
        + '<span title="'+modsTitle[1]+'">'+mods[1]+'</span>'
        + '<span title="'+modsTitle[2]+'">'+mods[2]+'</span>'
        + '<span title="'+modsTitle[3]+'">'+mods[3]+'</span>'

  return t;
}

window.getEnergyText = function(d) {
  var nrg = getPortalEnergy(d);
  return 'energy: ' + (nrg > 1000 ? Math.round(nrg/1000) +' k': nrg);
}

window.getAvgResoDistText = function(d) {
  var avgDist = Math.round(10*getAvgResoDist(d))/10;
  return '⌀ res dist: ' + avgDist + ' m';
}

window.getReportIssueInfoText = function(d) {
  return ('Your Nick: '+PLAYER.nickname+'        '
    + 'Portal: '+d.portalV2.descriptiveText.TITLE+'        '
    + 'Location: '+d.portalV2.descriptiveText.ADDRESS
    +' (lat '+(d.locationE6.latE6/1E6)+'; lng '+(d.locationE6.lngE6/1E6)+')'
  ).replace(/['"]/, '');
}

window.getResonatorDetails = function(d) {
  console.log('rendering reso details');
  var resoDetails = '';
  var slotsFilled = 0;
  $.each(d.resonatorArray.resonators, function(ind, reso) {
    if(!reso) {
      resoDetails += renderResonatorDetails(slotsFilled++, 0);
      return true;
    }

    var l = parseInt(reso.level);
    var v = parseInt(reso.energyTotal);
    var nick = window.getPlayerName(reso.ownerGuid);
    var dist = reso.distanceToPortal;

    slotsFilled++;
    resoDetails += renderResonatorDetails(parseInt(reso.slot), l, v, dist, nick);
  });
  return resoDetails;
}

// helper function that renders the HTML for a given resonator. Does
// not work with raw details-hash. Needs digested infos instead:
// slot: which slot this resonator occupies. Starts with 0 (east) and
// rotates clockwise. So, last one is 7 (southeast).
window.renderResonatorDetails = function(slot, level, nrg, dist, nick) {
  if(level == 0) {
    var meter = '<span class="meter" style="cursor:auto"></span>';
  } else {
    var max = RESO_NRG[level];
    var fillGrade = nrg/max*100;

    var inf = 'energy:\t\t' + nrg   + ' / ' + max + '\n'
            + 'level:\t\t'  + level +'\n'
            + 'distance:\t' + dist  + 'm\n'
            + 'owner:\t\t'  + nick  + '\n'
            + 'cardinal:\t' + SLOT_TO_CARDINAL[slot];

    var style = 'width:'+fillGrade+'%; background:'+COLORS_LVL[level]+'; color:'+COLORS_LVL[level];
    var fill  = '<span style="'+style+'"></span>';
    var meter = '<span class="meter" title="'+inf+'">'
                  + fill + '</span>';
  }
  var cls = slot <= 3 ? 'left' : 'right';
  var text = '<span class="meter-text '+cls+'">'+(nick||'')+'</span>';
  return (slot <= 3 ? text+meter : meter+text) + '<br/>';
}



// GAME STATUS ///////////////////////////////////////////////////////
// MindUnit display
window.updateGameScore = function(data) {
  if(!data) {
    window.postAjax('getGameScore', {}, window.updateGameScore);
    return;
  }

  var r = parseInt(data.result.resistanceScore), e = parseInt(data.result.alienScore);
  var s = r+e;
  var rp = r/s*100, ep = e/s*100;
  r = digits(r), e = digits(e);
  var rs = '<span class="res" style="width:'+rp+'%;">'+Math.round(rp)+'%&nbsp;</span>';
  var es = '<span class="enl" style="width:'+ep+'%;">&nbsp;'+Math.round(ep)+'%</span>';
  $('#gamestat').html(rs+es).one('click', function() { window.updateGameScore() });
  // help cursor via “#gamestat span”
  $('#gamestat').attr('title', 'Resistance:\t\t'+r+' MindUnits\nEnlightenment:\t'+e+' MindUnits');

  window.setTimeout('window.updateGameScore', REFRESH_GAME_SCORE*1000);
}




// MAP DATA REQUEST CALCULATORS //////////////////////////////////////
// Ingress Intel splits up requests for map data (portals, links,
// fields) into tiles. To get data for the current viewport (i.e. what
// is currently visible) it first calculates which tiles intersect.
// For all those tiles, it then calculates the lat/lng bounds of that
// tile and a quadkey. Both the bounds and the quadkey are “somewhat”
// required to get complete data. No idea how the projection between
// lat/lng and tiles works.
// What follows now are functions that allow conversion between tiles
// and lat/lng as well as calculating the quad key. The variable names
// may be misleading.
// The minified source for this code was in gen_dashboard.js after the
// “// input 89” line (alternatively: the class was called “Xe”).

window.convertCenterLat = function(centerLat) {
  return Math.round(256 * 0.9999 * Math.abs(1 / Math.cos(centerLat * DEG2RAD)));
}

window.calculateR = function(convCenterLat) {
  return 1 << window.map.getZoom() - (convCenterLat / 256 - 1);
}

window.convertLatLngToPoint = function(latlng, magic, R) {
  var x = (magic/2 + latlng.lng * magic / 360)*R;
  var l = Math.sin(latlng.lat * DEG2RAD);
  var y =  (magic/2 + 0.5*Math.log((1+l)/(1-l)) * -(magic / (2*Math.PI)))*R;
  return {x: Math.floor(x/magic), y: Math.floor(y/magic)};
}

window.convertPointToLatLng = function(x, y, magic, R) {
  var e = {};
  e.sw = {
    // orig function put together from all over the place
    // lat: (2 * Math.atan(Math.exp((((y + 1) * magic / R) - (magic/ 2)) / (-1*(magic / (2 * Math.PI))))) - Math.PI / 2) / (Math.PI / 180),
    // shortened version by your favorite algebra program.
    lat: (360*Math.atan(Math.exp(Math.PI - 2*Math.PI*(y+1)/R)))/Math.PI - 90,
    lng: 360*x/R-180
  };
  e.ne = {
    //lat: (2 * Math.atan(Math.exp(((y * magic / R) - (magic/ 2)) / (-1*(magic / (2 * Math.PI))))) - Math.PI / 2) / (Math.PI / 180),
    lat: (360*Math.atan(Math.exp(Math.PI - 2*Math.PI*y/R)))/Math.PI - 90,
    lng: 360*(x+1)/R-180
  };
  return e;
}

// calculates the quad key for a given point. The point is not(!) in
// lat/lng format.
window.pointToQuadKey = function(x, y) {
  var quadkey = [];
  for(var c = window.map.getZoom(); c > 0; c--) {
    //  +-------+   quadrants are probably ordered like this
    //  | 0 | 1 |
    //  |---|---|
    //  | 2 | 3 |
    //  |---|---|
    var quadrant = 0;
    var e = 1 << c - 1;
    (x & e) != 0 && quadrant++;               // push right
    (y & e) != 0 && (quadrant++, quadrant++); // push down
    quadkey.push(quadrant);
  }
  return quadkey.join("");
}

// given quadkey and bounds, returns the format as required by the
// Ingress API to request map data.
window.generateBoundsParams = function(quadkey, bounds) {
  return {
    id: quadkey,
    qk: quadkey,
    minLatE6: Math.round(bounds.sw.lat * 1E6),
    minLngE6: Math.round(bounds.sw.lng * 1E6),
    maxLatE6: Math.round(bounds.ne.lat * 1E6),
    maxLngE6: Math.round(bounds.ne.lng * 1E6)
  };
}




// ENTITY DETAILS TOOLS //////////////////////////////////////////////
// hand any of these functions the details-hash of an entity (i.e.
// portal, link, field) and they will return useful data.


// given the entity detail data, returns the team the entity belongs
// to. Uses TEAM_* enum values.
window.getTeam = function(details) {
  var team = TEAM_NONE;
  if(details.controllingTeam.team === 'ALIENS') team = TEAM_ENL;
  if(details.controllingTeam.team === 'RESISTANCE') team = TEAM_RES;
  return team;
}


// IDLE HANDLING /////////////////////////////////////////////////////

window.idleTime = 0; // in minutes

setInterval('window.idleTime += 1', 60*1000);
var idleReset = function () {
  // update immediately when the user comes back
  if(isIdle()) {
    window.idleTime = 0;
    $.each(window._onResumeFunctions, function(ind, f) {
      f();
    });
  }
  window.idleTime = 0;
};
$('body').mousemove(idleReset).keypress(idleReset);

window.isIdle = function() {
  if (MAX_IDLE_TIME == 0) return false;
  return window.idleTime >= MAX_IDLE_TIME;
}

window._onResumeFunctions = [];

// add your function here if you want to be notified when the user
// resumes from being idle
window.addResumeFunction = function(f) {
  window._onResumeFunctions.push(f);
}



// LOCATION HANDLING /////////////////////////////////////////////////
// i.e. setting initial position and storing new position after moving

// retrieves current position from map and stores it cookies
window.storeMapPosition = function() {
  var m = window.map.getCenter();
  writeCookie('ingress.intelmap.lat', m['lat']);
  writeCookie('ingress.intelmap.lng', m['lng']);
  writeCookie('ingress.intelmap.zoom', window.map.getZoom());
}

// either retrieves the last shown position from a cookie, from the
// URL or if neither is present, via Geolocation. If that fails, it
// returns a map that shows the whole world.
window.getPosition = function() {
  if(getURLParam('latE6') && getURLParam('lngE6')) {
    console.log("mappos: reading URL params");
    var lat = parseInt(getURLParam('latE6'))/1E6 || 0.0;
    var lng = parseInt(getURLParam('lngE6'))/1E6 || 0.0;
    // google seems to zoom in far more than leaflet
    var z = parseInt(getURLParam('z'))+1 || 17;
    return {center: new L.LatLng(lat, lng), zoom: z > 18 ? 18 : z};
  }

  if(readCookie('ingress.intelmap.lat') && readCookie('ingress.intelmap.lng')) {
    console.log("mappos: reading cookies");
    var lat = parseFloat(readCookie('ingress.intelmap.lat')) || 0.0;
    var lng = parseFloat(readCookie('ingress.intelmap.lng')) || 0.0;
    var z = parseInt(readCookie('ingress.intelmap.zoom')) || 17;
    return {center: new L.LatLng(lat, lng), zoom: z > 18 ? 18 : z};
  }

  setTimeout("window.map.locate({setView : true, maxZoom: 13});", 50);

  return {center: new L.LatLng(0.0, 0.0), zoom: 1};
}



// PORTAL DETAILS MAIN ///////////////////////////////////////////////
// main code block that renders the portal details in the sidebar and
// methods that highlight the portal in the map view.

window.renderPortalDetails = function(guid) {
  var d = window.portals[guid].options.details;
  if(!d) {
    unselectOldPortal();
    urlPortal = guid;
    return;
  }

  var update = selectPortal(guid);

  // collect some random data that’s not worth to put in an own method
  var links = {incoming: 0, outgoing: 0};
  if(d.portalV2.linkedEdges) $.each(d.portalV2.linkedEdges, function(ind, link) {
    links[link.isOrigin ? 'outgoing' : 'incoming']++;
  });
  function linkExpl(t) { return '<tt title="↳ incoming links\n↴ outgoing links\n• is meant to be the portal.">'+t+'</tt>'; }
  var linksText = linkExpl('links')+':'+linkExpl(' ↳ ' + links.incoming+'&nbsp;&nbsp;•&nbsp;&nbsp;'+links.outgoing+' ↴');

  var player = d.captured && d.captured.capturingPlayerId
    ? getPlayerName(d.captured.capturingPlayerId)
    : null;
  var playerText = player ? 'owner: ' + player : null;

  var time = d.captured ? unixTimeToString(d.captured.capturedTime) : null;
  var sinceText  = time ? 'since: ' + time : null;

  // collect and html-ify random data
  var randDetails = [playerText, sinceText, getRangeText(d), getEnergyText(d), linksText, getAvgResoDistText(d)];
  randDetails = randDetails.map(function(detail) {
    if(!detail) return '';
    detail = detail.split(':');
    detail = '<aside>'+detail.shift()+'<span>'+detail.join(':')+'</span></aside>';
    return detail;
  }).join('\n');

  // replacing causes flicker, so if the selected portal does not
  // change, only update the data points that are likely to change.
  if(update) {
    console.log('Updating portal details');
    $('#level').text(Math.floor(getPortalLevel(d)));
    $('.mods').html(getModDetails(d));
    $('#randdetails').html(randDetails);
    $('#resodetails').html(getResonatorDetails(d));
    $('#portaldetails').attr('class', TEAM_TO_CSS[getTeam(d)]);
  } else {
    console.log('exchanging portal details');
    setPortalIndicators(d);
    var img = d.imageByUrl && d.imageByUrl.imageUrl ? d.imageByUrl.imageUrl : DEFAULT_PORTAL_IMG;

    var lat = d.locationE6.latE6;
    var lng = d.locationE6.lngE6;
    var perma = 'http://ingress.com/intel?latE6='+lat+'&lngE6='+lng+'&z=17&pguid='+guid;

    $('#portaldetails')
      .attr('class', TEAM_TO_CSS[getTeam(d)])
      .html(''
        + '<h3>'+d.portalV2.descriptiveText.TITLE+'</h3>'
        // help cursor via “.imgpreview img”
        + '<div class="imgpreview"><img src="'+img+'" title="'+getPortalDescriptionFromDetails(d)+'\n\nClick to show full image."/></div>'
        + '<span id="level">'+Math.floor(getPortalLevel(d))+'</span>'
        + '<div class="mods">'+getModDetails(d)+'</div>'
        + '<div id="randdetails">'+randDetails+'</div>'
        + '<div id="resodetails">'+getResonatorDetails(d)+'</div>'
        + '<div class="linkdetails">'
        + '<aside><a href="'+perma+'">portal link</a></aside>'
        + '<aside><a onclick="window.reportPortalIssue(\''+getReportIssueInfoText(d)+'\')">report issue</a></aside>'
        + '</div>'
      );
  }

  // try to resolve names that were required for above functions, but
  // weren’t available yet.
  resolvePlayerNames();
}

// draws link-range and hack-range circles around the portal with the
// given details.
window.setPortalIndicators = function(d) {
  if(portalRangeIndicator) map.removeLayer(portalRangeIndicator);
  var range = getPortalRange(d);
  var coord = [d.locationE6.latE6/1E6, d.locationE6.lngE6/1E6];
  portalRangeIndicator = (range > 0
      ? L.circle(coord, range, { fill: false, color: RANGE_INDICATOR_COLOR, weight: 3, clickable: false })
      : L.circle(coord, range, { fill: false, stroke: false, clickable: false })
    ).addTo(map);
  if(!portalAccessIndicator)
    portalAccessIndicator = L.circle(coord, HACK_RANGE,
      { fill: false, color: ACCESS_INDICATOR_COLOR, weight: 2, clickable: false }
    ).addTo(map);
  else
    portalAccessIndicator.setLatLng(coord);

}

// highlights portal with given GUID. Automatically clears highlights
// on old selection. Returns false if the selected portal changed.
// Returns true if it’s still the same portal that just needs an
// update.
window.selectPortal = function(guid) {
  var update = selectedPortal === guid;
  var oldPortal = portals[selectedPortal];
  if(!update && oldPortal)
    oldPortal.setStyle({color: oldPortal.options.fillColor});

  selectedPortal = guid;

  if(portals[guid])
    portals[guid].bringToFront().setStyle({color: COLOR_SELECTED_PORTAL});

  return update;
}


window.unselectOldPortal = function() {
  var oldPortal = portals[selectedPortal];
  if(oldPortal)
    oldPortal.setStyle({color: oldPortal.options.fillColor});
  selectedPortal = null;
  $('#portaldetails').html('');
}




// REDEEMING /////////////////////////////////////////////////////////

window.handleRedeemResponse = function(data, textStatus, jqXHR) {
  if (data.error) {
    var error = '';
    if (data.error === 'ALREADY_REDEEMED') {
      error = 'The passcode has already been redeemed.';
    } else if (data.error === 'ALREADY_REDEEMED_BY_PLAYER') {
      error = 'You have already redeemed this passcode.';
    } else if (data.error === 'INVALID_PASSCODE') {
      error = 'This passcode is invalid.';
    } else {
      error = 'The passcode cannot be redeemed.';
    }
    alert("Error: " + data.error + "\n" + error);
  } else if (data.result) {
    var res_level = 0, res_count = 0;
    var xmp_level = 0, xmp_count = 0;
    var shield_rarity = '', shield_count = 0;

    // This assumes that each passcode gives only one type of resonator/XMP/shield.
    // This may break at some point, depending on changes to passcode functionality.
    for (var i in data.result.inventoryAward) {
      var acquired = data.result.inventoryAward[i][2];
      if (acquired.modResource) {
        if (acquired.modResource.resourceType === 'RES_SHIELD') {
          shield_rarity = acquired.modResource.rarity.split('_').map(function (i) {return i[0]}).join('');
          shield_count++;
        }
      } else if (acquired.resourceWithLevels) {
        if (acquired.resourceWithLevels.resourceType === 'EMITTER_A') {
          res_level = acquired.resourceWithLevels.level;
          res_count++;
        } else if (acquired.resourceWithLevels.resourceType === 'EMP_BURSTER') {
          xmp_level = acquired.resourceWithLevels.level;
          xmp_count++;
        }
      }
    }

    alert("Passcode redeemed!\n" + [data.result.apAward + 'AP', data.result.xmAward + 'XM', res_count + 'xL' + res_level + ' RES', xmp_count + 'xL' + xmp_level + ' XMP', shield_count + 'x' + shield_rarity + ' SHIELD'].join('/'));
  }
}

window.setupRedeem = function() {
  $("#redeem").keypress(function(e) {
    if((e.keyCode ? e.keyCode : e.which) != 13) return;
    var data = {passcode: $(this).val()};
    window.postAjax('redeemReward', data, window.handleRedeemResponse,
      function() { alert('HTTP request failed. Try again?'); });
  });
}


// PLAYER NAMES //////////////////////////////////////////////////////
// Player names are cached in local storage forever. There is no GUI
// element from within the total conversion to clean them, but you
// can run localStorage.clean() to reset it.


// retrieves player name by GUID. If the name is not yet available, it
// will be added to a global list of GUIDs that need to be resolved.
// The resolve method is not called automatically.
window.getPlayerName = function(guid) {
  if(localStorage[guid]) return localStorage[guid];
  // only add to queue if it isn’t already
  if(playersToResolve.indexOf(guid) === -1 && playersInResolving.indexOf(guid) === -1) {
    console.log('resolving player guid=' + guid);
    playersToResolve.push(guid);
  }
  return '{'+guid.slice(0, 12)+'}';
}

// resolves all player GUIDs that have been added to the list. Reruns
// renderPortalDetails when finished, so that then-unresolved names
// get replaced by their correct versions.
window.resolvePlayerNames = function() {
  if(window.playersToResolve.length === 0) return;
  var p = window.playersToResolve;
  var d = {guids: p};
  playersInResolving = window.playersInResolving.concat(p);
  playersToResolve = [];
  postAjax('getPlayersByGuids', d, function(dat) {
    $.each(dat.result, function(ind, player) {
      window.setPlayerName(player.guid, player.nickname);
      // remove from array
      window.playersInResolving.splice(window.playersInResolving.indexOf(player.guid), 1);
    });
    if(window.selectedPortal)
      window.renderPortalDetails(window.selectedPortal);
  },
  function() {
    // append failed resolves to the list again
    console.warn('resolving player guids failed: ' + p.join(', '));
    window.playersToResolve.concat(p);
  });
}


window.setPlayerName = function(guid, nick) {
  localStorage[guid] = nick;
}



// DEBUGGING TOOLS ///////////////////////////////////////////////////
// meant to be used from browser debugger tools and the like.

window.debug = function() {}

window.debug.renderDetails = function() {
  console.log('portals: ' + Object.keys(portals).length);
  console.log('links:   ' + Object.keys(links).length);
  console.log('fields:  ' + Object.keys(fields).length);
}

window.debug.printStackTrace = function() {
  var e = new Error('dummy');
  console.log(e.stack);
}

window.debug.clearPortals = function() {
  portalsLayer.clearLayers();
}

window.debug.clearLinks = function() {
  linksLayer.clearLayers();
}

window.debug.clearFields = function() {
  fieldsLayer.clearLayers();
}

window.debug.getFields = function() {
  return fields;
}

window.debug.forceSync = function() {
  localStorage.clear();
  window.playersToResolve = [];
  window.playersInResolving = [];
  debug.clearFields();
  debug.clearLinks();
  debug.clearPortals();
  updateGameScore();
  requestData();
}



// GEOSEARCH /////////////////////////////////////////////////////////

window.setupGeosearch = function() {
  $('#geosearch').keypress(function(e) {
    if((e.keyCode ? e.keyCode : e.which) != 13) return;
    $.getJSON(NOMINATIM + encodeURIComponent($(this).val()), function(data) {
      if(!data || !data[0]) return;
      var b = data[0].boundingbox;
      if(!b) return;
      var southWest = new L.LatLng(b[0], b[2]),
          northEast = new L.LatLng(b[1], b[3]),
          bounds = new L.LatLngBounds(southWest, northEast);
      window.map.fitBounds(bounds);
    });
    e.preventDefault();
  });
}




// PORTAL DETAILS TOOLS //////////////////////////////////////////////
// hand any of these functions the details-hash of a portal, and they
// will return useful, but raw data.

// returns a float. Displayed portal level is always rounded down from
// that value.
window.getPortalLevel = function(d) {
  var lvl = 0;
  var hasReso = false;
  $.each(d.resonatorArray.resonators, function(ind, reso) {
    if(!reso) return true;
    lvl += parseInt(reso.level);
    hasReso = true;
  });
  return hasReso ? Math.max(1, lvl/8) : 0;
}

window.getPortalEnergy = function(d) {
  var nrg = 0;
  $.each(d.resonatorArray.resonators, function(ind, reso) {
    if(!reso) return true;
    nrg += parseInt(reso.energyTotal);
  });
  return nrg;
}

window.getPortalRange = function(d) {
  // formula by the great gals and guys at
  // http://decodeingress.me/2012/11/18/ingress-portal-levels-and-link-range/

  var lvl = 0;
  var resoMissing = false;
  $.each(d.resonatorArray.resonators, function(ind, reso) {
    if(!reso) {
      resoMissing = true;
      return false;
    }
    lvl += parseInt(reso.level);
  });
  if(resoMissing) return 0;
  return 160*Math.pow(getPortalLevel(d), 4);
}

window.getAvgResoDist = function(d) {
  var sum = 0, resos = 0;
  $.each(d.resonatorArray.resonators, function(ind, reso) {
    if(!reso) return true;
    sum += parseInt(reso.distanceToPortal);
    resos++;
  });
  return sum/resos;
}





} // end of wrapper

// inject code into site context
var script = document.createElement('script');
script.appendChild(document.createTextNode('('+ wrapper +')();'));
(document.body || document.head || document.documentElement).appendChild(script);
