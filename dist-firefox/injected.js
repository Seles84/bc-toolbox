(function() {
  "use strict";
  function getDefaultExportFromCjs(x) {
    return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
  }
  var bcmodsdk = {};
  var hasRequiredBcmodsdk;
  function requireBcmodsdk() {
    if (hasRequiredBcmodsdk) return bcmodsdk;
    hasRequiredBcmodsdk = 1;
    (function(exports) {
      (function() {
        const o = "1.2.0";
        function e(o2) {
          alert("Mod ERROR:\n" + o2);
          const e2 = new Error(o2);
          throw console.error(e2), e2;
        }
        const t = new TextEncoder();
        function n(o2) {
          return !!o2 && "object" == typeof o2 && !Array.isArray(o2);
        }
        function r(o2) {
          const e2 = /* @__PURE__ */ new Set();
          return o2.filter(((o3) => !e2.has(o3) && e2.add(o3)));
        }
        const i = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Set();
        function c(o2) {
          a.has(o2) || (a.add(o2), console.warn(o2));
        }
        function s(o2) {
          const e2 = [], t2 = /* @__PURE__ */ new Map(), n2 = /* @__PURE__ */ new Set();
          for (const r3 of f.values()) {
            const i3 = r3.patching.get(o2.name);
            if (i3) {
              e2.push(...i3.hooks);
              for (const [e3, a2] of i3.patches.entries()) t2.has(e3) && t2.get(e3) !== a2 && c(`ModSDK: Mod '${r3.name}' is patching function ${o2.name} with same pattern that is already applied by different mod, but with different pattern:
Pattern:
${e3}
Patch1:
${t2.get(e3) || ""}
Patch2:
${a2}`), t2.set(e3, a2), n2.add(r3.name);
            }
          }
          e2.sort(((o3, e3) => e3.priority - o3.priority));
          const r2 = (function(o3, e3) {
            if (0 === e3.size) return o3;
            let t3 = o3.toString().replaceAll("\r\n", "\n");
            for (const [n3, r3] of e3.entries()) t3.includes(n3) || c(`ModSDK: Patching ${o3.name}: Patch ${n3} not applied`), t3 = t3.replaceAll(n3, r3);
            return (0, eval)(`(${t3})`);
          })(o2.original, t2);
          let i2 = function(e3) {
            var t3, i3;
            const a2 = null === (i3 = (t3 = m.errorReporterHooks).hookChainExit) || void 0 === i3 ? void 0 : i3.call(t3, o2.name, n2), c2 = r2.apply(this, e3);
            return null == a2 || a2(), c2;
          };
          for (let t3 = e2.length - 1; t3 >= 0; t3--) {
            const n3 = e2[t3], r3 = i2;
            i2 = function(e3) {
              var t4, i3;
              const a2 = null === (i3 = (t4 = m.errorReporterHooks).hookEnter) || void 0 === i3 ? void 0 : i3.call(t4, o2.name, n3.mod), c2 = n3.hook.apply(this, [e3, (o3) => {
                if (1 !== arguments.length || !Array.isArray(e3)) throw new Error(`Mod ${n3.mod} failed to call next hook: Expected args to be array, got ${typeof o3}`);
                return r3.call(this, o3);
              }]);
              return null == a2 || a2(), c2;
            };
          }
          return { hooks: e2, patches: t2, patchesSources: n2, enter: i2, final: r2 };
        }
        function l(o2, e2 = false) {
          let r2 = i.get(o2);
          if (r2) e2 && (r2.precomputed = s(r2));
          else {
            let e3 = window;
            const a2 = o2.split(".");
            for (let t2 = 0; t2 < a2.length - 1; t2++) if (e3 = e3[a2[t2]], !n(e3)) throw new Error(`ModSDK: Function ${o2} to be patched not found; ${a2.slice(0, t2 + 1).join(".")} is not object`);
            const c2 = e3[a2[a2.length - 1]];
            if ("function" != typeof c2) throw new Error(`ModSDK: Function ${o2} to be patched not found`);
            const l2 = (function(o3) {
              let e4 = -1;
              for (const n2 of t.encode(o3)) {
                let o4 = 255 & (e4 ^ n2);
                for (let e5 = 0; e5 < 8; e5++) o4 = 1 & o4 ? -306674912 ^ o4 >>> 1 : o4 >>> 1;
                e4 = e4 >>> 8 ^ o4;
              }
              return ((-1 ^ e4) >>> 0).toString(16).padStart(8, "0").toUpperCase();
            })(c2.toString().replaceAll("\r\n", "\n")), d2 = { name: o2, original: c2, originalHash: l2 };
            r2 = Object.assign(Object.assign({}, d2), { precomputed: s(d2), router: () => {
            }, context: e3, contextProperty: a2[a2.length - 1] }), r2.router = /* @__PURE__ */ (function(o3) {
              return function(...e4) {
                return o3.precomputed.enter.apply(this, [e4]);
              };
            })(r2), i.set(o2, r2), e3[r2.contextProperty] = r2.router;
          }
          return r2;
        }
        function d() {
          for (const o2 of i.values()) o2.precomputed = s(o2);
        }
        function p() {
          const o2 = /* @__PURE__ */ new Map();
          for (const [e2, t2] of i) o2.set(e2, { name: e2, original: t2.original, originalHash: t2.originalHash, sdkEntrypoint: t2.router, currentEntrypoint: t2.context[t2.contextProperty], hookedByMods: r(t2.precomputed.hooks.map(((o3) => o3.mod))), patchedByMods: Array.from(t2.precomputed.patchesSources) });
          return o2;
        }
        const f = /* @__PURE__ */ new Map();
        function u(o2) {
          f.get(o2.name) !== o2 && e(`Failed to unload mod '${o2.name}': Not registered`), f.delete(o2.name), o2.loaded = false, d();
        }
        function g(o2, t2) {
          o2 && "object" == typeof o2 || e("Failed to register mod: Expected info object, got " + typeof o2), "string" == typeof o2.name && o2.name || e("Failed to register mod: Expected name to be non-empty string, got " + typeof o2.name);
          let r2 = `'${o2.name}'`;
          "string" == typeof o2.fullName && o2.fullName || e(`Failed to register mod ${r2}: Expected fullName to be non-empty string, got ${typeof o2.fullName}`), r2 = `'${o2.fullName} (${o2.name})'`, "string" != typeof o2.version && e(`Failed to register mod ${r2}: Expected version to be string, got ${typeof o2.version}`), o2.repository || (o2.repository = void 0), void 0 !== o2.repository && "string" != typeof o2.repository && e(`Failed to register mod ${r2}: Expected repository to be undefined or string, got ${typeof o2.version}`), null == t2 && (t2 = {}), t2 && "object" == typeof t2 || e(`Failed to register mod ${r2}: Expected options to be undefined or object, got ${typeof t2}`);
          const i2 = true === t2.allowReplace, a2 = f.get(o2.name);
          a2 && (a2.allowReplace && i2 || e(`Refusing to load mod ${r2}: it is already loaded and doesn't allow being replaced.
Was the mod loaded multiple times?`), u(a2));
          const c2 = (o3) => {
            let e2 = g2.patching.get(o3.name);
            return e2 || (e2 = { hooks: [], patches: /* @__PURE__ */ new Map() }, g2.patching.set(o3.name, e2)), e2;
          }, s2 = (o3, t3) => (...n2) => {
            var i3, a3;
            const c3 = null === (a3 = (i3 = m.errorReporterHooks).apiEndpointEnter) || void 0 === a3 ? void 0 : a3.call(i3, o3, g2.name);
            g2.loaded || e(`Mod ${r2} attempted to call SDK function after being unloaded`);
            const s3 = t3(...n2);
            return null == c3 || c3(), s3;
          }, p2 = { unload: s2("unload", (() => u(g2))), hookFunction: s2("hookFunction", ((o3, t3, n2) => {
            "string" == typeof o3 && o3 || e(`Mod ${r2} failed to patch a function: Expected function name string, got ${typeof o3}`);
            const i3 = l(o3), a3 = c2(i3);
            "number" != typeof t3 && e(`Mod ${r2} failed to hook function '${o3}': Expected priority number, got ${typeof t3}`), "function" != typeof n2 && e(`Mod ${r2} failed to hook function '${o3}': Expected hook function, got ${typeof n2}`);
            const s3 = { mod: g2.name, priority: t3, hook: n2 };
            return a3.hooks.push(s3), d(), () => {
              const o4 = a3.hooks.indexOf(s3);
              o4 >= 0 && (a3.hooks.splice(o4, 1), d());
            };
          })), patchFunction: s2("patchFunction", ((o3, t3) => {
            "string" == typeof o3 && o3 || e(`Mod ${r2} failed to patch a function: Expected function name string, got ${typeof o3}`);
            const i3 = l(o3), a3 = c2(i3);
            n(t3) || e(`Mod ${r2} failed to patch function '${o3}': Expected patches object, got ${typeof t3}`);
            for (const [n2, i4] of Object.entries(t3)) "string" == typeof i4 ? a3.patches.set(n2, i4) : null === i4 ? a3.patches.delete(n2) : e(`Mod ${r2} failed to patch function '${o3}': Invalid format of patch '${n2}'`);
            d();
          })), removePatches: s2("removePatches", ((o3) => {
            "string" == typeof o3 && o3 || e(`Mod ${r2} failed to patch a function: Expected function name string, got ${typeof o3}`);
            const t3 = l(o3);
            c2(t3).patches.clear(), d();
          })), callOriginal: s2("callOriginal", ((o3, t3, n2) => {
            "string" == typeof o3 && o3 || e(`Mod ${r2} failed to call a function: Expected function name string, got ${typeof o3}`);
            const i3 = l(o3);
            return Array.isArray(t3) || e(`Mod ${r2} failed to call a function: Expected args array, got ${typeof t3}`), i3.original.apply(null != n2 ? n2 : globalThis, t3);
          })), getOriginalHash: s2("getOriginalHash", ((o3) => {
            "string" == typeof o3 && o3 || e(`Mod ${r2} failed to get hash: Expected function name string, got ${typeof o3}`);
            return l(o3).originalHash;
          })) }, g2 = { name: o2.name, fullName: o2.fullName, version: o2.version, repository: o2.repository, allowReplace: i2, api: p2, loaded: true, patching: /* @__PURE__ */ new Map() };
          return f.set(o2.name, g2), Object.freeze(p2);
        }
        function h() {
          const o2 = [];
          for (const e2 of f.values()) o2.push({ name: e2.name, fullName: e2.fullName, version: e2.version, repository: e2.repository });
          return o2;
        }
        let m;
        const y = void 0 === window.bcModSdk ? window.bcModSdk = (function() {
          const e2 = { version: o, apiVersion: 1, registerMod: g, getModsInfo: h, getPatchingInfo: p, errorReporterHooks: Object.seal({ apiEndpointEnter: null, hookEnter: null, hookChainExit: null }) };
          return m = e2, Object.freeze(e2);
        })() : (n(window.bcModSdk) || e("Failed to init Mod SDK: Name already in use"), 1 !== window.bcModSdk.apiVersion && e(`Failed to init Mod SDK: Different version already loaded ('1.2.0' vs '${window.bcModSdk.version}')`), window.bcModSdk.version !== o && alert(`Mod SDK warning: Loading different but compatible versions ('1.2.0' vs '${window.bcModSdk.version}')
One of mods you are using is using an old version of SDK. It will work for now but please inform author to update`), window.bcModSdk);
        return Object.defineProperty(exports, "__esModule", { value: true }), exports.default = y, y;
      })();
    })(bcmodsdk);
    return bcmodsdk;
  }
  var bcmodsdkExports = requireBcmodsdk();
  const bcModSdk = /* @__PURE__ */ getDefaultExportFromCjs(bcmodsdkExports);
  const PAGE_SOURCE = "bct-page";
  const RELAY_SOURCE = "bct-relay";
  function isRelayEnvelope(data) {
    return typeof data === "object" && data !== null && data.source === RELAY_SOURCE;
  }
  var lzString = { exports: {} };
  var hasRequiredLzString;
  function requireLzString() {
    if (hasRequiredLzString) return lzString.exports;
    hasRequiredLzString = 1;
    (function(module) {
      var LZString = (function() {
        var f = String.fromCharCode;
        var keyStrBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var keyStrUriSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
        var baseReverseDic = {};
        function getBaseValue(alphabet, character) {
          if (!baseReverseDic[alphabet]) {
            baseReverseDic[alphabet] = {};
            for (var i = 0; i < alphabet.length; i++) {
              baseReverseDic[alphabet][alphabet.charAt(i)] = i;
            }
          }
          return baseReverseDic[alphabet][character];
        }
        var LZString2 = {
          compressToBase64: function(input) {
            if (input == null) return "";
            var res = LZString2._compress(input, 6, function(a) {
              return keyStrBase64.charAt(a);
            });
            switch (res.length % 4) {
              // To produce valid Base64
              default:
              // When could this happen ?
              case 0:
                return res;
              case 1:
                return res + "===";
              case 2:
                return res + "==";
              case 3:
                return res + "=";
            }
          },
          decompressFromBase64: function(input) {
            if (input == null) return "";
            if (input == "") return null;
            return LZString2._decompress(input.length, 32, function(index) {
              return getBaseValue(keyStrBase64, input.charAt(index));
            });
          },
          compressToUTF16: function(input) {
            if (input == null) return "";
            return LZString2._compress(input, 15, function(a) {
              return f(a + 32);
            }) + " ";
          },
          decompressFromUTF16: function(compressed) {
            if (compressed == null) return "";
            if (compressed == "") return null;
            return LZString2._decompress(compressed.length, 16384, function(index) {
              return compressed.charCodeAt(index) - 32;
            });
          },
          //compress into uint8array (UCS-2 big endian format)
          compressToUint8Array: function(uncompressed) {
            var compressed = LZString2.compress(uncompressed);
            var buf = new Uint8Array(compressed.length * 2);
            for (var i = 0, TotalLen = compressed.length; i < TotalLen; i++) {
              var current_value = compressed.charCodeAt(i);
              buf[i * 2] = current_value >>> 8;
              buf[i * 2 + 1] = current_value % 256;
            }
            return buf;
          },
          //decompress from uint8array (UCS-2 big endian format)
          decompressFromUint8Array: function(compressed) {
            if (compressed === null || compressed === void 0) {
              return LZString2.decompress(compressed);
            } else {
              var buf = new Array(compressed.length / 2);
              for (var i = 0, TotalLen = buf.length; i < TotalLen; i++) {
                buf[i] = compressed[i * 2] * 256 + compressed[i * 2 + 1];
              }
              var result = [];
              buf.forEach(function(c) {
                result.push(f(c));
              });
              return LZString2.decompress(result.join(""));
            }
          },
          //compress into a string that is already URI encoded
          compressToEncodedURIComponent: function(input) {
            if (input == null) return "";
            return LZString2._compress(input, 6, function(a) {
              return keyStrUriSafe.charAt(a);
            });
          },
          //decompress from an output of compressToEncodedURIComponent
          decompressFromEncodedURIComponent: function(input) {
            if (input == null) return "";
            if (input == "") return null;
            input = input.replace(/ /g, "+");
            return LZString2._decompress(input.length, 32, function(index) {
              return getBaseValue(keyStrUriSafe, input.charAt(index));
            });
          },
          compress: function(uncompressed) {
            return LZString2._compress(uncompressed, 16, function(a) {
              return f(a);
            });
          },
          _compress: function(uncompressed, bitsPerChar, getCharFromInt) {
            if (uncompressed == null) return "";
            var i, value, context_dictionary = {}, context_dictionaryToCreate = {}, context_c = "", context_wc = "", context_w = "", context_enlargeIn = 2, context_dictSize = 3, context_numBits = 2, context_data = [], context_data_val = 0, context_data_position = 0, ii;
            for (ii = 0; ii < uncompressed.length; ii += 1) {
              context_c = uncompressed.charAt(ii);
              if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
                context_dictionary[context_c] = context_dictSize++;
                context_dictionaryToCreate[context_c] = true;
              }
              context_wc = context_w + context_c;
              if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
                context_w = context_wc;
              } else {
                if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                  if (context_w.charCodeAt(0) < 256) {
                    for (i = 0; i < context_numBits; i++) {
                      context_data_val = context_data_val << 1;
                      if (context_data_position == bitsPerChar - 1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                      } else {
                        context_data_position++;
                      }
                    }
                    value = context_w.charCodeAt(0);
                    for (i = 0; i < 8; i++) {
                      context_data_val = context_data_val << 1 | value & 1;
                      if (context_data_position == bitsPerChar - 1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                      } else {
                        context_data_position++;
                      }
                      value = value >> 1;
                    }
                  } else {
                    value = 1;
                    for (i = 0; i < context_numBits; i++) {
                      context_data_val = context_data_val << 1 | value;
                      if (context_data_position == bitsPerChar - 1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                      } else {
                        context_data_position++;
                      }
                      value = 0;
                    }
                    value = context_w.charCodeAt(0);
                    for (i = 0; i < 16; i++) {
                      context_data_val = context_data_val << 1 | value & 1;
                      if (context_data_position == bitsPerChar - 1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                      } else {
                        context_data_position++;
                      }
                      value = value >> 1;
                    }
                  }
                  context_enlargeIn--;
                  if (context_enlargeIn == 0) {
                    context_enlargeIn = Math.pow(2, context_numBits);
                    context_numBits++;
                  }
                  delete context_dictionaryToCreate[context_w];
                } else {
                  value = context_dictionary[context_w];
                  for (i = 0; i < context_numBits; i++) {
                    context_data_val = context_data_val << 1 | value & 1;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                    value = value >> 1;
                  }
                }
                context_enlargeIn--;
                if (context_enlargeIn == 0) {
                  context_enlargeIn = Math.pow(2, context_numBits);
                  context_numBits++;
                }
                context_dictionary[context_wc] = context_dictSize++;
                context_w = String(context_c);
              }
            }
            if (context_w !== "") {
              if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                if (context_w.charCodeAt(0) < 256) {
                  for (i = 0; i < context_numBits; i++) {
                    context_data_val = context_data_val << 1;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                  }
                  value = context_w.charCodeAt(0);
                  for (i = 0; i < 8; i++) {
                    context_data_val = context_data_val << 1 | value & 1;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                    value = value >> 1;
                  }
                } else {
                  value = 1;
                  for (i = 0; i < context_numBits; i++) {
                    context_data_val = context_data_val << 1 | value;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                    value = 0;
                  }
                  value = context_w.charCodeAt(0);
                  for (i = 0; i < 16; i++) {
                    context_data_val = context_data_val << 1 | value & 1;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                    value = value >> 1;
                  }
                }
                context_enlargeIn--;
                if (context_enlargeIn == 0) {
                  context_enlargeIn = Math.pow(2, context_numBits);
                  context_numBits++;
                }
                delete context_dictionaryToCreate[context_w];
              } else {
                value = context_dictionary[context_w];
                for (i = 0; i < context_numBits; i++) {
                  context_data_val = context_data_val << 1 | value & 1;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                  } else {
                    context_data_position++;
                  }
                  value = value >> 1;
                }
              }
              context_enlargeIn--;
              if (context_enlargeIn == 0) {
                context_enlargeIn = Math.pow(2, context_numBits);
                context_numBits++;
              }
            }
            value = 2;
            for (i = 0; i < context_numBits; i++) {
              context_data_val = context_data_val << 1 | value & 1;
              if (context_data_position == bitsPerChar - 1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = value >> 1;
            }
            while (true) {
              context_data_val = context_data_val << 1;
              if (context_data_position == bitsPerChar - 1) {
                context_data.push(getCharFromInt(context_data_val));
                break;
              } else context_data_position++;
            }
            return context_data.join("");
          },
          decompress: function(compressed) {
            if (compressed == null) return "";
            if (compressed == "") return null;
            return LZString2._decompress(compressed.length, 32768, function(index) {
              return compressed.charCodeAt(index);
            });
          },
          _decompress: function(length, resetValue, getNextValue) {
            var dictionary = [], enlargeIn = 4, dictSize = 4, numBits = 3, entry = "", result = [], i, w, bits, resb, maxpower, power, c, data = { val: getNextValue(0), position: resetValue, index: 1 };
            for (i = 0; i < 3; i += 1) {
              dictionary[i] = i;
            }
            bits = 0;
            maxpower = Math.pow(2, 2);
            power = 1;
            while (power != maxpower) {
              resb = data.val & data.position;
              data.position >>= 1;
              if (data.position == 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
              }
              bits |= (resb > 0 ? 1 : 0) * power;
              power <<= 1;
            }
            switch (bits) {
              case 0:
                bits = 0;
                maxpower = Math.pow(2, 8);
                power = 1;
                while (power != maxpower) {
                  resb = data.val & data.position;
                  data.position >>= 1;
                  if (data.position == 0) {
                    data.position = resetValue;
                    data.val = getNextValue(data.index++);
                  }
                  bits |= (resb > 0 ? 1 : 0) * power;
                  power <<= 1;
                }
                c = f(bits);
                break;
              case 1:
                bits = 0;
                maxpower = Math.pow(2, 16);
                power = 1;
                while (power != maxpower) {
                  resb = data.val & data.position;
                  data.position >>= 1;
                  if (data.position == 0) {
                    data.position = resetValue;
                    data.val = getNextValue(data.index++);
                  }
                  bits |= (resb > 0 ? 1 : 0) * power;
                  power <<= 1;
                }
                c = f(bits);
                break;
              case 2:
                return "";
            }
            dictionary[3] = c;
            w = c;
            result.push(c);
            while (true) {
              if (data.index > length) {
                return "";
              }
              bits = 0;
              maxpower = Math.pow(2, numBits);
              power = 1;
              while (power != maxpower) {
                resb = data.val & data.position;
                data.position >>= 1;
                if (data.position == 0) {
                  data.position = resetValue;
                  data.val = getNextValue(data.index++);
                }
                bits |= (resb > 0 ? 1 : 0) * power;
                power <<= 1;
              }
              switch (c = bits) {
                case 0:
                  bits = 0;
                  maxpower = Math.pow(2, 8);
                  power = 1;
                  while (power != maxpower) {
                    resb = data.val & data.position;
                    data.position >>= 1;
                    if (data.position == 0) {
                      data.position = resetValue;
                      data.val = getNextValue(data.index++);
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                  }
                  dictionary[dictSize++] = f(bits);
                  c = dictSize - 1;
                  enlargeIn--;
                  break;
                case 1:
                  bits = 0;
                  maxpower = Math.pow(2, 16);
                  power = 1;
                  while (power != maxpower) {
                    resb = data.val & data.position;
                    data.position >>= 1;
                    if (data.position == 0) {
                      data.position = resetValue;
                      data.val = getNextValue(data.index++);
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                  }
                  dictionary[dictSize++] = f(bits);
                  c = dictSize - 1;
                  enlargeIn--;
                  break;
                case 2:
                  return result.join("");
              }
              if (enlargeIn == 0) {
                enlargeIn = Math.pow(2, numBits);
                numBits++;
              }
              if (dictionary[c]) {
                entry = dictionary[c];
              } else {
                if (c === dictSize) {
                  entry = w + w.charAt(0);
                } else {
                  return null;
                }
              }
              result.push(entry);
              dictionary[dictSize++] = w + entry.charAt(0);
              enlargeIn--;
              w = entry;
              if (enlargeIn == 0) {
                enlargeIn = Math.pow(2, numBits);
                numBits++;
              }
            }
          }
        };
        return LZString2;
      })();
      if (module != null) {
        module.exports = LZString;
      } else if (typeof angular !== "undefined" && angular != null) {
        angular.module("LZString", []).factory("LZString", function() {
          return LZString;
        });
      }
    })(lzString);
    return lzString.exports;
  }
  var lzStringExports = requireLzString();
  const COMPRESSION_MAGIC = String.fromCharCode(9580);
  function decodeDescription(description) {
    if (!description || !description.startsWith(COMPRESSION_MAGIC)) {
      return description;
    }
    try {
      return lzStringExports.decompressFromUTF16(description.slice(1)) || description;
    } catch {
      return description;
    }
  }
  function buildProfile(character, withAppearance) {
    if (!character.MemberNumber || character.MemberNumber <= 0) {
      return null;
    }
    let friends;
    if (character.IsPlayer() && Player.FriendNames) {
      try {
        friends = Object.fromEntries(Player.FriendNames);
      } catch {
        friends = void 0;
      }
    }
    const profile = {
      memberNumber: character.MemberNumber,
      name: character.Name,
      nickname: character.Nickname,
      accountName: character.IsPlayer() ? character.AccountName : void 0,
      isPlayer: character.IsPlayer(),
      title: character.Title,
      description: decodeDescription(character.Description),
      creation: character.Creation,
      labelColor: character.LabelColor,
      pronouns: character.GetPronouns(),
      money: character.IsPlayer() ? character.Money : void 0,
      difficulty: character.GetDifficulty(),
      // R117+ renamed the old numeric ItemPermission to AllowedInteractions
      itemPermission: character.AllowedInteractions,
      // null (not undefined) when the character is verifiably unowned, so
      // the background can record a release in the relationship history.
      ownership: character.Ownership ? sanitize(character.Ownership) : null,
      lovership: sanitize(character.Lovership),
      submissives: character.IsPlayer() ? [...Player.SubmissivesList ?? []] : void 0,
      friends,
      whitelist: character.WhiteList,
      blacklist: character.BlackList,
      reputation: sanitize(character.Reputation),
      skills: sanitize(character.Skill),
      crafting: buildCrafting(character),
      // Favorites are folded into per-item PermissionItems records since R117
      favoriteItems: Object.entries(character.PermissionItems ?? {}).filter(([, permission]) => permission?.Permission === "Favorite").map(([key]) => key),
      addons: collectAddons(character)
    };
    if (withAppearance && character.Canvas) {
      try {
        profile.appearanceImage = canvasToDataUrl(cropCanvas(character.Canvas));
      } catch {
      }
    }
    return profile;
  }
  function canvasToDataUrl(canvas) {
    if (!canvas) {
      return void 0;
    }
    const webp = canvas.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
  }
  function buildCrafting(character) {
    try {
      const source = character.IsPlayer() ? Player.Crafting : character.Crafting;
      if (!source) {
        return void 0;
      }
      const items = CraftingDecompressServerData(source).filter(Boolean);
      return items.length > 0 ? sanitize(items) : void 0;
    } catch {
      return void 0;
    }
  }
  function collectAddons(character) {
    const c = character;
    const addons = {};
    for (const key of ["LSCG", "FBC", "FBCOtherAddons", "BCX", "MPA"]) {
      if (c[key] !== void 0) {
        addons[key] = sanitize(c[key]);
      }
    }
    return Object.keys(addons).length > 0 ? addons : void 0;
  }
  function sanitize(value) {
    if (value === void 0 || value === null) {
      return void 0;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return void 0;
    }
  }
  function cropCanvas(canvas) {
    const { width, height } = canvas;
    if (width === 0 || height === 0) {
      return null;
    }
    const scratch = document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return canvas;
    }
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha !== void 0 && alpha > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX === 0 && maxY === 0) {
      return null;
    }
    const croppedWidth = maxX - minX + 1;
    const croppedHeight = maxY - minY + 1;
    const cropped = document.createElement("canvas");
    cropped.width = croppedWidth;
    cropped.height = croppedHeight;
    const croppedCtx = cropped.getContext("2d");
    if (!croppedCtx) {
      return canvas;
    }
    croppedCtx.drawImage(scratch, minX, minY, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
    return cropped;
  }
  async function runQuery(query) {
    switch (query.type) {
      case "character-data": {
        const target = ChatRoomCharacter?.find((c) => c.MemberNumber === query.memberNumber);
        if (!target) {
          return { success: false, error: `Character ${query.memberNumber} is not in the room` };
        }
        const profile = buildProfile(target, true);
        return profile ? { success: true, data: profile } : { success: false, error: `Could not build profile for ${query.memberNumber}` };
      }
      case "player-data": {
        if (!Player?.MemberNumber) {
          return { success: false, error: "Not logged in" };
        }
        return {
          success: true,
          data: {
            wardrobeNames: Player.WardrobeCharacterNames,
            crafting: Player.Crafting,
            savedColors: Player.SavedColors
          }
        };
      }
      case "player-wardrobe": {
        if (!Player?.MemberNumber) {
          return { success: false, error: "Not logged in" };
        }
        if (!Player.Wardrobe || Player.Wardrobe.length === 0) {
          return { success: false, error: "Wardrobe not loaded yet" };
        }
        try {
          WardrobeLoadCharacters(false);
        } catch {
        }
        await renderWardrobeCanvases();
        const slots = (WardrobeCharacter ?? []).map((c, index) => ({
          index,
          name: Player.WardrobeCharacterNames?.[index] ?? `Slot ${index + 1}`,
          image: c?.Canvas ? safeDataUrl(c.Canvas) : void 0
        }));
        return { success: true, data: { slots } };
      }
      case "room-roster": {
        if (!Player?.MemberNumber) {
          return { success: false, error: "Not logged in" };
        }
        if (!ChatRoomData || !ChatRoomCharacter?.length) {
          return { success: false, error: "Not in a chat room" };
        }
        const members = ChatRoomCharacter.filter(
          (c) => typeof c.MemberNumber === "number"
        ).map((c) => ({
          memberNumber: c.MemberNumber,
          name: c.Name,
          nickname: c.Nickname,
          labelColor: c.LabelColor,
          isPlayer: c.IsPlayer()
        }));
        return { success: true, data: { members } };
      }
      case "send-whisper": {
        if (!Player?.MemberNumber) {
          return { success: false, error: "Not logged in" };
        }
        if (CurrentScreen !== "ChatRoom") {
          return { success: false, error: "Your character is not in a chat room" };
        }
        if (!ChatRoomCharacter?.some((c) => c.MemberNumber === query.target)) {
          return { success: false, error: "They are not in your room" };
        }
        const result = ChatRoomSendWhisper(query.target, query.message);
        if (result === "target-gone") {
          return { success: false, error: "They just left the room" };
        }
        if (result === "target-out-of-range") {
          return { success: false, error: "They are out of whisper range" };
        }
        return { success: true, data: null };
      }
      case "send-beep": {
        if (!Player?.MemberNumber) {
          return { success: false, error: "Not logged in" };
        }
        ServerSend("AccountBeep", {
          MemberNumber: query.target,
          BeepType: "",
          IsSecret: true,
          Message: query.message
        });
        return { success: true, data: null };
      }
    }
  }
  async function renderWardrobeCanvases() {
    let quietTicks = 0;
    for (let i = 0; i < 50 && quietTicks < 3; i++) {
      let redrew = false;
      for (const character of WardrobeCharacter ?? []) {
        if (character?.MustDraw) {
          try {
            CharacterLoadCanvas(character);
            redrew = true;
          } catch {
          }
        }
      }
      quietTicks = redrew ? 0 : quietTicks + 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  function safeDataUrl(canvas) {
    try {
      return canvasToDataUrl(cropCanvas(canvas));
    } catch {
      return void 0;
    }
  }
  const SERVER_EVENTS = /* @__PURE__ */ new Set([
    "LoginResponse",
    "ChatRoomSync",
    "ChatRoomSyncSingle",
    "ChatRoomSyncCharacter",
    "ChatRoomSyncMemberJoin",
    "ChatRoomSyncMemberLeave",
    "AccountBeep",
    "AccountQueryResult"
  ]);
  const CLIENT_EVENTS = /* @__PURE__ */ new Set(["ChatRoomLeave", "AccountBeep"]);
  const APPEARANCE_SETTLE_DELAY = 1e3;
  const APPEARANCE_THROTTLE = 1e4;
  const FRIENDS_POLL_INTERVAL = 45e3;
  if (window.BCT_VERSION) {
    console.warn("[BCT] an older BC Toolbox script is still active — refresh this tab to update");
    window.postMessage(
      {
        source: PAGE_SOURCE,
        message: { kind: "mod-loaded", version: "1.1.1", build: "92494c2a66ef", stale: true }
      },
      window.location.origin
    );
  } else {
    window.BCT_VERSION = "1.1.1";
    boot();
  }
  function boot() {
    const mod = bcModSdk.registerMod({
      name: "BCToolbox",
      fullName: "BC Toolbox",
      version: "1.1.1",
      repository: "https://github.com/seles84/bc-toolbox"
    });
    const appearanceSentAt = /* @__PURE__ */ new Map();
    const appearancePending = /* @__PURE__ */ new Map();
    let socketAttached = null;
    function send(message) {
      const envelope = { source: PAGE_SOURCE, message };
      window.postMessage(envelope, window.location.origin);
    }
    function sendGameEvent(direction, event, args) {
      send({
        kind: "game-event",
        direction,
        event,
        // Almost every BC socket event carries a single payload object.
        data: sanitize2(args.length === 1 ? args[0] : args),
        timestamp: Date.now()
      });
    }
    function sanitize2(value) {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return void 0;
      }
    }
    const onServerEvent = (event, ...args) => {
      if (SERVER_EVENTS.has(event)) {
        sendGameEvent("server", event, args);
      }
    };
    const onClientEvent = (event, ...args) => {
      if (typeof event === "string" && CLIENT_EVENTS.has(event)) {
        sendGameEvent("client", event, args);
      }
    };
    function attachSocket() {
      const socket = ServerSocket;
      if (!socket || socketAttached === socket) {
        return;
      }
      socketAttached = socket;
      socket.offAny(onServerEvent);
      socket.onAny(onServerEvent);
      socket.offAnyOutgoing?.(onClientEvent);
      socket.prependAnyOutgoing?.(onClientEvent);
      console.info("[BCT] socket listeners attached");
    }
    mod.hookFunction("ServerInit", 0, (args, next) => {
      const result = next(args);
      attachSocket();
      return result;
    });
    if (typeof ServerSocket !== "undefined" && ServerSocket) {
      attachSocket();
    }
    mod.hookFunction("LoginResponse", 0, (args, next) => {
      const result = next(args);
      if (Player?.MemberNumber && Player.MemberNumber > 0) {
        const profile = buildProfile(Player, false);
        if (profile) {
          send({ kind: "session", state: "login", player: profile });
        }
      }
      return result;
    });
    if (typeof Player !== "undefined" && Player?.MemberNumber && Player.MemberNumber > 0) {
      const profile = buildProfile(Player, true);
      if (profile) {
        send({ kind: "session", state: "login", player: profile });
      }
    }
    mod.hookFunction("CommonDrawAppearanceBuild", 0, (args, next) => {
      const result = next(args);
      const character = args[0];
      const member = character?.MemberNumber;
      if (member && member > 0 && !appearancePending.has(member) && Date.now() - (appearanceSentAt.get(member) ?? 0) > APPEARANCE_THROTTLE) {
        appearancePending.set(
          member,
          setTimeout(() => {
            appearancePending.delete(member);
            const profile = buildProfile(character, true);
            if (profile?.appearanceImage) {
              appearanceSentAt.set(member, Date.now());
              send({ kind: "appearance", profile, timestamp: Date.now() });
            }
          }, APPEARANCE_SETTLE_DELAY)
        );
      }
      return result;
    });
    function pollOnlineFriends() {
      try {
        if (Player?.MemberNumber && Player.MemberNumber > 0) {
          ServerSend("AccountQuery", { Query: "OnlineFriends" });
        }
      } catch {
      }
    }
    setInterval(pollOnlineFriends, FRIENDS_POLL_INTERVAL);
    setTimeout(pollOnlineFriends, 5e3);
    mod.hookFunction("ChatRoomMessageDisplay", 100, (args, next) => {
      try {
        const [data, msg, , metadata] = args;
        if (data && typeof data.Sender === "number" && data.Type) {
          send({
            kind: "chat-line",
            line: {
              sender: data.Sender,
              senderName: metadata?.senderName,
              type: data.Type,
              content: data.Content ?? "",
              dictionary: sanitize2(data.Dictionary),
              // Plain whispers carry the target on the message itself,
              // not in the extracted metadata.
              target: metadata?.TargetMemberNumber ?? (typeof data.Target === "number" ? data.Target : void 0),
              rendered: typeof msg === "string" && msg.trim() ? msg.trim() : void 0
            },
            timestamp: Date.now()
          });
        }
      } catch (error) {
        console.warn("[BCT] chat-line capture failed", error);
      }
      return next(args);
    });
    window.addEventListener("message", (event) => {
      if (event.source !== window || !isRelayEnvelope(event.data)) {
        return;
      }
      const { message } = event.data;
      if (message.kind === "query") {
        void runQuery(message.query).catch((error) => ({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        })).then((result) => send({ kind: "query-result", id: message.id, result }));
      }
    });
    send({ kind: "mod-loaded", version: "1.1.1", build: "92494c2a66ef" });
    console.info(`[BCT] BC Toolbox v${"1.1.1"} loaded`);
  }
})();
