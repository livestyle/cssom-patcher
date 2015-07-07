'use strict';

/**
 * Splits given string by given separator with respect of
 * quoted substrings
 * @param  {String} str
 * @param  {String} sep
 * @return {Array}
 */
module.exports = function(str, sep) {
	var parts = [], start = 0, ch;
	for (var i = 0, il = str.length; i < il; i++) {
		ch = str[i];
		switch (ch) {
			case '\\': // skip escaped character
				i++;
				break;

			case '"': // skip quoted substring
			case "'":
				while (++i < il) {
					if (str[i] === '\\') {
						continue;
					}

					if (str[i] === ch) {
						break;
					}
				}
				break;

			case sep:
				parts.push(str.substring(start, i));
				start = i + 1;
				break;
		}
	}

	parts.push(str.substring(start));
	return parts;
};