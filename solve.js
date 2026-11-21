// A fast drop-in for csv-reader 1.0.0.
//
// run(input) reads one CSV input {text, header} and answers {columns, rows, errors},
// exactly as make.fun's own csv-reader 1.0.0 does. The reading policy, as the
// competition states it:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, and each CRLF or lone CR inside it reads as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends);
//   - a quote that never closes is a literal character, and the text after it is
//     read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it, each padded with "" (short_row, with fields: its count)
//     or cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met, a record's short_row or
//     long_row when it ends: line the 1-based line its record starts on, counting
//     every LF, CRLF and lone CR inside quotes, and row its record's index in rows,
//     null for the header.
//
// How it is fast: the text is swept once, left to right, and a plain field is
// taken out of the text with one slice when its terminator is found, instead of
// being built up a character at a time. A quoted field is likewise one slice
// when it holds no doubled quote and no line break inside. Only the rare broken
// shapes -- a stray CR, a doubled quote, a line break inside quotes, characters
// after a closing quote, a quote that never closes -- go through the careful
// readers at the bottom, which walk those fields a character at a time.

const COMMA = 44; // ','
const LF = 10; // '\n'
const CR = 13; // '\r'
const QUOTE = 34; // '"'
const BOM = 0xfeff;

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text. */
const AT_COMMA = 0;
const AT_BREAK = 1;
const AT_END = 2;

/**
 * Reads an unquoted field that starts at `start`, with `prefix` already kept.
 * Updates nothing but the returned positions: {value, ended, added, pos, line}.
 * `added` counts the characters this read kept, not the prefix. A lone CR is
 * dropped and reported; a quote inside is an ordinary character.
 */
function readUnquoted(text, start, prefix, line, recordLine, recordRow, errors) {
  const n = text.length;
  let value = prefix;
  let added = 0;
  let p = start;
  let seg = start; // start of the run of characters not yet moved into value
  for (;;) {
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === COMMA) {
        value += text.slice(seg, p);
        added += p - seg;
        return { value, ended: AT_COMMA, added, pos: p + 1, line };
      }
      if (c === LF) {
        value += text.slice(seg, p);
        added += p - seg;
        return { value, ended: AT_BREAK, added, pos: p + 1, line: line + 1 };
      }
      if (c === CR) {
        if (text.charCodeAt(p + 1) === LF) {
          value += text.slice(seg, p);
          added += p - seg;
          return { value, ended: AT_BREAK, added, pos: p + 2, line: line + 1 };
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        value += text.slice(seg, p);
        added += p - seg;
        p += 1;
        seg = p;
        continue;
      }
      p += 1;
    }
    value += text.slice(seg, n);
    added += n - seg;
    return { value, ended: AT_END, added, pos: n, line };
  }
}

/**
 * Reads a quoted field whose opening quote is at `open`, the careful way: one
 * character at a time, so doubled quotes, line breaks inside the quotes and
 * characters after the closing quote are all handled. Returns
 * {value, ended, pos, line}. A quote that never closes is a literal character
 * and the text after it is read again as unquoted.
 */
