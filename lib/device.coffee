###
# Copyright 2013-2016  Zaid Abdulla
#
# GenieACS is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# GenieACS is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
###

common = require './common'


sanitizeDeclaration = (declaration, wildcard, now) ->
  if typeof declaration is 'number'
    declaration = [declaration]

  if declaration[7]?
    declaration[7] = sanitizeParameterValue(declaration[7])

  for i in [0...declaration.length] by 2 when declaration[i]?
    if declaration[i] <= 0
      declaration[i] = now + declaration[i]
    else
      declaration[i] = Math.min(now, declaration[i])

  return declaration


sanitizeProperties = (properties, wildcard) ->
  if not wildcard
    if typeof properties is 'number'
      properties = [properties]
    else if properties[1]
      properties[1] = 1

      for i in [2...properties.length] by 2 \
          when properties[i]? and properties[i + 1]?
        properties[0] = Math.max(properties[0] ? 0, properties[i])

      if properties[6]? and properties[7]? and not (properties[6] < properties[2])
        properties[2] = properties[6]
        properties[3] = 0
      else if properties[2]? and properties[3] and not (properties[2] < properties[6])
        properties[6] = properties[2]
        properties[7] = null

  else if typeof properties isnt 'number'
    properties = properties[0]

  return properties


sanitizeParameterValue = (parameterValue) ->
  if parameterValue[0]?
    switch parameterValue[1]
      when 'xsd:boolean'
        if typeof parameterValue[0] isnt 'boolean'
          parameterValue = parameterValue.slice()
          parameterValue[0] = !!JSON.parse(parameterValue[0])
      when 'xsd:string'
        if typeof parameterValue[0] isnt 'string'
          parameterValue = parameterValue.slice()
          parameterValue[0] = '' + parameterValue[0]
      when 'xsd:int', 'xsd:unsignedInt'
        if typeof parameterValue[0] isnt 'number'
          parameterValue = parameterValue.slice()
          parameterValue[0] = +parameterValue[0]
      when 'xsd:dateTime'
        if typeof parameterValue[0] isnt 'number'
          parameterValue = parameterValue.slice()
          if parameterValue[0].getTime?
            parameterValue[0] = parameterValue[0].getTime()
          else if isNaN(parameterValue[0])
            parameterValue[0] = Date.parse(parameterValue[0])
          else
            parameterValue[0] = +parameterValue[0]
      else
        if parameterValue[1]?
          throw new Error("Parameter value type \"#{parameterValue[1]}\" not recognized.")

        # Ensure consistency after serialization
        parameterValue[0] = JSON.parse(JSON.stringify(parameter[0]))

  return parameterValue


init = () ->
  return [[[null, [0, 1]]]]


declare = (deviceData, path, declaration, now) ->
  wildcard = false
  for i in [0...path.length] by 1 when not path[i]?
    wildcard = true
    break

  declaration = sanitizeDeclaration(declaration, wildcard, now)

  ref = deviceData
  depth = 0
  for i in [0...path.length] by 1
    if not (p = path[i])?
      ++ depth
      continue

    ref[1 + depth] ?= {}
    ref[1 + depth][p] ?= []
    ref = ref[1 + depth][p]
    depth = 0

  ref[0] ?= []
  ref[0][depth] ?= []

  if wildcard
    ref[0][depth][0] = Math.max(ref[0][depth][0] ? 0, declaration[0])
  else if not ref[0][depth][0]?
      ref[0][depth][0] = declaration
  else
    for i in [0...declaration.length] by 2
      if declaration[i]?
        ref[0][depth][0][i] = Math.max(ref[0][depth][0][i] ? 0, declaration[i])

      if declaration[i + 1]?
        ref[0][depth][0][i + 1] = declaration[i + 1]

  return


