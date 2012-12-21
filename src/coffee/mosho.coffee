'use strict'

memoize1 = (fn) ->
  m = {}
  return (a) ->
    m[a] = fn(a) unless m[a]?
    return m[a]

updateWinHash = (tag) ->
  hash = "##{tag}"
  window.location.hash = hash if window.location.hash != hash
  window.scrollTo 0, 0
  setTimeout (-> window.scrollTo 0, 0), 0
  return

addWinListener = (evt, cb) ->
  window.addEventListener evt, cb
  return

addDocListener = (evt, cb) ->
  document.addEventListener evt, cb
  return

fireDocEvent = (evtName, detail = {}) ->
  evt = document.createEvent 'CustomEvent'
  evt.initCustomEvent evtName, on, on, detail
  document.dispatchEvent evt
  return

unHash = (str) ->
  return str.replace /^\#/, ''

pfx = do ->
  style = document.createElement("dummy").style
  pres = ["Webkit","Moz","O","ms","Khtml"]
  return memoize1 (prop) ->
    uc = prop.charAt(0).toUpperCase() + prop.slice(1)
    props = [prop].concat pres.map (pre) -> "#{pre}#{uc}"
    for prop in props
      return prop if style[prop]?

css = (el, props = []) ->
  for key of props when props.hasOwnProperty key
    pkey = pfx key
    el.style[pkey] = props[key]
  return el

perspective = (p) ->
  return " perspective(#{p}px) "

defTransform =
  scale: 1
  translate: x: 0, y: 0, z: 0
  rotate: x: 0, y: 0, z: 0

transform3d = ({translate: t, rotate: r, scale: s}, rev = off) ->
  return if rev
    "scale(#{1 / s})" +
    " rotateZ(#{-r.z}deg) rotateY(#{-r.y}deg) rotateX(#{-r.x}deg)" +
    " translate3d(#{-t.x}px,#{-t.y}px,#{-t.z}px)"
  else
    "translate3d(#{t.x}px,#{t.y}px,#{t.z}px)" +
    " rotateX(#{r.x}deg) rotateY(#{r.y}deg) rotateZ(#{r.z}deg)" +
    " scale(#{s})"

transformData = (data, def = defTransform) ->
  transform =
    scale: Number(data.scale or 1) * def.scale
    translate:
      x: Number(data.x or 0) + def.translate.x
      y: Number(data.y or 0) + def.translate.y
      z: Number(data.z or 0) + def.translate.z
    rotate:
      x: Number(data.rotx or 0) + def.rotate.x
      y: Number(data.roty or 0) + def.rotate.y
      z: Number(data.rotz or 0) + def.rotate.z
  return transform

initialized = off
root = null
camera = null

class SceneElement
  n = 0
  byId = {}
  byOrder = []
  constructor: (@el, @parent = null) ->
    @data = @el.dataset
    @transform = transformData @data

    @el.id = "mosho-element-#{n}" unless @el.id
    @id = @el.id

    css @el,
      position:       'absolute'
      display:        'block'
      transformStyle: 'preserve-3d'

    @updateCss()
    @order = n++
    byId[@id] = @
    byOrder.push @
    return

  show: (t = null) ->
    return if typeof t is 'string' and (e = @getById(t))?
      e.show()
    else
      false

  getById: (id) -> byId[id]

  getByOrder: (n, offset = off) ->
    max = byOrder.length - 1
    n += @order if offset
    n -= byOrder.length while n > max
    n += byOrder.length while n < 0
    byOrder[n]

  getTransformList: ->
    transforms = [@transform].concat (@parent?.getTransformList() or [])
    return transforms

  buildTotalTransform: ->
    transforms = @getTransformList()
    transform =
      scale: 1
      translate: x: 0, y: 0, z: 0
      rotate: x: 0, y: 0, z: 0
    while (t = transforms.shift())?
      transform.scale *= t.scale
      transform.translate.x += t.translate.x
      transform.translate.y += t.translate.y
      transform.translate.z += t.translate.z
      transform.rotate.x += t.rotate.x
      transform.rotate.y += t.rotate.y
      transform.rotate.z += t.rotate.z
    return transform

  buildCssTransform: (camera = off) ->
    return transform3d @buildTotalTransform(), camera

  updateCss: ->
    css @el, transform: @buildCssTransform()

  translate: (x = 0, y = 0, z = 0, abs = off) ->
    if abs
      @transform.translate = x: x, y: y, z: z
    else
      @transform.translate.x += x
      @transform.translate.y += y
      @transform.translate.z += z
    @updateCss()
    return

  rotate: (x, y, z, abs = off) ->
    if abs
      @transform.rotate = x: x, y: y, z: z
    else
      @transform.rotate.x += x
      @transform.rotate.y += y
      @transform.rotate.z += z
    @updateCss()
    return

  scale: (s = 1, abs = off) ->
    if abs
      @transform.scale = s
    else
      @transform.scale *= s
    @updateCss()
    return