function readQuotedSlow(text, open, openLine, recordLine, recordRow, errors) {
  const n = text.length;
  let value = '';
  let p = open + 1;
  let ln = openLine;
  let closed = false;
  while (p < n) {
    const c = text.charCodeAt(p);
    if (c === QUOTE) {
      if (text.charCodeAt(p + 1) === QUOTE) {
        value += '"';
        p += 2;
        continue;
      }
      p += 1;
      closed = true;
      break;
    }
    if (c === CR) {
      // CRLF and a lone CR inside quotes are each one LF.
      value += '\n';
      ln += 1;
      p += text.charCodeAt(p + 1) === LF ? 2 : 1;
      continue;
    }
    if (c === LF) ln += 1;
    value += text[p];
    p += 1;
  }
  if (!closed) {
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    return readUnquoted(text, open + 1, '"', openLine, recordLine, recordRow, errors);
  }
  if (p >= n) return { value, ended: AT_END, pos: n, line: ln };
  const c = text.charCodeAt(p);
  if (c === COMMA) return { value, ended: AT_COMMA, pos: p + 1, line: ln };
  if (c === LF) return { value, ended: AT_BREAK, pos: p + 1, line: ln + 1 };
  if (c === CR && text.charCodeAt(p + 1) === LF) {
    return { value, ended: AT_BREAK, pos: p + 2, line: ln + 1 };
  }
  // What follows the closing quote is appended as it stands.
  const rest = readUnquoted(text, p, value, ln, recordLine, recordRow, errors);
  if (rest.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  return rest;
}

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === BOM) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;

  while (pos < n) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended = AT_COMMA;
    let lastQuoted = false;

    do {
      let value;
      if (text.charCodeAt(pos) === QUOTE) {
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        // The closing quote: a quote doubled with the next one is a literal
        // quote inside the field, not a close.
        let q = text.indexOf('"', open + 1);
        let doubled = false;
        while (q !== -1 && text.charCodeAt(q + 1) === QUOTE) {
          doubled = true;
          q = text.indexOf('"', q + 2);
        }
        if (q === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const rest = readUnquoted(text, open + 1, '"', openLine, recordLine, recordRow, errors);
          value = rest.value;
          ended = rest.ended;
          pos = rest.pos;
          line = rest.line;
        } else if (doubled) {
          const slow = readQuotedSlow(text, open, openLine, recordLine, recordRow, errors);
          value = slow.value;
          ended = slow.ended;
          pos = slow.pos;
          line = slow.line;
        } else {
          const span = text.slice(open + 1, q);
          if (span.indexOf('\n') === -1 && span.indexOf('\r') === -1) {
            // No line break inside the quotes: the field is the span itself.
            value = span;
            if (q + 1 >= n) {
              pos = n;
              ended = AT_END;
            } else {
              const after = text.charCodeAt(q + 1);
              if (after === COMMA) {
                pos = q + 2;
                ended = AT_COMMA;
              } else if (after === LF) {
                pos = q + 2;
                line += 1;
                ended = AT_BREAK;
              } else if (after === CR && text.charCodeAt(q + 2) === LF) {
                pos = q + 3;
                line += 1;
                ended = AT_BREAK;
              } else {
                // Characters after the closing quote, appended as they stand.
                const rest = readUnquoted(text, q + 1, value, line, recordLine, recordRow, errors);
                if (rest.added > 0) {
                  errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
                }
                value = rest.value;
                ended = rest.ended;
                pos = rest.pos;
                line = rest.line;
              }
            }
          } else {
            // A line break inside the quotes: the careful reader normalises
            // each CRLF or lone CR to LF and counts the lines.
            const slow = readQuotedSlow(text, open, openLine, recordLine, recordRow, errors);
            value = slow.value;
            ended = slow.ended;
            pos = slow.pos;
            line = slow.line;
          }
        }
      } else {
        lastQuoted = false;
        // An unquoted field: sweep to its terminator, then take it out with
        // one slice. A lone CR is the only thing that splits it: the run
        // before it is kept, the CR is dropped and reported, and the sweep
        // carries on from after it.
        let i = pos;
        let built = null;
        let part = pos;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === COMMA) {
            value = built === null ? text.slice(part, i) : built + text.slice(part, i);
            pos = i + 1;
            ended = AT_COMMA;
            break;
          }
          if (c === LF) {
            value = built === null ? text.slice(part, i) : built + text.slice(part, i);
            pos = i + 1;
            line += 1;
            ended = AT_BREAK;
            break;
          }
          if (c === CR) {
            if (text.charCodeAt(i + 1) === LF) {
              value = built === null ? text.slice(part, i) : built + text.slice(part, i);
              pos = i + 2;
              line += 1;
              ended = AT_BREAK;
              break;
            }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            built = built === null ? text.slice(part, i) : built + text.slice(part, i);
            i += 1;
            part = i;
            continue;
          }
          i += 1;
        }
        if (value === undefined) {
          value = built === null ? text.slice(part, n) : built + text.slice(part, n);
          pos = n;
          ended = AT_END;
        }
      }
      fields.push(value);
    } while (ended === AT_COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
