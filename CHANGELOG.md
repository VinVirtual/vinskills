# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.0.0] - 2026-11-24

### Changed
- **Split into repositories.** The eight `vin-core` skills now live in their own public
  repositories, each with its own tests, CI, licence and v1.0.0 release:
  [vin-house-build](https://github.com/VinVirtual/vin-house-build),
  [vin-agent-orchestration](https://github.com/VinVirtual/vin-agent-orchestration),
  [vin-site-qa](https://github.com/VinVirtual/vin-site-qa),
  [vin-meter](https://github.com/VinVirtual/vin-meter),
  [vin-navigator](https://github.com/VinVirtual/vin-navigator),
  [vin-docs](https://github.com/VinVirtual/vin-docs),
  [vin-squeeze](https://github.com/VinVirtual/vin-squeeze) and
  [vin-scriptlens](https://github.com/VinVirtual/vin-scriptlens).
- **`vin-burn` is renamed `vin-meter`**, including its CLI (`scripts/vin-meter.mjs`).
- VinSkills is now a pure marketplace: `catalog.json` lists all 29 skill repositories, each its
  own plugin pinned to a commit. `vin-core` is a bundle like the other three, so
  `/plugin install vin-core@vinskills` still installs all eight core skills, and each can be
  installed alone (for example `/plugin install vin-meter@vinskills`).
- README: one table of every skill with its repository link; install commands for bundles and
  single skills.
- Tests: the skill tests moved to the skill repositories. Here they check the catalog, the
  generated files, the bundles, that no skill code is left in this repository, banned names,
  and (online) that every pinned repository is public and has a SKILL.md with the plugin's name
  and a licence at the pinned commit.

### Removed
- `plugins/vin-core/skills/` and the `examples/` folder (now in vin-site-qa and vin-docs).
- The `playwright-core` dev dependency and the poppler step in CI, no longer needed here.

## [1.0.0] - 2026-11-24

### Added
- Claude Code plugin marketplace `vinskills` (`.claude-plugin/marketplace.json`), generated from `catalog.json`.
- 21 skill plugins, one per public skill repository, each a GitHub source pinned to a reviewed commit.
- Bundles `vin-media` (9 skills), `vin-robotics` (8) and `vin-ai-eval` (4): manifests whose dependencies install their members.
- `vin-core` plugin with eight original skills:
  - `vin-house-build`: brief-to-release flow with agents, agent rules, `privacy-scan.mjs`, `fresh-clone-check.sh`.
  - `vin-agent-orchestration`: briefing subagents, parallel work in one repository, report format.
  - `vin-site-qa`: screenshots at 390/1024/1440 in both themes, WebKit iPhone pass, reduced motion, console, CSP and headers, prerender/SEO, quick accessibility, LCP/CLS/JS budgets.
  - `vin-burn`: token and cost report from local Claude Code transcripts by day, project, model, tool and task category; JSON and CSV.
  - `vin-navigator`: symbol index (Universal Ctags or a built-in extractor for JS/TS/Python/Go/Swift) with find, show, refs, outline and map.
  - `vin-docs`: PDF, DOCX, XLSX, PPTX and HTML to Markdown, with its own ZIP and XML readers.
  - `vin-squeeze`: shrinks logs, command output and JSON, keeps error lines, saves the original.
  - `vin-scriptlens`: runs a small script over large JSON in a locked-down Node process.
- `scripts/build-marketplace.mjs` (`--pin`, `--check`) and `scripts/validate.mjs`.
- Offline test suite (`npm test`) and online source checks (`npm run test:online`).
- CI workflow running the tests, the generated-file check and skill-ci.
