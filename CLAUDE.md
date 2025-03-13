# CLAUDE.md - Codebase Guidelines

## Build Commands
- **Build:** `npm run build` (all packages) or `cd apps/web && npm run build`
- **Dev:** `npm run dev` (all packages) or `cd apps/web && npm run dev` (Next.js app with Turbopack)
- **Processor:** `cd apps/processor && npm run dev` (runs with ts-node-dev hot reload)
- **Test:** `cd apps/processor && npm run test:analysis` (for book analysis testing)
- **OCR Process:** `cd apps/processor && npm run ocr:process`

## Lint & Type Checking
- **Lint:** `npm run lint` (all) or `cd apps/<app> && npm run lint`
- **Type Check:** `npm run check-types` (all) or `cd apps/<app> && npm run check-types`
- **Format:** `npm run format` (uses Prettier)

## Code Style Guidelines
- **TypeScript:** Use strong typing; avoid `any` unless necessary
- **React:** Functional components with hooks, no class components
- **Naming:** camelCase for variables/functions, PascalCase for components/types
- **Imports:** Group imports (React, libraries, local) with blank line between
- **Error Handling:** Use try/catch blocks with appropriate error logging
- **API Requests:** Centralize in service files, use async/await with proper error handling
- **Comments:** Document complex logic and interfaces, but prefer self-documenting code