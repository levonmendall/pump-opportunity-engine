import { createRequire as __poeCreateRequire } from "node:module"; const require = __poeCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/util.js
var require_util = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/util.js"(exports) {
    "use strict";
    exports.getBooleanOption = (options, key) => {
      let value = false;
      if (key in options && typeof (value = options[key]) !== "boolean") {
        throw new TypeError(`Expected the "${key}" option to be a boolean`);
      }
      return value;
    };
    exports.cppdb = /* @__PURE__ */ Symbol();
    exports.inspect = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/sqlite-error.js
var require_sqlite_error = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/sqlite-error.js"(exports, module) {
    "use strict";
    var SqliteError = class _SqliteError extends Error {
      constructor(message, code) {
        if (typeof code !== "string") {
          throw new TypeError("Expected second argument to be a string");
        }
        super("" + message);
        this.code = code;
        if (typeof Error.captureStackTrace === "function") {
          Error.captureStackTrace(this, _SqliteError);
        }
      }
    };
    Object.defineProperty(SqliteError.prototype, "name", {
      value: "SqliteError",
      writable: true,
      enumerable: false,
      configurable: true
    });
    module.exports = SqliteError;
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/wrappers.js
var require_wrappers = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/wrappers.js"(exports) {
    "use strict";
    var { cppdb } = require_util();
    exports.prepare = function prepare(sql) {
      return this[cppdb].prepare(sql, this, false, false);
    };
    exports.exec = function exec(sql) {
      this[cppdb].exec(sql);
      return this;
    };
    exports.close = function close() {
      this[cppdb].close();
      return this;
    };
    exports.loadExtension = function loadExtension(...args) {
      this[cppdb].loadExtension(...args);
      return this;
    };
    exports.defaultSafeIntegers = function defaultSafeIntegers(...args) {
      this[cppdb].defaultSafeIntegers(...args);
      return this;
    };
    exports.unsafeMode = function unsafeMode(...args) {
      this[cppdb].unsafeMode(...args);
      return this;
    };
    exports.getters = {
      name: {
        get: function name() {
          return this[cppdb].name;
        },
        enumerable: true
      },
      open: {
        get: function open() {
          return this[cppdb].open;
        },
        enumerable: true
      },
      inTransaction: {
        get: function inTransaction() {
          return this[cppdb].inTransaction;
        },
        enumerable: true
      },
      readonly: {
        get: function readonly() {
          return this[cppdb].readonly;
        },
        enumerable: true
      },
      memory: {
        get: function memory() {
          return this[cppdb].memory;
        },
        enumerable: true
      }
    };
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/transaction.js
var require_transaction = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/transaction.js"(exports, module) {
    "use strict";
    var { cppdb } = require_util();
    var controllers = /* @__PURE__ */ new WeakMap();
    module.exports = function transaction(fn) {
      if (typeof fn !== "function") throw new TypeError("Expected first argument to be a function");
      const db = this[cppdb];
      const controller = getController(db, this);
      const { apply } = Function.prototype;
      const properties = {
        default: { value: wrapTransaction(apply, fn, db, controller.default) },
        deferred: { value: wrapTransaction(apply, fn, db, controller.deferred) },
        immediate: { value: wrapTransaction(apply, fn, db, controller.immediate) },
        exclusive: { value: wrapTransaction(apply, fn, db, controller.exclusive) },
        database: { value: this, enumerable: true }
      };
      Object.defineProperties(properties.default.value, properties);
      Object.defineProperties(properties.deferred.value, properties);
      Object.defineProperties(properties.immediate.value, properties);
      Object.defineProperties(properties.exclusive.value, properties);
      return properties.default.value;
    };
    var getController = (db, self) => {
      let controller = controllers.get(db);
      if (!controller) {
        const shared = {
          commit: db.prepare("COMMIT", self, false, false),
          rollback: db.prepare("ROLLBACK", self, false, false),
          savepoint: db.prepare("SAVEPOINT `	_bs3.	`", self, false, false),
          release: db.prepare("RELEASE `	_bs3.	`", self, false, false),
          rollbackTo: db.prepare("ROLLBACK TO `	_bs3.	`", self, false, false)
        };
        controllers.set(db, controller = {
          default: Object.assign({ begin: db.prepare("BEGIN", self, false, false) }, shared),
          deferred: Object.assign({ begin: db.prepare("BEGIN DEFERRED", self, false, false) }, shared),
          immediate: Object.assign({ begin: db.prepare("BEGIN IMMEDIATE", self, false, false) }, shared),
          exclusive: Object.assign({ begin: db.prepare("BEGIN EXCLUSIVE", self, false, false) }, shared)
        });
      }
      return controller;
    };
    var wrapTransaction = (apply, fn, db, { begin, commit, rollback, savepoint, release, rollbackTo }) => function sqliteTransaction() {
      let before, after, undo;
      if (db.inTransaction) {
        before = savepoint;
        after = release;
        undo = rollbackTo;
      } else {
        before = begin;
        after = commit;
        undo = rollback;
      }
      before.run();
      try {
        const result = apply.call(fn, this, arguments);
        if (result && typeof result.then === "function") {
          throw new TypeError("Transaction function cannot return a promise");
        }
        after.run();
        return result;
      } catch (ex) {
        if (db.inTransaction) {
          undo.run();
          if (undo !== rollback) after.run();
        }
        throw ex;
      }
    };
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/pragma.js
var require_pragma = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/pragma.js"(exports, module) {
    "use strict";
    var { getBooleanOption, cppdb } = require_util();
    module.exports = function pragma(source, options) {
      if (options == null) options = {};
      if (typeof source !== "string") throw new TypeError("Expected first argument to be a string");
      if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
      const simple = getBooleanOption(options, "simple");
      const stmt = this[cppdb].prepare(`PRAGMA ${source}`, this, true, false);
      return simple ? stmt.pluck().get() : stmt.all();
    };
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/explain.js
var require_explain = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/explain.js"(exports, module) {
    "use strict";
    var { cppdb } = require_util();
    module.exports = function explain(source) {
      if (typeof source !== "string") throw new TypeError("Expected first argument to be a string");
      const stmt = this[cppdb].prepare(`EXPLAIN ${source}`, this, false, true);
      return stmt.all();
    };
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/backup.js
var require_backup = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/backup.js"(exports, module) {
    "use strict";
    var fs2 = __require("fs");
    var path = __require("path");
    var { promisify } = __require("util");
    var { cppdb } = require_util();
    var fsAccess = promisify(fs2.access);
    module.exports = async function backup(filename, options) {
      if (options == null) options = {};
      if (typeof filename !== "string") throw new TypeError("Expected first argument to be a string");
      if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
      filename = filename.trim();
      const attachedName = "attached" in options ? options.attached : "main";
      const handler = "progress" in options ? options.progress : null;
      if (!filename) throw new TypeError("Backup filename cannot be an empty string");
      if (filename === ":memory:") throw new TypeError('Invalid backup filename ":memory:"');
      if (typeof attachedName !== "string") throw new TypeError('Expected the "attached" option to be a string');
      if (!attachedName) throw new TypeError('The "attached" option cannot be an empty string');
      if (handler != null && typeof handler !== "function") throw new TypeError('Expected the "progress" option to be a function');
      await fsAccess(path.dirname(filename)).catch(() => {
        throw new TypeError("Cannot save backup because the directory does not exist");
      });
      const isNewFile = await fsAccess(filename).then(() => false, () => true);
      return runBackup(this[cppdb].backup(this, attachedName, filename, isNewFile), handler || null);
    };
    var runBackup = (backup, handler) => {
      let rate = 0;
      let useDefault = true;
      return new Promise((resolve2, reject) => {
        setImmediate(function step() {
          try {
            const progress = backup.transfer(rate);
            if (!progress.remainingPages) {
              backup.close();
              resolve2(progress);
              return;
            }
            if (useDefault) {
              useDefault = false;
              rate = 100;
            }
            if (handler) {
              const ret = handler(progress);
              if (ret !== void 0) {
                if (typeof ret === "number" && ret === ret) rate = Math.max(0, Math.min(2147483647, Math.round(ret)));
                else throw new TypeError("Expected progress callback to return a number or undefined");
              }
            }
            setImmediate(step);
          } catch (err) {
            backup.close();
            reject(err);
          }
        });
      });
    };
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/serialize.js
var require_serialize = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/serialize.js"(exports, module) {
    "use strict";
    var { cppdb } = require_util();
    module.exports = function serialize(options) {
      if (options == null) options = {};
      if (typeof options !== "object") throw new TypeError("Expected first argument to be an options object");
      const attachedName = "attached" in options ? options.attached : "main";
      if (typeof attachedName !== "string") throw new TypeError('Expected the "attached" option to be a string');
      if (!attachedName) throw new TypeError('The "attached" option cannot be an empty string');
      return this[cppdb].serialize(attachedName);
    };
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/function.js
var require_function = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/function.js"(exports, module) {
    "use strict";
    var { getBooleanOption, cppdb } = require_util();
    module.exports = function defineFunction(name, options, fn) {
      if (options == null) options = {};
      if (typeof options === "function") {
        fn = options;
        options = {};
      }
      if (typeof name !== "string") throw new TypeError("Expected first argument to be a string");
      if (typeof fn !== "function") throw new TypeError("Expected last argument to be a function");
      if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
      if (!name) throw new TypeError("User-defined function name cannot be an empty string");
      const safeIntegers = "safeIntegers" in options ? +getBooleanOption(options, "safeIntegers") : 2;
      const deterministic = getBooleanOption(options, "deterministic");
      const directOnly = getBooleanOption(options, "directOnly");
      const varargs = getBooleanOption(options, "varargs");
      let argCount = -1;
      if (!varargs) {
        argCount = fn.length;
        if (!Number.isInteger(argCount) || argCount < 0) throw new TypeError("Expected function.length to be a positive integer");
        if (argCount > 100) throw new RangeError("User-defined functions cannot have more than 100 arguments");
      }
      this[cppdb].function(fn, name, argCount, safeIntegers, deterministic, directOnly);
      return this;
    };
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/aggregate.js
var require_aggregate = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/aggregate.js"(exports, module) {
    "use strict";
    var { getBooleanOption, cppdb } = require_util();
    module.exports = function defineAggregate(name, options) {
      if (typeof name !== "string") throw new TypeError("Expected first argument to be a string");
      if (typeof options !== "object" || options === null) throw new TypeError("Expected second argument to be an options object");
      if (!name) throw new TypeError("User-defined function name cannot be an empty string");
      const start = "start" in options ? options.start : null;
      const step = getFunctionOption(options, "step", true);
      const inverse = getFunctionOption(options, "inverse", false);
      const result = getFunctionOption(options, "result", false);
      const safeIntegers = "safeIntegers" in options ? +getBooleanOption(options, "safeIntegers") : 2;
      const deterministic = getBooleanOption(options, "deterministic");
      const directOnly = getBooleanOption(options, "directOnly");
      const varargs = getBooleanOption(options, "varargs");
      let argCount = -1;
      if (!varargs) {
        argCount = Math.max(getLength(step), inverse ? getLength(inverse) : 0);
        if (argCount > 0) argCount -= 1;
        if (argCount > 100) throw new RangeError("User-defined functions cannot have more than 100 arguments");
      }
      this[cppdb].aggregate(start, step, inverse, result, name, argCount, safeIntegers, deterministic, directOnly);
      return this;
    };
    var getFunctionOption = (options, key, required) => {
      const value = key in options ? options[key] : null;
      if (typeof value === "function") return value;
      if (value != null) throw new TypeError(`Expected the "${key}" option to be a function`);
      if (required) throw new TypeError(`Missing required option "${key}"`);
      return null;
    };
    var getLength = ({ length }) => {
      if (Number.isInteger(length) && length >= 0) return length;
      throw new TypeError("Expected function.length to be a positive integer");
    };
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/table.js
var require_table = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/table.js"(exports, module) {
    "use strict";
    var { cppdb } = require_util();
    module.exports = function defineTable(name, factory) {
      if (typeof name !== "string") throw new TypeError("Expected first argument to be a string");
      if (!name) throw new TypeError("Virtual table module name cannot be an empty string");
      let eponymous = false;
      if (typeof factory === "object" && factory !== null) {
        eponymous = true;
        factory = defer(parseTableDefinition(factory, "used", name));
      } else {
        if (typeof factory !== "function") throw new TypeError("Expected second argument to be a function or a table definition object");
        factory = wrapFactory(factory);
      }
      this[cppdb].table(factory, name, eponymous);
      return this;
    };
    function wrapFactory(factory) {
      return function virtualTableFactory(moduleName, databaseName, tableName, ...args) {
        const thisObject = {
          module: moduleName,
          database: databaseName,
          table: tableName
        };
        const def = apply.call(factory, thisObject, args);
        if (typeof def !== "object" || def === null) {
          throw new TypeError(`Virtual table module "${moduleName}" did not return a table definition object`);
        }
        return parseTableDefinition(def, "returned", moduleName);
      };
    }
    function parseTableDefinition(def, verb, moduleName) {
      if (!hasOwnProperty.call(def, "rows")) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition without a "rows" property`);
      }
      if (!hasOwnProperty.call(def, "columns")) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition without a "columns" property`);
      }
      const rows = def.rows;
      if (typeof rows !== "function" || Object.getPrototypeOf(rows) !== GeneratorFunctionPrototype) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "rows" property (should be a generator function)`);
      }
      let columns = def.columns;
      if (!Array.isArray(columns) || !isStringArray(columns = [...columns])) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "columns" property (should be an array of strings)`);
      }
      if (columns.length !== new Set(columns).size) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with duplicate column names`);
      }
      if (!columns.length) {
        throw new RangeError(`Virtual table module "${moduleName}" ${verb} a table definition with zero columns`);
      }
      let parameters;
      if (hasOwnProperty.call(def, "parameters")) {
        parameters = def.parameters;
        if (!Array.isArray(parameters) || !isStringArray(parameters = [...parameters])) {
          throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "parameters" property (should be an array of strings)`);
        }
      } else {
        parameters = inferParameters(rows);
      }
      if (parameters.length !== new Set(parameters).size) {
        throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with duplicate parameter names`);
      }
      if (parameters.length > 32) {
        throw new RangeError(`Virtual table module "${moduleName}" ${verb} a table definition with more than the maximum number of 32 parameters`);
      }
      for (const parameter of parameters) {
        if (columns.includes(parameter)) {
          throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with column "${parameter}" which was ambiguously defined as both a column and parameter`);
        }
      }
      let safeIntegers = 2;
      if (hasOwnProperty.call(def, "safeIntegers")) {
        const bool2 = def.safeIntegers;
        if (typeof bool2 !== "boolean") {
          throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "safeIntegers" property (should be a boolean)`);
        }
        safeIntegers = +bool2;
      }
      let directOnly = false;
      if (hasOwnProperty.call(def, "directOnly")) {
        directOnly = def.directOnly;
        if (typeof directOnly !== "boolean") {
          throw new TypeError(`Virtual table module "${moduleName}" ${verb} a table definition with an invalid "directOnly" property (should be a boolean)`);
        }
      }
      const columnDefinitions = [
        ...parameters.map(identifier).map((str) => `${str} HIDDEN`),
        ...columns.map(identifier)
      ];
      return [
        `CREATE TABLE x(${columnDefinitions.join(", ")});`,
        wrapGenerator(rows, new Map(columns.map((x, i) => [x, parameters.length + i])), moduleName),
        parameters,
        safeIntegers,
        directOnly
      ];
    }
    function wrapGenerator(generator, columnMap, moduleName) {
      return function* virtualTable(...args) {
        const output = args.map((x) => Buffer.isBuffer(x) ? Buffer.from(x) : x);
        for (let i = 0; i < columnMap.size; ++i) {
          output.push(null);
        }
        for (const row of generator(...args)) {
          if (Array.isArray(row)) {
            extractRowArray(row, output, columnMap.size, moduleName);
            yield output;
          } else if (typeof row === "object" && row !== null) {
            extractRowObject(row, output, columnMap, moduleName);
            yield output;
          } else {
            throw new TypeError(`Virtual table module "${moduleName}" yielded something that isn't a valid row object`);
          }
        }
      };
    }
    function extractRowArray(row, output, columnCount, moduleName) {
      if (row.length !== columnCount) {
        throw new TypeError(`Virtual table module "${moduleName}" yielded a row with an incorrect number of columns`);
      }
      const offset = output.length - columnCount;
      for (let i = 0; i < columnCount; ++i) {
        output[i + offset] = row[i];
      }
    }
    function extractRowObject(row, output, columnMap, moduleName) {
      let count = 0;
      for (const key of Object.keys(row)) {
        const index = columnMap.get(key);
        if (index === void 0) {
          throw new TypeError(`Virtual table module "${moduleName}" yielded a row with an undeclared column "${key}"`);
        }
        output[index] = row[key];
        count += 1;
      }
      if (count !== columnMap.size) {
        throw new TypeError(`Virtual table module "${moduleName}" yielded a row with missing columns`);
      }
    }
    function inferParameters({ length }) {
      if (!Number.isInteger(length) || length < 0) {
        throw new TypeError("Expected function.length to be a positive integer");
      }
      const params = [];
      for (let i = 0; i < length; ++i) {
        params.push(`$${i + 1}`);
      }
      return params;
    }
    var { hasOwnProperty } = Object.prototype;
    var { apply } = Function.prototype;
    var GeneratorFunctionPrototype = Object.getPrototypeOf(function* () {
    });
    var identifier = (str) => `"${str.replace(/"/g, '""')}"`;
    var defer = (x) => () => x;
    var isStringArray = (arr) => {
      for (let i = 0; i < arr.length; ++i) {
        if (typeof arr[i] !== "string") return false;
      }
      return true;
    };
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/inspect.js
var require_inspect = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/methods/inspect.js"(exports, module) {
    "use strict";
    var DatabaseInspection = function Database3() {
    };
    module.exports = function inspect(depth, opts) {
      return Object.assign(new DatabaseInspection(), this);
    };
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/database.js
var require_database = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/database.js"(exports, module) {
    "use strict";
    var fs2 = __require("fs");
    var path = __require("path");
    var util = require_util();
    var SqliteError = require_sqlite_error();
    module.exports = function createDatabase(getAddon, allowNativeBinding) {
      function Database3(filenameGiven, options) {
        if (new.target == null) {
          return new Database3(filenameGiven, options);
        }
        let buffer;
        if (Buffer.isBuffer(filenameGiven)) {
          buffer = filenameGiven;
          filenameGiven = ":memory:";
        }
        if (filenameGiven == null) filenameGiven = "";
        if (options == null) options = {};
        if (typeof filenameGiven !== "string") throw new TypeError("Expected first argument to be a string");
        if (typeof options !== "object") throw new TypeError("Expected second argument to be an options object");
        if ("readOnly" in options) throw new TypeError('Misspelled option "readOnly" should be "readonly"');
        if ("memory" in options) throw new TypeError('Option "memory" was removed in v7.0.0 (use ":memory:" filename instead)');
        const filename = filenameGiven.trim();
        const anonymous = filename === "" || filename === ":memory:";
        const readonly = util.getBooleanOption(options, "readonly");
        const fileMustExist = util.getBooleanOption(options, "fileMustExist");
        const timeout = "timeout" in options ? options.timeout : 5e3;
        const verbose = "verbose" in options ? options.verbose : null;
        const nativeBinding = "nativeBinding" in options ? options.nativeBinding : null;
        if (readonly && anonymous && !buffer) throw new TypeError("In-memory/temporary databases cannot be readonly");
        if (!Number.isInteger(timeout) || timeout < 0) throw new TypeError('Expected the "timeout" option to be a positive integer');
        if (timeout > 2147483647) throw new RangeError('Option "timeout" cannot be greater than 2147483647');
        if (verbose != null && typeof verbose !== "function") throw new TypeError('Expected the "verbose" option to be a function');
        if (!allowNativeBinding && "nativeBinding" in options) throw new TypeError('The "nativeBinding" option is only supported by the default better-sqlite3 entrypoint');
        if (allowNativeBinding && nativeBinding != null && typeof nativeBinding !== "string" && typeof nativeBinding !== "object") throw new TypeError('Expected the "nativeBinding" option to be a string or addon object');
        const addon = getAddon(nativeBinding);
        if (!addon.isInitialized) {
          addon.initialize(SqliteError, arrayFactory, arrayAppender, rowFactory, recordFactory);
          addon.isInitialized = true;
        }
        if (!anonymous && !filename.startsWith("file:") && !fs2.existsSync(path.dirname(filename))) {
          throw new TypeError("Cannot open database because the directory does not exist");
        }
        Object.defineProperties(this, {
          [util.cppdb]: { value: new addon.Database(filename, filenameGiven, anonymous, readonly, fileMustExist, timeout, verbose || null, buffer || null) },
          ...wrappers.getters
        });
      }
      const wrappers = require_wrappers();
      Database3.prototype.prepare = wrappers.prepare;
      Database3.prototype.transaction = require_transaction();
      Database3.prototype.pragma = require_pragma();
      Database3.prototype.explain = require_explain();
      Database3.prototype.backup = require_backup();
      Database3.prototype.serialize = require_serialize();
      Database3.prototype.function = require_function();
      Database3.prototype.aggregate = require_aggregate();
      Database3.prototype.table = require_table();
      Database3.prototype.loadExtension = wrappers.loadExtension;
      Database3.prototype.exec = wrappers.exec;
      Database3.prototype.close = wrappers.close;
      Database3.prototype.defaultSafeIntegers = wrappers.defaultSafeIntegers;
      Database3.prototype.unsafeMode = wrappers.unsafeMode;
      Database3.prototype[util.inspect] = require_inspect();
      return Database3;
    };
    function arrayFactory(...values) {
      return values;
    }
    function arrayAppender(array, ...values) {
      const offset = array.length;
      for (let i = 0; i < values.length; ++i) {
        array[offset + i] = values[i];
      }
    }
    function rowFactory(...keys2) {
      if (!keys2.includes("__proto__")) {
        const parameters = keys2.map((_, index) => `v${index}`).join(",");
        const properties = keys2.map((key, index) => `${JSON.stringify(key)}:v${index}`).join(",");
        return Function(`return (${parameters}) => ({${properties}})`)();
      }
      return (...values) => {
        const row = {};
        for (let i = 0; i < keys2.length; ++i) row[keys2[i]] = values[i];
        return row;
      };
    }
    function recordFactory(value) {
      return { value, done: false };
    }
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/binding.js
var binding_exports = {};
__export(binding_exports, {
  getBinding: () => getBinding,
  getPrebuildPath: () => getPrebuildPath
});
import fs from "node:fs";
import crypto from "node:crypto";
import url from "node:url";
import { createRequire } from "node:module";
function getBinding(nativeBinding) {
  if (nativeBinding != null) throw Error("NATIVE_PAPER_CUSTOM_ADDON_DENIED");
  if (cached) return cached;
  const p = url.fileURLToPath(new URL("./better_sqlite3.node", import.meta.url));
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const s = fs.fstatSync(fd);
    const codeParent = fs.lstatSync(url.fileURLToPath(new URL(".", import.meta.url)));
    const rootReleasePath = /^\/opt\/poe\/releases\/[a-f0-9]{40}\/better_sqlite3\.node$/.test(p);
    const rootRelease = rootReleasePath && s.uid === 0 && codeParent.uid === 0 && (codeParent.mode & 18) === 0 && fs.realpathSync(p) === p;
    if (!s.isFile() || s.nlink !== 1 || (rootReleasePath ? !rootRelease : s.uid !== process.getuid()) || (s.mode & 18) !== 0 || s.size !== 2226168) throw Error("NATIVE_PAPER_ADDON_FILE_REFUSED");
    const b = fs.readFileSync(fd);
    if (crypto.createHash("sha256").update(b).digest("hex") !== "6fd4292c6c5f352436cd85c9e1cb286978efa43c20ae350973f83414ced9991d") throw Error("NATIVE_PAPER_ADDON_HASH_MISMATCH");
  } finally {
    fs.closeSync(fd);
  }
  return cached = nativeRequire(p);
}
var nativeRequire, cached, getPrebuildPath;
var init_binding = __esm({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/binding.js"() {
    nativeRequire = createRequire(import.meta.url);
    getPrebuildPath = () => null;
  }
});

