import { describe, expect, it } from 'vitest';
import { preloadImages, preloadedUrls } from '../src/ui/preload.js';

describe('preloadImages', () => {
  it('holt jede Adresse nur einmal und lässt leere aus', () => {
    preloadImages(['https://cdn/a.png', '', 'https://cdn/b.png']);
    preloadImages(['https://cdn/a.png']);
    expect(preloadedUrls()).toEqual(['https://cdn/a.png', 'https://cdn/b.png']);
  });

  it('hält höchstens vierzig Bilder und lässt die ältesten los', () => {
    preloadImages(Array.from({ length: 50 }, (_, i) => `https://cdn/p${i}.png`));
    const urls = preloadedUrls();
    expect(urls).toHaveLength(40);
    expect(urls).not.toContain('https://cdn/a.png');
    expect(urls.at(-1)).toBe('https://cdn/p49.png');
  });
});
