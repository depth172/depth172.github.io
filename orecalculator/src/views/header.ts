import type { Monster } from '../core/types.ts';
import { renderAuth } from './auth.ts';
import { STARS, esc } from './common.ts';

export function renderHeader(m: Monster): string {
  return `
	<header>
		<div class="header-content">
			<h1>Orecalculator</h1>
			<div class="auth-status">
				${renderAuth()}
			</div>
		</div>
		<div class="monster-info">
			<div class="monster-name">${esc(m.name)}</div>
			<div class="monster-class">${STARS(m.reels.length)}</div>
		</div>
	</header>`;
}
