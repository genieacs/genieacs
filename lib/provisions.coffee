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


processProvision = (type, args, callback) ->
  switch type
    when 'refresh'
      declarations = []
      path = common.parsePath(args[0])
      declaration = [args[1], null, null, null, null, null, args[1]]
      for i in [path.length...14] by 1
        path = path.slice()
        path.length = i
        declarations.push([path].concat(declaration))

      return callback(null, declarations)

    when 'value'
      declarations = [[common.parsePath(args[0]), args[1], null, null, null, null, null, args[1]]]
      return callback(null, declarations)

    when 'tag'
      declarations = [[['Tags', args[0]], null, null, null, null, null, null, null, [args[1], 'xsd:boolean']]]
      return callback(null, declarations)

    else
      return callback(new Error("Unknown provision type '#{type}'"))


exports.processProvision = processProvision
