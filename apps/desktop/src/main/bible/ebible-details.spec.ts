import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  COPYRIGHT_PAGE,
  parseEbibleCopyrightPage,
  readSuggestedDetails,
} from './ebible-details';

/** A made-up page in the layout of an eBible.org download's copr.htm. */
function page({
  lang = 'tl',
  title = 'Halimbawang Bibliya',
  href = 'https://ebible.org/tgl-sample',
  copyright = '&copy; 2020 Sample Translators',
  terms = `<p>This translation is made available to you under the terms of the
<a href='http://creativecommons.org/licenses/by-sa/4.0/'>Creative Commons Attribution Share-Alike license 4.0.</a></p>`,
} = {}): string {
  // eBible.org's pages start with a byte-order mark.
  return `\uFEFF<!DOCTYPE html>
<html lang="${lang}">
<head><title>${title}  </title></head>
<body>
<div class="main">
<div class="toc"><a href="${href}">${title}</a></div></br>
<h1>${title}</h1>
<p>Language: Tagalog<br /></p>
${terms}
<p>You have permission to share it.</p>
<div class="copyright">
<center><a href="webfaq.htm">Questions</a></center>
<p align="center"><a href='copyright.htm'>${copyright}</a></p>
</div>
</div></body></html>`;
}

describe('parseEbibleCopyrightPage', () => {
  it('reads every detail from a Creative Commons translation', () => {
    expect(parseEbibleCopyrightPage(page())).toEqual({
      code: 'TGLSAMPLE',
      name: 'Halimbawang Bibliya',
      languageCode: 'tl',
      licence:
        '© 2020 Sample Translators\nThis translation is made available to you under the terms of the Creative Commons Attribution Share-Alike license 4.0. http://creativecommons.org/licenses/by-sa/4.0/',
      attribution: 'Halimbawang Bibliya (© 2020 Sample Translators)',
      sourceUrl: 'https://ebible.org/tgl-sample',
    });
  });

  it('reads a public-domain translation, which states no licence terms', () => {
    expect(
      parseEbibleCopyrightPage(
        page({
          lang: 'en',
          title: 'Sample English Bible',
          href: 'https://ebible.org/eng-sample',
          copyright: 'Public Domain',
          terms: '',
        }),
      ),
    ).toMatchObject({
      code: 'ENGSAMPLE',
      languageCode: 'en',
      licence: 'Public Domain',
      attribution: 'Sample English Bible (Public Domain)',
    });
  });

  it('leaves out each detail that would not be valid for the server', () => {
    const suggestion = parseEbibleCopyrightPage(
      page({
        lang: 'English',
        href: 'https://ebible.org/a-very-long-identifier',
        title: 'x'.repeat(121),
      }),
    );
    expect(suggestion).not.toHaveProperty('languageCode');
    expect(suggestion).not.toHaveProperty('code');
    expect(suggestion).not.toHaveProperty('name');
    expect(suggestion).not.toHaveProperty('attribution');
  });

  it('suggests no code for an address outside eBible.org', () => {
    const suggestion = parseEbibleCopyrightPage(
      page({ href: 'https://example.org/tgl-sample' }),
    );
    expect(suggestion).not.toHaveProperty('code');
    expect(suggestion.sourceUrl).toBe('https://example.org/tgl-sample');
  });

  it('takes text only, never markup', () => {
    const suggestion = parseEbibleCopyrightPage(
      page({ title: 'Bible <img src=x onerror=alert(1)> &amp; Co' }),
    );
    expect(suggestion.name).toBe('Bible & Co');
  });

  it('suggests nothing from a page in another layout', () => {
    expect(parseEbibleCopyrightPage('<p>Copyright notice</p>')).toEqual({});
  });
});

describe('readSuggestedDetails', () => {
  it('suggests nothing for a folder without a copyright page', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pakita-ebible-'));
    await expect(readSuggestedDetails(directory)).resolves.toEqual({});
  });

  it('reads the folder’s copyright page', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pakita-ebible-'));
    writeFileSync(join(directory, COPYRIGHT_PAGE), page());
    await expect(readSuggestedDetails(directory)).resolves.toMatchObject({
      code: 'TGLSAMPLE',
    });
  });

  it('does not follow a link in place of the page', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pakita-ebible-'));
    const elsewhere = join(directory, 'elsewhere.htm');
    writeFileSync(elsewhere, page());
    symlinkSync(elsewhere, join(directory, COPYRIGHT_PAGE));
    await expect(readSuggestedDetails(directory)).resolves.toEqual({});
  });

  it('ignores a page too large to be a copyright page', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pakita-ebible-'));
    writeFileSync(
      join(directory, COPYRIGHT_PAGE),
      page() + ' '.repeat(600 * 1024),
    );
    await expect(readSuggestedDetails(directory)).resolves.toEqual({});
  });
});
