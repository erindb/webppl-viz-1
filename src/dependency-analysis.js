/*
  (local-set-key (kbd "s-r") (lambda () (interactive) (save-buffer) (process-send-string "*shell viz*" "echo '\n'; node src/dependency-analysis.js\n")))
*/

var esprima = require('esprima');
var escodegen = require('escodegen');
var escope = require('escope');

var traverse = require('estraverse').traverse;
var replace = require('estraverse').replace;
var _ = require('underscore');
var lodash = require('lodash');
var Closure = require('./closure');

/*
  (function() {,
  var x = flip(0.5); // [x],
  var y = repeat(2, x ? gaussian(0,1) : beta(2,2)); // [x,y], // TODO: second arg should be a function, not a value
  var z = map(function (x) { var y = x + 1; return y }, y); // [x,y,x],
  return z,
  })
*/
function m() {
  return _k0(globalStore, function (globalStore, _k1, _address153) {
    var _currentAddress = _address153;
    _addr.save(_globalCurrentAddress, _address153);
    return function () {
      return flip(globalStore, function (globalStore, x) {
        _addr.save(_globalCurrentAddress, _currentAddress);
        var _k4 = function (globalStore, _result3) {
          _addr.save(_globalCurrentAddress, _currentAddress);
          return function () {
            return repeat(globalStore, function (globalStore, y) {
              _addr.save(_globalCurrentAddress, _currentAddress);
              return function () {
                return map(globalStore, function (globalStore, z) {
                  _addr.save(_globalCurrentAddress, _currentAddress);
                  return function () {
                    return _k1(globalStore, z);
                  };
                }, _address153.concat('_159'), function (globalStore, _k2, _address154, x) {
                  var _currentAddress = _address154;
                  _addr.save(_globalCurrentAddress, _address154);
                  var y = ad.scalar.add(x, 1);
                  return function () {
                    return _k2(globalStore, y);
                  };
                }, y);
              };
            }, _address153.concat('_158'), 2, _result3);
          };
        };
        return function () {
          return x ? gaussian(globalStore, _k4, _address153.concat('_156'), 0, 1) : beta(globalStore, _k4, _address153.concat('_157'), 2, 2);
        };
      }, _address153.concat('_155'), 0.5);
    };
  });
}

var ast = esprima.parse(m.toString())

var untrampoline = function(ast) {
  replace(ast,
          {enter: function(node, parent) {

          }}
         )
}

var getReturnVariables = function(ast) {
  var rets = [];
  // find where we call the _k1 continuation and extract those arguments (minus globalStore)
  traverse(
    ast,
    {enter: function(node, parent) {
      if (node.type == 'CallExpression' && node.callee.type == 'Identifier') {
        if (node.callee.name == '_k1') {
          rets = _.chain(node.arguments).pluck('name').without('globalStore').value();
          this.break(); // stops traversing
        }
      }
    }}
  )
  return rets;
}

// undo the trampolining


// MOCK
var mUntrampolined = [
  '(function() {',
  'var x = flip(0.5); // [x]',
  'var y = repeat(2, x ? gaussian(0,1) : beta(2,2)); // [x,y]', // TODO: second arg should be a function, not a value
  'var z = map(function (x) { var y = x + 1; return y }, y); // [x,y,x]',
  'return z',
  '})'
].join('\n')


var astUntrampolined = esprima.parse(mUntrampolined);


// _ast must be untrampolined
var uniqueNames = function(_ast) {
  var ast = lodash.cloneDeep(_ast);

  var scopeManager = escope.analyze(ast);
  var topScope = scopeManager.acquire(ast);

  var rename = function(topNode, from, to) {

    console.log('\nCALLING RENAME');
    console.log('renaming', from, 'to', to, 'in', escodegen.generate(topNode))
    console.log('------------------------------')

    var renamingScope = scopeManager.acquireAll(topNode);

    console.log(renamingScope)
    process.exit()

    var r = replace(topNode, {
      leave: function(node, parent) {
        if (node.type == 'Identifier') {
          if (node.name == from) {

            // if (escodegen.generate(parent) == 'x + 1') {
            //   //console.log(scopeManager.acquire(node))
            //   console.log('here');
            //   console.log(escodegen.generate(parent))
            // }

            if (_.isEqual(scopeManager.acquire(parent), renamingScope) || true) {
              return _.extend({}, node, {name: to});
            }
          }
        }
      }
    });
    console.log('RENAMED: ', escodegen.generate(r));
    console.log('------------------------------')
    return r;


  }

  var gensymDict = {}
  var gensym = function(prefix) {
    if (!gensymDict[prefix]) {
      gensymDict[prefix] = 0
    }
    gensymDict[prefix] += 1
    // console.log('gensym', prefix, gensymDict[prefix]);
    return prefix + ('__' + gensymDict[prefix])
  }

  var ancestorScopes = function(scope) {
    var currScope = scope;
    var ancestors = [];
    while(currScope.upper) {
      currScope = currScope.upper;
      ancestors.push(currScope);
    }
    return ancestors;
  }

  var scopesToTraverse = [topScope];
  // traverse scopes, marking
  while(scopesToTraverse.length) {
    var scope = scopesToTraverse.shift();
    // console.log('inside of:')
    // console.log('------------------------------')
    // console.log(escodegen.generate(scope.block))
    // console.log('------------------------------')

    var variables = _.chain(scope.variables)
        .pluck('name')
        .without('arguments')
        .value();
    // console.log('variables are', variables.join(', '));

    // get any conflicts with variables in ancestor scopes
    var ancestorVariables = _.chain(ancestorScopes(scope))
        .pluck('variables')
        .flatten()
        .pluck('name')
        .without('arguments')
        .value();

    var conflictingNames = _.intersection(variables, ancestorVariables);

    if (conflictingNames.length > 0) {
      // console.log('conflicting names are', conflictingNames.join(', '))

      conflictingNames.forEach(function(name) {
        // TODO: using findWhere means I don't handle multiple redefinitions of the same variable
        var scopeEntry = _.findWhere(scope.variables,{name: name});
        var defNames = _.pluck(scopeEntry.defs, 'name');
        var refNames = _.pluck(scopeEntry.references, 'identifier');
        var changeSites = defNames.concat(refNames);

        var newName = gensym(name);

        // console.log('renaming', name, 'to', newName);
        changeSites.forEach(function(x) { x.name = newName })
      })
    }
    // console.log('\n')

    scopesToTraverse = scopesToTraverse.concat(scope.childScopes);
  }


  return ast;
}
// // test with transformed
// var source = 'var x = [[1]]; var y = map(function(x) { return x.map(function(x) { var y = x + 1; return y}) }, x);';
// console.log(escodegen.generate(uniqueNames(esprima.parse(source))))
// process.exit()