class SlideGroup extends SceneElement
  constructor: (@el, @parent = null) ->
    super @el, @parent
    me = @
    @children = for el in @el.childNodes
      if el?.classList?.contains 'mosho-slide'
        new Slide el, me
      else if el?.classList?.contains 'mosho-group'
        new SlideGroup el, me

  updateCss: -> return

  show: (t) ->
    return true if super t
    return @getByOrder(1, on).show()

class Camera extends SlideGroup
  constructor: (@el) ->
    super @el, null
    css @el,
      position: 'absolute'
      transformOrigin: "0% 0%"
      transformStyle: "preserve-3d"
  updateCss: -> return

class Slide extends SceneElement
  active = null
  slides = []
  n = 0

  constructor: (@el, @parent = null) ->
    @el.classList.add 'mosho-inactive'
    @slidesOrder = n++
    slides.push @
    super @el, @parent
    @updateCss()

  show: (t) ->
    return on if super t
    return on if @ == @getActiveSlide()
    prevSlide = @getActiveSlide()
    fireDocEvent "mosho:enter:#{@id}"
    fireDocEvent "mosho:leave:#{prevSlide.id}" if prevSlide?
    fireDocEvent "mosho:pre-show",
      prevSlide: prevSlide
      nextSlide: @
    active = @
    updateWinHash @id
    prevSlide?.el.classList.remove 'mosho-active'
    prevSlide?.el.classList.add 'mosho-inactive'
    @el.classList.remove 'mosho-inactive'
    @el.classList.add 'mosho-active'
    css camera.el,
      transform: @buildCssTransform on
      transition: "all " + (@data.transition or "1s ease")
    fireDocEvent "mosho:post-show",
      prevSlide: prevSlide
      nextSlide: @
    return on

  getActiveSlide: ->
    return active

  getPrevSlide: ->
    return if @data.prev?
      @getById @data.prev
    else
      slides[if @slidesOrder == 0 then slides.length-1 else @slidesOrder-1]

  getNextSlide: ->
    return if @data.next?
      @getById @data.next
    else
      slides[if @slidesOrder == slides.length-1 then 0 else @slidesOrder+1]

  updateCss: ->
    css @el, transform: 'translate(-50%,-50%) ' + @buildCssTransform()


init = ->
  return if initialized
  fireDocEvent "mosho:pre-init"

  root = document.createElement 'div'
  root.id = 'mosho-container'

  css document.body,
    height: '100%'
    overflow: 'hidden'

  css root,
    position: "absolute"
    transformOrigin: "0% 0%"
    transition: "all 0s ease-in-out"
    top: "50%"
    left: "50%"
    transform: perspective(4000)
    transformStyle: "preserve-3d"

  camera = document.getElementById 'mosho'
  camera.id = 'mosho-camera'
  camera = new Camera camera

  document.body.appendChild root
  root.appendChild camera.el

  unless camera.show unHash window.location.hash
    camera.getByOrder(0).show()

  initListeners()
  initTouchListeners()
  initialized = on

  fireDocEvent "mosho:post-init"
  return

initTouchListeners = ->
  hammer = new Hammer(document.documentElement)
  hammer.onswipe = (swipeEvent) ->
    if (swipeEvent.direction == "left")
      mosho.next()
    if (swipeEvent.direction == "right")
      mosho.prev()
    return
  return

initListeners = ->
  addWinListener 'hashchange', ->
    Slide.prototype
      .getById(unHash window.location.hash)
      .show()

  addDocListener 'keydown', (e) ->
    switch e.keyCode
      when 37, 38, 9, 32, 39, 40
        e.preventDefault()
    return

  addDocListener 'keyup', (e) ->
    switch e.keyCode
      when 37, 38
        mosho.prev()
        e.preventDefault()
      when 9, 32, 39, 40
        mosho.next()
        e.preventDefault()
  return

onEnterSlide = (id, cb) ->
  addDocListener "mosho:enter:#{id}", cb
  return

onLeaveSlide = (id, cb) ->
  addDocListener "mosho:leave:#{id}", cb
  return

attachPlugin = (plug) ->
  plug.name ?= "Anonymous Plugin"
  console.warn "plugin '#{plug.name}' attached after Mosho.init()" if initialized
  addDocListener "mosho:pre-init",  plug.preinit  if typeof plug.preJump  == 'function'
  addDocListener "mosho:post-init", plug.postInit if typeof plug.postInit == 'function'
  addDocListener "mosho:pre-show",  plug.preShow  if typeof plug.preShow  == 'function'
  addDocListener "mosho:post-show", plug.postShow if typeof plug.postShow == 'function'
  return

mosho = window.mosho =
  init: init
  prev: ->
    Slide.prototype
      .getActiveSlide()
      .getPrevSlide()
      .show()
  next: ->
    Slide.prototype
      .getActiveSlide()
      .getNextSlide()
      .show()
  show: (id) ->
    SceneElement.prototype
      .getById(id)
      .show()
  getElement: (id) ->
    return if id?
      SceneElement.prototype.getById id
    else
      Slide.prototype.getActiveSlide()
  enter: onEnterSlide
  leave: onLeaveSlide
  plugin: attachPlugin
