fs     = require 'fs'
path   = require 'path'
coffee = require 'coffee-script'
uglify = require 'uglify-js'

coffeeSrcDir = "#{__dirname}/src/coffee"
jsDistDir    = "#{__dirname}/dist"


task 'clean', ->
  try
    rmRecurse jsDistDir
  catch e
    console.log e

task 'build', ->
  invoke 'clean'
  fs.mkdirSync jsDistDir
  
  coffeeSources = fs.readdirSync(coffeeSrcDir).map (file) ->
    source =
      source: fs.readFileSync("#{coffeeSrcDir}/#{file}").toString()
      file: path.basename file, '.coffee'
    return source
  
  jsSources = coffeeSources.map (source) ->
    source =
      source: coffee.compile source.source
      file: source.file
    return source
  
  jsSources.forEach (source) ->
    ast = uglify.parser.parse source.source
    ast = uglify.uglify.ast_mangle ast
    ast = uglify.uglify.ast_squeeze ast
    min = uglify.uglify.gen_code ast
    
    fs.writeFileSync "#{jsDistDir}/#{source.file}.js", source.source
    fs.writeFileSync "#{jsDistDir}/#{source.file}.min.js", min


rmRecurse = (filename) ->
  try
    stat = fs.statSync filename
    if stat.isFile()
      fs.unlinkSync filename
    else if stat.isDirectory()
      fs.readdirSync(filename).forEach (subfilename) ->
        rmRecurse "#{filename}/#{subfilename}"
      fs.rmdirSync filename
  catch e
    console.log e unless e.errno == 34