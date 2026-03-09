# Contributing to QTI Scoring System

We welcome contributions! Please follow these guidelines to ensure a smooth collaboration.

## Getting Started

1.  Fork the repository.
2.  Clone your fork: `git clone https://github.com/metyatech/qti-scoring-system.git`
3.  Install dependencies: `npm install`
4.  Create a branch for your changes: `git checkout -b my-feature-branch`

## Development

- Write clean, documented code.
- Follow existing coding conventions and style.
- Use `npm run lint` and `npm run test` to verify your changes.

## Verification

Before submitting a Pull Request, run the full verification suite:

```bash
npm run verify
```

This ensures that linting, unit tests, E2E tests, and build all pass.

## Submitting a Pull Request

1.  Ensure all tests pass.
2.  Provide a clear description of your changes.
3.  Maintain a concise commit history.
4.  Submit your PR for review.

## Coding Standards

- Use TypeScript for all new code.
- Follow [AGENTS.md](./AGENTS.md) for project-wide rules and engineering standards.
- Automated tests are required for all behavioral changes.
