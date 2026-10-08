# Contributing to Media Toolkit Pro

Welcome! This guide will help you get started contributing to Media Toolkit Pro.

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Git
- Familiarity with React and Electron

### Setup Development Environment

1. **Fork and clone** the repository

   ```bash
   git clone https://github.com/YOUR_USERNAME/Media-ToolKit-Pro.git
   cd Media-ToolKit-Pro
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start development mode**

   ```bash
   npm run dev
   ```

   This will start Vite dev server and launch Electron.

### Project Structure

Familiarize yourself with the layout:

```
├── src/
│   ├── pages/          # Page components (Auth, Dashboard, Tools, etc.)
│   ├── components/     # Reusable UI components
│   ├── lib/            # Utilities, hooks, API helpers
│   ├── App.jsx         # Main app router and layout
│   └── main.jsx        # React entry point
├── electron/           # Electron main process (IPC, window management)
├── tests/              # Test files
├── scripts/            # Build automation scripts
└── build/              # Assets, icons, installer configs
```

## Development Workflow

### Creating a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

Use descriptive branch names:
- `feature/` — New features
- `fix/` — Bug fixes
- `docs/` — Documentation updates
- `refactor/` — Code improvements

### Code Style

- Use consistent indentation (2 spaces)
- Follow React hooks conventions
- Use meaningful variable and function names
- Comment complex logic
- Keep components focused and modular

### Running Tests

```bash
npm run test
```

Tests are located in the `tests/` directory. Write tests for new features.

### Building the App

Before submitting a PR, test the build:

```bash
npm run build:ui
npm run dist
```

This creates distributable packages for your platform.

## Making Changes

### Adding a New Feature

1. Create a new branch
2. Implement your feature in `src/`
3. Add or update tests in `tests/`
4. Update relevant documentation
5. Commit with clear messages
6. Open a pull request with a detailed description

### Fixing a Bug

1. Create a new branch from `main`
2. Write a test that reproduces the bug (if applicable)
3. Implement the fix
4. Verify tests pass
5. Commit and open a pull request

### Updating Documentation

Documentation files are in the `docs/` directory. Use clear, concise language.

## Commit Guidelines

Write clear, descriptive commit messages:

```
feat: add video encoding tool
fix: resolve crash when uploading large files
docs: update installation instructions
refactor: simplify job queue logic
```

Format:
```
<type>: <short description>

<optional longer description>
```

Types:
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation
- `style` — Formatting (no logic change)
- `refactor` — Code restructuring
- `test` — Tests
- `chore` — Build, deps, maintenance

## Pull Request Process

1. **Update your branch** with latest main

   ```bash
   git fetch origin
   git rebase origin/main
   ```

2. **Run tests** to ensure nothing breaks

   ```bash
   npm run test
   npm run build:ui
   ```

3. **Push your changes**

   ```bash
   git push origin feature/your-feature-name
   ```

4. **Open a Pull Request** on GitHub
   - Provide a clear title and description
   - Reference related issues (e.g., `Closes #42`)
   - Include screenshots for UI changes
   - Mention breaking changes if any

5. **Address review feedback** — Maintainers will review and suggest improvements

6. **Merge** — After approval, your PR will be merged!

## Architecture & Design Patterns

### Component Structure

Components follow this pattern:

```jsx
import { useState } from 'react';

function MyComponent({ prop1, prop2 }) {
  const [state, setState] = useState(null);

  const handleAction = () => {
    // Action logic
  };

  return (
    <div>
      {/* JSX */}
    </div>
  );
}

export default MyComponent;
```

### Hooks

Custom hooks are in `src/lib/` (e.g., `useJobs.js`). Use them to share stateful logic.

### API Integration

API calls are handled in `src/lib/api.js`. Keep API logic separate from components.

## Testing

Write tests alongside features:

```bash
npm run test
```

Tests should cover:
- Component rendering
- User interactions
- API integration
- Edge cases

## Debugging

### Debugging the Renderer Process

Use React Developer Tools (installed via npm):

```bash
npm run dev
```

Then open DevTools in Electron (Ctrl+Shift+I).

### Debugging the Main Process

Add logs to `electron/main.js`:

```javascript
console.log('Debug info:', data);
```

Check the terminal where you ran `npm run dev`.

## Common Issues

### Build Fails

1. Clear node_modules and reinstall
   ```bash
   rm -rf node_modules
   npm install
   ```
2. Check Node version: `node --version` (needs 18+)

### Electron Won't Launch

1. Ensure frontend built: `npm run build:ui`
2. Check for port conflicts (Vite uses 5173)
3. Review Electron logs in terminal

### Tests Failing

1. Run individual test: `npm run test -- tests/specific.test.js`
2. Check test output for detailed errors
3. Verify mocks and dependencies

## Getting Help

- **GitHub Discussions** — Ask questions
- **Issues** — Report bugs or request features
- **Slack/Discord** — (if available) — Real-time chat
- **Documentation** — Check `docs/` folder

## Code Review Process

After opening a PR:

1. Automated checks run (tests, linting)
2. Maintainers review code
3. Discuss and iterate on feedback
4. Merge when approved

## Recognition

Contributors are recognized in:
- Release notes
- Contributors list in README
- GitHub contributors page

Thank you for contributing! 🎉
