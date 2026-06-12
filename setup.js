#!/usr/bin/env node
/**
 * Interactive setup wizard for the content pipeline.
 * Walks through: API keys → app creation → notification channel → content config → cron setup
 *
 * Usage:
 *   node setup.js                          # generic interactive setup
 *   node setup.js --template <slug>        # use a pre-built template
 *   node setup.js --list-templates         # show all available templates
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HOME = process.env.HOME || '';
const SKILL_DIR = path.dirname(path.resolve(__filename || process.argv[1]));
const LOAD_ENV_PATH = path.join(SKILL_DIR, 'load-env.sh');
const TEMPLATES_DIR = path.join(SKILL_DIR, 'templates');

// Handle --list-templates early (no rl needed)
if (process.argv.includes('--list-templates')) {
  try {
    execSync(`node "${path.join(SKILL_DIR, 'scripts/list-templates.js')}"`, { stdio: 'inherit' });
  } catch {}
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultValue) {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function askRequired(question) {
  return new Promise((resolve) => {
    const prompt = `${question}: `;
    function tryAgain() {
      rl.question(prompt, (answer) => {
        const val = answer.trim();
        if (val) resolve(val);
        else { console.log('  ⚠ This field is required.'); tryAgain(); }
      });
    }
    tryAgain();
  });
}

function updateLoadEnv(envVars) {
  let content = '';
  if (fs.existsSync(LOAD_ENV_PATH)) {
    content = fs.readFileSync(LOAD_ENV_PATH, 'utf-8');
  } else {
    // Start from example if available
    const examplePath = path.join(SKILL_DIR, 'templates', 'load-env.example.sh');
    if (fs.existsSync(examplePath)) {
      content = fs.readFileSync(examplePath, 'utf-8');
    } else {
      content = '#!/bin/bash\n# Content pipeline environment variables\n';
    }
  }

  for (const [key, value] of Object.entries(envVars)) {
    if (!value) continue;
    const exportLine = `export ${key}="${value}"`;
    const pattern = new RegExp(`^export ${key}=.*$`, 'm');
    if (pattern.test(content)) {
      content = content.replace(pattern, exportLine);
    } else {
      content += `\n${exportLine}`;
    }
  }

  fs.writeFileSync(LOAD_ENV_PATH, content);
  console.log(`  ✅ Updated ${LOAD_ENV_PATH}`);
}

async function runTemplateSetup(templateSlug) {
  const templateDir = path.join(TEMPLATES_DIR, templateSlug);
  const templateJsonPath = path.join(templateDir, 'template.json');

  if (!fs.existsSync(templateJsonPath)) {
    console.error(`\n❌ Template not found: ${templateSlug}`);
    console.error(`Run 'node setup.js --list-templates' to see available templates.\n`);
    rl.close();
    process.exit(1);
  }

  const tmpl = JSON.parse(fs.readFileSync(templateJsonPath, 'utf-8'));

  console.log(`\n🎯 Template: ${tmpl.name}`);
  console.log(`   ${tmpl.description}\n`);
  console.log(`Platforms:   ${tmpl.platforms.join(', ')}`);
  console.log(`Difficulty:  ${tmpl.difficulty}`);
  console.log(`\nRequired env vars:`);
  tmpl.requiredEnvVars.forEach(v => console.log(`  • ${v}`));
  if (tmpl.optionalEnvVars && tmpl.optionalEnvVars.length) {
    console.log(`Optional:`);
    tmpl.optionalEnvVars.forEach(v => console.log(`  • ${v}`));
  }
  console.log('');

  // 1. App name
  const appName = await askRequired('App name? (lowercase, no spaces, e.g. myapp)');
  const appNameClean = appName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  if (appNameClean !== appName) console.log(`  → Normalized to: ${appNameClean}`);

  const apiKeyEnvName = `DROPSPACE_API_KEY_${appNameClean.toUpperCase().replace(/-/g, '_')}`;

  // 2. Dropspace API key (always required)
  console.log('\nDropspace API key? Get one at https://dropspace.dev → Settings → API Keys');
  const dropspaceKey = await ask('   Key (ds_live_...)', 'paste-key-here');

  // 3. Template-specific env vars
  const envVars = { [apiKeyEnvName]: dropspaceKey };
  const templateEnvVars = tmpl.requiredEnvVars.filter(v => !v.startsWith('DROPSPACE_API_KEY'));
  for (const envVar of templateEnvVars) {
    // Strip parenthetical descriptions
    const cleanVar = envVar.split(' ')[0];
    if (!cleanVar.includes('_KEY') && !cleanVar.includes('_TOKEN') && !cleanVar.includes('_SECRET')) continue;
    const val = await ask(`\n${envVar}`, 'paste-key-here');
    if (val && val !== 'paste-key-here') envVars[cleanVar] = val;
  }

  // 4. Write load-env.sh
  updateLoadEnv(envVars);

  // 5. Run init-app.js
  const initScript = path.join(SKILL_DIR, 'scripts/init-app.js');
  const initCmd = `node "${initScript}" --app ${appNameClean} --platforms ${tmpl.platforms.join(',')}`;
  console.log(`\nRunning: ${initCmd}`);
  try {
    execSync(initCmd, { stdio: 'inherit' });
  } catch (err) {
    console.error(`\n❌ init-app.js failed: ${err.message}`);
    rl.close();
    process.exit(1);
  }

  // 6. Copy template files and replace placeholders
  const pathsLib = require('./core/paths');
  const appConfigPath = pathsLib.appConfigPath(appNameClean);
  const configDir = path.join(pathsLib.appRoot(appNameClean), 'config');
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  const filesToCopy = tmpl.files || ['app.json', 'FORMAT.md', 'CONTEXT.md'];
  for (const fileName of filesToCopy) {
    const srcPath = path.join(templateDir, fileName);
    if (!fs.existsSync(srcPath)) {
      console.log(`  ⚠ Template file ${fileName} not found — skipping`);
      continue;
    }

    let content = fs.readFileSync(srcPath, 'utf-8');
    // Replace placeholders
    content = content.replace(/\{\{APP_NAME\}\}/g, appNameClean);
    content = content.replace(/\{\{API_KEY_ENV\}\}/g, apiKeyEnvName);

    let dstPath;
    if (fileName === 'app.json') {
      dstPath = appConfigPath;
    } else {
      dstPath = path.join(configDir, fileName);
    }

    fs.writeFileSync(dstPath, content);
    console.log(`  📄 Wrote ${fileName} → ${dstPath}`);
  }

  // 7. Print template-specific setup steps
  console.log('\n─────────────────────────────────');
  console.log(`✅ Template "${tmpl.name}" applied!\n`);
  console.log('Next steps:\n');
  tmpl.setupSteps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));

  console.log('\nCrons to set up:');
  tmpl.crons.forEach(c => {
    console.log(`\n  ${c.name}: ${c.schedule}`);
    console.log(`    ${c.description}`);
  });

  if (tmpl.notes && tmpl.notes.length) {
    console.log('\nNotes:');
    tmpl.notes.forEach(n => console.log(`  ℹ ${n}`));
  }

  console.log(`\nRun 'node list-templates.js --slug ${templateSlug}' for full template details.\n`);

  rl.close();
}

async function main() {
  // Check for --template flag
  const templateFlagIdx = process.argv.indexOf('--template');
  if (templateFlagIdx >= 0) {
    const templateSlug = process.argv[templateFlagIdx + 1];
    if (!templateSlug || templateSlug.startsWith('--')) {
      console.error('\n❌ --template requires a slug. Run --list-templates to see options.\n');
      rl.close();
      process.exit(1);
    }
    return runTemplateSetup(templateSlug);
  }

  console.log('\n🚀 Content Pipeline Setup Wizard\n');
  console.log('This wizard will configure a new app for the autonomous content pipeline.');
  console.log('Press Enter to accept defaults shown in [brackets].\n');
  console.log('Tip: Use --template <slug> to start from a pre-built template.');
  console.log('     Use --list-templates to see all available templates.\n');

  // 1. App name
  const appName = await askRequired('1. App name? (lowercase, no spaces, e.g. myapp)');
  const appNameClean = appName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  if (appNameClean !== appName) {
    console.log(`  → Normalized to: ${appNameClean}`);
  }

  // 2. Dropspace API key
  console.log('\n2. Dropspace API key? Get one at https://dropspace.dev → Settings → API Keys');
  const dropspaceKey = await ask('   Key (ds_live_...)', 'paste-key-here');
  const apiKeyEnvName = `DROPSPACE_API_KEY_${appNameClean.toUpperCase().replace(/-/g, '_')}`;

  // 3. Anthropic API key
  const anthropicKey = await ask('\n3. Anthropic API key? (https://console.anthropic.com)', 'paste-key-here');

  // 4. Image provider
  console.log('\n4. Image provider for visual formats (TikTok/Instagram slideshows)?');
  console.log('   Options: fal (default, ~$0.08/img), replicate (~$0.003/img), openai (~$0.04/img), none (text-only)');
  const imageProvider = await ask('   Provider', 'fal');
  let imageProviderKey = '';
  let imageProviderEnvKey = '';
  if (imageProvider === 'fal') {
    imageProviderEnvKey = 'FAL_KEY';
    imageProviderKey = await ask('   Fal.ai API key (https://fal.ai → Keys)', 'paste-key-here');
  } else if (imageProvider === 'replicate') {
    imageProviderEnvKey = 'REPLICATE_API_TOKEN';
    imageProviderKey = await ask('   Replicate API token (https://replicate.com → API tokens)', 'paste-key-here');
  } else if (imageProvider === 'openai') {
    imageProviderEnvKey = 'OPENAI_API_KEY';
    imageProviderKey = await ask('   OpenAI API key (https://platform.openai.com → API keys)', 'paste-key-here');
  }

  // 5. Platforms
  console.log('\n5. Which platforms to post to?');
  console.log('   Visual: tiktok, instagram | Text: twitter, linkedin, reddit, facebook');
  const platformsInput = await ask('   Platforms (comma-separated)', 'tiktok,twitter,linkedin');
  const platforms = platformsInput.split(',').map(s => s.trim()).filter(Boolean);

  // 6. Notification channel
  console.log('\n6. Where should reports be sent?');
  const notifyChannel = await ask('   Channel (slack/telegram/discord/none)', 'none');
  let notifyTarget = '';
  if (notifyChannel !== 'none') {
    if (notifyChannel === 'slack') notifyTarget = await ask('   Slack channel ID (e.g. C0CHANNEL_ID)');
    else if (notifyChannel === 'telegram') notifyTarget = await ask('   Telegram chat ID');
    else if (notifyChannel === 'discord') notifyTarget = await ask('   Discord channel ID');
    else notifyTarget = await ask('   Channel target/ID');
  }

  // 7-11. Product details
  const productUrl = await ask('\n7. Your product URL (e.g. https://myapp.com)');
  const description = await ask('\n8. One-line description of your product');
  const audience = await ask('\n9. Who is your audience? (e.g. indie hackers, solo founders)');
  const problem = await ask('\n10. What problem do you solve?');
  const voice = await ask('\n11. Describe your content voice', 'lowercase, casual, genuine, like a real person not a brand');

  console.log('\n─────────────────────────────────');
  console.log('Setting up your app...\n');

  // Write load-env.sh
  const envVars = {
    [apiKeyEnvName]: dropspaceKey,
    ANTHROPIC_API_KEY: anthropicKey,
  };
  if (imageProviderEnvKey && imageProviderKey) {
    envVars[imageProviderEnvKey] = imageProviderKey;
  }
  updateLoadEnv(envVars);

  // Run init-app.js
  const initScript = path.join(SKILL_DIR, 'scripts/init-app.js');
  const notifyFlag = notifyChannel !== 'none' && notifyTarget
    ? `--notify ${notifyChannel}:${notifyTarget}`
    : '';
  const initCmd = `node "${initScript}" --app ${appNameClean} --platforms ${platforms.join(',')} ${notifyFlag}`;
  console.log(`\nRunning: ${initCmd}`);
  try {
    execSync(initCmd, { stdio: 'inherit' });
  } catch (err) {
    console.error(`\n❌ init-app.js failed: ${err.message}`);
    rl.close();
    process.exit(1);
  }

  // Update app.json with product details
  const pathsLib = require('./core/paths');
  const appConfigPath = pathsLib.appConfigPath(appNameClean);
  try {
    const config = JSON.parse(fs.readFileSync(appConfigPath, 'utf-8'));
    config.url = productUrl || config.url;
    config.description = description || config.description;
    config.audience = audience || config.audience;
    config.problem = problem || config.problem;
    config.voice = voice || config.voice;
    config.apiKeyEnv = apiKeyEnvName;
    if (imageProvider && imageProvider !== 'none') {
      config.mediaGen = config.mediaGen || {};
      config.mediaGen.image = { provider: imageProvider, envKey: imageProviderEnvKey };
    }
    fs.writeFileSync(appConfigPath, JSON.stringify(config, null, 2));
    console.log(`\n✅ Updated app.json with product details`);
  } catch (err) {
    console.error(`\n⚠ Could not update app.json: ${err.message}`);
  }

  // Copy FORMAT.md.example and CONTEXT.md.example
  const configDir = path.join(pathsLib.appRoot(appNameClean), 'config');
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  const templates = [
    ['FORMAT.md.example', 'FORMAT.md'],
    ['CONTEXT.md.example', 'CONTEXT.md'],
  ];
  for (const [src, dst] of templates) {
    const srcPath = path.join(SKILL_DIR, 'templates', src);
    const dstPath = path.join(configDir, dst);
    if (fs.existsSync(srcPath) && !fs.existsSync(dstPath)) {
      fs.copyFileSync(srcPath, dstPath);
      console.log(`  📄 Copied ${dst} → ${dstPath}`);
    } else if (!fs.existsSync(srcPath)) {
      console.log(`  ⚠ Template ${src} not found — create ${dstPath} manually`);
    }
  }

  // Print next steps
  console.log('\n─────────────────────────────────');
  console.log('✅ Setup complete!\n');
  console.log('Next steps:\n');
  console.log(`  1. Review and edit your app config:`);
  console.log(`     ${appConfigPath}`);
  console.log(`\n  2. Edit your content guidelines:`);
  console.log(`     ${configDir}/FORMAT.md   ← voice + style rules`);
  console.log(`     ${configDir}/CONTEXT.md  ← product facts + claims`);
  console.log(`\n  3. Test the pipeline:`);
  console.log(`     source ${LOAD_ENV_PATH}`);
  console.log(`     node ${path.join(SKILL_DIR, 'scripts/test-pipeline.js')} --app ${appNameClean}`);
  console.log(`\n  4. Set up crons:`);
  console.log(`     node ${path.join(SKILL_DIR, 'scripts/setup-crons.js')}`);

  rl.close();
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  rl.close();
  process.exit(1);
});
