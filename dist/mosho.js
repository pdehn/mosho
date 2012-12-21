/*
 * Hammer.JS
 * version 0.6.4
 * author: Eight Media
 * https://github.com/EightMedia/hammer.js
 * Licensed under the MIT license.
 */
function Hammer(element, options, undefined)
{
    var self = this;

    var defaults = {
        // prevent the default event or not... might be buggy when false
        prevent_default    : false,
        css_hacks          : true,

        swipe              : true,
        swipe_time         : 200,   // ms
        swipe_min_distance : 20,   // pixels

        drag               : true,
        drag_vertical      : true,
        drag_horizontal    : true,
        // minimum distance before the drag event starts
        drag_min_distance  : 20,    // pixels

        // pinch zoom and rotation
        transform          : true,
        scale_treshold     : 0.1,
        rotation_treshold  : 15,    // degrees

        tap                : true,
        tap_double         : true,
        tap_max_interval   : 300,
        tap_max_distance   : 10,
        tap_double_distance: 20,

        hold               : true,
        hold_timeout       : 500
    };
    options = mergeObject(defaults, options);

    // some css hacks
    (function() {
        if(!options.css_hacks) {
            return false;
        }

        var vendors = ['webkit','moz','ms','o',''];
        var css_props = {
            "userSelect": "none",
            "touchCallout": "none",
            "userDrag": "none",
            "tapHighlightColor": "rgba(0,0,0,0)"
        };

        var prop = '';
        for(var i = 0; i < vendors.length; i++) {
            for(var p in css_props) {
                prop = p;
                if(vendors[i]) {
                    prop = vendors[i] + prop.substring(0, 1).toUpperCase() + prop.substring(1);
                }
                element.style[ prop ] = css_props[p];
            }
        }
    })();

    // holds the distance that has been moved
    var _distance = 0;

    // holds the exact angle that has been moved
    var _angle = 0;

    // holds the direction that has been moved
    var _direction = 0;

    // holds position movement for sliding
    var _pos = { };

    // how many fingers are on the screen
    var _fingers = 0;

    var _first = false;

    var _gesture = null;
    var _prev_gesture = null;

    var _touch_start_time = null;
    var _prev_tap_pos = {x: 0, y: 0};
    var _prev_tap_end_time = null;

    var _hold_timer = null;

    var _offset = {};

    // keep track of the mouse status
    var _mousedown = false;

    var _event_start;
    var _event_move;
    var _event_end;

    var _has_touch = ('ontouchstart' in window);

    var _can_tap = false;


    /**
     * option setter/getter
     * @param   string  key
     * @param   mixed   value
     * @return  mixed   value
     */
    this.option = function(key, val) {
        if(val !== undefined) {
            options[key] = val;
        }

        return options[key];
    };


    /**
     * angle to direction define
     * @param  float    angle
     * @return string   direction
     */
    this.getDirectionFromAngle = function( angle ) {
        var directions = {
            down: angle >= 45 && angle < 135, //90
            left: angle >= 135 || angle <= -135, //180
            up: angle < -45 && angle > -135, //270
            right: angle >= -45 && angle <= 45 //0
        };

        var direction, key;
        for(key in directions){
            if(directions[key]){
                direction = key;
                break;
            }
        }
        return direction;
    };


    /**
     * destroy events
     * @return  void
     */
    this.destroy = function() {
        if(_has_touch) {
            removeEvent(element, "touchstart touchmove touchend touchcancel", handleEvents);
        }
        // for non-touch
        else {
            removeEvent(element, "mouseup mousedown mousemove", handleEvents);
            removeEvent(element, "mouseout", handleMouseOut);
        }
    };


    /**
     * count the number of fingers in the event
     * when no fingers are detected, one finger is returned (mouse pointer)
     * @param  event
     * @return int  fingers
     */
    function countFingers( event )
    {
        // there is a bug on android (until v4?) that touches is always 1,
        // so no multitouch is supported, e.g. no, zoom and rotation...
        return event.touches ? event.touches.length : 1;
    }


    /**
     * get the x and y positions from the event object
     * @param  event
     * @return array  [{ x: int, y: int }]
     */
    function getXYfromEvent( event )
    {
        event = event || window.event;

        // no touches, use the event pageX and pageY
        if(!_has_touch) {
            var doc = document,
                body = doc.body;

            return [{
                x: event.pageX || event.clientX + ( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) - ( doc && doc.clientLeft || body && doc.clientLeft || 0 ),
                y: event.pageY || event.clientY + ( doc && doc.scrollTop || body && body.scrollTop || 0 ) - ( doc && doc.clientTop || body && doc.clientTop || 0 )
            }];
        }
        // multitouch, return array with positions
        else {
            var pos = [], src;
            for(var t=0, len=event.touches.length; t<len; t++) {
                src = event.touches[t];
                pos.push({ x: src.pageX, y: src.pageY });
            }
            return pos;
        }
    }


    /**
     * calculate the angle between two points
     * @param   object  pos1 { x: int, y: int }
     * @param   object  pos2 { x: int, y: int }
     */
    function getAngle( pos1, pos2 )
    {
        return Math.atan2(pos2.y - pos1.y, pos2.x - pos1.x) * 180 / Math.PI;
    }

    /**
     * calculate the distance between two points
     * @param   object  pos1 { x: int, y: int }
     * @param   object  pos2 { x: int, y: int }
     */
    function getDistance( pos1, pos2 )
    {
        var x = pos2.x - pos1.x, y = pos2.y - pos1.y;
        return Math.sqrt((x * x) + (y * y));
    }


    /**
     * calculate the scale size between two fingers
     * @param   object  pos_start
     * @param   object  pos_move
     * @return  float   scale
     */
    function calculateScale(pos_start, pos_move)
    {
        if(pos_start.length == 2 && pos_move.length == 2) {
            var start_distance = getDistance(pos_start[0], pos_start[1]);
            var end_distance = getDistance(pos_move[0], pos_move[1]);
            return end_distance / start_distance;
        }

        return 0;
    }


    /**
     * calculate the rotation degrees between two fingers
     * @param   object  pos_start
     * @param   object  pos_move
     * @return  float   rotation
     */
    function calculateRotation(pos_start, pos_move)
    {
        if(pos_start.length == 2 && pos_move.length == 2) {
            var start_rotation = getAngle(pos_start[1], pos_start[0]);
            var end_rotation = getAngle(pos_move[1], pos_move[0]);
            return end_rotation - start_rotation;
        }

        return 0;
    }


    /**
     * trigger an event/callback by name with params
     * @param string name
     * @param array  params
     */
    function triggerEvent( eventName, params )
    {
        // return touches object
        params.touches = getXYfromEvent(params.originalEvent);
        params.type = eventName;

        // trigger callback
        if(isFunction(self["on"+ eventName])) {
            self["on"+ eventName].call(self, params);
        }
    }


    /**
     * cancel event
     * @param   object  event
     * @return  void
     */

    function cancelEvent(event)
    {
        event = event || window.event;
        if(event.preventDefault){
            event.preventDefault();
            event.stopPropagation();
        }else{
            event.returnValue = false;
            event.cancelBubble = true;
        }
    }


    /**
     * reset the internal vars to the start values
     */
    function reset()
    {
        _pos = {};
        _first = false;
        _fingers = 0;
        _distance = 0;
        _angle = 0;
        _gesture = null;
    }


    var gestures = {
        // hold gesture
        // fired on touchstart
        hold : function(event)
        {
            // only when one finger is on the screen
            if(options.hold) {
                _gesture = 'hold';
                clearTimeout(_hold_timer);

                _hold_timer = setTimeout(function() {
                    if(_gesture == 'hold') {
                        triggerEvent("hold", {
                            originalEvent   : event,
                            position        : _pos.start
                        });
                    }
                }, options.hold_timeout);
            }
        },

        // swipe gesture
        // fired on touchend
        swipe : function(event)
        {
            if (!_pos.move || _gesture === "transform") {
                return;
            }

            // get the distance we moved
            var _distance_x = _pos.move[0].x - _pos.start[0].x;
            var _distance_y = _pos.move[0].y - _pos.start[0].y;
            _distance = Math.sqrt(_distance_x*_distance_x + _distance_y*_distance_y);

            // compare the kind of gesture by time
            var now = new Date().getTime();
            var touch_time = now - _touch_start_time;

            if(options.swipe && (options.swipe_time > touch_time) && (_distance > options.swipe_min_distance)) {
                // calculate the angle
                _angle = getAngle(_pos.start[0], _pos.move[0]);
                _direction = self.getDirectionFromAngle(_angle);

                _gesture = 'swipe';

                var position = { x: _pos.move[0].x - _offset.left,
                    y: _pos.move[0].y - _offset.top };

                var event_obj = {
                    originalEvent   : event,
                    position        : position,
                    direction       : _direction,
                    distance        : _distance,
                    distanceX       : _distance_x,
                    distanceY       : _distance_y,
                    angle           : _angle
                };

                // normal slide event
                triggerEvent("swipe", event_obj);
            }
        },


        // drag gesture
        // fired on mousemove
        drag : function(event)
        {
            // get the distance we moved
            var _distance_x = _pos.move[0].x - _pos.start[0].x;
            var _distance_y = _pos.move[0].y - _pos.start[0].y;
            _distance = Math.sqrt(_distance_x * _distance_x + _distance_y * _distance_y);

            // drag
            // minimal movement required
            if(options.drag && (_distance > options.drag_min_distance) || _gesture == 'drag') {
                // calculate the angle
                _angle = getAngle(_pos.start[0], _pos.move[0]);
                _direction = self.getDirectionFromAngle(_angle);

                // check the movement and stop if we go in the wrong direction
                var is_vertical = (_direction == 'up' || _direction == 'down');

                if(((is_vertical && !options.drag_vertical) || (!is_vertical && !options.drag_horizontal)) && (_distance > options.drag_min_distance)) {
                    return;
                }

                _gesture = 'drag';

                var position = { x: _pos.move[0].x - _offset.left,
                    y: _pos.move[0].y - _offset.top };

                var event_obj = {
                    originalEvent   : event,
                    position        : position,
                    direction       : _direction,
                    distance        : _distance,
                    distanceX       : _distance_x,
                    distanceY       : _distance_y,
                    angle           : _angle
                };

                // on the first time trigger the start event
                if(_first) {
                    triggerEvent("dragstart", event_obj);

                    _first = false;
                }

                // normal slide event
                triggerEvent("drag", event_obj);

                cancelEvent(event);
            }
        },


        // transform gesture
        // fired on touchmove
        transform : function(event)
        {
            if(options.transform) {
                var count = countFingers(event);
                if (count !== 2) {
                    return false;
                }

                var rotation = calculateRotation(_pos.start, _pos.move);
                var scale = calculateScale(_pos.start, _pos.move);

                if (_gesture === 'transform' ||
                    Math.abs(1 - scale) > options.scale_treshold ||
                    Math.abs(rotation) > options.rotation_treshold) {

                    _gesture = 'transform';
                    _pos.center = {
                        x: ((_pos.move[0].x + _pos.move[1].x) / 2) - _offset.left,
                        y: ((_pos.move[0].y + _pos.move[1].y) / 2) - _offset.top
                    };

                    if(_first)
                        _pos.startCenter = _pos.center;

                    var _distance_x = _pos.center.x - _pos.startCenter.x;
                    var _distance_y = _pos.center.y - _pos.startCenter.y;
                    _distance = Math.sqrt(_distance_x*_distance_x + _distance_y*_distance_y);

                    var event_obj = {
                        originalEvent   : event,
                        position        : _pos.center,
                        scale           : scale,
                        rotation        : rotation,
                        distance        : _distance,
                        distanceX       : _distance_x,
                        distanceY       : _distance_y
                    };

                    // on the first time trigger the start event
                    if (_first) {
                        triggerEvent("transformstart", event_obj);
                        _first = false;
                    }

                    triggerEvent("transform", event_obj);

                    cancelEvent(event);

                    return true;
                }
            }

            return false;
        },


        // tap and double tap gesture
        // fired on touchend
        tap : function(event)
        {
            // compare the kind of gesture by time
            var now = new Date().getTime();
            var touch_time = now - _touch_start_time;

            // dont fire when hold is fired
            if(options.hold && !(options.hold && options.hold_timeout > touch_time)) {
                return;
            }

            // when previous event was tap and the tap was max_interval ms ago
            var is_double_tap = (function(){
                if (_prev_tap_pos &&
                    options.tap_double &&
                    _prev_gesture == 'tap' &&
                    _pos.start &&
                    (_touch_start_time - _prev_tap_end_time) < options.tap_max_interval)
                {
                    var x_distance = Math.abs(_prev_tap_pos[0].x - _pos.start[0].x);
                    var y_distance = Math.abs(_prev_tap_pos[0].y - _pos.start[0].y);
                    return (_prev_tap_pos && _pos.start && Math.max(x_distance, y_distance) < options.tap_double_distance);
                }
                return false;
            })();

            if(is_double_tap) {
                _gesture = 'double_tap';
                _prev_tap_end_time = null;

                triggerEvent("doubletap", {
                    originalEvent   : event,
                    position        : _pos.start
                });
                cancelEvent(event);
            }

            // single tap is single touch
            else {
                var x_distance = (_pos.move) ? Math.abs(_pos.move[0].x - _pos.start[0].x) : 0;
                var y_distance =  (_pos.move) ? Math.abs(_pos.move[0].y - _pos.start[0].y) : 0;
                _distance = Math.max(x_distance, y_distance);

                if(_distance < options.tap_max_distance) {
                    _gesture = 'tap';
                    _prev_tap_end_time = now;
                    _prev_tap_pos = _pos.start;

                    if(options.tap) {
                        triggerEvent("tap", {
                            originalEvent   : event,
                            position        : _pos.start
                        });
                        cancelEvent(event);
                    }
                }
            }
        }
    };


    function handleEvents(event)
    {
        var count;
        switch(event.type)
        {
            case 'mousedown':
            case 'touchstart':
                count = countFingers(event);
                _can_tap = count === 1;

                //We were dragging and now we are zooming.
                if (count === 2 && _gesture === "drag") {

                    //The user needs to have the dragend to be fired to ensure that
                    //there is proper cleanup from the drag and move onto transforming.
                    triggerEvent("dragend", {
                        originalEvent   : event,
                        direction       : _direction,
                        distance        : _distance,
                        angle           : _angle
                    });
                }
                _setup();

                if(options.prevent_default) {
                    cancelEvent(event);
                }
                break;

            case 'mousemove':
            case 'touchmove':
                count = countFingers(event);

                //The user has gone from transforming to dragging.  The
                //user needs to have the proper cleanup of the state and
                //setup with the new "start" points.
                if (!_mousedown && count === 1) {
                    return false;
                } else if (!_mousedown && count === 2) {
                    _can_tap = false;

                    reset();
                    _setup();
                }

                _event_move = event;
                _pos.move = getXYfromEvent(event);

                if(!gestures.transform(event)) {
                    gestures.drag(event);
                }
                break;

            case 'mouseup':
            case 'mouseout':
            case 'touchcancel':
            case 'touchend':
                var callReset = true;

                _mousedown = false;
                _event_end = event;

                // swipe gesture
                gestures.swipe(event);

                // drag gesture
                // dragstart is triggered, so dragend is possible
                if(_gesture == 'drag') {
                    triggerEvent("dragend", {
                        originalEvent   : event,
                        direction       : _direction,
                        distance        : _distance,
                        angle           : _angle
                    });
                }

                // transform
                // transformstart is triggered, so transformed is possible
                else if(_gesture == 'transform') {
                    // define the transform distance
                    var _distance_x = _pos.center.x - _pos.startCenter.x;
                    var _distance_y = _pos.center.y - _pos.startCenter.y;
                    
                    triggerEvent("transformend", {
                        originalEvent   : event,
                        position        : _pos.center,
                        scale           : calculateScale(_pos.start, _pos.move),
                        rotation        : calculateRotation(_pos.start, _pos.move),
                        distance        : _distance,
                        distanceX       : _distance_x,
                        distanceY       : _distance_y
                    });

                    //If the user goes from transformation to drag there needs to be a
                    //state reset so that way a dragstart/drag/dragend will be properly
                    //fired.
                    if (countFingers(event) === 1) {
                        reset();
                        _setup();
                        callReset = false;
                    }
                } else if (_can_tap) {
                    gestures.tap(_event_start);
                }

                _prev_gesture = _gesture;

                // trigger release event
                // "release" by default doesn't return the co-ords where your
                // finger was released. "position" will return "the last touched co-ords"

                triggerEvent("release", {
                    originalEvent   : event,
                    gesture         : _gesture,
                    position        : _pos.move || _pos.start
                });

                // reset vars if this was not a transform->drag touch end operation.
                if (callReset) {
                    reset();
                }
                break;
        } // end switch

        /**
         * Performs a blank setup.
         * @private
         */
        function _setup() {
            _pos.start = getXYfromEvent(event);
            _touch_start_time = new Date().getTime();
            _fingers = countFingers(event);
            _first = true;
            _event_start = event;

            // borrowed from jquery offset https://github.com/jquery/jquery/blob/master/src/offset.js
            var box = element.getBoundingClientRect();
            var clientTop  = element.clientTop  || document.body.clientTop  || 0;
            var clientLeft = element.clientLeft || document.body.clientLeft || 0;
            var scrollTop  = window.pageYOffset || element.scrollTop  || document.body.scrollTop;
            var scrollLeft = window.pageXOffset || element.scrollLeft || document.body.scrollLeft;

            _offset = {
                top: box.top + scrollTop - clientTop,
                left: box.left + scrollLeft - clientLeft
            };

            _mousedown = true;

            // hold gesture
            gestures.hold(event);
        }
    }


    function handleMouseOut(event) {
        if(!isInsideHammer(element, event.relatedTarget)) {
            handleEvents(event);
        }
    }


    // bind events for touch devices
    // except for windows phone 7.5, it doesnt support touch events..!
    if(_has_touch) {
        addEvent(element, "touchstart touchmove touchend touchcancel", handleEvents);
    }
    // for non-touch
    else {
        addEvent(element, "mouseup mousedown mousemove", handleEvents);
        addEvent(element, "mouseout", handleMouseOut);
    }


    /**
     * find if element is (inside) given parent element
     * @param   object  element
     * @param   object  parent
     * @return  bool    inside
     */
    function isInsideHammer(parent, child) {
        // get related target for IE
        if(!child && window.event && window.event.toElement){
            child = window.event.toElement;
        }

        if(parent === child){
            return true;
        }

        // loop over parentNodes of child until we find hammer element
        if(child){
            var node = child.parentNode;
            while(node !== null){
                if(node === parent){
                    return true;
                }
                node = node.parentNode;
            }
        }
        return false;
    }


    /**
     * merge 2 objects into a new object
     * @param   object  obj1
     * @param   object  obj2
     * @return  object  merged object
     */
    function mergeObject(obj1, obj2) {
        var output = {};

        if(!obj2) {
            return obj1;
        }

        for (var prop in obj1) {
            if (prop in obj2) {
                output[prop] = obj2[prop];
            } else {
                output[prop] = obj1[prop];
            }
        }
        return output;
    }


    /**
     * check if object is a function
     * @param   object  obj
     * @return  bool    is function
     */
    function isFunction( obj ){
        return Object.prototype.toString.call( obj ) == "[object Function]";
    }


    /**
     * attach event
     * @param   node    element
     * @param   string  types
     * @param   object  callback
     */
    function addEvent(element, types, callback) {
        types = types.split(" ");
        for(var t= 0,len=types.length; t<len; t++) {
            if(element.addEventListener){
                element.addEventListener(types[t], callback, false);
            }
            else if(document.attachEvent){
                element.attachEvent("on"+ types[t], callback);
            }
        }
    }


    /**
     * detach event
     * @param   node    element
     * @param   string  types
     * @param   object  callback
     */
    function removeEvent(element, types, callback) {
        types = types.split(" ");
        for(var t= 0,len=types.length; t<len; t++) {
            if(element.removeEventListener){
                element.removeEventListener(types[t], callback, false);
            }
            else if(document.detachEvent){
                element.detachEvent("on"+ types[t], callback);
            }
        }
    }
}