// ../pump-opportunity-engine/node_modules/better-sqlite3/lib/index.js
var require_lib = __commonJS({
  "../pump-opportunity-engine/node_modules/better-sqlite3/lib/index.js"(exports, module) {
    "use strict";
    module.exports = require_database()((init_binding(), __toCommonJS(binding_exports)).getBinding, true);
    module.exports.SqliteError = require_sqlite_error();
  }
});

// src/backup-worker.ts
import { parentPort, workerData } from "node:worker_threads";

// src/backup.ts
var import_better_sqlite32 = __toESM(require_lib(), 1);
import { isDeepStrictEqual } from "node:util";

// src/reporting.ts
import { createHash } from "node:crypto";

// src/financial-policy-reporting.ts
var INCEPTION = Date.parse("2026-10-26T22:07:36.212Z");
var MAX = (1n << 127n) - 1n;

// src/native-candidate-diagnostics.ts
var NATIVE_CANDIDATE_FAILURE_CODES = [
  "AUDIT_COMPLETED_AFTER_DECISION_BUCKET",
  "COMPONENT_RPC_-32005",
  "COMPONENT_RPC_OVERLOAD",
  "COMPONENT_WS_RPC_ERROR",
  "COMPONENT_WS_TRANSPORT",
  "DECISION_DEADLINE_EXPIRED",
  "NATIVE_AUDIT_ADMISSION_CLOSED",
  "NATIVE_AUDIT_BATCH_BINDING",
  "NATIVE_AUDIT_BATCH_ITEM",
  "NATIVE_AUDIT_BATCH_RECEIPT",
  "NATIVE_AUDIT_CANDIDATE_RETIRED",
  "NATIVE_AUDIT_CAPTURED_CORRECTION",
  "NATIVE_AUDIT_CAPTURED_TARGET_NOT_IN_HISTORY",
  "NATIVE_AUDIT_CLOCK_REGRESSION",
  "NATIVE_AUDIT_CONFIRMED_STATUS_DISAGREEMENT",
  "NATIVE_AUDIT_CONTEXT_FENCE_INVALID_OR_STALE",
  "NATIVE_AUDIT_DIAGNOSTIC_BOUND",
  "NATIVE_AUDIT_ELAPSED_LIMIT",
  "NATIVE_AUDIT_HISTORY_CONTEXT",
  "NATIVE_AUDIT_HISTORY_PAGE_PAYLOAD_LIMIT",
  "NATIVE_AUDIT_HISTORY_PAGE_SCHEMA",
  "NATIVE_AUDIT_HISTORY_RANGE_NOT_COVERED",
  "NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED",
  "NATIVE_AUDIT_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN",
  "NATIVE_AUDIT_INVALID_OPTIONS",
  "NATIVE_AUDIT_INVALID_TARGET",
  "NATIVE_AUDIT_LOWER_CONTEXT_CLOCK_INVALID",
  "NATIVE_AUDIT_NOTIFICATION_BOUND",
  "NATIVE_AUDIT_NOTIFICATION_SCHEMA",
  "NATIVE_AUDIT_NOT_COMPLETED",
  "NATIVE_AUDIT_OWNED_ENTRY_RESOLVED",
  "NATIVE_AUDIT_PAGE_OPERATION_BOUND",
  "NATIVE_AUDIT_POST_SNAPSHOT_CORRECTION",
  "NATIVE_AUDIT_POST_WINDOW_SLOT_FENCE_UNAVAILABLE",
  "NATIVE_AUDIT_PRE_WINDOW_SLOT_FENCE_UNAVAILABLE",
  "NATIVE_AUDIT_SESSION_ABORTED",
  "NATIVE_AUDIT_SESSION_CANCELLED",
  "NATIVE_AUDIT_SESSION_CLOCK",
  "NATIVE_AUDIT_SESSION_DEADLINE",
  "NATIVE_AUDIT_SESSION_DEADLINE_OR_GENERATION",
  "NATIVE_AUDIT_SESSION_INPUT_BOUND",
  "NATIVE_AUDIT_SESSION_PAGE_BOUND",
  "NATIVE_AUDIT_SESSION_PAGE_LIMIT",
  "NATIVE_AUDIT_SESSION_UNAVAILABLE",
  "NATIVE_AUDIT_SOURCE_GENERATION_CHANGED",
  "NATIVE_AUDIT_TAIL_ADMISSION_CLOSED",
  "NATIVE_AUDIT_TAIL_GENERATION",
  "NATIVE_AUDIT_TAIL_NOTIFICATION_BOUND",
  "NATIVE_AUDIT_TAIL_NOTIFICATION_GENERATION",
  "NATIVE_AUDIT_TAIL_NOTIFICATION_SCHEMA",
  "NATIVE_AUDIT_TAIL_OPTIONS",
  "NATIVE_AUDIT_TARGET_SLOT_BOUNDARY_AMBIGUOUS",
  "NATIVE_AUDIT_UNAVAILABLE",
  "NATIVE_AUDIT_UNUSABLE_TARGET_INFORMATION",
  "NATIVE_FLOW_ACK_INVALID",
  "NATIVE_FLOW_CALLBACK_PROCESSING_OVERRUN",
  "NATIVE_FLOW_CANDIDATE_CAPACITY",
  "NATIVE_FLOW_CANDIDATE_RETIRED",
  "NATIVE_FLOW_CANONICAL_SCOPE",
  "NATIVE_FLOW_CLOSED",
  "NATIVE_FLOW_CONFIRMED_CORRECTION",
  "NATIVE_FLOW_CONTROL_CALLBACK_FAILED",
  "NATIVE_FLOW_CONTROL_CANCELLED",
  "NATIVE_FLOW_CONTROL_DIAGNOSTIC_FAILED",
  "NATIVE_FLOW_CONTROL_GUARD_UNAVAILABLE",
  "NATIVE_FLOW_CONTROL_RECORDING_FAILED",
  "NATIVE_FLOW_CROSS_SCOPE_UNAVAILABLE",
  "NATIVE_FLOW_DATA_CONTRACT",
  "NATIVE_FLOW_DISCONNECTED",
  "NATIVE_FLOW_DURATION_LIMIT",
  "NATIVE_FLOW_EVENT_CORRECTION",
  "NATIVE_FLOW_FUTURE_SNAPSHOT",
  "NATIVE_FLOW_GAP_CALLBACK_FAILED",
  "NATIVE_FLOW_INDEPENDENT_AUDIT_GAP",
  "NATIVE_FLOW_INFORMATION_CUTOFF",
  "NATIVE_FLOW_INVALID_LIMITS",
  "NATIVE_FLOW_INVALID_PERSISTENCE",
  "NATIVE_FLOW_MEMORY_PRESSURE",
  "NATIVE_FLOW_NOTIFICATION_LEDGER_LIMIT",
  "NATIVE_FLOW_NOTIFICATION_SCHEMA",
  "NATIVE_FLOW_OPEN_CANCELLED",
  "NATIVE_FLOW_PHYSICAL_SETTLEMENT_UNVERIFIED",
  "NATIVE_FLOW_PAYLOAD_OR_TIME_LIMIT",
  "NATIVE_FLOW_PEER_CONTROL_LIMIT",
  "NATIVE_FLOW_PEER_PONG_DEADLINE",
  "NATIVE_FLOW_PROCESSING_DEADLINE",
  "NATIVE_FLOW_PROTOCOL_EFFECT_CAPACITY",
  "NATIVE_FLOW_PROTOCOL_EFFECT_CORRECTION",
  "NATIVE_FLOW_PROTOCOL_MARKER_CAPACITY",
  "NATIVE_FLOW_REBOUND_GENERATION_AMBIGUOUS",
  "NATIVE_FLOW_REBOUND_SUPPORT_BEFORE_RETIREMENT",
  "NATIVE_FLOW_RECEIPT_LIMIT",
  "NATIVE_FLOW_RESOURCE_LIMIT",
  "NATIVE_FLOW_RETENTION_LIMIT",
  "NATIVE_FLOW_RETIRED_SUBSCRIPTION_LIMIT",
  "NATIVE_FLOW_ROUND_TRIP_CONNECTION",
  "NATIVE_FLOW_ROUND_TRIP_RECEIPT",
  "NATIVE_FLOW_ROUND_TRIP_UNAVAILABLE",
  "NATIVE_FLOW_RPC_ENVELOPE",
  "NATIVE_FLOW_SCOPE_CONFLICT",
  "NATIVE_FLOW_SCOPE_NOT_USABLE",
  "NATIVE_FLOW_SIGNATURE",
  "NATIVE_FLOW_SOCKET_COUNTER",
  "NATIVE_FLOW_STOPPED",
  "NATIVE_FLOW_SUBSCRIPTION_ACK",
  "NATIVE_FLOW_SUBSCRIPTION_ID_REUSED",
  "NATIVE_FLOW_SUPPORT_EXPIRED",
  "NATIVE_FLOW_SUPPORT_EXPIRED_DURING_ACK",
  "NATIVE_FLOW_SUPPORT_UNAVAILABLE",
  "NATIVE_FLOW_TRANSPORT_CLOSED",
  "NATIVE_FLOW_TRANSPORT_SETTLING",
  "NATIVE_FLOW_UNAVAILABLE",
  "NATIVE_FLOW_UNEXPECTED_ACK",
  "NATIVE_FLOW_UNSCHEDULED_CONTROL_SUPPRESSED",
  "NATIVE_FLOW_UNSCOPED_NOTIFICATION",
  "NATIVE_FLOW_UNSUBSCRIBE_ACK",
  "NATIVE_FLOW_VALIDATED_ADMISSION_CLOSED",
  "NATIVE_SOURCE_FINANCIAL_RUNWAY",
  "OTHER_UNEXPORTED_REASON",
  "PILOT_RPC_ABORTED",
  "PILOT_RPC_COMPONENT_ABORTED",
  "PILOT_RPC_COMPONENT_ADMISSION_CLOSED",
  "PILOT_RPC_COMPONENT_DISPATCH_EXPIRED",
  "PILOT_RPC_COMPONENT_HTTP_429",
  "PILOT_RPC_COMPONENT_HTTP_STATUS_502",
  "PILOT_RPC_COMPONENT_HTTP_STATUS_503",
  "PILOT_RPC_COMPONENT_HTTP_STATUS_504",
  "PILOT_RPC_COMPONENT_HTTP_TRANSPORT",
  "PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT",
  "PILOT_RPC_COMPONENT_RPC_ERROR_-32016",
  "PILOT_RPC_COMPONENT_RPC_OVERLOAD",
  "PILOT_RPC_COOLDOWN",
  "PILOT_RPC_PHYSICAL_SLOT_OCCUPIED",
  "PILOT_RPC_QUERY_COOLDOWN",
  "RESEARCH_CLOCK_ADMISSION_CLOSED",
  "RESEARCH_CLOCK_POOL_UNAVAILABLE",
  "RPC_NODE_ERROR"
];
var NATIVE_CANDIDATE_FAILURE_KINDS = ["quality-gap", "audit-unavailable", "audit-unusable", "predictive-unavailable", "decision-expired"];
var NATIVE_AUDIT_DISPATCH_REASONS = ["eligible", "native-service-wait", "native-service-dispatch", "native-service-return", "rpc-gate-wait", "ceiling-backoff", "ceiling-refresh", "prepare-native-runway", "scheduler-wait", "scheduler-refusal", "audit-selected", "peer-selected", "page-admission", "page-response", "page-refusal", "page-deferred", "page-not-exposed", "work-exception"];
var NATIVE_AUDIT_DISPATCH_ACTIONS = ["await-financial-operation-runway", "await-shared-dispatch", "await-selected-peer-audit-page", "await-physical-settlement", "await-shared-gate-recovery", "await-shared-pacing", "await-shared-pacing-or-http-cooldown", "await-history-provider-or-query-cooldown", "await-local-uninvoked-page-retry", "await-primary-support-ceiling", "await-bounded-ceiling-refresh", "refresh-confirmed-bank-ceiling", "await-control-runway-gate", "await-native-service-action", "request-early-support-refresh", "request-early-heartbeat", "perform-required-native-service", "retain-uninvoked-page-for-shared-scheduling", "advance-logical-session", "invoke-shared-rpc", "validate-logical-session", "retain-unavailable-target", "invoke-shared-quiet-batch", "dispatch-audit-page", "dispatch-origin-verification", "retain-refused-target", "await-next-dispatch", "retain-and-recheck-target", "recheck-after-backoff", "recheck-after-busy", "recheck-after-close", "recheck-after-closed", "recheck-after-connect", "recheck-after-deferred", "recheck-after-idle", "recheck-after-ping", "recheck-after-pong", "recheck-after-subscribe", "recheck-after-support", "recheck-after-unavailable", "recheck-after-unsubscribe"];
var NATIVE_AUDIT_SCHEDULER_REASONS = ["physical-operation-or-cancellation-unsettled", "completion-deadline-expired", "shared-physical-pacing", "declared-completion-envelope-exceeds-deadline", "one-other-start-per-protection-cycle", "outside-bounded-admission-window"];
var NATIVE_CANDIDATE_FAILURE_DIAGNOSTICS = Object.freeze({ version: "bounded-native-candidate-failures-v1", scope: "CURRENT_RUNNER_INSTANCE", maximumRecentFacts: 8, meaning: "Actual outcome observations and last local dispatch state, not independent windows, physical-start proof, provider causation or financial qualification. Earlier-instance causes remain unknown." });
var codes = new Set(NATIVE_CANDIDATE_FAILURE_CODES);
var kinds = new Set(NATIVE_CANDIDATE_FAILURE_KINDS);
var dispatches = new Set(NATIVE_AUDIT_DISPATCH_REASONS);
var actions = new Set(NATIVE_AUDIT_DISPATCH_ACTIONS);
var scheduler = new Set(NATIVE_AUDIT_SCHEDULER_REASONS);

