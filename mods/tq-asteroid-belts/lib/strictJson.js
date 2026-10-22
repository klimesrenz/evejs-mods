"use strict";

function parseJsonRejectDuplicateKeys(text) {
  if (typeof text !== "string") throw new TypeError("JSON input must be a string");
  let offset = 0;

  function fail(message) {
    throw new SyntaxError(`${message} at offset ${offset}`);
  }

  function skipWhitespace() {
    while (offset < text.length && /[\t\n\r ]/.test(text[offset])) offset += 1;
  }

  function parseString() {
    if (text[offset] !== '"') fail("expected JSON string");
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      const character = text[offset];
      if (character === '"') {
        offset += 1;
        const token = text.slice(start, offset);
        try {
          return JSON.parse(token);
        } catch (error) {
          fail(`invalid JSON string: ${error.message}`);
        }
      }
      if (character === "\\") {
        offset += 1;
        if (offset >= text.length) fail("unterminated JSON escape");
        if (text[offset] === "u") {
          const digits = text.slice(offset + 1, offset + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(digits)) fail("invalid JSON unicode escape");
          offset += 5;
          continue;
        }
        if (!/["\\/bfnrt]/.test(text[offset])) fail("invalid JSON escape");
        offset += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) fail("unescaped control character in JSON string");
      offset += 1;
    }
    fail("unterminated JSON string");
  }

  function parseNumber() {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(offset));
    if (!match) fail("invalid JSON number");
    offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail("JSON number is not finite");
    return value;
  }

  function parseLiteral(literal, value) {
    if (!text.startsWith(literal, offset)) fail(`expected ${literal}`);
    offset += literal.length;
    return value;
  }

  function parseArray() {
    const values = [];
    offset += 1;
    skipWhitespace();
    if (text[offset] === "]") {
      offset += 1;
      return values;
    }
    while (true) {
      values.push(parseValue());
      skipWhitespace();
      if (text[offset] === "]") {
        offset += 1;
        return values;
      }
      if (text[offset] !== ",") fail("expected ',' or ']' in JSON array");
      offset += 1;
      skipWhitespace();
    }
  }

  function parseObject() {
    const value = Object.create(null);
    const keys = new Set();
    offset += 1;
    skipWhitespace();
    if (text[offset] === "}") {
      offset += 1;
      return value;
    }
    while (true) {
      const key = parseString();
      if (keys.has(key)) throw new SyntaxError(`duplicate JSON key '${key}' at offset ${offset}`);
      keys.add(key);
      skipWhitespace();
      if (text[offset] !== ":") fail("expected ':' after JSON object key");
      offset += 1;
      const entry = parseValue();
      Object.defineProperty(value, key, {
        value: entry,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      skipWhitespace();
      if (text[offset] === "}") {
        offset += 1;
        return value;
      }
      if (text[offset] !== ",") fail("expected ',' or '}' in JSON object");
      offset += 1;
      skipWhitespace();
    }
  }

  function parseValue() {
    skipWhitespace();
    const character = text[offset];
    if (character === '"') return parseString();
    if (character === "{") return parseObject();
    if (character === "[") return parseArray();
    if (character === "t") return parseLiteral("true", true);
    if (character === "f") return parseLiteral("false", false);
    if (character === "n") return parseLiteral("null", null);
    if (character === "-" || /[0-9]/.test(character || "")) return parseNumber();
    fail("unexpected JSON token");
  }

  const value = parseValue();
  skipWhitespace();
  if (offset !== text.length) fail("unexpected content after JSON value");
  return value;
}

module.exports = { parseJsonRejectDuplicateKeys };
