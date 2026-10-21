/** Lowercase `#slug` with runs of anything but letters, digits and `_` folded to `_`; `''` if nothing is left. */
export function tagSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}_]+/gu, '_')
    .replaceAll(/^_+|_+$/g, '');

  return slug === '' ? '' : `#${slug}`;
}

/** Epoch seconds at UTC midnight of a `YYYY-MM-DD` date. */
export function epochDay(date: string): number | undefined {
  const parsed = Date.parse(`${date}T00:00:00Z`);

  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
}
