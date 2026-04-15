import fs from 'node:fs/promises';

const file = 'C:/Users/regan/Downloads/afrospice/frontend/src/components/pages/global.css';
let css = (await fs.readFile(file, 'utf8')).replace(/\r\n/g, '\n');

function replaceExact(oldValue, newValue, label) {
  if (!css.includes(oldValue)) {
    throw new Error(`Missing expected block: ${label}`);
  }
  css = css.replace(oldValue, newValue);
}

replaceExact(`.hero-stat-card span,\n.dashboard-rail-label,\n.owner-copilot-answer-label {`, `.hero-stat-card span,\n.dashboard-rail-label {`, 'owner-copilot label selector');
replaceExact(`.owner-copilot-summary,\n.owner-copilot-answer-shell,\n.dashboard-focus-rail,\n.dashboard-activity-list,\n.dashboard-risk-list {`, `.dashboard-focus-rail,\n.dashboard-activity-list,\n.dashboard-risk-list {`, 'owner-copilot summary selector group');
replaceExact(`.owner-copilot-fact,\n.dashboard-rail-card,\n.dashboard-focus-card,\n.owner-copilot-answer-card {`, `.dashboard-rail-card,\n.dashboard-focus-card {`, 'owner-copilot fact card group');
replaceExact(`.owner-copilot-fact strong,\n.dashboard-focus-card strong,\n.dashboard-rail-card strong {`, `.dashboard-focus-card strong,\n.dashboard-rail-card strong {`, 'owner-copilot strong group');
replaceExact(`.owner-copilot-action,\n.dashboard-risk-row,\n.dashboard-activity-item {`, `.dashboard-risk-row,\n.dashboard-activity-item {`, 'owner-copilot action group');
replaceExact(`.owner-copilot-action p,\n.owner-copilot-answer-card p,\n.dashboard-rail-card p,\n.dashboard-focus-card p,\n.dashboard-activity-item p,\n.dashboard-risk-row small {`, `.dashboard-rail-card p,\n.dashboard-focus-card p,\n.dashboard-activity-item p,\n.dashboard-risk-row small {`, 'owner-copilot paragraph group');
replaceExact(`@media (max-width: 1480px) {\n  .inventory-brief-row,\n  .owner-copilot-facts,\n  .dashboard-focus-grid {`, `@media (max-width: 1480px) {\n  .inventory-brief-row,\n  .dashboard-focus-grid {`, 'owner-copilot media 1480');
replaceExact(`@media (max-width: 1280px) {\n  .command-hero,\n  .owner-copilot-grid,\n  .dashboard-command-grid,\n  .dashboard-performance-grid,\n  .inventory-page-premium .inventory-workbench-grid {`, `@media (max-width: 1280px) {\n  .command-hero,\n  .dashboard-command-grid,\n  .dashboard-performance-grid,\n  .inventory-page-premium .inventory-workbench-grid {`, 'owner-copilot media 1280');
replaceExact(`@media (max-width: 980px) {\n  .inventory-brief-row,\n  .hero-stat-grid,\n  .owner-copilot-facts,\n  .dashboard-focus-grid {`, `@media (max-width: 980px) {\n  .inventory-brief-row,\n  .hero-stat-grid,\n  .dashboard-focus-grid {`, 'owner-copilot media 980');
replaceExact(`@media (max-width: 760px) {\n  .command-hero,\n  .owner-copilot-panel,\n  .dashboard-performance-panel,\n  .dashboard-activity-panel,\n  .inventory-page-premium .inventory-reorder-panel,\n  .inventory-page-premium .inventory-command-panel {`, `@media (max-width: 760px) {\n  .command-hero,\n  .dashboard-performance-panel,\n  .dashboard-activity-panel,\n  .inventory-page-premium .inventory-reorder-panel,\n  .inventory-page-premium .inventory-command-panel {`, 'owner-copilot media 760');

css = css.replace(/\.owner-copilot-panel \{[\s\S]*?\.dashboard-command-grid \{/m, '.dashboard-command-grid {');
css = css.replace(/\.decision-briefing-panel \{[\s\S]*?\.owner-assistant-launcher \{/m, '.owner-assistant-launcher {');

replaceExact(`.app-shell.dark .reports-signal-card,\n.app-shell.dark .decision-briefing-card,\n.app-shell.dark .decision-briefing-answer-card,\n.app-shell.dark .decision-briefing-disclosure,\n.app-shell.dark .decision-briefing-fact,\n.app-shell.dark .decision-briefing-action,\n.app-shell.dark .inventory-brief-card,`, `.app-shell.dark .reports-signal-card,\n.app-shell.dark .inventory-brief-card,`, 'dark decision briefing top block');
replaceExact(`.app-shell.dark .decision-briefing-card span,\n.app-shell.dark .decision-briefing-answer-label,\n.app-shell.dark .owner-assistant-overline,`, `.app-shell.dark .owner-assistant-overline,`, 'dark decision briefing overline group');
replaceExact(`.app-shell.dark .decision-briefing-card p,\n.app-shell.dark .decision-briefing-answer-card p,\n.app-shell.dark .decision-briefing-disclosure p,\n.app-shell.dark .decision-briefing-action p,\n.app-shell.dark .dashboard-studio-metric-card small,`, `.app-shell.dark .dashboard-studio-metric-card small,`, 'dark decision briefing paragraph group');
replaceExact(`.app-shell.dark .decision-briefing-fact span,\n.app-shell.dark .decision-briefing-action > span,\n.app-shell.dark .dashboard-studio-metric-card span,`, `.app-shell.dark .dashboard-studio-metric-card span,`, 'dark decision briefing span group');
replaceExact(`.app-shell.dark .decision-briefing-fact strong,\n.app-shell.dark .decision-briefing-answer-card strong,\n.app-shell.dark .decision-briefing-action strong,\n.app-shell.dark .dashboard-studio-metric-card strong,`, `.app-shell.dark .dashboard-studio-metric-card strong,`, 'dark decision briefing strong group');
css = css.replace(/\.app-shell\.dark \.decision-briefing-action > span \{[\s\S]*?\n\}/m, '');

if (/owner-copilot|decision-briefing/.test(css)) {
  throw new Error('Legacy AI selectors still remain in global.css');
}

await fs.writeFile(file, css);
console.log('cleaned global.css');