// src/operating-intelligence.ts
var candidateFailureCodes = new Set(NATIVE_CANDIDATE_FAILURE_CODES);

// src/reporting.ts
var MAX_SNAPSHOT_BYTES = 128 * 1024;
function object(value, keys2) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("object required");
  const o = value;
  if (Object.keys(o).sort().join("|") !== [...keys2].sort().join("|")) throw new Error("unexpected/missing fields");
  return o;
}
function text(value, max = 256) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("bounded text required");
}
function time(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) throw new Error("UTC millisecond timestamp required");
  const n = Date.parse(value);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== value) throw new Error("invalid timestamp");
  return n;
}
function number(value, nonnegative = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e15 || nonnegative && value < 0) throw new Error("bounded finite number required");
}
function nullable(value, check) {
  if (value !== null) check(value);
}
function oneOf(value, allowed) {
  if (!allowed.includes(value)) throw new Error("unsupported value");
}
function bool(value) {
  if (typeof value !== "boolean") throw new Error("boolean required");
}
function units(value, decimals) {
  if (typeof value !== "string" || !(decimals ? /^(0|[1-9]\d{0,20})(\.\d{1,9})?$/ : /^(0|[1-9]\d{0,39})$/).test(value)) throw new Error("decimal integer quantity required");
}
function list(value, max, check) {
  if (!Array.isArray(value) || value.length > max) throw new Error("bounded array required");
  value.forEach(check);
}
function validateReportingTradeCache(value, accountId, inceptionAt, now) {
  const cache = object(value, ["schemaVersion", "accountId", "inceptionAt", "windowLimited", "trades"]);
  if (cache.schemaVersion !== 1 || cache.accountId !== accountId || cache.inceptionAt !== inceptionAt || !Number.isSafeInteger(inceptionAt) || !Number.isSafeInteger(now) || now < inceptionAt) throw Error("reporting trade cache identity");
  bool(cache.windowLimited);
  let previous = Infinity;
  const seen = /* @__PURE__ */ new Set();
  list(cache.trades, 50, (value2) => {
    const t = object(value2, ["actionId", "id", "mint", "side", "quantity", "at", "valueUsd", "executionCostsUsd", "status", "reason"]);
    text(t.actionId, 160);
    text(t.id, 128);
    text(t.mint, 96);
    oneOf(t.side, ["buy", "sell"]);
    units(t.quantity, false);
    const at = time(t.at);
    if (at < inceptionAt || at > now || at > previous || seen.has(String(t.actionId))) throw Error("reporting trade cache chronology");
    previous = at;
    seen.add(String(t.actionId));
    nullable(t.valueUsd, (v) => number(v, true));
    nullable(t.executionCostsUsd, (v) => number(v, true));
    oneOf(t.status, ["PAPER filled"]);
    text(t.reason, 512);
  });
  if (Buffer.byteLength(JSON.stringify(cache)) > 128 * 1024) throw Error("reporting trade cache bound");
  return cache;
}
function reportingFilledTrade(actionId, at, attempt, order, result) {
  const integer3 = (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,38})$/.test(v);
  const q = attempt?.quote, o = order?.input;
  if (result?.status !== "filled" || result.at !== at || !o || attempt.orderId !== o.id || typeof o.mint !== "string" || o.mint.length > 96 || !["buy", "sell"].includes(o.side) || !integer3(o.gas) || !q || !integer3(q.receiveUnits) || !integer3(q.spendLamports) || o.side === "sell" && !integer3(q.pricedBaseUnits)) return null;
  const p = attempt.price, validPrice = !!p && integer3(p.microUsdPerSol) && BigInt(p.microUsdPerSol) > 0n && Number.isSafeInteger(p.at) && p.at <= at && at - p.at <= 1e4;
  const usd2 = (v) => validPrice ? Number(BigInt(v) * BigInt(p.microUsdPerSol) / 1000000000n) / 1e6 : null;
  return { actionId, id: "paper-fill:" + createHash("sha256").update(actionId).digest("hex").slice(0, 32), mint: o.mint, side: o.side, quantity: o.side === "buy" ? q.receiveUnits : q.pricedBaseUnits, at: new Date(at).toISOString(), valueUsd: usd2(o.side === "buy" ? q.spendLamports : q.receiveUnits), executionCostsUsd: usd2(o.gas), status: "PAPER filled", reason: "Durable single modeled attempt; pool fees embedded, gas separate; no live-fill claim. " + actionId };
}