set = (deviceData, path, revision, properties) ->
  ++ revision # revisions start at layer 1
  wildcard = false
  for i in [0...path.length] by 1 when not path[i]?
    wildcard = true
    break

  properties = sanitizeProperties(properties, wildcard)

  ref = deviceData
  depth = 0
  for i in [0...path.length] by 1
    if not (p = path[i])?
      ++ depth
      continue

    if not wildcard and properties[1]
      # Update existing timestamp for ancestors
      ref[0] ?= []
      ref[0][0] ?= []
      ref[0][0][revision] ?= []
      if not (ref[0][0][revision][0] >= properties[0])
        ref[0][0][revision][0] = properties[0]
        ref[0][0][revision][1] = 1

      if not (ref[0][0][revision][2] >= properties[0])
        ref[0][0][revision][2] = properties[0]
        ref[0][0][revision][3] = 1

    ref[1 + depth] ?= {}
    ref[1 + depth][p] ?= []
    ref = ref[1 + depth][p]
    depth = 0

  ref[0] ?= []
  ref[0][depth] ?= []

  if wildcard
    ref[0][depth][revision] = Math.max(ref[0][depth][revision] ? 0, properties)
  else if not ref[0][0][revision]?
    ref[0][0][revision] = properties
  else
    for i in [0...properties.length] by 2 \
        when properties[i]?# and properties[i + 1]?
      if not (properties[i] < ref[0][0][revision][i])
        ref[0][0][revision][i] = properties[i]
        ref[0][0][revision][i + 1] = properties[i + 1]

    if properties[7]?
      ref[0][0][revision][7] = sanitizeParameterValue(ref[0][0][revision][7])

  return


traverse = (deviceData, pattern, revision, callback) ->
  if not pattern?
    pattern = []
    pattern.length = 99

  if not revision?
    revision = 99

  ++ revision # First layer is for declarations

  collectTimestamps = (ref, path, root, timestamps, wildcard) ->
    # Skip properties of parameter we're currently at
    skip = if root == path.length then 1 else 0

    if ref[0]?
      for i in [skip...ref[0].length] by 1
        if ref[0][i]? and i <= pattern.length - path.length
          p = path.slice()
          p.length += i
          if wildcard or i > 0
            revisions = ref[0][i]
          else
            # Extract only timestamp from properties array
            revisions = (j?[0] for j in ref[0][i])

          current = -1
          for j in [Math.min(revision, revisions.length - 1)..1] by -1 when revisions[j]?
              current = revisions[j]; break

          timestamps.push([p, root, revisions, current, current])

    for i in [skip...ref.length - 1] by 1
      if ref[1 + i]? and i < pattern.length - path.length
        p = path.slice()
        p.length += i
        for k, v of ref[1+i]
          if not pattern[path.length + i]? or pattern[path.length + i] == k
            collectTimestamps(v, p.concat(k), root, timestamps, wildcard or i > 0)

    return

  processOverlaps = (timestamps, root, skip) ->
    skip = 1 if not skip
    for i in [skip...timestamps.length] by 1
      for j in [0...i] by 1
        if timestamps[i][0].length > timestamps[j][0].length
          t = timestamps[j]
          tt = timestamps[i]
        else
          t = timestamps[i]
          tt = timestamps[j]

        overlap = common.pathOverlap(t[0], tt[0], root)

        if overlap & 1
          if t[0].length == tt[0].length
            tt[3 + (root - tt[1]) * 2] = Math.max(tt[3 + (root - tt[1]) * 2], t[3 + (root - t[1]) * 2])
          else
            tt[4 + (root - tt[1]) * 2] = Math.max(tt[4 + (root - tt[1]) * 2], t[4 + (root - t[1]) * 2])

        if overlap & 2
          t[3 + (root - t[1]) * 2] = Math.max(t[3 + (root - t[1]) * 2], tt[3 + (root - t[1]) * 2])

    return

  recursive = (ref, path, timestamps, timestampThreshold, revisionThreshold) ->
    declaration = ref[0]?[0]?[0]?.slice() or []
    base = ref[0]?[0]?[1]?.slice() or []
    current = []

    # Find timestamp and revision in which this parameter was most recently
    # created in order to ignore older properties
    for t in timestamps
      for j in [Math.min(revision, t[2].length - 1)..1] by -1 when t[2][j]?
        if not (t[2][j] <= ref[0]?[0]?[j]?[0]) and t[2][j] >= timestampThreshold
          timestampThreshold = Math.max(timestampThreshold, t[2][j])
          revisionThreshold = Math.max(revisionThreshold, j)
          current[0] = timestampThreshold
        break

    # Collect current properties
    if ref[0]?[0]?
      for i in [revisionThreshold...Math.min(revision + 1, ref[0][0].length)] by 1 when (rev = ref[0][0][i])?
        for j in [0...rev.length] by 2 when rev[j]?
          if rev[j] >= timestampThreshold
            current[j] = rev[j]
            current[j + 1] = rev[j + 1]
          else
            current[j] ?= 0

    # Return if parameter no longer exists
    if not (declaration[1] or base[1] or current[1])
      l = timestamps.length
      collectTimestamps(ref, path, path.length - 1, timestamps)
      processOverlaps(timestamps, path.length - 1, l)
      return

    tentativeTimestamp = -1
    if current[2]? and not current[3]
      tentativeTimestamp = current[2]

    filteredTimestamps = timestamps.filter((t) ->
      if t[0][path.length - 1]?
        if t[0][path.length - 1]? and t[0][path.length - 1] == path[path.length - 1]
          t[2 + (path.length - t[1]) * 2] = Math.max(t[2 + (path.length - t[1]) * 2], current[0])
        else
          return false

      if t[0].length > path.length
        t[3 + (path.length - t[1]) * 2] = t[1 + (path.length - t[1]) * 2]
        t[4 + (path.length - t[1]) * 2] = tentativeTimestamp
        return true

      if not declaration[0] or t[2][0] > declaration[0]
        declaration[0] = t[2][0]

      return false
    )

    collectTimestamps(ref, path, path.length, filteredTimestamps)

    processOverlaps(filteredTimestamps, path.length, 0)

    if path.length < pattern.length
      children = {}
      for k, v of ref[1]
        if not pattern[path.length]? or k == pattern[path.length]
          r = recursive(v, path.concat(k), filteredTimestamps, timestampThreshold, revisionThreshold)
          children[k] = r if r?

    descendantTimestamps = filteredTimestamps.map((t) ->
      res = [t[0], t[1]]
      res[2] = t[2][0] if t[2][0]?
      res[3] = t[2][1] if t[2][1]?

      cur = Math.max(t[3 + (path.length - t[1]) * 2], t[4 + (path.length - t[1]) * 2])

      if path.length > t[1]
        t[2 + (path.length - t[1]) * 2] = Math.min(t[2 + (path.length - t[1]) * 2], cur)

      if cur >= 0
       res[4] = cur

      return res
    ).filter((t) -> t.length > 1)

    # Match value type of current if no type is specified
    if declaration[7]? and not declaration[7][1]?
      declaration[7] = sanitizeParameterValue([declaration[7][0], current[7]?[1]])

    return callback(path, declaration, base, current, descendantTimestamps, children)

  return recursive(deviceData, [], [], 0, 1)


