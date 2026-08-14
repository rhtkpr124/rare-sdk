import onlyParse from './only-parse-unknown.js';
import preferIsAddressEqual from './prefer-is-address-equal.js';

export default {
  rules: {
    ...onlyParse.rules,
    ...preferIsAddressEqual.rules,
  },
};