// src/backup.ts
import { chmodSync, closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, realpathSync, renameSync, statSync, statfsSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";

// src/ledger.ts
var import_better_sqlite3 = __toESM(require_lib(), 1);

// src/paper-equity-risk.ts
var PAPER_EQUITY_RISK_VERSION = "paper-equity-risk-5-10-v1";
var PAPER_EQUITY_RISK_POLICY = Object.freeze({ version: PAPER_EQUITY_RISK_VERSION, entryConsumedCostBps: 500, dailyDrawdownBps: 1e3, maximumPositions: 2, refundableDepositsIncluded: false, basis: "complete-observed-executable-equity-current-usd", automaticDayReset: "fresh-complete-observation-next-UTC-day", historicalBasis: "all-retained-same-day-reconciliation-receipts; unobserved peaks unknown", fundedExecution: false });
var equityRiskAmount = (v) => {
  if (typeof v !== "string" || !/^(0|[1-9][0-9]{0,38})$/.test(v) || BigInt(v) > (1n << 127n) - 1n) throw Error("EQUITY_RISK_POLICY_INVALID");
  return BigInt(v);
};
var object2 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var integer = (v) => Number.isSafeInteger(v) && Number(v) >= 0;
var exact = (v, keys2) => Object.keys(v).sort().join(",") === keys2.split(",").sort().join(",");
var equityRiskDay = (at) => new Date(at).toISOString().slice(0, 10);
function consumedEntryAllowance(equityMicroUsd, microUsdPerSol) {
  if (equityMicroUsd < 0n || microUsdPerSol <= 0n) throw Error("EQUITY_RISK_POLICY_INVALID");
  return equityMicroUsd * 1000000000n * 500n / (microUsdPerSol * 10000n);
}
function validateEntryAllocation(v, at, consumed) {
  if (!object2(v) || !exact(v, "version,at,equityMicroUsd,microUsdPerSol,maximumConsumedLamports,consumedLamports,refundableDepositsIncluded") || v.version !== PAPER_EQUITY_RISK_VERSION || !integer(v.at) || v.at > at || v.refundableDepositsIncluded !== false) throw Error("entry allocation invariant");
  const equity = equityRiskAmount(v.equityMicroUsd), price = equityRiskAmount(v.microUsdPerSol), maximum = equityRiskAmount(v.maximumConsumedLamports), actual = equityRiskAmount(v.consumedLamports);
  if (price === 0n || actual === 0n || maximum !== consumedEntryAllowance(equity, price) || actual > maximum || consumed !== void 0 && actual !== consumed) throw Error("entry allocation amount invariant");
}
function validateEquityRiskState(v, inceptionAt, lastAt, revision) {
  if (!object2(v) || !exact(v, "version,activatedAt,activationRevision,daily") || v.version !== PAPER_EQUITY_RISK_VERSION || !integer(v.activatedAt) || v.activatedAt < inceptionAt || v.activatedAt > lastAt || !integer(v.activationRevision) || v.activationRevision < 1 || v.activationRevision > revision || !object2(v.daily)) throw Error("equity risk policy invariant");
  const d = v.daily;
  if (!exact(d, "day,highWaterMicroUsd,highWaterAt,lossPaused,historyState,historyCoverage,historyCutoffRevision,historyCursorRevision,historyReceipts,historyDigest") || typeof d.day !== "string" || !/^\d{4}-\d\d-\d\d$/.test(d.day) || d.day < equityRiskDay(v.activatedAt) || d.day > equityRiskDay(lastAt) || equityRiskDay(Date.parse(d.day + "T00:00:00.000Z")) !== d.day || typeof d.lossPaused !== "boolean" || !["scanning", "complete", "invalid"].includes(d.historyState) || !["verified-retained-same-day", "first-complete-observation", "unavailable"].includes(d.historyCoverage) || !integer(d.historyCutoffRevision) || d.historyCutoffRevision >= revision || !integer(d.historyCursorRevision) || d.historyCursorRevision > d.historyCutoffRevision || !integer(d.historyReceipts) || typeof d.historyDigest !== "string" || !/^[a-f0-9]{64}$/.test(d.historyDigest) || d.historyState === "complete" && (d.historyCoverage === "unavailable" || d.highWaterMicroUsd === null || d.historyCursorRevision !== d.historyCutoffRevision) || d.historyState !== "complete" && d.historyCoverage !== "unavailable") throw Error("equity risk history invariant");
  if (d.highWaterMicroUsd === null) {
    if (d.highWaterAt !== null) throw Error("equity risk peak invariant");
  } else {
    equityRiskAmount(d.highWaterMicroUsd);
    if (!integer(d.highWaterAt) || d.highWaterAt < inceptionAt || d.highWaterAt > lastAt || equityRiskDay(d.highWaterAt) !== d.day) throw Error("equity risk peak time invariant");
  }
}

// src/execution-realism.ts
import { createHash as createHash2 } from "node:crypto";
var PAPER_EXECUTION_MODEL_VERSION = "paper-chain-conditioned-v1";
var PAPER_EXECUTION_POLICY = Object.freeze({ version: PAPER_EXECUTION_MODEL_VERSION, observationSamples: 32, nominalSlotDurationMs: 400, propagationScenarioMs: 250, inclusionScenarioSlots: 2, computeUnitLimitScenario: 2e5, computeUnitPriceMicroLamportsScenario: "10000", baseFeePerSignatureLamportsScenario: "5000", routingTipLamports: "0", maximumDecisionLifetimeMs: 5e3, minimumDecisionDelayMs: 500, maximumLandingQuoteAgeMs: 2e3, blockhashValidity: "UNOBSERVED; bounded decision lifetime is not a measured blockhash lifetime", meaning: "DETERMINISTIC_PAPER_SCENARIO_NOT_OBSERVED_CHAIN_LANDING", feeBasis: "DECLARED_SCENARIO_NOT_RPC_FEE_OR_COMPUTE_MEASUREMENT", simulation: "NOT_RUN_UNFUNDED_PAPER_ACCOUNT", historicalPolicy: "orders without executionModel retain original semantics" });
var hash = (value) => createHash2("sha256").update(JSON.stringify(value)).digest("hex");
var PAPER_EXECUTION_POLICY_SHA256 = hash(PAPER_EXECUTION_POLICY);
var integer2 = (n) => Number.isSafeInteger(n) && Number(n) >= 0;
var sha = (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
var amount = (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v);
var object3 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var exact2 = (v, keys2) => Object.keys(v).sort().join(",") === keys2.split(",").sort().join(",");
function paperExecutionFee(plan) {
  return (BigInt(plan.baseFeeLamports) + BigInt(plan.priorityFeeLamports) + BigInt(plan.routingTipLamports)).toString();
}
function validatePaperExecutionPlan(value) {
  if (!object3(value) || !exact2(value, "version,policySha256,constructionSha256,intentSha256,temporaryQuoteRentLamports,quoteRentProofSha256,plannedAt,decisionQuoteAt,sourceSlot,observedRpcMs,slotDurationMs,slotDurationBasis,propagationMs,inclusionSlots,constructionMs,executeAt,expiresAt,baseFeeLamports,priorityFeeLamports,routingTipLamports,computeUnitLimit,computeUnitPriceMicroLamports") || value.version !== PAPER_EXECUTION_MODEL_VERSION || value.policySha256 !== PAPER_EXECUTION_POLICY_SHA256 || !sha(value.constructionSha256) || !sha(value.intentSha256) || !sha(value.quoteRentProofSha256) || !amount(value.temporaryQuoteRentLamports) || (BigInt(value.temporaryQuoteRentLamports) === 0n || BigInt(value.temporaryQuoteRentLamports) >= 1n << 64n)) return false;
  for (const key of ["plannedAt", "decisionQuoteAt", "sourceSlot", "observedRpcMs", "slotDurationMs", "propagationMs", "inclusionSlots", "constructionMs", "executeAt", "expiresAt", "computeUnitLimit"]) if (!integer2(value[key])) return false;
  for (const key of ["baseFeeLamports", "priorityFeeLamports", "routingTipLamports", "computeUnitPriceMicroLamports"]) if (!amount(value[key])) return false;
  const p = value, policy = PAPER_EXECUTION_POLICY;
  return (p.slotDurationBasis === "observed" || p.slotDurationBasis === "scenario") && p.slotDurationMs >= 100 && p.slotDurationMs <= 2e3 && p.observedRpcMs <= 1e4 && p.constructionMs <= 2e3 && p.decisionQuoteAt <= p.plannedAt && p.plannedAt - p.decisionQuoteAt <= 2e3 && p.propagationMs === policy.propagationScenarioMs && p.inclusionSlots === policy.inclusionScenarioSlots && p.computeUnitLimit === policy.computeUnitLimitScenario && p.computeUnitPriceMicroLamports === policy.computeUnitPriceMicroLamportsScenario && p.baseFeeLamports === policy.baseFeePerSignatureLamportsScenario && p.routingTipLamports === policy.routingTipLamports && BigInt(p.priorityFeeLamports) === (BigInt(p.computeUnitLimit) * BigInt(p.computeUnitPriceMicroLamports) + 999999n) / 1000000n && p.expiresAt === p.plannedAt + policy.maximumDecisionLifetimeMs && p.executeAt === p.plannedAt + Math.max(policy.minimumDecisionDelayMs, p.constructionMs + p.observedRpcMs + p.propagationMs + p.inclusionSlots * p.slotDurationMs) && p.executeAt < p.expiresAt;
}

// src/costs.ts
var COST_CATEGORIES = ["data", "rpc", "hosting", "backup", "transfer-networkfee"];
var COST_CLASSIFICATIONS = ["actual", "estimated", "allocated"];
var MAX2 = (1n << 127n) - 1n;
var text2 = (value, max = 512) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
var time2 = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 864e13;
var record = (value) => !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
var keys = (value, expected) => record(value) && Object.keys(value).sort().join("|") === [...expected].sort().join("|");
function uint(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("unsigned integer cost required");
  const amount3 = BigInt(value);
  if (amount3 > MAX2) throw new Error("cost amount exceeds supported bound");
  return amount3;
}
function category(value) {
  if (!COST_CATEGORIES.includes(value)) throw new Error("unsupported operating cost category");
}
function classification(value) {
  if (!COST_CLASSIFICATIONS.includes(value)) throw new Error("cost classification required");
}
function coverage(value, state, recordedAt) {
  if (!keys(value, ["status", "from", "through", "evidence", "classification"]) || !["unknown", "complete"].includes(value.status) || !text2(value.evidence)) throw new Error("bounded explicit cost coverage required");
  classification(value.classification);
  if (!time2(value.from) || !time2(value.through) || value.from < state.inceptionAt || value.from > value.through || value.through > recordedAt) throw new Error("invalid/future cost coverage interval");
}
function validateOperatingCosts(state) {
  if (!keys(state, ["schemaVersion", "accountId", "inceptionAt", "lastRecordedAt", "totals", "coverage", "recent"]) || state.schemaVersion !== 1 || !/^((poe|fixture)-[a-z0-9-]{1,80})$/.test(state.accountId) || !time2(state.inceptionAt) || !time2(state.lastRecordedAt) || state.lastRecordedAt < state.inceptionAt) throw new Error("operating cost state identity invariant");
  if (!keys(state.totals, [...COST_CATEGORIES]) || !keys(state.coverage, [...COST_CATEGORIES]) || !Array.isArray(state.recent) || state.recent.length > 50) throw new Error("bounded operating cost state required");
  for (const cat of COST_CATEGORIES) {
    if (!keys(state.totals[cat], [...COST_CLASSIFICATIONS])) throw new Error("cost bucket classification invariant");
    for (const cls of COST_CLASSIFICATIONS) {
      const bucket = state.totals[cat][cls];
      if (!keys(bucket, ["knownMicroUsd", "unvaluedSolLamports", "unvaluedCount"])) throw new Error("cost bucket invariant");
      uint(bucket.knownMicroUsd);
      const unknown = uint(bucket.unvaluedSolLamports);
      if (!Number.isSafeInteger(bucket.unvaluedCount) || bucket.unvaluedCount < 0 || bucket.unvaluedCount === 0 !== (unknown === 0n)) throw new Error("unvalued expense invariant");
    }
    if (state.coverage[cat] !== null) coverage(state.coverage[cat], state, state.lastRecordedAt);
  }
  const cachedValues = /* @__PURE__ */ new Map(), cachedPending = /* @__PURE__ */ new Map();
  const resolved = new Set(state.recent.filter((row) => row.kind === "valuation").map((row) => row.expenseId));
  let lastRecentAt = state.inceptionAt;
  for (const event of state.recent) {
    if (!keys(event, ["id", "kind", "expenseId", "category", "classification", "occurredAt", "recordedAt", "currency", "amount", "valueMicroUsd", "evidence"]) || !text2(event.id, 128) || !text2(event.expenseId, 128) || !text2(event.evidence) || !["expense", "valuation"].includes(event.kind) || !["USD", "SOL"].includes(event.currency)) throw new Error("recent operating expense invariant");
    category(event.category);
    classification(event.classification);
    const amount3 = uint(event.amount);
    if (amount3 === 0n || event.kind === "expense" && event.id !== event.expenseId || event.kind === "valuation" && event.currency !== "SOL" || event.currency === "USD" && event.valueMicroUsd !== event.amount) throw new Error("recent operating expense value invariant");
    if (event.valueMicroUsd !== null) uint(event.valueMicroUsd);
    if (!time2(event.occurredAt) || !time2(event.recordedAt) || event.occurredAt < state.inceptionAt || event.occurredAt > event.recordedAt || event.recordedAt > state.lastRecordedAt || event.recordedAt < lastRecentAt) throw new Error("recent expense chronology invariant");
    lastRecentAt = event.recordedAt;
    const key = event.category + ":" + event.classification;
    if (event.valueMicroUsd !== null) cachedValues.set(key, (cachedValues.get(key) ?? 0n) + uint(event.valueMicroUsd));
    else if (!resolved.has(event.expenseId)) {
      const pending = cachedPending.get(key) ?? { lamports: 0n, count: 0 };
      pending.lamports += amount3;
      pending.count++;
      cachedPending.set(key, pending);
    }
  }
  for (const cat of COST_CATEGORIES) for (const cls of COST_CLASSIFICATIONS) {
    const key = cat + ":" + cls, bucket = state.totals[cat][cls], pending = cachedPending.get(key);
    if (uint(bucket.knownMicroUsd) < (cachedValues.get(key) ?? 0n) || pending && (uint(bucket.unvaluedSolLamports) < pending.lamports || bucket.unvaluedCount < pending.count)) throw new Error("cost totals contradict retained source events");
  }
}

// src/ledger.ts
var ADAPTIVE_PAPER_STRATEGY_VERSION = "adaptive-momentum-v2-paper-v1";
var TECHNICAL_PROTECTION_PAUSE_REASONS = Object.freeze(["completed PAPER protection gap exceeded research boundary", "completed protection deadline exceeded; candidate windows must restart", "first completed protection deadline exceeded; fresh observation required", "PAPER protection currently overdue; candidate admissions closed", "PAPER protection unavailable; exposure retained"]);
var REPORTING_OPERATING_HISTORY_KEY = "reporting_history_operating_v2";
var OPERATING_REPORTING_BASIS = "net-token-trading-sol-current-usd-v2";
var INTERNAL_SHUTDOWN_PROOF_POLICY = Object.freeze({ version: "internal-native-shutdown-chain-v1", maximumRuns: 128, maximumStops: 128, maximumControlIntents: 512, maximumControlBytes: 1024 * 1024 });
var L = 1000000000n;
var INITIAL = 1000000000n;
var MAX_PRICE_AGE = 1e4;
var utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
var boundedText = (s, max = 512) => typeof s === "string" && s.length > 0 && s.length <= max;
var amount2 = (s) => {
  if (typeof s !== "string" || !/^(0|[1-9][0-9]*)$/.test(s)) throw new Error("unsigned integer amount required");
  const n = BigInt(s);
  if (n > (1n << 127n) - 1n) throw new Error("amount exceeds supported bound");
  return n;
};
function priceAt(price, now) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(price.at) || price.at > now || now - price.at > MAX_PRICE_AGE || typeof price.source !== "string" || !price.source || price.source.length > 512 || amount2(price.microUsdPerSol) === 0n) throw new Error("fresh timestamped USD conversion required");
  return amount2(price.microUsdPerSol);
}
var usd = (lamports, price) => lamports * price / L;
function validateEntryStrategy(value, at) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== ADAPTIVE_PAPER_STRATEGY_VERSION || !Number.isSafeInteger(value.cycle) || value.cycle < 1 || !Number.isSafeInteger(value.windowStartAt) || value.windowStartAt < 0 || value.windowEndAt !== value.windowStartAt + 6e4 || value.windowEndAt !== Math.floor(at / 1e4) * 1e4 || !Number.isSafeInteger(value.assessedAt) || value.assessedAt < value.windowEndAt || value.assessedAt > at || !boundedText(value.signalId, 160) || /[\u0000-\u001f]/.test(value.signalId)) throw Error("adaptive entry strategy invariant");
}
function validateOperatingReportingHistory(value, inceptionAt) {
  const h = value, integer3 = (n) => Number.isSafeInteger(n) && Number(n) >= 0;
  if (!integer3(inceptionAt) || !h || typeof h !== "object" || Array.isArray(h) || Object.keys(h).sort().join(",") !== "basis,cutoverAt,downsampled,firstObservedAt,points,schemaVersion,windowLimited" || h.schemaVersion !== 2 || h.basis !== OPERATING_REPORTING_BASIS || typeof h.windowLimited !== "boolean" || typeof h.downsampled !== "boolean" || !Array.isArray(h.points) || h.points.length < 1 || h.points.length > 720) throw Error("invalid operating reporting history metadata");
  if (h.cutoverAt !== null && (!integer3(h.cutoverAt) || h.cutoverAt <= inceptionAt) || h.firstObservedAt !== null && (!integer3(h.firstObservedAt) || h.cutoverAt === null || h.firstObservedAt < h.cutoverAt)) throw Error("operating reporting cutover mismatch");
  let previous = -Infinity;
  for (const p of h.points) {
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join(",") !== "at,economicMicroUsd,tradingMicroUsd" || !integer3(p.at) || p.at < inceptionAt || p.at <= previous) throw Error("operating reporting chronology");
    for (const v of [p.tradingMicroUsd, p.economicMicroUsd]) if (v !== null) {
      if (typeof v !== "string" || !/^(-?(0|[1-9][0-9]*))$/.test(v)) throw Error("integer operating reporting value required");
      amount2(v.startsWith("-") ? v.slice(1) : v);
    }
    if (p.at > inceptionAt && (p.tradingMicroUsd !== null || p.economicMicroUsd !== null) && (h.cutoverAt === null || p.at < h.cutoverAt)) throw Error("operating reporting value before cutover");
    if (p.at > inceptionAt && p.tradingMicroUsd !== null && (h.firstObservedAt === null || p.at < h.firstObservedAt)) throw Error("operating reporting first observation mismatch");
    previous = p.at;
  }
  const first = h.points[0];
  if (first.at !== inceptionAt || first.tradingMicroUsd !== "0" || first.economicMicroUsd !== null) throw Error("operating reporting inception mismatch");
  if (h.cutoverAt === null && (h.points.length !== 1 || h.firstObservedAt !== null || h.windowLimited || h.downsampled)) throw Error("operating reporting cutover absent");
  if (h.cutoverAt !== null && h.points.length < 2) throw Error("operating reporting observations absent");
  if (h.firstObservedAt !== null && !h.windowLimited && !h.downsampled && !h.points.some((p) => p.at === h.firstObservedAt && p.tradingMicroUsd !== null)) throw Error("operating reporting first observation absent");
  if (h.cutoverAt !== null && h.cutoverAt > inceptionAt + 1) {
    const gap = h.points[1];
    if (!gap || gap.at !== inceptionAt + 1 || gap.tradingMicroUsd !== null || gap.economicMicroUsd !== null) throw Error("operating reporting inception gap absent");
  }
  return structuredClone(h);
}
function validateFinancialState(s, accountId, mode, options = {}) {
  const record2 = (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  const key = (v, max) => boundedText(v, max) && !["__proto__", "constructor", "prototype"].includes(v);
  const eventTime = (v) => Number.isSafeInteger(v) && v >= s.inceptionAt && v <= s.lastAt;
  if (!record2(s) || s.schemaVersion !== 1 || s.accountId !== accountId || s.mode !== mode || s.initialMicroUsd !== INITIAL.toString() || !Number.isSafeInteger(s.inceptionAt) || s.inceptionAt < 0 || !Number.isSafeInteger(s.lastAt) || s.lastAt < s.inceptionAt || !Number.isSafeInteger(s.revision) || s.revision < 0) throw new Error("financial identity/state invariant");
  if (!record2(s.inceptionPrice)) throw new Error("inception conversion invariant");
  const inceptionPrice = priceAt(s.inceptionPrice, s.inceptionAt);
  const initialLamports = INITIAL * L / inceptionPrice;
  if (amount2(s.roundingResidualMicroUsd) !== INITIAL - usd(initialLamports, inceptionPrice)) throw new Error("inception rounding invariant");
  if (!record2(s.controls) || typeof s.controls.entriesEnabled !== "boolean" || typeof s.controls.stopRequested !== "boolean" || !boundedText(s.controls.reason) || !eventTime(s.controls.changedAt) || !(s.controls.readinessVersion === null || boundedText(s.controls.readinessVersion, 128)) || s.controls.stopRequested && s.controls.entriesEnabled || s.mode === "PAPER" && s.controls.entriesEnabled && s.controls.readinessVersion === null) throw new Error("financial recovery/control invariant");
  if (!record2(s.daily) || typeof s.daily.lossPaused !== "boolean" || typeof s.daily.paused !== "boolean" || s.daily.lossPaused && !s.daily.paused || !Number.isSafeInteger(s.daily.reconciledAt) || s.daily.reconciledAt < 0 || s.daily.reconciledAt > s.lastAt || typeof s.daily.day !== "string" || !/^\d{4}-\d\d-\d\d$/.test(s.daily.day) || utcDay(Date.parse(s.daily.day + "T00:00:00.000Z")) !== s.daily.day || s.daily.day < utcDay(s.inceptionAt) || s.daily.day > utcDay(s.lastAt) || s.daily.reconciledAt > 0 && utcDay(s.daily.reconciledAt) !== s.daily.day) throw new Error("financial day/reconciliation invariant");
  const cash = amount2(s.lamports);
  const gasReserve = amount2(s.gasReserve);
  if (initialLamports <= gasReserve) throw new Error("inception gas reserve invariant");
  amount2(s.executionCosts);
  amount2(s.daily.baselineMicroUsd);
  if (typeof s.realizedLamports !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(s.realizedLamports) || amount2(s.realizedLamports.startsWith("-") ? s.realizedLamports.slice(1) : s.realizedLamports) > (1n << 127n) - 1n) throw new Error("realized balance invariant");
  if (!record2(s.positions) || !record2(s.pending) || !record2(s.lockedDeposits) || Object.keys(s.positions).length > 3 || Object.keys(s.pending).length > 3) throw new Error("capacity/state map invariant");
  for (const [mint, deposit] of Object.entries(s.lockedDeposits)) {
    if (!key(mint, 96)) throw new Error("locked deposit identity invariant");
    amount2(deposit);
  }
  for (const [mint, p] of Object.entries(s.positions)) {
    if (!record2(p) || !key(mint, 96) || p.mint !== mint || !eventTime(p.enteredAt) || amount2(p.units) === 0n || amount2(p.entryLamports) === 0n || amount2(p.entryGas) === 0n || p.allocation === void 0 && amount2(p.costMicroUsd) > 50000000n || amount2(p.deposit) > amount2(s.lockedDeposits[mint] ?? "0")) throw new Error("position identity/amount invariant");
    if (p.executionModelVersion !== void 0 && p.executionModelVersion !== "paper-chain-conditioned-v1") throw Error("position execution model version invariant");
    if (p.allocation !== void 0) {
      if (!s.equityRisk && !options.allowUnavailableEntryPolicy) throw Error("position allocation policy unavailable");
      validateEntryAllocation(p.allocation, p.enteredAt, amount2(p.entryLamports) + amount2(p.entryGas));
      if (amount2(p.costMicroUsd) !== usd(amount2(p.allocation.consumedLamports), amount2(p.allocation.microUsdPerSol))) throw Error("position allocation cost invariant");
    }
    if (p.strategy !== void 0) {
      validateEntryStrategy(p.strategy, p.strategy.assessedAt);
      if (!boundedText(p.strategy.roundTripId, 100) || !Number.isSafeInteger(p.strategy.highWaterAt) || p.strategy.highWaterAt < p.enteredAt || p.strategy.highWaterAt > s.lastAt || p.strategy.assessedAt > p.enteredAt) throw Error("adaptive position strategy invariant");
      amount2(p.strategy.highWaterNetLamports);
    }
  }
  let reservations = 0n;
  const pendingMints = /* @__PURE__ */ new Set();
  let pendingBuys = 0;
  for (const [id, o] of Object.entries(s.pending)) {
    if (!record2(o) || !key(id, 100) || o.id !== id || !key(o.mint, 96) || pendingMints.has(o.mint) || !eventTime(o.decidedAt) || !Number.isSafeInteger(o.executeAt) || !Number.isSafeInteger(o.expiresAt) || o.executeAt < o.decidedAt + 500 || o.expiresAt <= o.executeAt || o.expiresAt > o.decidedAt + 3e4 || !boundedText(o.decisionEvidence) || amount2(o.gas) === 0n || amount2(o.minReceive) === 0n) throw new Error("pending order identity/time/amount invariant");
    const gas = amount2(o.gas), spend = amount2(o.maxSpend), deposit = amount2(o.deposit), reserved = amount2(o.reserved);
    if (o.executionModel !== void 0 && (!validatePaperExecutionPlan(o.executionModel) || o.executionModel.plannedAt !== o.decidedAt || o.executionModel.executeAt !== o.executeAt || o.executionModel.expiresAt !== o.expiresAt || paperExecutionFee(o.executionModel) !== o.gas || o.temporaryRentLamports !== o.executionModel.temporaryQuoteRentLamports)) throw Error("pending execution model invariant");
    const temporary = amount2(o.temporaryRentLamports ?? "0");
    if (!o.executionModel && o.temporaryRentLamports !== void 0) throw Error("temporary rent requires supported execution model");
    if (o.allocation !== void 0) {
      if (o.side !== "buy") throw Error("allocation belongs to entry only");
      validateEntryAllocation(o.allocation, o.decidedAt, gas + spend);
    }
    if (o.entryStrategy !== void 0) {
      if (o.side !== "buy") throw Error("adaptive strategy belongs to entry only");
      validateEntryStrategy(o.entryStrategy, o.decidedAt);
    }
    if (o.side === "buy") {
      pendingBuys++;
      if (spend === 0n || s.positions[o.mint] || reserved !== gas + spend + deposit + temporary || deposit > 0n && s.lockedDeposits[o.mint]) throw new Error("pending buy reservation invariant");
    } else if (o.side === "sell") {
      if (!s.positions[o.mint] || spend !== 0n || deposit !== 0n || reserved !== gas + temporary) throw new Error("pending exit reservation invariant");
    } else throw new Error("pending order side invariant");
    pendingMints.add(o.mint);
    reservations += reserved;
  }
  if (s.equityRisk !== void 0) try {
    validateEquityRiskState(s.equityRisk, s.inceptionAt, s.lastAt, s.revision);
  } catch (error) {
    if (!options.allowUnavailableEntryPolicy) throw error;
  }
  if (reservations > cash || Object.keys(s.positions).length + pendingBuys > 3) throw new Error("cash reservation/capacity invariant");
}

// src/backup.ts
var BackupPreparationDeferred = class extends Error {
  constructor() {
    super("BACKUP_RUNTIME_PREPARATION_DEFERRED");
  }
};
var PREFIX = "poe-financial-";
var PENDING = "poe-financial-pending.sqlite";
var OPERATION_LOCK = ".poe-backup.lock";
var NAME = /^poe-financial-([0-9]{20})\.sqlite$/;
var ArtifactWorker = class {
  worker;
  failed = false;
  constructor(options) {
    const source = import.meta.url.endsWith(".ts");
    const register = source ? "data:text/javascript," + encodeURIComponent(`import {register} from ${JSON.stringify(import.meta.resolve("tsx/esm/api"))};register();`) : "";
    this.worker = new Worker(new URL("./backup-worker.mjs", import.meta.url), { workerData: options, execArgv: source ? ["--import", register] : [], env: {} });
    this.worker.on("error", () => {
      this.failed = true;
    });
    this.worker.on("exit", () => {
      this.failed = true;
    });
  }
  request(task) {
    if (this.failed) return Promise.reject(new Error("backup artifact worker unavailable; pending artifacts preserved"));
    return new Promise((resolve2, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.worker.off("message", message);
        this.worker.off("error", error);
        this.worker.off("exit", exited);
      };
      const error = () => {
        cleanup();
        reject(new Error("backup artifact worker failed; pending artifacts preserved"));
      };
      const exited = () => error();
      const message = (reply) => {
        cleanup();
        if (reply.ok) resolve2(reply.result ?? null);
        else reject(new Error(reply.error ?? "backup artifact operation failed"));
      };
      const timer = setTimeout(() => {
        cleanup();
        this.failed = true;
        void this.worker.terminate();
        reject(new Error("backup artifact work exceeded 30s; pending artifacts preserved"));
      }, 3e4);
      this.worker.once("message", message);
      this.worker.once("error", error);
      this.worker.once("exit", exited);
      this.worker.postMessage(task);
    });
  }
  async close() {
    await this.worker.terminate();
  }
};
var FinancialBackupStore = class {
  directory;
  identity;
  sourcePath;
  maxBytes;
  persistent;
  minimumFreeBytes;
  staged;
  constructor(options) {
    this.directory = resolve(options.directory);
    const source = resolve(options.sourcePath);
    let sourceParent = dirname(source);
    try {
      sourceParent = realpathSync(sourceParent);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && ["ENOENT", "EACCES"].includes(String(error.code)))) throw error;
    }
    this.sourcePath = join(sourceParent, basename(source));
    this.identity = { ...options.identity };
    this.persistent = options.persistent === true;
    this.minimumFreeBytes = options.minimumFreeBytes ?? 256 * 1024 * 1024;
    this.maxBytes = this.persistent ? Number.MAX_SAFE_INTEGER : options.maxBytes ?? 64 * 1024 * 1024;
    if (options.persistent !== void 0 && typeof options.persistent !== "boolean" || !Number.isSafeInteger(this.minimumFreeBytes) || this.minimumFreeBytes < 1024 * 1024 || !Number.isSafeInteger(this.maxBytes) || this.maxBytes < 4096 || !this.persistent && this.maxBytes > 1024 * 1024 * 1024) throw new Error("bounded backup size required");
    if (!Number.isSafeInteger(this.identity.inceptionAt) || this.identity.inceptionAt < 0 || !["PAPER", "DISPOSABLE_PAPER"].includes(this.identity.mode) || !this.identity.accountId) throw new Error("actual backup identity required");
    if (this.sourcePath.startsWith(this.directory + "/")) throw new Error("backup directory must not contain source financial state");
    if (realpathSync(dirname(this.directory)) !== dirname(this.directory)) throw new Error("canonical backup parent required");
    try {
      mkdirSync(this.directory, { mode: 448 });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    this.checkDirectory();
  }
  checkDirectory() {
    const s = lstatSync(this.directory);
    if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid?.() || (s.mode & 511) !== 448 || realpathSync(this.directory) !== this.directory) throw new Error("private canonical owner-held backup directory required");
  }
  privateFile(path) {
    const s = lstatSync(path);
    if (!s.isFile() || s.isSymbolicLink() || s.uid !== process.getuid?.() || (s.mode & 511) !== 384 || s.nlink !== 1 || s.size > this.maxBytes) throw new Error("private bounded regular backup/source file required");
    return s;
  }
  checkSourceSize() {
    let size = this.privateFile(this.sourcePath).size;
    try {
      size += this.privateFile(this.sourcePath + "-wal").size;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (size > this.maxBytes) throw new Error("source database and active WAL exceed backup size limit");
    if (this.persistent) {
      const disk = statfsSync(this.directory), free = disk.bavail * disk.bsize;
      if (!Number.isSafeInteger(free) || free < size + this.minimumFreeBytes) throw new Error("backup disk headroom unavailable; financial source and prior backups retained");
    }
  }
  scan() {
    this.checkDirectory();
    const dir = opendirSync(this.directory), completed = [], unknown = [];
    let pending = false;
    try {
      for (let count = 0; ; count++) {
        const entry = dir.readSync();
        if (!entry) break;
        if (count >= 32) throw new Error("backup directory entry bound exceeded; nothing removed");
        const match = NAME.exec(entry.name);
        if (match) completed.push({ name: entry.name, generation: match[1] });
        else if (entry.name === PENDING || entry.name === PENDING + "-wal" || entry.name === PENDING + "-shm") pending = true;
        else if (entry.name === OPERATION_LOCK) {
          try {
            this.privateFile(join(this.directory, OPERATION_LOCK));
          } catch {
            unknown.push(entry.name);
          }
        } else unknown.push(entry.name);
      }
    } finally {
      dir.closeSync();
    }
    completed.sort((a, b) => a.generation.localeCompare(b.generation));
    return { completed, unknown, pending };
  }
  inspect(path, generation, requireStandalone = true) {
    const file = this.privateFile(path);
    let source;
    try {
      source = statSync(this.sourcePath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && ["ENOENT", "EACCES"].includes(String(error.code)))) throw error;
    }
    if (source && file.dev === source.dev && file.ino === source.ino) throw new Error("source financial database cannot be a backup retention target");
    if (requireStandalone) {
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW), header = Buffer.alloc(100);
      try {
        if (readSync(fd, header, 0, 100, 0) !== 100 || header[18] !== 1 || header[19] !== 1) throw new Error("backup is not a standalone normalized artifact");
      } finally {
        closeSync(fd);
      }
    }
    const db = new import_better_sqlite32.default(path, { readonly: true, fileMustExist: true, timeout: 100 });
    try {
      if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("backup integrity failure");
      if (requireStandalone && db.pragma("journal_mode", { simple: true }) !== "delete") throw new Error("backup is not a standalone normalized artifact");
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 5").all();
      if (tables.map((x) => x.name).sort().join(",") !== "actions,financial_state,journal,metadata") throw new Error("backup schema mismatch");
      const size = db.prepare("SELECT length(body) size FROM financial_state WHERE singleton=1").get();
      if (!size || size.size > 1048576) throw new Error("backup account absent or oversized");
      const row = db.prepare("SELECT body FROM financial_state WHERE singleton=1").get();
      const state = JSON.parse(row.body);
      validateFinancialState(state, this.identity.accountId, this.identity.mode);
      if (state.inceptionAt !== this.identity.inceptionAt) throw new Error("backup inception identity mismatch");
      const costSize = db.prepare("SELECT length(CAST(value AS BLOB)) size FROM metadata WHERE key='operating_costs'").get();
      if (costSize) {
        if (costSize.size > 262144) throw new Error("backup operating cost metadata limit");
        const row2 = db.prepare("SELECT value FROM metadata WHERE key='operating_costs'").get();
        const costs = JSON.parse(row2.value);
        validateOperatingCosts(costs);
        if (costs.accountId !== state.accountId || costs.inceptionAt !== state.inceptionAt || costs.lastRecordedAt > state.lastAt) throw new Error("backup operating cost account/inception chronology mismatch");
      } else for (const [from, through] of [["cost:", "cost;"], ["cost-valuation:", "cost-valuation;"]]) {
        if (db.prepare("SELECT 1 FROM actions WHERE id>=? AND id<? LIMIT 1").get(from, through) || db.prepare("SELECT 1 FROM journal WHERE action_id>=? AND action_id<? LIMIT 1").get(from, through)) throw new Error("backup operating cost metadata missing from recorded history");
      }
      const journal = db.prepare("SELECT revision,at FROM journal ORDER BY revision DESC LIMIT 1").get();
      if (!journal || journal.revision !== state.revision || journal.at !== state.lastAt) throw new Error("backup journal/state mismatch");
      const counts = db.prepare("SELECT (SELECT count(*) FROM journal) journal,(SELECT count(*) FROM actions) actions,(SELECT min(revision) FROM journal) first").get();
      if (counts.journal !== state.revision + 1 || counts.actions !== state.revision || counts.first !== 0) throw new Error("backup financial history incomplete");
      if (db.prepare("SELECT action_id FROM journal WHERE revision>0 EXCEPT SELECT id FROM actions LIMIT 1").get()) throw new Error("backup financial action identity mismatch");
      const inception = db.prepare("SELECT at,kind FROM journal WHERE revision=0").get();
      if (inception?.kind !== "inception" || inception.at !== state.inceptionAt) throw new Error("backup inception mismatch");
      const metadata = db.prepare("SELECT key,length(value) size FROM metadata WHERE key IN ('reporting_history','reporting_history_operating_v2','snapshot_sequence','reporting_trades')").all();
      if (metadata.some((x) => x.size > 262144)) throw new Error("backup metadata bound exceeded");
      const historyRow = db.prepare("SELECT value FROM metadata WHERE key='reporting_history'").get();
      if (!historyRow) throw new Error("backup inception history absent");
      const history = JSON.parse(historyRow.value);
      let previous = -Infinity;
      if (!history || typeof history !== "object" || Object.keys(history).sort().join(",") !== "downsampled,points,windowLimited" || !Array.isArray(history.points) || history.points.length > 720 || typeof history.windowLimited !== "boolean" || typeof history.downsampled !== "boolean") throw new Error("backup reporting history malformed");
      for (const point of history.points) {
        if (!point || Object.keys(point).sort().join(",") !== "at,economicMicroUsd,tradingMicroUsd" || !Number.isSafeInteger(point.at) || point.at <= previous || point.at < state.inceptionAt || ![point.tradingMicroUsd, point.economicMicroUsd].every((v) => v === null || typeof v === "string" && /^-?(0|[1-9][0-9]{0,38})$/.test(v) && BigInt(v.replace(/^-/, "")) <= (1n << 127n) - 1n)) throw new Error("backup reporting history chronology/value mismatch");
        previous = point.at;
      }
      if (!history.windowLimited && (history.points[0]?.at !== state.inceptionAt || history.points[0]?.tradingMicroUsd !== "0")) throw new Error("backup reporting inception mismatch");
      const operatingHistoryRow = db.prepare("SELECT value FROM metadata WHERE key=?").get(REPORTING_OPERATING_HISTORY_KEY);
      if (operatingHistoryRow) validateOperatingReportingHistory(JSON.parse(operatingHistoryRow.value), state.inceptionAt);
      const tradesRow = db.prepare("SELECT value FROM metadata WHERE key='reporting_trades'").get();
      if (tradesRow) {
        const cache = validateReportingTradeCache(JSON.parse(tradesRow.value), state.accountId, state.inceptionAt, state.lastAt);
        for (const trade of cache.trades) {
          const attempt = db.prepare("SELECT j.at,j.kind,j.detail,a.result FROM journal j JOIN actions a ON a.id=j.action_id WHERE j.action_id=?").get(trade.actionId);
          if (!attempt || attempt.kind !== "attempt" || Buffer.byteLength(attempt.detail) > 65536) throw Error("backup reporting trade attempt absent");
          const payload = JSON.parse(attempt.detail), order = db.prepare("SELECT detail FROM journal WHERE action_id=?").get("order:" + payload.orderId);
          if (!order || Buffer.byteLength(order.detail) > 65536 || !isDeepStrictEqual(trade, reportingFilledTrade(trade.actionId, attempt.at, payload, JSON.parse(order.detail), JSON.parse(attempt.result)))) throw Error("backup reporting trade durable evidence mismatch");
        }
      }
      const sequence = db.prepare("SELECT value FROM metadata WHERE key='snapshot_sequence'").get();
      if (sequence && !/^[1-9][0-9]{0,39}$/.test(sequence.value)) throw new Error("backup sequence malformed");
      return { ...this.identity, path, generation, revision: state.revision, lastAt: state.lastAt, snapshotSequence: sequence?.value ?? null };
    } finally {
      db.close();
    }
  }
  /** Read-only selection never deletes corrupt, foreign or unknown paths. */
  latest() {
    const scan = this.scan(), rejected = scan.unknown.map((file) => ({ file, reason: "unrecognized-path" }));
    let backup = null;
    for (const item of [...scan.completed].reverse()) {
      try {
        const valid = this.inspect(join(this.directory, item.name), item.generation);
        if (!backup) backup = valid;
      } catch {
        rejected.push({ file: item.name, reason: "invalid-backup" });
      }
    }
    return { backup, rejected, pending: scan.pending };
  }
  ready() {
    const scan = this.scan();
    if (scan.completed.length > 2 || scan.unknown.length) throw new Error("backup retention layout needs review; nothing removed");
    const completed = scan.completed.map((item) => this.inspect(join(this.directory, item.name), item.generation));
    return { scan, completed };
  }
  normalize(path) {
    const db = new import_better_sqlite32.default(path, { fileMustExist: true, timeout: 100 });
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      if (db.pragma("journal_mode=DELETE", { simple: true }) !== "delete") throw new Error("backup journal normalization failed");
    } finally {
      db.close();
    }
    chmodSync(path, 384);
  }
  syncDirectory() {
    const fd = openSync(this.directory, constants.O_RDONLY);
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  acquireOperation() {
    this.checkDirectory();
    const path = join(this.directory, OPERATION_LOCK);
    const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 384);
    try {
      this.privateFile(path);
      const result = spawnSync("/usr/bin/flock", ["-xn", "3"], { stdio: ["ignore", "ignore", "pipe", fd], timeout: 5e3 });
      if (result.error || result.status !== 0) throw new Error("backup operation already active or standard Linux flock unavailable");
      return fd;
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  /** Runtime backup startup must not synchronously wait up to five seconds
   * for a local lock child. The same open-file-description lease is retained
   * by this sole writer after flock exits; errors close it only after settlement. */
  async acquireOperationAsync() {
    this.checkDirectory();
    const path = join(this.directory, OPERATION_LOCK), fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 384);
    try {
      this.privateFile(path);
      await new Promise((resolve2, reject) => {
        const child = spawn("/usr/bin/flock", ["-xn", "3"], { stdio: ["ignore", "ignore", "ignore", fd] });
        let failed = false;
        const timer = setTimeout(() => {
          failed = true;
          child.kill("SIGKILL");
        }, 5e3);
        child.once("error", () => {
          failed = true;
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          if (failed || code !== 0) reject(Error("backup operation already active or standard Linux flock unavailable"));
          else resolve2();
        });
      });
      return fd;
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  promote(valid, completed) {
    const completedFd = openSync(valid.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      fsyncSync(completedFd);
    } finally {
      closeSync(completedFd);
    }
    const newest = completed.at(-1);
    if (newest && (valid.revision < newest.revision || newest.snapshotSequence !== null && (valid.snapshotSequence === null || BigInt(valid.snapshotSequence) < BigInt(newest.snapshotSequence)))) throw new Error("backup would regress durable history");
    const next = (BigInt(newest?.generation ?? "0") + 1n).toString().padStart(20, "0");
    if (next.length > 20) throw new Error("backup generation exhausted");
    const target = join(this.directory, PREFIX + next + ".sqlite");
    try {
      lstatSync(target);
      throw new Error("unexpected backup promotion target; nothing overwritten");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (completed.length === 2) {
      this.inspect(completed[0].path, completed[0].generation);
      unlinkSync(completed[0].path);
      this.syncDirectory();
    }
    renameSync(valid.path, target);
    this.syncDirectory();
    return { ...valid, path: target, generation: next };
  }
  async create(source, runtime) {
    const operation = await this.acquireOperationAsync();
    let worker;
    try {
      if (runtime && !runtime.admission()) throw new BackupPreparationDeferred();
      const prepare = () => {
        const before2 = source.state();
        if (before2.accountId !== this.identity.accountId || before2.mode !== this.identity.mode || before2.inceptionAt !== this.identity.inceptionAt) throw new Error("backup source identity mismatch");
        worker = this.artifactWorker();
        return before2;
      };
      const before = runtime ? runtime.measure(prepare) : prepare();
      await worker.request({ task: "prepare", minimumRevision: before.revision });
      await source.backup(join(this.directory, PENDING));
      const result = await worker.request({ task: "finish" });
      if (!result) throw new Error("backup completion missing");
      return result;
    } catch (error) {
      try {
        await worker?.request({ task: "abort" });
      } catch {
      }
      throw error;
    } finally {
      try {
        await worker?.close();
      } finally {
        closeSync(operation);
      }
    }
  }
  artifactWorker() {
    return new ArtifactWorker({ directory: this.directory, sourcePath: this.sourcePath, identity: this.identity, maxBytes: this.persistent ? void 0 : this.maxBytes, persistent: this.persistent, minimumFreeBytes: this.minimumFreeBytes });
  }
  /** Runtime-safe pending maintenance; all SQLite artifact work runs off-thread. */
  async maintainPending() {
    const operation = await this.acquireOperationAsync();
    let worker;
    try {
      worker = this.artifactWorker();
      return await worker.request({ task: "recover" });
    } finally {
      try {
        await worker?.close();
      } finally {
        closeSync(operation);
      }
    }
  }
  /** Internal worker entry. The parent holds the operation lease across phases. */
  runArtifactTask(message) {
    if (message.task === "recover") return this.recoverPendingOwned();
    if (message.task === "prepare") {
      this.checkSourceSize();
      const { scan, completed } = this.ready();
      if (scan.pending) throw new Error("pending backup requires explicit recovery; nothing overwritten");
      const path = join(this.directory, PENDING), fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384);
      closeSync(fd);
      this.staged = { path, own: lstatSync(path), completed, minimumRevision: message.minimumRevision, validated: false };
      return null;
    }
    const staged = this.staged;
    if (!staged) return null;
    if (message.task === "finish") {
      this.privateFile(staged.path);
      this.normalize(staged.path);
      const valid = this.inspect(staged.path, "0");
      if (valid.revision < staged.minimumRevision) throw new Error("backup predates source observation");
      staged.validated = true;
      const result = this.promote(valid, staged.completed);
      this.staged = void 0;
      return result;
    }
    try {
      const current = lstatSync(staged.path);
      if (!staged.validated && current.dev === staged.own.dev && current.ino === staged.own.ino) {
        for (const suffix of ["-wal", "-shm", ""]) {
          const path = staged.path + suffix;
          try {
            const s = lstatSync(path);
            if (s.isFile() && !s.isSymbolicLink() && s.uid === process.getuid?.() && s.nlink === 1 && (s.mode & 63) === 0) unlinkSync(path);
          } catch {
          }
        }
      }
    } catch {
    }
    this.staged = void 0;
    return null;
  }
  /** Explicitly complete a crash-left staging artifact only after identity checks. */
  recoverPending() {
    const operation = this.acquireOperation();
    try {
      return this.recoverPendingOwned();
    } finally {
      closeSync(operation);
    }
  }
  recoverPendingOwned() {
    if (!this.scan().pending) return null;
    const { completed } = this.ready();
    const path = join(this.directory, PENDING);
    this.inspect(path, "0", false);
    this.normalize(path);
    return this.promote(this.inspect(path, "0"), completed);
  }
};

// src/backup-worker.ts
if (!parentPort) throw new Error("backup artifact worker requires a parent");
var port = parentPort;
var store = new FinancialBackupStore(workerData);
port.on("message", (task) => {
  try {
    port.postMessage({ ok: true, result: store.runArtifactTask(task) });
  } catch (error) {
    port.postMessage({ ok: false, error: error instanceof Error ? error.message : "backup artifact operation failed" });
  }
});