// test with untransformed
// var ast2b = uniqueNames(ast);
// console.log(escodegen.generate(ast2b));
// process.exit()

var ast2 = uniqueNames(ast);

// TODO: make this work for the transformed code
// TODO: filter out variables that are entirely deterministic (i.e., neither random nor derived from random)
var getTopLevelVarsUntransformed = function(ast) {
  return _.chain(ast.body[0].expression.body.body)
    .where({type: 'VariableDeclaration'})
    .pluck('declarations')
    .flatten()
    .pluck('id')
    .pluck('name')
    .value();
}

var getTopLevelVars = function(ast) {
  var vars = [];
  var whitelistContinuation = true;  // the top level continuation in a model function has an _address in it, so we don't count it as a lower-level cont
  traverse(
    ast,
    {enter: function(node, parent) {
      if (node.type == 'FunctionExpression') {

        if (whitelistContinuation) {
          whitelistContinuation = false;
          return;
        }

        var variableNames = _.pluck(node.params, 'name');

        if (_.find(variableNames, function(name) { return /_address/.test(name) })) {
          this.skip();
        } else {
          var addedNames = _.reject(variableNames,
                                    function(name) { return /globalStore/.test(name) || /_k/.test(name) || /_result/.test(name) })
          vars = vars.concat(addedNames);
        }
      }
    }
    }
  )
  return vars;
}

console.log(getTopLevelVars(ast2));
process.exit()


// returns all identifiers referenced in a syntax subtree
var treeIdentifiers = function(t, name) {

  var names = [];

  traverse(t, {
    enter: function (node, parent) {
      if (node.type == 'Identifier') {
        names.push(node.name);
      }
    },
    leave: function (node, parent) {
    }
  });

  return names;
}

var topLevelDependencies = function(ast) {
  var varNames = getTopLevelVars(ast);

  var modelBody = ast.body[0].expression.body.body;

  return _.chain(varNames)
    .map(function(varName) {

      var declaration = _.find(modelBody,
                               function(ast1) {
                                 return ast1.type == 'VariableDeclaration' &&
                                   ast1.declarations[0].id.name == varName
                               });

      var otherIdentifiers = _.without(treeIdentifiers(declaration), varName);
      return [varName, _.intersection(varNames, otherIdentifiers)];

    })
    .object()
    .value();
}



var bayesBall = function(dependencies, query, givens) {
  var getParents = function(node) {
    return dependencies[node];
  }

  var getChildren = function(node) {
    return _.keys(_.pick(dependencies,
                         function(v, k) {
                           return (_.contains(v, node))
                         }));
  }

  var curNode;
  var numVisited = 0;
  var visited = {};
  var queue = [query];

  var relation = function(a,b) {
    if (_.contains(dependencies[a], b)) {
      return 'child' // a is a child of b
    } else {
      return 'parent'
    }
  }

  // visit query
  while(true) {
    if (queue.length == 0) {
      break;
    }
    var lastNode = curNode;
    curNode = queue.shift();
    var from = !lastNode ? 'child' : relation(lastNode, curNode);

    // console.log('last: ', lastNode);
    // console.log('curr: ', curNode);
    // console.log('from: ', from);
    // console.log('');

    if (!_.has(visited, curNode)) {
      visited[curNode] = {};
    }

    if (visited[curNode][from]) {
      continue;
    }

    visited[curNode][from] = true;

    if (from == 'child') {
      if (_.contains(givens, curNode)) {

      } else {
        queue = queue.concat(getParents(curNode), getChildren(curNode))
      }
    } else {
      if (_.contains(givens, curNode)) {
        //console.log(getParents(curNode));
        queue = queue.concat(getParents(curNode))
      } else {
        queue = queue.concat(getChildren(curNode))
      }
    }
  }

  return visited;

}
