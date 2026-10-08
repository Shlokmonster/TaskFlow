'use strict';

/** Escape user input before it is embedded in a RegExp. */
const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive partial match, for `?search=` filters. */
const like = (value) => new RegExp(escapeRegex(value), 'i');

/** Wrap a list of field names into a `$or` of case-insensitive matches. */
const searchOr = (value, fields) => fields.map((field) => ({ [field]: like(value) }));

module.exports = { escapeRegex, like, searchOr };
