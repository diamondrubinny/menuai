# Contributing

1. Fork and create a branch.
2. `npm install`, `npm run dev`.
3. Before opening a PR: `npm run typecheck && npm test && npm run test:e2e`.
4. Keep UI strings in `src/i18n/ui.ts` (every key in he/en/ar — a test enforces it) and menu labels in `src/core/labels.ts`.
5. New themes must pass the contrast test; new UI must be keyboard- and screen-reader-accessible (axe runs in CI).
6. Translations of menu labels are welcome — native-speaker review preferred.

## License of contributions

MenuAI is licensed under the GNU AGPL-3.0-only with additional attribution terms (see `NOTICE`). By submitting a contribution you agree that it is licensed under the same terms. Do not remove or alter the license headers or the "Powered by MenuAI" credit — CI (`npm run check:attribution`) will fail.