(function() {
  'use strict';

  var Camera, SceneElement, Slide, SlideGroup, addDocListener, addWinListener, attachPlugin, camera, css, defTransform, fireDocEvent, init, initListeners, initTouchListeners, initialized, memoize1, mosho, onEnterSlide, onLeaveSlide, perspective, pfx, root, transform3d, transformData, unHash, updateWinHash,
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  memoize1 = function(fn) {
    var m;
    m = {};
    return function(a) {
      if (m[a] == null) {
        m[a] = fn(a);
      }
      return m[a];
    };
  };

  updateWinHash = function(tag) {
    var hash;
    hash = "#" + tag;
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
    window.scrollTo(0, 0);
    setTimeout((function() {
      return window.scrollTo(0, 0);
    }), 0);
  };

  addWinListener = function(evt, cb) {
    window.addEventListener(evt, cb);
  };

  addDocListener = function(evt, cb) {
    document.addEventListener(evt, cb);
  };

  fireDocEvent = function(evtName, detail) {
    var evt;
    if (detail == null) {
      detail = {};
    }
    evt = document.createEvent('CustomEvent');
    evt.initCustomEvent(evtName, true, true, detail);
    document.dispatchEvent(evt);
  };

  unHash = function(str) {
    return str.replace(/^\#/, '');
  };

  pfx = (function() {
    var pres, style;
    style = document.createElement("dummy").style;
    pres = ["Webkit", "Moz", "O", "ms", "Khtml"];
    return memoize1(function(prop) {
      var props, uc, _i, _len;
      uc = prop.charAt(0).toUpperCase() + prop.slice(1);
      props = [prop].concat(pres.map(function(pre) {
        return "" + pre + uc;
      }));
      for (_i = 0, _len = props.length; _i < _len; _i++) {
        prop = props[_i];
        if (style[prop] != null) {
          return prop;
        }
      }
    });
  })();

  css = function(el, props) {
    var key, pkey;
    if (props == null) {
      props = [];
    }
    for (key in props) {
      if (!(props.hasOwnProperty(key))) {
        continue;
      }
      pkey = pfx(key);
      el.style[pkey] = props[key];
    }
    return el;
  };

  perspective = function(p) {
    return " perspective(" + p + "px) ";
  };

  defTransform = {
    scale: 1,
    translate: {
      x: 0,
      y: 0,
      z: 0
    },
    rotate: {
      x: 0,
      y: 0,
      z: 0
    }
  };

  transform3d = function(_arg, rev) {
    var r, s, t;
    t = _arg.translate, r = _arg.rotate, s = _arg.scale;
    if (rev == null) {
      rev = false;
    }
    if (rev) {
      return ("scale(" + (1 / s) + ")") + (" rotateZ(" + (-r.z) + "deg) rotateY(" + (-r.y) + "deg) rotateX(" + (-r.x) + "deg)") + (" translate3d(" + (-t.x) + "px," + (-t.y) + "px," + (-t.z) + "px)");
    } else {
      return ("translate3d(" + t.x + "px," + t.y + "px," + t.z + "px)") + (" rotateX(" + r.x + "deg) rotateY(" + r.y + "deg) rotateZ(" + r.z + "deg)") + (" scale(" + s + ")");
    }
  };

  transformData = function(data, def) {
    var transform;
    if (def == null) {
      def = defTransform;
    }
    transform = {
      scale: Number(data.scale || 1) * def.scale,
      translate: {
        x: Number(data.x || 0) + def.translate.x,
        y: Number(data.y || 0) + def.translate.y,
        z: Number(data.z || 0) + def.translate.z
      },
      rotate: {
        x: Number(data.rotx || 0) + def.rotate.x,
        y: Number(data.roty || 0) + def.rotate.y,
        z: Number(data.rotz || 0) + def.rotate.z
      }
    };
    return transform;
  };

  initialized = false;

  root = null;

  camera = null;

  SceneElement = (function() {
    var byId, byOrder, n;

    n = 0;

    byId = {};

    byOrder = [];

    function SceneElement(el, parent) {
      this.el = el;
      this.parent = parent != null ? parent : null;
      this.data = this.el.dataset;
      this.transform = transformData(this.data);
      if (!this.el.id) {
        this.el.id = "mosho-element-" + n;
      }
      this.id = this.el.id;
      css(this.el, {
        position: 'absolute',
        display: 'block',
        transformStyle: 'preserve-3d'
      });
      this.updateCss();
      this.order = n++;
      byId[this.id] = this;
      byOrder.push(this);
      return;
    }

    SceneElement.prototype.show = function(t) {
      var e;
      if (t == null) {
        t = null;
      }
      if (typeof t === 'string' && ((e = this.getById(t)) != null)) {
        return e.show();
      } else {
        return false;
      }
    };

    SceneElement.prototype.getById = function(id) {
      return byId[id];
    };

    SceneElement.prototype.getByOrder = function(n, offset) {
      var max;
      if (offset == null) {
        offset = false;
      }
      max = byOrder.length - 1;
      if (offset) {
        n += this.order;
      }
      while (n > max) {
        n -= byOrder.length;
      }
      while (n < 0) {
        n += byOrder.length;
      }
      return byOrder[n];
    };

    SceneElement.prototype.getTransformList = function() {
      var transforms, _ref;
      transforms = [this.transform].concat(((_ref = this.parent) != null ? _ref.getTransformList() : void 0) || []);
      return transforms;
    };

    SceneElement.prototype.buildTotalTransform = function() {
      var t, transform, transforms;
      transforms = this.getTransformList();
      transform = {
        scale: 1,
        translate: {
          x: 0,
          y: 0,
          z: 0
        },
        rotate: {
          x: 0,
          y: 0,
          z: 0
        }
      };
      while ((t = transforms.shift()) != null) {
        transform.scale *= t.scale;
        transform.translate.x += t.translate.x;
        transform.translate.y += t.translate.y;
        transform.translate.z += t.translate.z;
        transform.rotate.x += t.rotate.x;
        transform.rotate.y += t.rotate.y;
        transform.rotate.z += t.rotate.z;
      }
      return transform;
    };

    SceneElement.prototype.buildCssTransform = function(camera) {
      if (camera == null) {
        camera = false;
      }
      return transform3d(this.buildTotalTransform(), camera);
    };

    SceneElement.prototype.updateCss = function() {
      return css(this.el, {
        transform: this.buildCssTransform()
      });
    };

    SceneElement.prototype.translate = function(x, y, z, abs) {
      if (x == null) {
        x = 0;
      }
      if (y == null) {
        y = 0;
      }
      if (z == null) {
        z = 0;
      }
      if (abs == null) {
        abs = false;
      }
      if (abs) {
        this.transform.translate = {
          x: x,
          y: y,
          z: z
        };
      } else {
        this.transform.translate.x += x;
        this.transform.translate.y += y;
        this.transform.translate.z += z;
      }
      this.updateCss();
    };

    SceneElement.prototype.rotate = function(x, y, z, abs) {
      if (abs == null) {
        abs = false;
      }
      if (abs) {
        this.transform.rotate = {
          x: x,
          y: y,
          z: z
        };
      } else {
        this.transform.rotate.x += x;
        this.transform.rotate.y += y;
        this.transform.rotate.z += z;
      }
      this.updateCss();
    };

    SceneElement.prototype.scale = function(s, abs) {
      if (s == null) {
        s = 1;
      }
      if (abs == null) {
        abs = false;
      }
      if (abs) {
        this.transform.scale = s;
      } else {
        this.transform.scale *= s;
      }
      this.updateCss();
    };

    return SceneElement;

  })();

  SlideGroup = (function(_super) {

    __extends(SlideGroup, _super);

    function SlideGroup(el, parent) {
      var me;
      this.el = el;
      this.parent = parent != null ? parent : null;
      SlideGroup.__super__.constructor.call(this, this.el, this.parent);
      me = this;
      this.children = (function() {
        var _i, _len, _ref, _ref1, _ref2, _results;
        _ref = this.el.childNodes;
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          el = _ref[_i];
          if (el != null ? (_ref1 = el.classList) != null ? _ref1.contains('mosho-slide') : void 0 : void 0) {
            _results.push(new Slide(el, me));
          } else if (el != null ? (_ref2 = el.classList) != null ? _ref2.contains('mosho-group') : void 0 : void 0) {
            _results.push(new SlideGroup(el, me));
          } else {
            _results.push(void 0);
          }
        }
        return _results;
      }).call(this);
    }

    SlideGroup.prototype.updateCss = function() {};

    SlideGroup.prototype.show = function(t) {
      if (SlideGroup.__super__.show.call(this, t)) {
        return true;
      }
      return this.getByOrder(1, true).show();
    };

    return SlideGroup;

  })(SceneElement);

  Camera = (function(_super) {

    __extends(Camera, _super);

    function Camera(el) {
      this.el = el;
      Camera.__super__.constructor.call(this, this.el, null);
      css(this.el, {
        position: 'absolute',
        transformOrigin: "0% 0%",
        transformStyle: "preserve-3d"
      });
    }

    Camera.prototype.updateCss = function() {};

    return Camera;

  })(SlideGroup);

  Slide = (function(_super) {
    var active, n, slides;

    __extends(Slide, _super);

    active = null;

    slides = [];

    n = 0;

    function Slide(el, parent) {
      this.el = el;
      this.parent = parent != null ? parent : null;
      this.el.classList.add('mosho-inactive');
      this.slidesOrder = n++;
      slides.push(this);
      Slide.__super__.constructor.call(this, this.el, this.parent);
      this.updateCss();
    }

    Slide.prototype.show = function(t) {
      var prevSlide;
      if (Slide.__super__.show.call(this, t)) {
        return true;
      }
      if (this === this.getActiveSlide()) {
        return true;
      }
      prevSlide = this.getActiveSlide();
      fireDocEvent("mosho:enter:" + this.id);
      if (prevSlide != null) {
        fireDocEvent("mosho:leave:" + prevSlide.id);
      }
      fireDocEvent("mosho:pre-show", {
        prevSlide: prevSlide,
        nextSlide: this
      });
      active = this;
      updateWinHash(this.id);
      if (prevSlide != null) {
        prevSlide.el.classList.remove('mosho-active');
      }
      if (prevSlide != null) {
        prevSlide.el.classList.add('mosho-inactive');
      }
      this.el.classList.remove('mosho-inactive');
      this.el.classList.add('mosho-active');
      css(camera.el, {
        transform: this.buildCssTransform(true),
        transition: "all " + (this.data.transition || "1s ease")
      });
      fireDocEvent("mosho:post-show", {
        prevSlide: prevSlide,
        nextSlide: this
      });
      return true;
    };

    Slide.prototype.getActiveSlide = function() {
      return active;
    };

    Slide.prototype.getPrevSlide = function() {
      if (this.data.prev != null) {
        return this.getById(this.data.prev);
      } else {
        return slides[this.slidesOrder === 0 ? slides.length - 1 : this.slidesOrder - 1];
      }
    };

    Slide.prototype.getNextSlide = function() {
      if (this.data.next != null) {
        return this.getById(this.data.next);
      } else {
        return slides[this.slidesOrder === slides.length - 1 ? 0 : this.slidesOrder + 1];
      }
    };

    Slide.prototype.updateCss = function() {
      return css(this.el, {
        transform: 'translate(-50%,-50%) ' + this.buildCssTransform()
      });
    };

    return Slide;

  })(SceneElement);

  init = function() {
    if (initialized) {
      return;
    }
    fireDocEvent("mosho:pre-init");
    root = document.createElement('div');
    root.id = 'mosho-container';
    css(document.body, {
      height: '100%',
      overflow: 'hidden'
    });
    css(root, {
      position: "absolute",
      transformOrigin: "0% 0%",
      transition: "all 0s ease-in-out",
      top: "50%",
      left: "50%",
      transform: perspective(4000),
      transformStyle: "preserve-3d"
    });
    camera = document.getElementById('mosho');
    camera.id = 'mosho-camera';
    camera = new Camera(camera);
    document.body.appendChild(root);
    root.appendChild(camera.el);
    if (!camera.show(unHash(window.location.hash))) {
      camera.getByOrder(0).show();
    }
    initListeners();
    initTouchListeners();
    initialized = true;
    fireDocEvent("mosho:post-init");
  };

  initTouchListeners = function() {
    var hammer;
    hammer = new Hammer(document.documentElement);
    hammer.onswipe = function(swipeEvent) {
      if (swipeEvent.direction === "left") {
        mosho.next();
      }
      if (swipeEvent.direction === "right") {
        mosho.prev();
      }
    };
  };

  initListeners = function() {
    addWinListener('hashchange', function() {
      return Slide.prototype.getById(unHash(window.location.hash)).show();
    });
    addDocListener('keydown', function(e) {
      switch (e.keyCode) {
        case 37:
        case 38:
        case 9:
        case 32:
        case 39:
        case 40:
          e.preventDefault();
      }
    });
    addDocListener('keyup', function(e) {
      switch (e.keyCode) {
        case 37:
        case 38:
          mosho.prev();
          return e.preventDefault();
        case 9:
        case 32:
        case 39:
        case 40:
          mosho.next();
          return e.preventDefault();
      }
    });
  };

  onEnterSlide = function(id, cb) {
    addDocListener("mosho:enter:" + id, cb);
  };

  onLeaveSlide = function(id, cb) {
    addDocListener("mosho:leave:" + id, cb);
  };

  attachPlugin = function(plug) {
    var _ref;
    if ((_ref = plug.name) == null) {
      plug.name = "Anonymous Plugin";
    }
    if (initialized) {
      console.warn("plugin '" + plug.name + "' attached after Mosho.init()");
    }
    if (typeof plug.preJump === 'function') {
      addDocListener("mosho:pre-init", plug.preinit);
    }
    if (typeof plug.postInit === 'function') {
      addDocListener("mosho:post-init", plug.postInit);
    }
    if (typeof plug.preShow === 'function') {
      addDocListener("mosho:pre-show", plug.preShow);
    }
    if (typeof plug.postShow === 'function') {
      addDocListener("mosho:post-show", plug.postShow);
    }
  };

  mosho = window.mosho = {
    init: init,
    prev: function() {
      return Slide.prototype.getActiveSlide().getPrevSlide().show();
    },
    next: function() {
      return Slide.prototype.getActiveSlide().getNextSlide().show();
    },
    show: function(id) {
      return SceneElement.prototype.getById(id).show();
    },
    getElement: function(id) {
      if (id != null) {
        return SceneElement.prototype.getById(id);
      } else {
        return Slide.prototype.getActiveSlide();
      }
    },
    enter: onEnterSlide,
    leave: onLeaveSlide,
    plugin: attachPlugin
  };

}).call(this);
