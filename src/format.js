// "1 call", "2 calls".
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
