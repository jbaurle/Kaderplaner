import { describe, expect, it } from 'vitest';
import { renderFormationHelpBody, renderHelpModal } from '../src/ui/help.js';

describe('renderFormationHelpBody', () => {
  it('reports each tied formation with its own shortfall', () => {
    // Realer Fall: 3 Ausfälle, damit bleiben 1 TW, 7 ABW, 3 MF, 1 ANG.
    // 5-3-2 fehlt genau ein Stürmer, 5-4-1 genau ein Mittelfeldspieler.
    // Beide liegen bei Lücke 1, haben aber verschiedene Lücken.
    const body = renderFormationHelpBody({
      available: { TW: 1, ABW: 7, MF: 3, ANG: 1 },
      unavailable: ['Chabot', 'Ryerson', 'Zimmerschied'],
    });

    expect(body).toContain('TW 1 · ABW 7 · MF 3 · ANG 1');
    expect(body).toContain('<strong>5-3-2</strong>: 1 ANG fehlt');
    expect(body).toContain('<strong>5-4-1</strong>: 1 MF fehlt');
    expect(body).toContain('Chabot, Ryerson, Zimmerschied');
  });

  it('collapses to one line when every formation misses the same thing', () => {
    const body = renderFormationHelpBody({
      available: { TW: 0, ABW: 9, MF: 9, ANG: 9 },
      unavailable: [],
    });
    expect(body).toContain('Alle zehn Formationen: 1 TW fehlt');
    expect(body).not.toContain('<strong>4-4-2</strong>');
  });

  it('joins several missing positions with und', () => {
    const body = renderFormationHelpBody({
      available: { TW: 0, ABW: 0, MF: 9, ANG: 9 },
      unavailable: [],
    });
    expect(body).toMatch(/1 TW und 3 ABW fehlen/);
  });

  it('omits the shortfall paragraph when every formation fits', () => {
    const body = renderFormationHelpBody({
      available: { TW: 9, ABW: 9, MF: 9, ANG: 9 },
      unavailable: [],
    });
    expect(body).not.toContain('Am nächsten dran');
  });
});

describe('renderHelpModal', () => {
  it('escapes the title and keeps the body markup', () => {
    const html = renderHelpModal('A & B', '<p>Text</p>');
    expect(html).toContain('aria-label="A &amp; B"');
    expect(html).toContain('<p>Text</p>');
    expect(html).toContain('data-dialog-close');
  });
});

