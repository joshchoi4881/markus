#!/usr/bin/env node
/**
 * Lists all available content pipeline templates.
 *
 * Usage:
 *   node list-templates.js
 *   node list-templates.js --json       # output raw JSON
 *   node list-templates.js --slug <s>   # show details for one template
 */

const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.resolve(path.dirname(path.resolve(process.argv[1])), '..');
const TEMPLATES_DIR = path.join(SKILL_DIR, 'templates');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const slugIndex = args.indexOf('--slug');
const targetSlug = slugIndex >= 0 ? args[slugIndex + 1] : null;

function loadTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR)
    .filter(f => {
      const templateJson = path.join(TEMPLATES_DIR, f, 'template.json');
      return fs.statSync(path.join(TEMPLATES_DIR, f)).isDirectory() && fs.existsSync(templateJson);
    })
    .map(slug => {
      try {
        return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, slug, 'template.json'), 'utf-8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function difficultyColor(difficulty) {
  switch (difficulty) {
    case 'beginner': return '\x1b[32m';     // green
    case 'intermediate': return '\x1b[33m'; // yellow
    case 'advanced': return '\x1b[31m';     // red
    default: return '\x1b[0m';
  }
}
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const templates = loadTemplates();

if (jsonMode) {
  console.log(JSON.stringify(templates, null, 2));
  process.exit(0);
}

if (targetSlug) {
  const t = templates.find(t => t.slug === targetSlug);
  if (!t) {
    console.error(`Template not found: ${targetSlug}`);
    console.error(`Run 'node list-templates.js' to see all available templates.`);
    process.exit(1);
  }
  console.log(`\n${BOLD}${t.name}${RESET} ${DIM}(${t.slug})${RESET}`);
  console.log(`${t.description}\n`);
  console.log(`Category:   ${t.category}`);
  console.log(`Difficulty: ${difficultyColor(t.difficulty)}${t.difficulty}${RESET}`);
  console.log(`Platforms:  ${t.platforms.join(', ')}`);
  console.log(`\n${BOLD}Required Env Vars:${RESET}`);
  t.requiredEnvVars.forEach(v => console.log(`  • ${v}`));
  if (t.optionalEnvVars && t.optionalEnvVars.length) {
    console.log(`\n${BOLD}Optional Env Vars:${RESET}`);
    t.optionalEnvVars.forEach(v => console.log(`  ${DIM}• ${v}${RESET}`));
  }
  console.log(`\n${BOLD}Required Tools:${RESET}`);
  t.requiredTools.forEach(v => console.log(`  • ${v}`));
  if (t.optionalTools && t.optionalTools.length) {
    console.log(`\n${BOLD}Optional Tools:${RESET}`);
    t.optionalTools.forEach(v => console.log(`  ${DIM}• ${v}${RESET}`));
  }
  console.log(`\n${BOLD}Crons:${RESET}`);
  t.crons.forEach(c => console.log(`  • ${c.name} — ${c.schedule} — ${c.description}`));
  console.log(`\n${BOLD}Setup Steps:${RESET}`);
  t.setupSteps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  if (t.notes && t.notes.length) {
    console.log(`\n${BOLD}Notes:${RESET}`);
    t.notes.forEach(n => console.log(`  ${DIM}ℹ ${n}${RESET}`));
  }
  console.log(`\nTo use this template:`);
  console.log(`  node setup.js --template ${t.slug}\n`);
  process.exit(0);
}

// Default: list all
console.log(`\n${BOLD}Available Templates${RESET}  ${DIM}(node setup.js --template <slug> to use one)${RESET}\n`);

const colWidth = Math.max(...templates.map(t => t.slug.length)) + 2;

for (const t of templates) {
  const slugPad = t.slug.padEnd(colWidth);
  const diff = `${difficultyColor(t.difficulty)}${t.difficulty}${RESET}`;
  const platforms = `${DIM}[${t.platforms.join(', ')}]${RESET}`;
  console.log(`  ${BOLD}${slugPad}${RESET}  ${t.description.split('.')[0]}  ${diff}  ${platforms}`);
}

console.log(`\n${DIM}Run 'node list-templates.js --slug <slug>' for details on a template.${RESET}\n`);
