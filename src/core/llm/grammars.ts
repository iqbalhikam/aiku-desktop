/**
 * GBNF Grammar untuk mengunci output llama.cpp agar HANYA menghasilkan JSON valid
 * dengan enum aksi: "MOVE" | "RENAME" | "SKIP".
 * Aksi "DELETE" secara struktural mustahil dihasilkan oleh model.
 */
export function buildFileSuggestionGbnfGrammar(categories: readonly string[]): string {
  const escapedCategories = categories
    .map((cat) => cat.replace(/["\\]/g, ""))
    .filter((cat) => cat.length > 0);

  const categoryAlternatives =
    escapedCategories.length > 0
      ? escapedCategories.map((cat) => `"\\"${cat}\\""`).join(" | ") + ' | "null"'
      : 'string | "null"';

  return String.raw`
root ::= "{" ws "\"action\"" ws ":" ws action "," ws "\"category\"" ws ":" ws category "," ws "\"suggestedFileName\"" ws ":" ws nullable-filename "," ws "\"reason\"" ws ":" ws string ws "}"

action ::= "\"MOVE\"" | "\"RENAME\"" | "\"SKIP\""
category ::= ${categoryAlternatives}
nullable-filename ::= filename-string | "null"

filename-string ::= "\"" [a-zA-Z0-9._-]{1,120} "\""
string ::= "\"" ( [^"\\\x00-\x1f] | "\\" (["\\/bfnrt]) ){1,220} "\""
ws ::= [ \t\n\r]*
`.trim();
}

/**
 * GBNF Grammar untuk menerjemahkan kueri bahasa natural menjadi SearchFilter JSON terstruktur.
 */
export const SEARCH_FILTER_GBNF_GRAMMAR = String.raw`
root ::= "{" ws "\"extension\"" ws ":" ws nullable-ext "," ws "\"keywords\"" ws ":" ws string-array "," ws "\"dateRange\"" ws ":" ws date-range ws "}"

nullable-ext ::= "\"" "."? [a-zA-Z0-9]{1,10} "\"" | "null"
string-array ::= "[" ws ( string ( ws "," ws string ){0,7} )? ws "]"
date-range ::= "{" ws "\"from\"" ws ":" ws nullable-date "," ws "\"to\"" ws ":" ws nullable-date ws "}"
nullable-date ::= "\"" [0-9]{4} "-" [0-9]{2} "-" [0-9]{2} "\"" | "null"
string ::= "\"" ( [^"\\\x00-\x1f] | "\\" (["\\/bfnrt]) ){1,48} "\""
ws ::= [ \t\n\r]*
`.trim();