collapse = (deviceData, revision, wildcard) ->
  ref = deviceData

  if ref[0]?
    for depth, i in ref[0] when depth?.length > revision + 2
      if i == 0 and not wildcard
        depth[revision + 1] ?= []
        for j in [revision + 2...depth.length] by 1 when depth[j]?
          for k in [0...depth[j].length] by 2 when depth[j][k]?
            depth[revision + 1][k] = depth[j][k]
            depth[revision + 1][k + 1] = depth[j][k + 1]
      else
        for j in [revision + 2...depth.length] by 1 when depth[j]?
          depth[revision + 1] = depth[j]

      depth.length = revision + 2

  for i in [1...ref.length] by 1 when ref[i]?
    for k, v of ref[i]
      collapse(v, revision, wildcard or i != 1)


clearDeclarations = (deviceData, prefix) ->
  ref = deviceData

  if prefix?
    for p in prefix
      ref = ref[1]?[p]
      return if not ref?

  if ref[0]?
    for depth in ref[0] when depth?
      depth[0] = null

  for i in [1...ref.length] by 1 when ref[i]?
    for k, v of ref[i]
      clearDeclarations(v)


getPrerequisiteDeclarations = (declarations) ->
  dec = [declarations[0], 1]
  for i in [1...declarations.length] by 2
    if declarations[i]?
      dec[i] = declarations[i]
    else if declarations[i + 1]?
      dec[i] = 1
  return [dec]


getAll = (deviceData, pattern, revision) ->
  allParameters = []
  traverse(deviceData, pattern, revision, (path, declaration, base, current, descendantTimestamps, children) ->
    if path.length == pattern.length and current[1]
      allParameters.push([path].concat(current))
  )
  return allParameters


exports.getPrerequisiteDeclarations = getPrerequisiteDeclarations
exports.init = init
exports.getAll = getAll
exports.declare = declare
exports.set = set
exports.traverse = traverse
exports.collapse = collapse
exports.clearDeclarations = clearDeclarations
exports.sanitizeParameterValue = sanitizeParameterValue
