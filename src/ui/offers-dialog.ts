/**
 * Der Gebotsdialog. Geht auf, wenn man in der Erlös-Spalte auf einen grünen
 * Betrag tippt, und zeigt, woher der kommt.
 *
 * Aufbau von oben nach unten: die eine Zahl, mit der die Ansicht rechnet, dann
 * die Gebote mit Managerbild, zuletzt die Herleitung. Wer nur wissen will, was
 * der Verkauf bringt, liest die erste Zeile und ist fertig.
 *
 * Reiner Renderer. Öffnen und Schliessen steuert `planning-page.ts`.
 */

import type { MarketOffer } from '../api/types.js';
import { escapeHtml, formatEur, formatSignedEur, managerImageUrl } from './format.js';

export interface OffersDialogInput {
  playerName: string;
  /** Marktwert laut Kickbase. */
  marketValue: number;
  /** "G/V seit Kauf" laut Kickbase. */
  mvgl: number;
  /**
   * Der Preis, den man beim Einstellen aufgerufen hat. Gleicht er dem
   * Marktwert, hat man keinen gesetzt und die Zeile fällt weg.
   */
  askingPrice: number;
  /** Alle Gebote auf den Spieler, ungeordnet. Das eigene fliegt hier raus. */
  offers: readonly MarketOffer[];
}

export const OFFERS_DIALOG_TITLE = 'Gebote';

/**
 * Der Inhalt des Dialogs. Leer, wenn kein fremdes Gebot vorliegt: dann öffnet
 * die Tabelle ihn gar nicht erst.
 */
export function renderOffersBody(input: OffersDialogInput): string {
  const offers = [...input.offers]
    .filter((offer) => !offer.isMine)
    .sort((a, b) => b.amount - a.amount);
  if (offers.length === 0) return '';

  const top = offers[0]?.amount ?? 0;
  // Kaufpreis steckt schon in den beiden Kickbase-Zahlen.
  const purchase = input.marketValue - input.mvgl;
  const overMarket = top - input.marketValue;

  return `
    <div class="offers-hero">
      <div class="offers-hero-label">Damit rechnen wir</div>
      <div class="offers-hero-amount">${escapeHtml(formatEur(top))}</div>
      <div class="offers-hero-sub${overMarket < 0 ? ' offers-hero-sub--neg' : ''}">
        ${escapeHtml(formatSignedEur(overMarket))} gegenüber dem Marktwert
      </div>
    </div>
    <ul class="offers-list">
      ${offers.map((offer, index) => renderOffer(offer, index === 0, top, input.marketValue)).join('')}
    </ul>
    <dl class="offers-facts">
      ${factRow('Marktwert', formatEur(input.marketValue))}
      ${factRow('G/V laut Kickbase', formatSignedEur(input.mvgl), input.mvgl)}
      ${
        input.askingPrice > 0 && input.askingPrice !== input.marketValue
          ? factRow('Dein aufgerufener Preis', formatEur(input.askingPrice))
          : ''
      }
      ${factRow('Kaufpreis', formatEur(purchase))}
      ${factRow(
        'G/V beim Verkauf zum höchsten Gebot',
        formatSignedEur(top - purchase),
        top - purchase,
      )}
    </dl>
  `;
}

function renderOffer(
  offer: MarketOffer,
  isTop: boolean,
  top: number,
  marketValue: number,
): string {
  const behind = top - offer.amount;
  const note = isTop
    ? 'höchstes Gebot'
    : `${formatEur(behind)} weniger als das höchste Gebot`;
  return `
    <li class="offers-item${isTop ? ' offers-item--top' : ''}">
      ${renderAvatar(offer)}
      <span class="offers-who">
        <span class="offers-name">${escapeHtml(offer.userName || 'Unbekannt')}</span>
        <span class="offers-note">${escapeHtml(note)}</span>
      </span>
      <span class="offers-money">
        <span class="offers-amount">${escapeHtml(formatEur(offer.amount))}</span>
        <span class="offers-diff ${signColorClass(offer.amount - marketValue)}">${escapeHtml(formatSignedEur(offer.amount - marketValue))} zum Marktwert</span>
      </span>
    </li>
  `;
}

/**
 * Bild des Managers, ersatzweise seine Initialen. Nicht jeder hat eins, und
 * das CDN antwortet dann mit 403: dasselbe Verhalten wie beim Vereinswappen,
 * nur dass hier etwas an seiner Stelle stehen soll.
 */
function renderAvatar(offer: MarketOffer): string {
  const initials = escapeHtml(initialsOf(offer.userName));
  if (!offer.imagePath) return `<span class="offers-avatar">${initials}</span>`;
  return `
    <span class="offers-avatar">
      ${initials}
      <img src="${escapeHtml(managerImageUrl(offer.imagePath))}" alt=""
           width="34" height="34" loading="lazy" decoding="async"
           onerror="this.remove()">
    </span>
  `;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.slice(0, 2).map((part) => part[0] ?? '');
  return letters.join('').toUpperCase();
}

/**
 * Eine Zeile der Herleitung. `signOf` färbt den Wert grün oder rot, wie in der
 * G/V-Spalte der Tabelle. Fehlt er, bleibt der Betrag schwarz: Marktwert und
 * Kaufpreis sind keine Gewinne.
 */
function factRow(label: string, value: string, signOf?: number): string {
  const cls = signOf === undefined ? '' : ` class="${signColorClass(signOf)}"`;
  return `
    <div class="offers-fact">
      <dt>${escapeHtml(label)}</dt>
      <dd${cls}>${escapeHtml(value)}</dd>
    </div>
  `;
}

function signColorClass(value: number): string {
  if (value > 0) return 'num--pos';
  if (value < 0) return 'num--neg';
  return '';
}
