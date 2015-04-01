if(module.hot) {
  module.hot.accept(function(err) {
    console.log('[HMR] Error accepting: ' + err);
  });

  var parseFunction = function(func) {
    var code = func.toString();
    var m = code.match(/^function\s+__eval\s*\((.*)\)\s*\{([\s\S]*)\}$/i);
    if(!m) {
      return null;
    }
    var args = m[1];
    var body = m[2];
    var scope = {};

    if(args.trim()) {
      args.split(',').forEach(function(arg) {
        if(arg.indexOf('=') !== -1) {
          var p = arg.split('=');
          scope[p[0].trim()] = JSON.parse(p[1]);
        }
        else {
          scope[arg.trim()] = undefined;
        }
      });
    }

    return { body: body, scope: scope };
  }

  var injectScope = function(scope, code) {
    // Take an explicit scope object and inject it so that
    // `code` runs in context of it
    var injected = Object.keys(scope).map(function(binding) {
      return 'var ' + binding + ' = evalScope.' + binding + ';'
    }).join(' ');

    // Update our scope object with any modifications
    var extracted = Object.keys(scope).map(function(binding) {
      return 'evalScope.' + binding + ' = ' + binding + ';';
    }).join(' ');

    return injected + code + extracted;
  }

  var bindings = __moduleBindings;

  if(!module.hot.data) {
    // First time loading. Try and patch something.
    var patchedBindings = {};
    var originalBindings = {};
    var evalScope = {};

    var moduleEvalWithScope = function(frame) {
      // Update the scope to reflect only the values specified as
      // arguments to the __eval function. Copy over values from the
      // existing scope and ignore the rest.
      Object.keys(evalScope).forEach(function(arg) {
        if(arg in frame.scope) {
          frame.scope[arg] = evalScope[arg];
        }
      });
      evalScope = frame.scope;

      var code = injectScope(evalScope, frame.body);
      return eval(code);
    }

    var moduleEval = function(code) {
      return eval(code);
    }

    bindings.forEach(function(binding) {
      var f = eval(binding);

      if(typeof f === 'function' && binding !== '__eval') {
        var proto = f.prototype;
        originalBindings[binding] = f;

        var patched = function() {
          if(patchedBindings[binding]) {
            return patchedBindings[binding].apply(this, arguments);
          }
          else {
            return f.apply(this, arguments);
          }
        };

        eval(
          binding + ' = patched;\n' +
          binding + '.prototype = proto;'
        );

        if(module.exports[binding]) {
          module.exports[binding] = patched;
        }
      }
    });

    module.hot.dispose(function(data) {
      data.originalBindings = originalBindings;
      data.patchedBindings = patchedBindings;
      data.moduleEval = moduleEval;
      data.moduleEvalWithScope = moduleEvalWithScope;
    });
  }
  else {
    var originalBindings = module.hot.data.originalBindings;
    var patchedBindings = module.hot.data.patchedBindings;

    bindings.forEach(function(binding) {
      var lastFunction = patchedBindings[binding] || originalBindings[binding];
      var f = eval(binding);

      if(typeof f === 'function' && binding !== '__eval') {
        // We need to reify the function in the original module so
        // it references any of the original state. Strip the name
        // and simply eval it.
        var funcCode = (
          '(' + f.toString().replace(/^function \w+\(/, 'function (') + ')'
        );
        patchedBindings[binding] = module.hot.data.moduleEval(funcCode);
      }
    });

    if(typeof __eval === 'function') {
      try {
        module.hot.data.moduleEvalWithScope(parseFunction(__eval));
      }
      catch(e) {
        console.log('error evaling: ' + e);
      }
    }

    module.hot.dispose(function(data) {
      data.originalBindings = originalBindings;
      data.patchedBindings = patchedBindings;
      data.moduleEval = module.hot.data.moduleEval;
      data.moduleEvalWithScope = module.hot.data.moduleEvalWithScope;
    });
  }
}